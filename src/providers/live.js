import { compileConstellation, validateProgram } from '../core/program.js';
import { fail, required, getJSON } from './http.js';
export { observeSky } from './sky.js';

export async function decideReflex(input, env, options = {}) {
  if (!input || !Number.isFinite(input.dx) || !Number.isFinite(input.dy) ||
      Math.abs(input.dx) > 1 || Math.abs(input.dy) > 1 || typeof input.tracked !== 'boolean') fail('Invalid reflex input');
  const key = required(env, 'TYPESAFE_API_KEY');
  const criteria = {
    left: 'decrease image x', right: 'increase image x', up: 'decrease image y',
    down: 'increase image y', hold: 'close to target', wait: 'tracking unavailable'
  };
  const data = await getJSON('https://api.typesafe.ai/v1/systemone', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.JEV_MODEL || 'jev-latest', state: JSON.stringify(input),
      questions: { action: { type: 'choice',
        instructions: 'Choose an advisory cue. dx/dy = target minus current. If not tracked, wait. Never decide capture or safety.',
        criteria } }
    })
  }, options);
  const answer = data?.answers?.action;
  if (!answer || !Object.hasOwn(criteria, answer.choice) || !Number.isFinite(answer.confidence) ||
      answer.confidence < 0 || answer.confidence > 1) fail('Invalid Jev response', 502, 'invalid_response');
  return { source: 'jev-live', advisoryOnly: true, action: answer.choice, confidence: answer.confidence };
}

export async function planWithCodex(input, env, { signal } = {}) {
  required(env, 'OPENAI_API_KEY');
  const model = required(env, 'CODEX_MODEL');
  const constellation = input?.constellation;
  if (!constellation || typeof constellation.id !== 'string' || !Array.isArray(constellation.stars)) {
    fail('Catalog-backed normalized constellation required');
  }
  let baseline;
  try { baseline = compileConstellation(constellation); } catch { fail('Invalid constellation'); }
  const { Codex } = await import('@openai/codex-sdk');
  const codex = new Codex({ apiKey: env.OPENAI_API_KEY });
  const thread = codex.startThread({
    model, sandboxMode: 'read-only', approvalPolicy: 'never', skipGitRepoCheck: true, networkAccessEnabled: false
  });
  const timeout = AbortSignal.timeout(40000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let result;
  try {
    combined.throwIfAborted();
    result = await thread.run(
      'Return only JSON ProgramV1. Reorder steps to minimize hand travel; preserve each step exactly. No tools, files, shell or new coordinates. Symbolic choreography, not safety certification. Input: ' + JSON.stringify(baseline),
      { signal: combined }
    );
  } catch {
    if (signal?.aborted) fail('Request cancelled', 499, 'cancelled');
    if (timeout.aborted) fail('Planner timed out', 504, 'upstream_timeout');
    fail('Planner unavailable', 502, 'upstream_unavailable');
  }
  let program;
  try { program = validateProgram(JSON.parse(result.finalResponse)); }
  catch { fail('Invalid planner output', 502, 'invalid_response'); }
  if (program.steps.length !== baseline.steps.length || program.steps.some(s => {
    const b = baseline.steps.find(t => t.starId === s.starId);
    return !b || b.joint !== s.joint || b.target.x !== s.target.x || b.target.y !== s.target.y ||
      b.holdMs !== s.holdMs || b.tolerance !== s.tolerance;
  })) fail('Planner changed constraints', 502, 'invalid_response');
  return { ...program, source: 'codex-live', constellationId: baseline.constellationId };
}

