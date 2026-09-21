import { HumanRuntime } from './runtime.js';
import { isFreshPoseTime, MAX_POSE_AGE_MS } from './pose.js';
export const MAX_TRAIL_POINTS = 120;
export const TRAIL_DURATION_MS = 4000;
const validPoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

export class ConstellationTrace {
  constructor({ program = null, lines = [], joint = 'rightWrist' } = {}) {
    if (!['leftWrist', 'rightWrist'].includes(joint)) throw Error('Invalid joint');
    this.runtime = program ? new HumanRuntime(program) : null;
    this.joint = joint;
    const ids = new Set(this.runtime?.program.steps.map(step => step.starId) || []);
    if (!Array.isArray(lines) || lines.length > 100 || Array.from(lines).some(line =>
      !Array.isArray(line) || line.length < 2 || line.length > 12 || Array.from(line).some(id => !ids.has(id))))
      throw Error('Invalid constellation lines');
    const edges = new Map();
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      if (line[i - 1] === line[i]) throw Error('Invalid edge');
      const key = JSON.stringify([line[i - 1], line[i]].sort());
      edges.set(key, [line[i - 1], line[i]]);
    }
    this.edges = [...edges.values()];
    this.reset();
  }
  reset() {
    this.runtime?.reset();
    this.state = 'idle'; this.reason = 'idle';
    this.trail = []; this.current = null;
    this.lastAt = this.lastNow = this.startedAt = this.lastWatch = null;
  }
  start(now) {
    if (this.state === 'running' || this.state === 'complete') return;
    if (!Number.isFinite(now) || now < 0 || (this.lastNow !== null && now < this.lastNow)) { this.stop('invalid_clock'); return; }
    this.runtime?.start();
    this.trail = []; this.current = null; this.lastAt = null;
    this.startedAt = this.lastNow = this.lastWatch = now;
    this.state = 'running'; this.reason = 'running';
  }
  stop(reason = 'manual') {
    this.runtime?.stop(reason);
    if (this.state !== 'complete') this.state = 'paused';
    this.reason = reason;
    this.current = null;
  }
  watch(now) {
    if (this.state !== 'running') return;
    if (!Number.isFinite(now) || now < Math.max(this.lastNow, this.lastWatch)) this.stop('invalid_clock');
    else if (now - (this.lastAt ?? this.startedAt) > MAX_POSE_AGE_MS) this.stop('stale_sample');
    this.lastWatch = now;
  }
  tick(sample, now) {
    if (this.state !== 'running') return;
    const joint = this.runtime?.target?.joint || this.joint;
    if (!validPoint(sample) || sample.joint !== joint || !Number.isFinite(sample.confidence) ||
        sample.confidence < .8 || sample.confidence > 1) { this.stop('tracking_lost'); return; }
    if (!isFreshPoseTime(sample.at, now, this.lastAt) || now < this.lastNow ||
        (this.lastAt !== null && sample.at - this.lastAt > MAX_POSE_AGE_MS) ||
        now - this.lastNow > MAX_POSE_AGE_MS) { this.stop('stale_sample'); return; }
    if (sample.at < this.startedAt) return;
    const event = this.runtime?.tick(sample, now);
    if (event?.action === 'stop') { this.stop(event.reason); return event; }
    this.lastAt = sample.at; this.lastNow = now;
    this.current = { x: sample.x, y: sample.y, at: sample.at, joint };
    this.trail = this.trail.filter(p => sample.at - p.at <= TRAIL_DURATION_MS);
    if (!this.trail.length || sample.at - this.trail.at(-1).at >= 33) this.trail.push({ ...this.current });
    if (this.trail.length > MAX_TRAIL_POINTS) this.trail.shift();
    if (this.runtime?.state === 'complete') { this.state = this.reason = 'complete'; this.current = null; }
    return event;
  }
  snapshot() {
    const captures = structuredClone(this.runtime?.captures || []);
    const captured = new Map(captures.map(p => [p.starId, p]));
    return {
      state: this.state, reason: this.reason,
      current: this.current ? { ...this.current } : null,
      trail: this.trail.map(p => ({ ...p, brightness: .12 + .65 * Math.max(0, 1 - ((this.lastAt ?? p.at) - p.at) / TRAIL_DURATION_MS) })),
      captures,
      targets: (this.runtime?.program.steps || []).filter(step => !captured.has(step.starId))
        .map(step => ({ starId: step.starId, ...step.target })),
      lines: this.edges.filter(([a, b]) => captured.has(a) && captured.has(b))
        .map(([a, b]) => [{ ...captured.get(a) }, { ...captured.get(b) }])
    };
  }
}
