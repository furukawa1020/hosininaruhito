import { isFreshPoseTime, MAX_POSE_AGE_MS } from './pose.js';
import { validateProgram } from './program.js';

const JOINTS = ['leftWrist', 'rightWrist'];
const POSTURES = ['seated', 'standing'];
const MIN_DURATION_MS = 3000;
const MAX_DURATION_MS = 30000;
const SUPPORT_RADIUS = 0.025;
const validPoint = p => p && ['x', 'y'].every(k => Number.isFinite(p[k]) && p[k] >= 0 && p[k] <= 1);
const validSize = size => size && ['width', 'height'].every(k => Number.isInteger(size[k]) && size[k] > 0);
const sameSize = (a, b) => a?.width === b?.width && a?.height === b?.height;

// This is observed image-space coverage, never a claim of physical reach or safety.
export class ReachCalibration {
  constructor() { this.clear('idle', 'idle'); }
  clear(reason = 'manual', state = 'paused') {
    this.state = state;
    this.reason = reason;
    this.points = [];
    this.result = null;
    this.options = null;
    this.startedAt = this.firstAt = this.lastAt = this.lastNow = null;
  }
  start(options, now) {
    this.clear();
    if (!JOINTS.includes(options?.joint) || !POSTURES.includes(options?.posture) ||
        !validSize(options?.size) || !Number.isFinite(now) || now < 0) {
      this.reason = 'invalid_setup'; return;
    }
    this.options = structuredClone(options);
    this.startedAt = this.lastNow = now;
    this.state = this.reason = 'collecting';
  }
  tick(sample, now, size) {
    if (!['collecting', 'ready'].includes(this.state)) return;
    if (!sameSize(size, this.options.size)) { this.clear('frame_changed'); return; }
    if (!validPoint(sample) || sample.joint !== this.options.joint ||
        !Number.isFinite(sample.confidence) || sample.confidence < 0.8 || sample.confidence > 1) {
      this.clear('tracking_lost'); return;
    }
    if (!Number.isFinite(now) || now < this.lastNow || !isFreshPoseTime(sample.at, now, this.lastAt) ||
        (this.lastAt !== null && sample.at - this.lastAt > MAX_POSE_AGE_MS) ||
        now - this.lastNow > MAX_POSE_AGE_MS) { this.clear('stale_sample'); return; }
    if (sample.at < this.startedAt) return;
    this.lastAt = sample.at;
    this.lastNow = now;
    if (this.state === 'ready') return;
    if (now - this.startedAt > MAX_DURATION_MS) { this.clear('time_limit'); return; }
    this.firstAt ??= sample.at;
    // Bound memory to at most 601 samples, without replacing measured coordinates.
    if (!this.points.length || sample.at - this.points.at(-1).at >= 50) {
      this.points.push({ x: sample.x, y: sample.y, at: sample.at });
    }
  }
  finish(now) {
    if (this.state !== 'collecting') return;
    if (now - this.startedAt > MAX_DURATION_MS) { this.clear('time_limit'); return; }
    if (!Number.isFinite(now) || now < this.lastNow || this.lastAt === null || now - this.lastAt > MAX_POSE_AGE_MS) {
      this.clear('stale_sample'); return;
    }
    if (this.points.at(-1).at - this.points[0].at < MIN_DURATION_MS || this.points.length < 30) {
      this.reason = 'insufficient_samples'; return;
    }
    const bounds = measuredBounds(this.points);
    if (bounds.maxX - bounds.minX < 0.08 || bounds.maxY - bounds.minY < 0.08) {
      this.reason = 'narrow_range'; return;
    }
    this.result = { version: 1, ...structuredClone(this.options), bounds, points: structuredClone(this.points) };
    this.state = this.reason = 'ready';
  }
  snapshot() {
    return { state: this.state, reason: this.reason, count: this.points.length,
      elapsedMs: this.points.length ? this.points.at(-1).at - this.points[0].at : 0 };
  }
}

