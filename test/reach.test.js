import test from 'node:test';
import assert from 'node:assert/strict';
import { ReachCalibration, fitConstellationToReach } from '../src/core/reach.js';
import { HumanRuntime } from '../src/core/runtime.js';
const size = { width: 640, height: 480 };
const options = { joint: 'rightWrist', posture: 'seated', size };
const sample = (at, x = 0.5, y = 0.5, joint = 'rightWrist') => ({ joint, x, y, at, confidence: 0.9 });
function measured(joint = 'rightWrist') {
  const session = new ReachCalibration();
  session.start({ ...options, joint }, 0);
  // Synthetic revisited grid; not real human measurements.
  for (let at = 0, i = 0; at <= 6000; at += 50, i++) {
    session.tick(sample(at, 0.3 + (i % 5) * 0.1, 0.3 + (Math.floor(i / 5) % 5) * 0.1, joint), at, size);
  }
  session.finish(6000);
  assert.equal(session.state, 'ready');
  return session;
}
test('selected wrist and posture keep measured coordinates, then clear', () => {
  for (const joint of ['leftWrist', 'rightWrist']) {
    const session = measured(joint);
    assert.equal(session.result.joint, joint);
    assert.equal(session.result.posture, 'seated');
    assert.equal(session.result.points[0].x, 0.3);
    session.clear();
    assert.equal(session.result, null);
    assert.equal(session.points.length, 0);
  }
});
test('short, static and one-dimensional movement cannot confirm a region', () => {
  const session = new ReachCalibration(); session.start(options, 0);
  session.tick(sample(0), 0, size); session.finish(0);
  assert.equal(session.reason, 'insufficient_samples');
  for (let at = 100; at <= 3100; at += 100) session.tick(sample(at), at, size);
  session.finish(3100);
  assert.equal(session.reason, 'narrow_range');
  assert.equal(session.state, 'collecting');
  for (let at = 3200; at <= 5000; at += 100) session.tick(sample(at, at % 200 ? 0.2 : 0.8), at, size);
  session.finish(5000);
  assert.equal(session.reason, 'narrow_range');
  assert.equal(session.result, null);
});
test('loss, invalid, old, duplicate, future and reversed samples erase calibration', () => {
  for (const [value, now, reason] of [
    [null,6050,'tracking_lost'], [sample(6050,NaN),6050,'tracking_lost'],
    [{...sample(6050),confidence:0.79},6050,'tracking_lost'],
    [sample(6050,0.5,0.5,'leftWrist'),6050,'tracking_lost'],
    [sample(6000),6050,'stale_sample'],[sample(5900),6050,'stale_sample'],
    [sample(6200),6050,'stale_sample'],[sample(6050),6300,'stale_sample'],
    [sample(6050),5999,'stale_sample'],[sample(6300),6300,'stale_sample']
  ]) {
    const session = measured(); session.tick(value, now, size);
    assert.equal(session.reason, reason);
    assert.equal(session.result, null); assert.equal(session.points.length, 0);
  }
  const pending = new ReachCalibration(); pending.start(options,0);
  pending.tick(sample(10),10,size); pending.tick(null,20,size);
  assert.equal(pending.reason,'tracking_lost');
});
test('video size change requires explicit restart and new posture/hand', () => {
  const session = measured(); session.tick(sample(6050),6050,{width:480,height:640});
  assert.equal(session.reason,'frame_changed');
  session.tick(sample(6100),6100,size);
  assert.equal(session.result,null);
  session.start({...options,posture:'standing',joint:'leftWrist'},6100);
  assert.equal(session.state,'collecting');
  assert.equal(session.options.posture,'standing');
  assert.equal(session.options.joint,'leftWrist');
});
test('pre-start frames are ignored; collection bounded to 30s and 601 points', () => {
  const session = new ReachCalibration(); session.start(options,100);
  session.tick(sample(90),100,size); assert.equal(session.points.length,0);
  for(let at=100;at<=30100;at+=10) session.tick(sample(at),at,size);
  assert.equal(session.points.length,601);
  session.tick(sample(30110),30110,size);
  assert.equal(session.reason,'time_limit'); assert.equal(session.points.length,0);
});
test('invalid options and stale finish cannot create a result', () => {
  for(const setup of [null,{...options,joint:'head'},{...options,posture:'walking'},{...options,size:{width:0,height:480}}]) {
    const session = new ReachCalibration(); session.start(setup,0);
    assert.equal(session.reason,'invalid_setup');
  }
  const session = new ReachCalibration(); session.start(options,0); session.tick(sample(0),0,size);
  session.finish(200); assert.equal(session.reason,'stale_sample');
});
const constellation = {id:'test-only',stars:[{id:'a',x:0.25,y:0.25},{id:'b',x:0.75,y:0.25},{id:'c',x:0.25,y:0.75}]};
test('fit preserves IDs, selected joint and shape with one uniform scale and translation', () => {
  const reach = measured('leftWrist').result;
  const original = structuredClone({constellation,reach});
  const result = fitConstellationToReach(constellation,reach);
  assert.equal(result.ok,true); assert.equal(result.reduced,true);
  assert.deepEqual(result.program.steps.map(s=>s.starId),['a','b','c']);
  assert.ok(result.program.steps.every(s=>s.joint==='leftWrist'));
  const targets = result.program.steps.map(s=>s.target);
  for(let i=1;i<targets.length;i++) for(const key of ['x','y'])
    assert.ok(Math.abs(targets[i][key]-targets[0][key]-(constellation.stars[i][key]-constellation.stars[0][key])*result.scale)<1e-12);
  assert.deepEqual({constellation,reach},original);
  const runtime = new HumanRuntime(result.program); runtime.start();
  for(let at=0;at<=800;at+=100) runtime.tick(sample(at,targets[0].x,targets[0].y,'leftWrist'),at);
  assert.equal(runtime.captures[0].starId,'a');
});
test('box and isolated outliers do not establish observed target support', () => {
  const reach = measured().result;
  reach.points = reach.points.map((p,i)=>({...p,x:i%2?0.3:0.7,y:i%2?0.3:0.7}));
  const one = {id:'test-only',stars:[{id:'center',x:0.5,y:0.5}]};
  assert.equal(fitConstellationToReach(one,reach).reason,'unobserved_targets');
  reach.points[60]={...reach.points[60],x:0.5,y:0.5};
  reach.bounds={minX:0,minY:0,maxX:1,maxY:1};
  assert.equal(fitConstellationToReach(one,reach).reason,'unobserved_targets');
});
test('nearby stars reject instead of collapsing or silently removing IDs', () => {
  const reach=measured().result;
  assert.equal(fitConstellationToReach({id:'tiny',stars:[{id:'a',x:0.5,y:0.5},{id:'b',x:0.51,y:0.5}]},reach).reason,'too_close');
  assert.equal(fitConstellationToReach({id:'same',stars:[{id:'a',x:0.5,y:0.5},{id:'b',x:0.5,y:0.5}]},reach).reason,'overlapping_stars');
});
test('malformed source and calibration reject with fixed reasons', () => {
  const reach=measured().result;
  for(const input of [null,{}, {...constellation,stars:[]},{...constellation,stars:[{id:'a',x:Infinity,y:0}]},{...constellation,stars:[constellation.stars[0],constellation.stars[0]]}])
    assert.equal(fitConstellationToReach(input,reach).reason,'invalid_constellation');
  for(const invalid of [null,{}, {...reach,points:[]},{...reach,points:reach.points.map(p=>({...p,at:1}))},{...reach,joint:'head'}])
    assert.equal(fitConstellationToReach(constellation,invalid).reason,'invalid_calibration');
});

test('confirmation freezes recorded duration while fresh tracking continues', () => {
  const session = measured();
  const duration = session.snapshot().elapsedMs;
  const points = structuredClone(session.result.points);
  for(let at=6050;at<=7000;at+=50) session.tick(sample(at),at,size);
  assert.equal(session.snapshot().elapsedMs,duration);
  assert.deepEqual(session.result.points,points);
  assert.equal(session.state,'ready');
});

test('boundary placement stays inside ProgramV1 bounds without floating-point rejection', () => {
  const reach = measured().result;
  reach.points = reach.points.map((p,i) => ({...p,x:[0.08,0.1,0.5,0.9,0.92][i%5],y:0.1+0.2*(Math.floor(i/5)%5)}));
  const source={id:'edges',stars:[{id:'a',x:0,y:0.5},{id:'b',x:1,y:0.5}]};
  const fit=fitConstellationToReach(source,reach);
  assert.equal(fit.ok,true);
  assert.ok(fit.program.steps.every(s=>s.target.x>=0.1 && s.target.x<=0.9));
});
