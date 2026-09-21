import { planWithCodex } from './planner.js';
import { planWithVertex, vertexConfig } from './vertex.js';
import { fail } from './http.js';

export function plannerStatus(env) {
  const provider = env.HCR_PLANNER_PROVIDER || 'codex';
  let configured = false;
  if (provider === 'vertex') {
    try { vertexConfig(env); configured = true; } catch { /* configuration only, not a live probe */ }
  } else if (provider === 'codex') {
    configured = ['OPENAI_API_KEY', 'CODEX_MODEL'].every(k => typeof env[k] === 'string' && !!env[k].trim());
  }
  return { provider: ['codex', 'vertex'].includes(provider) ? provider : null, configured };
}

export function planProgram(input, env, options) {
  const { provider } = plannerStatus(env);
  if (provider === 'vertex') return planWithVertex(input, env, options);
  if (provider === 'codex') return planWithCodex(input, env, options);
  fail('Invalid planner provider', 503, 'planner_configuration');
}
