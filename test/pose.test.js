import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePose, isFreshPoseTime } from '../src/core/pose.js';
import { HumanRuntime } from '../src/core/runtime.js';
import { compileConstellation } from '../src/core/program.js';
import { PoseSession } from '../src/client/pose-session.js';

function detection() {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 100, visibility: 1 }));
  points[15] = { x: 0.2, y: 0.3, z: -100, visibility: 0.9 };
  points[16] = { x: 0.7, y: 0.4, z: 100, visibility: 0.95 };
  return { landmarks: [points], worldLandmarks: [[{ x: 999, y: 999 }]] };
}
test('image wrist identities and coordinates remain unmirrored; depth/world data are excluded', () => {
  const value = normalizePose(detection(), 123);
  assert.deepEqual(value.wrists.leftWrist, { joint: 'leftWrist', x: 0.2, y: 0.3, confidence: 0.9, at: 123 });
  assert.deepEqual(value.wrists.rightWrist, { joint: 'rightWrist', x: 0.7, y: 0.4, confidence: 0.95, at: 123 });
});
test('absence, multiple detections, occlusion and invalid SDK data yield no samples', () => {
  const cases = [
    [null, 'invalid_pose'], [{ landmarks: [] }, 'no_person'],
    [{ landmarks: [...detection().landmarks, ...detection().landmarks] }, 'multiple_people'],
    [{ landmarks: [[]] }, 'invalid_pose']
  ];
  for (const [key, value] of [['x', NaN], ['y', 1.01], ['x', -0.1], ['visibility', '1'], ['visibility', 1.1], ['visibility', 0.79]]) {
    const raw = detection(); raw.landmarks[0][15][key] = value;
    cases.push([raw, value === 0.79 ? 'occluded' : 'invalid_pose']);
  }
  for (const [raw, reason] of cases) {
    const frame = normalizePose(raw, 100);
    assert.equal(frame.tracked, false);
    assert.equal(frame.reason, reason);
    assert.equal(frame.wrists, undefined);
  }
  assert.equal(normalizePose(detection(), NaN).tracked, false);
});
test('converted samples satisfy HumanRuntime measured hold and loss contract', () => {
  const program = compileConstellation({ id: 'test-only', stars: [{ id: 'fixture', x: 0.7, y: 0.4 }] });
  const runtime = new HumanRuntime(program);
  runtime.start();
  for (let at = 0; at <= 800; at += 100) {
    const frame = normalizePose(detection(), at);
    runtime.tick(frame.wrists.rightWrist, at + 10);
  }
  assert.equal(runtime.captures.length, 1);
  assert.equal(runtime.captures[0].at, 800);
  runtime.reset(); runtime.start();
  const lost = normalizePose({ landmarks: [] }, 900);
  assert.equal(runtime.tick(lost.wrists?.rightWrist, 900).action, 'stop');
  assert.equal(runtime.state, 'paused');
});
test('freshness rejects old, future, duplicate and reversed frame timestamps', () => {
  assert.equal(isFreshPoseTime(100, 250, 99), true);
  for (const [at, now, previous] of [[100, 251, 99], [101, 100, 99], [100, 100, 100], [99, 100, 100], [NaN, 100, null]]) {
    assert.equal(isFreshPoseTime(at, now, previous), false);
  }
});

