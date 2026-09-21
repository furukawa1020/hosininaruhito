import { validateProgram } from './program.js';
import { HumanRuntime } from './runtime.js';

export function canonicalProgram(value) {
  validateProgram(value);
  return { version: 1, constellationId: value.constellationId, source: value.source,
    steps: value.steps.map(s => ({ starId: s.starId, joint: s.joint,
      target: { x: s.target.x, y: s.target.y }, holdMs: s.holdMs, tolerance: s.tolerance })) };
}
export function reorderProgram(baseline, proposal, source = 'codex-live') {
  if (!['codex-live', 'vertex-live'].includes(source)) throw Error('invalid_source');
  const base = canonicalProgram(baseline);
  if (!proposal || Object.keys(proposal).length !== 1 || !Array.isArray(proposal.order) ||
      proposal.order.length !== base.steps.length || new Set(proposal.order).size !== base.steps.length)
    throw Error('invalid_order');
  const steps = proposal.order.map(id => base.steps.find(s => s.starId === id));
  if (steps.some(s => !s)) throw Error('invalid_order');
  return { ...base, steps, source };
}
export function validatePlannedProgram(baseline, candidate, source = 'codex-live') {
  const clean = canonicalProgram(candidate), base = canonicalProgram(baseline);
  if (!['codex-live', 'vertex-live'].includes(source) || clean.constellationId !== base.constellationId || clean.source !== source ||
      clean.steps.length !== base.steps.length || clean.steps.some(s => {
        const original = base.steps.find(b => b.starId === s.starId);
        return !original || JSON.stringify(s) !== JSON.stringify(original);
      })) throw Error('changed_constraints');
  return clean;
}
export function travel(program) {
  return program.steps.slice(1).reduce((sum, s, i) => sum +
    Math.hypot(s.target.x-program.steps[i].target.x, s.target.y-program.steps[i].target.y), 0);
}
// Synthetic contract simulation, never evidence of human reach or safety.
export function evaluatePlan(baseline, candidate, source = 'codex-live') {
  const program = validatePlannedProgram(baseline, candidate, source);
  if (travel(program) > travel(baseline) + 1e-9) return { ok: false, reason: 'longer_path' };
  const runtime = new HumanRuntime(program); runtime.start(); let now = 0;
  for (const step of program.steps) {
    for (let elapsed = 0; elapsed <= Math.ceil(step.holdMs / 50) * 50; elapsed += 50) {
      runtime.tick({ joint: step.joint, ...step.target, confidence: 1, at: now }, now); now += 50;
    }
  }
  if (runtime.state !== 'complete' || runtime.captures.length !== program.steps.length)
    return { ok: false, reason: 'simulation_failed' };
  return { ok: true, distance: travel(program), baselineDistance: travel(baseline), holdMs: program.steps.reduce((sum,s)=>sum+s.holdMs,0) };
}
