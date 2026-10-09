import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePose, isFreshPoseTime } from '../src/core/pose.js';
import { HumanRuntime } from '../src/core/runtime.js';
import { compileConstellation } from '../src/core/program.js';
import { PoseSession, PERSON_SEARCH_MS } from '../src/client/pose-session.js';

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
  for (const [key, value] of [['x', NaN], ['x', Infinity], ['x', '0.5'], ['visibility', '1'], ['visibility', 1.1], ['visibility', 0.79]]) {
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
async function establish(app, start=100) {
  for(let i=0;i<=5;i++){app.time(start+i*100);await app.frame();app.reply();}
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
  assert.equal(app.samples.at(-1), null);
  await establish(app,200);
  assert.equal(app.samples.at(-1).wrists.rightWrist.at, 700);
  assert.equal(app.callbacks.size, 1);
  app.session.stop();
  assert.equal(app.workers[0].terminated, 1);
  assert.equal(app.callbacks.size, 0);
  assert.equal(app.samples.at(-1), null);
  app.ready();
  app.workers[0].emit({ type: 'ready' });
  assert.equal(app.workers.length, 2);
  assert.equal(app.session.state, 'searching');
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
    const app = setup(t); app.ready(); await establish(app); app.time(700); await app.frame();
    if (mode === 'old') app.time(851);
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
  assert.equal(app.samples.at(-1), null);
  await establish(app,200);
  assert.equal(app.samples.at(-1).tracked, true);
});
test('tracking loss stops until intentional restart, without automatic reacquisition', async t => {
  const app = setup(t); app.ready(); await establish(app); app.time(633); await app.frame();
  app.reply({ landmarks: [] });
  assert.equal(app.session.reason, 'no_person');
  assert.equal(app.workers[0].terminated, 1);
  app.reply();
  assert.equal(app.session.reason, 'no_person');
  app.ready();
  assert.equal(app.workers.length, 2);
});
test('model failures and worker crashes fall back once, then expose only fixed reasons', t => {
 for(const crash of [false,true]){
  const app=setup(t);app.session.start();
  const fail=w=>crash?w.onerror({preventDefault(){}}):w.emit({type:'error',reason:'model_failed',detail:'private details'});
  fail(app.workers[0]);assert.equal(app.session.reason,'loading_cpu');
  fail(app.workers[1]);assert.deepEqual(app.session.snapshot(),{state:'error',reason:crash?'inference_failed':'model_failed'});
  assert.ok(app.workers.every(w=>w.terminated===1));
 }
});
test('deadlines bound initial search and preserve tracking watchdog', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = setup(t);
  app.session.start();
  t.mock.timers.tick(20000);
  assert.equal(app.session.reason, 'loading_cpu');
  t.mock.timers.tick(20000);
  assert.equal(app.session.reason, 'model_timeout');
  app.ready();
  t.mock.timers.tick(PERSON_SEARCH_MS);
  assert.equal(app.session.reason, 'person_timeout');
  app.ready(); await establish(app);
  t.mock.timers.tick(150);
  assert.equal(app.session.reason, 'frame_gap');
  assert.ok(app.workers.every(w => w.terminated === 1));
});
test('duplicate frame timestamps and unavailable video APIs fail closed', async t => {
  const app = setup(t); app.ready(); await establish(app);
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
  app.ready(); await establish(app);
  app.time(740);
  await app.frame({ captureTime: 700, presentationTime: 730 });
  app.reply();
  assert.equal(app.samples.at(-1).at, 700);
  assert.equal(app.samples.at(-1).latencyMs, 40);
  app.time(760);
  await app.frame({ captureTime: 770, presentationTime: 750 });
  assert.equal(app.session.reason, 'stale_pose');
});