function setup(t, options = {}) {
  let time = 100, visible = true, callbackId = 0;
  const callbacks = new Map(), workers = [], samples = [], bitmaps = [];
  const video = {
    srcObject: {},
    requestVideoFrameCallback(callback) { callbacks.set(++callbackId, callback); return callbackId; },
    cancelVideoFrameCallback(id) { callbacks.delete(id); }
  };
  const session = new PoseSession({
    video, now: () => time, isVisible: () => visible,
    createWorker: () => {
      const worker = {
        sent: [], terminated: 0,
        postMessage(data) { this.sent.push(data); },
        terminate() { this.terminated++; },
        emit(data) { this.onmessage?.({ data }); }
      };
      workers.push(worker);
      return worker;
    },
    createBitmap: async () => {
      const bitmap = { closed: 0, close() { this.closed++; } };
      bitmaps.push(bitmap); return bitmap;
    },
    onSample: frame => samples.push(frame), ...options
  });
  t.after(() => session.dispose());
  return {
    session, workers, samples, callbacks, bitmaps, video,
    time: value => { time = value; }, hide: () => { visible = false; },
    ready() { session.start(); workers.at(-1).emit({ type: 'ready' }); },
    async frame(metadata = { presentationTime: time }) {
      const [id, callback] = callbacks.entries().next().value;
      callbacks.delete(id); callback(time, metadata);
      await Promise.resolve();
    },
    reply(result = detection(), changes = {}) {
      const sent = workers.at(-1).sent.findLast(value => value.type === 'frame');
      workers.at(-1).emit({ type: 'pose', id: sent.id, at: sent.at, result, ...changes });
    }
  };
}
test('one worker and one frame in flight; explicit restart replaces ownership', async t => {
  const app = setup(t);
  app.ready();
  app.session.start();
  assert.equal(app.workers.length, 1);
  await app.frame();
  assert.equal(app.callbacks.size, 0);
  assert.equal(app.workers[0].sent.filter(m => m.type === 'frame').length, 1);
  app.reply();
  assert.equal(app.samples.at(-1).wrists.rightWrist.at, 100);
  assert.equal(app.callbacks.size, 1);
  app.session.stop();
  assert.equal(app.workers[0].terminated, 1);
  assert.equal(app.callbacks.size, 0);
  assert.equal(app.samples.at(-1), null);
  app.ready();
  app.workers[0].emit({ type: 'ready' });
  assert.equal(app.workers.length, 2);
  assert.equal(app.session.state, 'tracking');
});
test('late ready or result after stop cannot resume or publish samples', async t => {
  const app = setup(t);
  app.ready(); await app.frame();
  const count = app.samples.length;
  app.session.stop();
  app.reply();
  app.workers[0].emit({ type: 'ready' });
  assert.equal(app.samples.length, count + 1);
  assert.equal(app.session.state, 'paused');
});
test('pending bitmap is released when stop wins the race', async t => {
  let resolve;
  const bitmap = { closed: 0, close() { this.closed++; } };
  const app = setup(t, { createBitmap: () => new Promise(done => { resolve = done; }) });
  app.ready(); await app.frame();
  app.session.stop();
  resolve(bitmap);
  await Promise.resolve();
  assert.equal(bitmap.closed, 1);
  assert.equal(app.workers[0].sent.filter(m => m.type === 'frame').length, 0);
});
test('stale inference, wrong timestamp and hidden tab release worker without samples', async t => {
  for (const mode of ['old', 'timestamp', 'hidden']) {
    const app = setup(t); app.ready(); await app.frame();
    if (mode === 'old') app.time(251);
    if (mode === 'hidden') app.hide();
    app.reply(detection(), mode === 'timestamp' ? { at: 99 } : {});
    assert.equal(app.session.state, 'paused');
    assert.equal(app.workers[0].terminated, 1);
    assert.equal(app.samples.at(-1), null);
  }
});
test('unmatched worker response cannot consume the current request', async t => {
  const app = setup(t); app.ready(); await app.frame();
  app.reply(detection(), { id: 999 });
  assert.notEqual(app.session.inFlight, null);
  assert.equal(app.samples.at(-1), null);
  app.reply();
  assert.equal(app.samples.at(-1).tracked, true);
});
test('tracking loss stops until intentional restart, without automatic reacquisition', async t => {
  const app = setup(t); app.ready(); await app.frame();
  app.reply({ landmarks: [] });
  assert.equal(app.session.reason, 'no_person');
  assert.equal(app.workers[0].terminated, 1);
  app.reply();
  assert.equal(app.session.reason, 'no_person');
  app.ready();
  assert.equal(app.workers.length, 2);
});
test('model failure and worker crash expose only fixed reasons', t => {
  const app = setup(t);
  app.session.start();
  app.workers[0].emit({ type: 'error', reason: 'model_failed', detail: 'private details' });
  assert.deepEqual(app.session.snapshot(), { state: 'error', reason: 'model_failed' });
  app.session.start();
  app.workers[1].onerror({ preventDefault() {} });
  assert.equal(app.session.reason, 'inference_failed');
});
test('deadlines stop absent frames and model loading without waiting for worker', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = setup(t);
  app.session.start();
  t.mock.timers.tick(20000);
  assert.equal(app.session.reason, 'model_timeout');
  app.ready();
  t.mock.timers.tick(150);
  assert.equal(app.session.reason, 'frame_gap');
  assert.ok(app.workers.every(w => w.terminated === 1));
});
test('duplicate frame timestamps and unavailable video APIs fail closed', async t => {
  const app = setup(t); app.ready(); await app.frame(); app.reply();
  await app.frame();
  assert.equal(app.session.reason, 'stale_pose');
  const unsupported = setup(t);
  unsupported.video.requestVideoFrameCallback = undefined;
  unsupported.session.start();
  assert.equal(unsupported.session.reason, 'unsupported');
  assert.equal(unsupported.workers.length, 0);
});

test('sensor capture time takes priority over later presentation time in the same clock', async t => {
  const app = setup(t);
  app.time(140);
  app.ready();
  await app.frame({ captureTime: 100, presentationTime: 130 });
  app.reply();
  assert.equal(app.samples.at(-1).at, 100);
  assert.equal(app.samples.at(-1).latencyMs, 40);
  app.time(160);
  await app.frame({ captureTime: 170, presentationTime: 150 });
  assert.equal(app.session.reason, 'stale_pose');
});
