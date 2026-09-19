import { validateProgram } from './program.js';

export class HumanRuntime {
  constructor(program) { this.program = validateProgram(structuredClone(program)); this.reset(); }
  reset() { this.state = 'idle'; this.index = 0; this.captures = []; this.holdSince = null; this.lastAt = null; }
  start() { if (this.state !== 'complete') { this.state = 'running'; this.holdSince = null; this.lastAt = null; } }
  stop() { if (this.state !== 'complete') this.state = 'paused'; this.holdSince = null; this.lastAt = null; }
  get target() { return this.program.steps[this.index] ?? null; }
  tick(sample, now) {
    if (this.state !== 'running') return { action: 'stop' };
    const valid = sample && Number.isFinite(now) && Number.isFinite(sample.at) &&
      Number.isFinite(sample.x) && Number.isFinite(sample.y) && sample.x >= 0 && sample.x <= 1 && sample.y >= 0 && sample.y <= 1 &&
      sample.joint === this.target.joint && sample.confidence >= 0.8 && sample.confidence <= 1 && now >= sample.at && now - sample.at <= 150;
    if (!valid || (this.lastAt !== null && (now < this.lastAt || now - this.lastAt > 150))) {
      this.holdSince = null; this.lastAt = Number.isFinite(now) ? now : null; return { action: 'wait' };
    }
    this.lastAt = now;
    const { target, tolerance, holdMs } = this.target;
    const dx = target.x - sample.x, dy = target.y - sample.y;
    const error = Math.hypot(dx, dy);
    if (error > tolerance) {
      this.holdSince = null;
      return { action: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'), error };
    }
    this.holdSince ??= now;
    if (now - this.holdSince < holdMs) return { action: 'hold', error };
    const capture = { starId: this.target.starId, joint: sample.joint, x: sample.x, y: sample.y, at: now, error };
    this.captures.push(capture); this.index++; this.holdSince = null;
    if (!this.target) this.state = 'complete';
    return { action: 'capture', capture };
  }
}