function measuredBounds(points) {
  // Drop extreme 5% on each axis; isolated outliers cannot define the envelope.
  const axis = key => points.map(p => p[key]).sort((a, b) => a - b);
  const x = axis('x'), y = axis('y'), trim = Math.floor(points.length * 0.05);
  return { minX: Math.max(0.1, x[trim] + 0.02), maxX: Math.min(0.9, x.at(-1 - trim) - 0.02),
    minY: Math.max(0.1, y[trim] + 0.02), maxY: Math.min(0.9, y.at(-1 - trim) - 0.02) };
}

function supported(target, points) {
  const nearby = points.filter(p => Math.hypot(target.x - p.x, target.y - p.y) <= SUPPORT_RADIUS);
  return nearby.length >= 3 && nearby.at(-1).at - nearby[0].at >= 200;
}

// A single uniform scale + translation preserves normalized-image shape and IDs.
// This contract is not wired to sky representative directions or the live planner.
export function fitConstellationToReach(constellation, reach) {
  const fail = reason => ({ ok: false, reason });
  const identifier = value => typeof value === 'string' && value.trim() && value.length <= 200;
  if (!identifier(constellation?.id) || !Array.isArray(constellation.stars) ||
      constellation.stars.length < 1 || constellation.stars.length > 12 ||
      Array.from(constellation.stars).some(p => !validPoint(p) || !identifier(p.id)) ||
      new Set(constellation.stars.map(p => p.id)).size !== constellation.stars.length) return fail('invalid_constellation');
  if (reach?.version !== 1 || !JOINTS.includes(reach.joint) || !POSTURES.includes(reach.posture) ||
      !validSize(reach.size) || !Array.isArray(reach.points) || reach.points.length < 30 || reach.points.length > 601 ||
      Array.from(reach.points).some((p, i) => !validPoint(p) || !Number.isFinite(p.at) || p.at < 0 ||
        (i > 0 && p.at <= reach.points[i - 1].at)) ||
      reach.points.at(-1).at - reach.points[0].at < MIN_DURATION_MS ||
      reach.points.at(-1).at - reach.points[0].at > MAX_DURATION_MS) return fail('invalid_calibration');
  // Recompute from samples; do not trust caller-supplied bounds.
  const b = measuredBounds(reach.points);
  if (b.maxX - b.minX < 0.08 || b.maxY - b.minY < 0.08) return fail('narrow_range');
  const stars = constellation.stars;
  const minX = Math.min(...stars.map(p => p.x)), maxX = Math.max(...stars.map(p => p.x));
  const minY = Math.min(...stars.map(p => p.y)), maxY = Math.max(...stars.map(p => p.y));
  if (stars.some((p, i) => stars.slice(i + 1).some(q => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9))) return fail('overlapping_stars');
  const initial = Math.min(1, maxX > minX ? (b.maxX - b.minX - 1e-10) / (maxX - minX) : 1,
    maxY > minY ? (b.maxY - b.minY - 1e-10) / (maxY - minY) : 1);
  for (let attempt = 0; attempt < 20; attempt++) {
    const scale = initial * (1 - attempt * 0.04);
    const targets = stars.map(p => ({ x: (p.x - (minX + maxX) / 2) * scale + (b.minX + b.maxX) / 2,
      y: (p.y - (minY + maxY) / 2) * scale + (b.minY + b.maxY) / 2 }));
    // Do not collapse distinct stars into overlapping hold regions (tolerance .045).
    if (targets.some((p, i) => targets.slice(i + 1).some(q => Math.hypot(p.x - q.x, p.y - q.y) < 0.10))) return fail('too_close');
    if (!targets.every(p => supported(p, reach.points))) continue;
    const program = validateProgram({ version: 1, constellationId: constellation.id, source: 'measured-image-fit',
      steps: stars.map((p, i) => ({ starId: p.id, joint: reach.joint, target: targets[i], holdMs: 800, tolerance: 0.045 })) });
    return { ok: true, program, scale, reduced: scale < 1, posture: reach.posture, size: { ...reach.size } };
  }
  return fail('unobserved_targets');
}
