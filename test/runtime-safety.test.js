import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HumanRuntime } from '../src/core/runtime.js';
import { compileConstellation, validateProgram } from '../src/core/program.js';
import { fixture } from '../src/core/fixture.js';

function setup() {
  const program = compileConstellation(fixture);
  program.steps = program.steps.slice(0, 1);
  const runtime = new HumanRuntime(program);
  const sample = { ...runtime.target.target, joint: 'rightWrist', confidence: 1 };
  runtime.start();
  return { runtime, sample };
}
test('tracking loss pauses permanently until an explicit fresh start', () => {
  const { runtime: r, sample: s } = setup();
  for (let at = 0; at <= 600; at += 100) r.tick({ ...s, at }, at);
  assert.equal(r.tick(null, 700).reason, 'tracking_lost');
  assert.equal(r.state, 'paused');
  for (let at = 800; at <= 2000; at += 100) assert.equal(r.tick({ ...s, at }, at).action, 'stop');
  assert.equal(r.captures.length, 0);
  r.start();
  for (let at = 2100; at <= 2800; at += 100) assert.equal(r.tick({ ...s, at }, at).action, 'hold');
  assert.equal(r.tick({ ...s, at: 2900 }, 2900).action, 'capture');
});
test('invalid tracking cannot coerce string confidence or nonfinite coordinates', () => {
  for (const change of [{ confidence: '1' }, { confidence: NaN }, { confidence: 1.1 }, { confidence: 0.79 },
    { x: NaN }, { y: -0.1 }, { joint: 'leftWrist' }, { at: -1 }]) {
    const { runtime: r, sample: s } = setup();
    assert.equal(r.tick({ ...s, at: 100, ...change }, 100).action, 'stop');
    assert.equal(r.state, 'paused');
    assert.equal(r.captures.length, 0);
  }
});
test('stale, future, duplicate and reversed sample timestamps pause', () => {
  for (const [at, now, reason] of [
    [0, 151, 'stale_sample'], [200, 150, 'stale_sample'],
    [100, 150, 'out_of_order_sample'], [90, 150, 'out_of_order_sample']
  ]) {
    const { runtime: r, sample: s } = setup();
    r.tick({ ...s, at: 100 }, 100);
    assert.equal(r.tick({ ...s, at }, now).reason, reason);
    assert.equal(r.state, 'paused');
  }
});
test('clock reversal, invalid clocks and acquisition/delivery gaps pause', () => {
  for (const [at, now, reason] of [
    [90, 90, 'invalid_clock'], [110, NaN, 'invalid_clock'],
    [110, -1, 'invalid_clock'], [260, 260, 'frame_gap'], [200, 260, 'frame_gap']
  ]) {
    const { runtime: r, sample: s } = setup();
    r.tick({ ...s, at: 100 }, 100);
    assert.equal(r.tick({ ...s, at }, now).reason, reason);
    assert.equal(r.state, 'paused');
  }
  const { runtime: r, sample: s } = setup();
  r.tick({ ...s, at: 0 }, 100);
  assert.equal(r.tick({ ...s, at: 200 }, 200).reason, 'frame_gap');
});
test('capture uses sensor hold duration and preserves measurement coordinates and timestamps', () => {
  const { runtime: r, sample: s } = setup();
  const measured = { ...s, x: s.x + 0.01 };
  for (let at = 0; at <= 700; at += 100) assert.equal(r.tick({ ...measured, at }, at + 100).action, 'hold');
  assert.equal(r.captures.length, 0);
  const result = r.tick({ ...measured, at: 800 }, 900);
  assert.equal(result.action, 'capture');
  assert.equal(result.capture.at, 800);
  assert.equal(result.capture.capturedAt, 900);
  assert.equal(result.capture.x, measured.x);
  assert.notEqual(result.capture.x, s.x);
  assert.ok(Math.abs(result.capture.error - 0.01) < 1e-10);
  assert.equal(r.state, 'complete');
  r.start();
  assert.equal(r.tick({ ...measured, at: 1000 }, 1000).action, 'stop');
  assert.equal(r.captures.length, 1);
});
test('leaving tolerance resets hold; start while running does not disturb valid hold', () => {
  const { runtime: r, sample: s } = setup();
  r.tick({ ...s, at: 0 }, 0);
  r.start();
  assert.equal(r.holdSince, 0);
  r.tick({ ...s, x: s.x + 0.2, at: 100 }, 100);
  assert.equal(r.holdSince, null);
  for (let at = 200; at <= 900; at += 100) assert.equal(r.tick({ ...s, at }, at).action, 'hold');
  assert.equal(r.tick({ ...s, at: 1000 }, 1000).action, 'capture');
  r.reset();
  assert.equal(r.state, 'idle');
  assert.equal(r.captures.length, 0);
  assert.equal(r.index, 0);
});
test('program metadata, malformed steps and empty catalog identities reject', () => {
  for (const change of [{ constellationId: '' }, { constellationId: ' ' }, { source: undefined }, { source: 1 }, { steps: [null] }]) {
    assert.throws(() => validateProgram({ ...compileConstellation(fixture), ...change }));
  }
  for (const constellation of [null, { id: '', stars: fixture.stars }, { id: 'test', stars: [null] }, { id: 'test', stars: [] }]) {
    assert.throws(() => compileConstellation(constellation));
  }
});
