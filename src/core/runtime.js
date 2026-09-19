import { validateProgram } from './program.js';

const MAX_SAMPLE_AGE_MS = 150;

export class HumanRuntime {
  constructor(program) {
    this.program = validateProgram(structuredClone(program));
    this.reset();
  }
  reset() {
    this.state = 'idle';
    this.index = 0;
    this.captures = [];
    this.holdSince = null;
    this.lastAt = null;
    this.lastSampleAt = null;
    this.stopReason = null;
  }
  start() {
    if (this.state === 'running' || this.state === 'complete') return;
    this.state = 'running';
    this.holdSince = null;
    this.lastAt = null;
    this.lastSampleAt = null;
    this.stopReason = null;
  }
  stop(reason = 'manual') {
    if (this.state !== 'complete') this.state = 'paused';
    this.holdSince = null;
    this.lastAt = null;
    this.lastSampleAt = null;
    this.stopReason = reason;
  }
  get target() { return this.program.steps[this.index] ?? null; }
  pause(reason) {
    this.stop(reason);
    return { action: 'stop', reason };
  }
  tick(sample, now) {
    if (this.state !== 'running') return { action: 'stop' };
    if (!Number.isFinite(now) || now < 0 || (this.lastAt !== null && now < this.lastAt)) {
      return this.pause('invalid_clock');
    }
    if (!sample || !Number.isFinite(sample.at) || sample.at < 0 ||
        !Number.isFinite(sample.x) || !Number.isFinite(sample.y) ||
        sample.x < 0 || sample.x > 1 || sample.y < 0 || sample.y > 1 ||
        sample.joint !== this.target.joint || !Number.isFinite(sample.confidence) ||
        sample.confidence < 0.8 || sample.confidence > 1) {
      return this.pause('tracking_lost');
    }
    if (now < sample.at || now - sample.at > MAX_SAMPLE_AGE_MS) return this.pause('stale_sample');
    if (this.lastSampleAt !== null && sample.at <= this.lastSampleAt) return this.pause('out_of_order_sample');
    if ((this.lastAt !== null && now - this.lastAt > MAX_SAMPLE_AGE_MS) ||
        (this.lastSampleAt !== null && sample.at - this.lastSampleAt > MAX_SAMPLE_AGE_MS)) {
      return this.pause('frame_gap');
    }
    this.lastAt = now;
    this.lastSampleAt = sample.at;
    const { target, tolerance, holdMs } = this.target;
    const dx = target.x - sample.x, dy = target.y - sample.y;
    const error = Math.hypot(dx, dy);
    if (error > tolerance) {
      this.holdSince = null;
      return { action: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'), error };
    }
    // Hold is measured by fresh sensor timestamps, not render/dispatch latency.
    this.holdSince ??= sample.at;
    if (sample.at - this.holdSince < holdMs) return { action: 'hold', error };
    const capture = {
      starId: this.target.starId, joint: sample.joint, x: sample.x, y: sample.y,
      at: sample.at, capturedAt: now, error
    };
    this.captures.push(capture);
    this.index++;
    this.holdSince = null;
    if (!this.target) this.state = 'complete';
    return { action: 'capture', capture };
  }
}