test('initial absence, occlusion and multiple people can be corrected without reloading the worker', async t => {
  const app=setup(t);app.ready();
  assert.equal(app.session.state,'searching');
  const hidden=detection();hidden.landmarks[0][15].visibility=.1;
  let at=100;
  for(const [result,reason] of [[{landmarks:[]},'no_person'],[hidden,'occluded'],[{landmarks:[...detection().landmarks,...detection().landmarks]},'multiple_people']]){
    await app.frame();app.reply(result);
    assert.equal(app.session.reason,'searching_'+reason);
    assert.equal(app.samples.filter(Boolean).length,0);
    assert.equal(app.workers[0].terminated,0);
    app.time(at+=100);
  }
  await establish(app,400);
  assert.equal(app.session.state,'tracking');
  assert.equal(app.samples.filter(Boolean).length,1);
  assert.equal(app.workers.length,1);
});
test('slow first inference is discarded before a fresh measurement can start tracking',async t=>{
  const app=setup(t);app.ready();await app.frame();app.time(400);app.reply();
  assert.equal(app.session.state,'searching');assert.equal(app.session.reason,'searching_slow');
  assert.equal(app.samples.filter(Boolean).length,0);assert.equal(app.callbacks.size,1);
  await app.frame();app.time(430);app.reply();
  assert.equal(app.samples.at(-1),null);
  for(let at=500;at<=900;at+=100){app.time(at);await app.frame();app.time(at+30);app.reply();}
  assert.equal(app.samples.at(-1).at,900);assert.equal(app.samples.at(-1).latencyMs,30);
});
test('search timeout releases a hung worker and ignores a late successful detection',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const app=setup(t);app.ready();await app.frame();
  t.mock.timers.tick(PERSON_SEARCH_MS);
  assert.equal(app.session.reason,'person_timeout');assert.equal(app.workers[0].terminated,1);
  app.reply();assert.equal(app.samples.filter(Boolean).length,0);assert.equal(app.callbacks.size,0);
});
test('repeated initial misses do not extend the original search deadline',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const app=setup(t);app.ready();
  for(let i=0;i<14;i++){app.time(100+i*1000);await app.frame();app.reply({landmarks:[]});t.mock.timers.tick(1000);}
  assert.equal(app.session.state,'searching');
  t.mock.timers.tick(1000);assert.equal(app.session.reason,'person_timeout');
});
test('expired initial search cannot accept a result even when the timer has not run',async t=>{
  const app=setup(t);app.ready();await app.frame();app.time(100+PERSON_SEARCH_MS);app.reply();
  assert.equal(app.session.reason,'person_timeout');assert.equal(app.samples.filter(Boolean).length,0);
});

test('initial search rejects duplicate and reversed input timestamps after a miss',async t=>{
  for(const at of [100,99]){
    const app=setup(t);app.ready();await app.frame();app.reply({landmarks:[]});
    app.time(110);await app.frame({presentationTime:at});
    assert.equal(app.session.reason,'stale_pose');
    assert.equal(app.workers[0].sent.filter(m=>m.type==='frame').length,1);
    assert.equal(app.samples.filter(Boolean).length,0);
  }
});
test('bitmap resolving after search deadline is closed without dispatch',async t=>{
  let resolve;const bitmap={closed:0,close(){this.closed++;}};
  const app=setup(t,{createBitmap:()=>new Promise(done=>{resolve=done;})});
  app.ready();app.time(PERSON_SEARCH_MS+50);await app.frame();
  app.time(PERSON_SEARCH_MS+100);resolve(bitmap);await Promise.resolve();
  assert.equal(app.session.reason,'person_timeout');assert.equal(bitmap.closed,1);
  assert.equal(app.workers[0].sent.filter(m=>m.type==='frame').length,0);
});

