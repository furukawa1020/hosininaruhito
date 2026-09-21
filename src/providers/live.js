import { fail, required, getJSON } from './http.js';
export { observeSky } from './sky.js';

export async function decideReflex(input, env, options = {}) {
  if (!input || Object.keys(input).length !== 3 || !['dx','dy','tracked'].every(k=>Object.hasOwn(input,k)) || !Number.isFinite(input.dx) || !Number.isFinite(input.dy) ||
      Math.abs(input.dx) > 1 || Math.abs(input.dy) > 1 || typeof input.tracked !== 'boolean') fail('Invalid reflex input');
  const key = required(env, 'TYPESAFE_API_KEY');
  const criteria = {
    left: 'decrease image x', right: 'increase image x', up: 'decrease image y',
    down: 'increase image y', hold: 'close to target', wait: 'tracking unavailable'
  };
  const data = await getJSON('https://api.typesafe.ai/v1/systemone', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.JEV_MODEL || 'jev-latest', state: JSON.stringify({dx:input.dx,dy:input.dy,tracked:input.tracked}),
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

export { planWithCodex } from './planner.js';
