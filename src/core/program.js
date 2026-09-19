function identifier(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
}

export function validateProgram(program) {
  if (program?.version !== 1 || !identifier(program.constellationId) || !identifier(program.source) ||
      !Array.isArray(program.steps) || program.steps.length < 1 || program.steps.length > 12) {
    throw new Error('Invalid program');
  }
  const ids = new Set();
  for (const step of program.steps) {
    if (!step || !identifier(step.starId) || ids.has(step.starId)) throw new Error('Invalid star ID');
    ids.add(step.starId);
    if (!['leftWrist', 'rightWrist'].includes(step.joint)) throw new Error('Unsupported joint');
    if (!step.target || !['x', 'y'].every(k => Number.isFinite(step.target[k]) && step.target[k] >= 0.1 && step.target[k] <= 0.9)) {
      throw new Error('Target outside demo bounds');
    }
    if (!Number.isFinite(step.holdMs) || step.holdMs < 800 || step.holdMs > 5000) throw new Error('Invalid hold duration');
    if (!Number.isFinite(step.tolerance) || step.tolerance < 0.01 || step.tolerance > 0.06) throw new Error('Invalid tolerance');
  }
  return program;
}

// Normalized image bounds are NOT a physical reachability guarantee.
export function compileConstellation(constellation) {
  if (!constellation || !identifier(constellation.id) || !Array.isArray(constellation.stars) ||
      constellation.stars.some(star => !star)) throw new Error('Invalid constellation');
  return validateProgram({
    version: 1, source: 'deterministic-baseline', constellationId: constellation.id,
    steps: constellation.stars.map(star => ({
      starId: star.id, joint: 'rightWrist', target: { x: star.x, y: star.y }, holdMs: 800, tolerance: 0.045
    }))
  });
}