test('finite off-image wrists are framing loss, never clamped samples', () => {
  for (const index of [15,16]) for (const axis of ['x','y']) for (const value of [-0.01,1.01]) {
    const raw=detection();raw.landmarks[0][index][axis]=value;
    const frame=normalizePose(raw,100);
    assert.deepEqual(frame,{tracked:false,reason:'out_of_frame',at:100});
    assert.equal(raw.landmarks[0][index][axis],value);
  }
  for(const value of [0,1]){
    const raw=detection();raw.landmarks[0][15].x=value;
    assert.equal(normalizePose(raw,100).wrists.leftWrist.x,value);
  }
});
test('malformed opposite wrist cannot be hidden by a framing or visibility failure', () => {
  for(const first of [{x:-.1},{visibility:.1}]){
    const raw=detection();Object.assign(raw.landmarks[0][15],first);
    raw.landmarks[0][16].x=NaN;
    assert.equal(normalizePose(raw,100).reason,'invalid_pose');
  }
});
test('framing can recover only before tracking; malformed frames still stop immediately',async t=>{
  const outside=detection();outside.landmarks[0][16].y=1.1;
  const app=setup(t);app.ready();await app.frame();app.reply(outside);
  assert.equal(app.session.reason,'searching_out_of_frame');
  assert.equal(app.samples.filter(Boolean).length,0);
  await establish(app,200);
  assert.equal(app.session.state,'tracking');
  app.time(800);await app.frame();app.reply(outside);
  assert.equal(app.session.reason,'out_of_frame');
  assert.equal(app.workers[0].terminated,1);assert.equal(app.samples.at(-1),null);
  const invalid=setup(t);invalid.ready();await invalid.frame();invalid.reply({landmarks:[[]]});
  assert.equal(invalid.session.reason,'invalid_pose');assert.equal(invalid.callbacks.size,0);
});

test('one good frame followed by framing loss stays in initial search without samples',async t=>{
 const app=setup(t);app.ready();await app.frame();app.reply();
 assert.equal(app.session.reason,'searching_stable');assert.equal(app.samples.filter(Boolean).length,0);
 const hidden=detection();hidden.landmarks[0][15].visibility=.1;
 const outside=detection();outside.landmarks[0][16].x=1.1;
 let at=200;
 for(const result of [{landmarks:[]},hidden,outside,{landmarks:[...detection().landmarks,...detection().landmarks]}]){
  app.time(at);await app.frame();app.reply(result);
  assert.equal(app.session.state,'searching');assert.equal(app.workers[0].terminated,0);
  app.time(at+100);await app.frame();app.reply();
  assert.equal(app.session.reason,'searching_stable');assert.equal(app.samples.filter(Boolean).length,0);
  at+=200;
 }
 await establish(app,at);
 assert.equal(app.session.state,'tracking');assert.equal(app.workers.length,1);
});
test('initial stable window uses sensor time and cannot be completed by sparse fresh frames',async t=>{
 const app=setup(t);app.ready();
 for(const at of [100,300,500,700]){app.time(at);await app.frame();app.reply();}
 assert.equal(app.session.state,'searching');assert.equal(app.samples.filter(Boolean).length,0);
 for(const at of [800,900,1000,1100]){app.time(at);await app.frame();app.reply();}
 assert.equal(app.samples.filter(Boolean).length,0);
 app.time(1200);await app.frame();app.reply();
 assert.equal(app.samples.filter(Boolean).length,1);assert.equal(app.samples.at(-1).at,1200);
});
test('stopping during stable acquisition discards pending results and does not auto-start',async t=>{
 const app=setup(t);app.ready();await app.frame();app.reply();
 app.time(200);await app.frame();app.session.stop();app.reply();
 assert.equal(app.session.state,'paused');assert.equal(app.samples.filter(Boolean).length,0);
 assert.equal(app.workers[0].terminated,1);
});

test('fresh results with delivery gaps cannot briefly enable tracking before the watchdog stops it',async t=>{
 const app=setup(t);app.ready();
 for(let at=100;at<=800;at+=100){app.time(at);await app.frame();app.time(at+80);app.reply();}
 assert.equal(app.session.state,'searching');assert.equal(app.session.reason,'searching_slow');
 assert.equal(app.samples.filter(Boolean).length,0);
 await establish(app,900);
 assert.equal(app.session.state,'tracking');
});

