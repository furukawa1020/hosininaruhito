import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraSession } from '../src/client/camera.js';

class Track extends EventTarget {
  constructor(kind = 'video') { super(); this.kind = kind; this.readyState = 'live'; this.muted = false; }
  stop() { this.readyState = 'ended'; }
}
function stream() {
  const value = new EventTarget();
  const tracks = [new Track(), new Track('audio')];
  return Object.assign(value, {
    getTracks: () => tracks, getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio')
  });
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function setup(options = {}) {
  const feeds = [], constraints = [], states = [];
  let visible = true;
  const video = { srcObject: null, play: async () => {}, pause: () => {} };
  const camera = new CameraSession({
    video, isVisible: () => visible, isSecure: () => true,
    mediaDevices: { getUserMedia: async value => { constraints.push(value); const feed = stream(); feeds.push(feed); return feed; } },
    onChange: state => states.push(state), ...options
  });
  return { camera, video, feeds, constraints, states, hide: () => { visible = false; } };
}
test('consent, visibility and secure context gate camera acquisition', async () => {
  const app = setup();
  await app.camera.start();
  assert.equal(app.camera.reason, 'consent');
  app.hide();
  await app.camera.start({ consent: true });
  assert.equal(app.camera.reason, 'hidden');
  assert.equal(app.constraints.length, 0);
  for (const options of [{ isSecure: () => false }, { mediaDevices: {} }]) {
    const blocked = setup(options);
    await blocked.camera.start({ consent: true });
    assert.equal(blocked.camera.reason, 'unsupported');
    assert.equal(blocked.constraints.length, 0);
  }
});
test('preview owns one stream, requests no audio, stops every track and allows explicit restart', async () => {
  const { camera, feeds, video, constraints } = setup();
  await camera.start({ consent: true });
  await camera.start({ consent: true });
  assert.equal(camera.state, 'preview');
  assert.equal(feeds.length, 1);
  assert.equal(constraints[0].audio, false);
  assert.equal(feeds[0].getAudioTracks()[0].readyState, 'ended');
  camera.stop();
  assert.equal(video.srcObject, null);
  assert.ok(feeds[0].getTracks().every(t => t.readyState === 'ended'));
  await camera.start({ consent: true });
  assert.equal(feeds.length, 2);
  camera.dispose();
  assert.equal(video.srcObject, null);
  assert.ok(feeds[1].getTracks().every(t => t.readyState === 'ended'));
});
for (const action of ['stop', 'dispose', 'hidden']) {
  test('late permission after ' + action + ' releases without preview or parallel acquisition', async () => {
    const permission = deferred();
    let calls = 0;
    const app = setup({ mediaDevices: { getUserMedia: () => { calls++; return permission.promise; } } });
    const started = app.camera.start({ consent: true });
    if (action === 'hidden') app.hide(); else app.camera[action]();
    await app.camera.start({ consent: true });
    assert.equal(calls, 1);
    const feed = stream();
    permission.resolve(feed);
    await started;
    assert.ok(feed.getTracks().every(t => t.readyState === 'ended'));
    assert.equal(app.video.srcObject, null);
    assert.notEqual(app.camera.state, 'preview');
    assert.equal(app.camera.pending, false);
  });
}
test('late rejection cannot replace stop state', async () => {
  const permission = deferred();
  const { camera } = setup({ mediaDevices: { getUserMedia: () => permission.promise } });
  const started = camera.start({ consent: true });
  camera.stop();
  permission.reject(new DOMException('private device detail', 'NotAllowedError'));
  await started;
  assert.deepEqual(camera.snapshot(), { state: 'paused', reason: 'manual', pending: false });
});
for (const [name, reason] of [['NotAllowedError', 'denied'], ['NotFoundError', 'missing'], ['NotReadableError', 'unavailable'], ['Error', 'failed']]) {
  test('sanitizes acquisition failure ' + name, async () => {
    const { camera, video } = setup({ mediaDevices: { getUserMedia: async () => { throw new DOMException('private device detail', name); } } });
    await camera.start({ consent: true });
    assert.deepEqual(camera.snapshot(), { state: 'error', reason, pending: false });
    assert.equal(video.srcObject, null);
  });
}
for (const event of ['ended', 'mute', 'inactive']) {
  test(event + ' releases camera and requires explicit restart', async () => {
    const { camera, video, feeds } = setup();
    await camera.start({ consent: true });
    (event === 'inactive' ? feeds[0] : feeds[0].getVideoTracks()[0]).dispatchEvent(new Event(event));
    assert.equal(camera.state, 'paused');
    assert.equal(video.srcObject, null);
    assert.ok(feeds[0].getTracks().every(t => t.readyState === 'ended'));
    feeds[0].getVideoTracks()[0].dispatchEvent(new Event('unmute'));
    assert.equal(camera.state, 'paused');
    await camera.start({ consent: true });
    // Old device events cannot stop a new session.
    feeds[0].dispatchEvent(new Event('inactive'));
    assert.equal(camera.state, 'preview');
    camera.dispose();
  });
}
test('playback failure releases all tracks', async () => {
  const app = setup();
  app.video.play = async () => { throw new Error('private playback detail'); };
  await app.camera.start({ consent: true });
  assert.equal(app.camera.reason, 'failed');
  assert.equal(app.video.srcObject, null);
  assert.ok(app.feeds[0].getTracks().every(t => t.readyState === 'ended'));
});
test('stopping while play is pending cannot restore preview', async () => {
  const app = setup(), playing = deferred();
  app.video.play = () => playing.promise;
  const started = app.camera.start({ consent: true });
  await Promise.resolve();
  app.camera.stop();
  playing.resolve();
  await started;
  assert.equal(app.camera.state, 'paused');
  assert.equal(app.video.srcObject, null);
  assert.ok(app.feeds[0].getTracks().every(t => t.readyState === 'ended'));
});

test('startup mute may clear before playback; persistent mute stops the session', async () => {
  for (const recovers of [true, false]) {
    const feed = stream();
    feed.getVideoTracks()[0].muted = true;
    const app = setup({ mediaDevices: { getUserMedia: async () => feed } });
    app.video.play = async () => { if (recovers) feed.getVideoTracks()[0].muted = false; };
    await app.camera.start({ consent: true });
    assert.equal(app.camera.state, recovers ? 'preview' : 'paused');
    if (!recovers) assert.ok(feed.getTracks().every(t => t.readyState === 'ended'));
    app.camera.dispose();
  }
});
test('stop unblocks pending playback without waiting for the media element', async () => {
  const app = setup();
  app.video.play = () => new Promise(() => {});
  const started = app.camera.start({ consent: true });
  await Promise.resolve();
  app.camera.stop();
  await started;
  assert.equal(app.camera.pending, false);
  assert.equal(app.video.srcObject, null);
});
test('empty or already ended camera stream fails closed', async () => {
  for (const empty of [true, false]) {
    const feed = stream();
    if (empty) feed.getVideoTracks = () => [];
    else feed.getVideoTracks()[0].stop();
    const app = setup({ mediaDevices: { getUserMedia: async () => feed } });
    await app.camera.start({ consent: true });
    assert.equal(app.camera.reason, 'unavailable');
    assert.ok(feed.getTracks().every(t => t.readyState === 'ended'));
  }
});