test('GPU initialization failure terminates it before CPU and ignores every late GPU event', async t => {
 const app=setup(t);app.session.start();const gpu=app.workers[0];
 assert.equal(gpu.sent[0].delegate,'GPU');
 gpu.emit({type:'error',reason:'model_failed'});
 assert.equal(gpu.terminated,1);assert.equal(app.session.reason,'loading_cpu');
 const cpu=app.workers[1];assert.equal(cpu.sent[0].delegate,'CPU');
 gpu.emit({type:'ready'});gpu.onerror({preventDefault(){}});gpu.onmessageerror();
 assert.equal(app.session.reason,'loading_cpu');assert.equal(app.callbacks.size,0);
 cpu.emit({type:'ready'});await establish(app);
 assert.equal(app.session.state,'tracking');assert.equal(app.samples.filter(Boolean).length,1);
});
test('a GPU ready arriving after its deadline starts CPU even before its timer fires', t => {
 const app=setup(t);app.session.start();app.time(20100);
 app.workers[0].emit({type:'ready'});
 assert.equal(app.workers[0].terminated,1);assert.equal(app.workers.length,2);
 assert.equal(app.session.reason,'loading_cpu');assert.equal(app.callbacks.size,0);
});
test('delayed callbacks cannot extend the total model startup deadline', t => {
 const app=setup(t);app.session.start();app.time(40100);
 app.workers[0].emit({type:'ready'});
 assert.equal(app.workers.length,1);assert.equal(app.workers[0].terminated,1);
 assert.equal(app.session.reason,'model_timeout');assert.equal(app.samples.filter(Boolean).length,0);
});
test('stop or hidden during GPU initialization never creates a fallback worker', t => {
 t.mock.timers.enable({apis:['setTimeout']});
 for(const hidden of [false,true]){
  const app=setup(t);app.session.start();const gpu=app.workers[0];
  if(hidden){app.hide();gpu.onerror({preventDefault(){}});}else app.session.stop();
  t.mock.timers.tick(40000);gpu.emit({type:'error',reason:'model_failed'});
  assert.equal(app.workers.length,1);assert.equal(gpu.terminated,1);
  assert.equal(app.session.reason,hidden?'hidden':'manual');
 }
});
test('inference failure after GPU ready stops without backend switching', async t => {
 const app=setup(t);app.ready();await establish(app);
 app.workers[0].emit({type:'error',reason:'inference_failed'});
 assert.equal(app.session.reason,'inference_failed');assert.equal(app.workers.length,1);
 assert.equal(app.workers[0].terminated,1);
});

test('timeout retains only the last search reason and late results cannot replace it', async t => {
 t.mock.timers.enable({apis:['setTimeout']});
 const app=setup(t);app.ready();await app.frame();app.time(300);app.reply();
 assert.equal(app.session.reason,'searching_slow');
 t.mock.timers.tick(PERSON_SEARCH_MS);
 assert.deepEqual(app.session.snapshot(),{state:'paused',reason:'person_timeout',searchReason:'searching_slow'});
 assert.equal(app.workers[0].terminated,1);assert.equal(app.samples.filter(Boolean).length,0);
 app.reply();assert.equal(app.session.snapshot().searchReason,'searching_slow');
 app.ready();assert.equal(app.session.snapshot().searchReason,undefined);
 await establish(app,400);assert.equal(app.session.state,'tracking');
 app.session.stop();assert.deepEqual(app.session.snapshot(),{state:'paused',reason:'manual'});
});

test('latest framing evidence replaces slow hint; expiry without a response claims no cause',async t=>{
 for(const delayed of [false,true]){
  const app=setup(t);app.ready();await app.frame();
  if(delayed){app.time(300);app.reply();await app.frame();app.reply({landmarks:[]});}
  app.time(15100);
  if(delayed)await app.frame();else app.reply();
  assert.equal(app.session.reason,'person_timeout');
  assert.equal(app.session.snapshot().searchReason,delayed?'searching_no_person':undefined);
  assert.equal(app.samples.filter(Boolean).length,0);
  app.session.stop();assert.equal(app.session.snapshot().searchReason,undefined);
 }
});
