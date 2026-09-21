import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConstellationTrace, MAX_TRAIL_POINTS } from '../src/core/trace.js';
import { TraceRenderer } from '../src/client/trace-renderer.js';
const program = { version:1, constellationId:'test-only',source:'fixture',steps:[
  {starId:'a',joint:'rightWrist',target:{x:.3,y:.3},holdMs:800,tolerance:.045},
  {starId:'b',joint:'rightWrist',target:{x:.7,y:.3},holdMs:800,tolerance:.045},
  {starId:'c',joint:'rightWrist',target:{x:.5,y:.7},holdMs:800,tolerance:.045}
]};
const sample=(at,x=.31,y=.31,joint='rightWrist')=>({at,x,y,joint,confidence:1});
function capture(trace, step, from) {
  for(let at=from;at<=from+800;at+=100) trace.tick(sample(at,step.target.x+.01,step.target.y+.01),at+20);
}
function renderer() {
  const events=new Map(),calls=[];
  const canvas={width:1,height:1,addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)};
  const gpu={setPixelRatio:r=>calls.push(['ratio',r]),setSize:(w,h)=>calls.push(['size',w,h]),
    render:()=>calls.push(['render']),dispose:()=>calls.push(['dispose']),forceContextLoss:()=>calls.push(['lose'])};
  const failures=[];
  return {view:new TraceRenderer(canvas,{createRenderer:()=>gpu,onFailure:r=>failures.push(r)}),canvas,calls,failures,events};
}
test('captures use measured coordinates and both timestamps; unheld targets cannot create stars or lines',()=>{
  const trace=new ConstellationTrace({program,lines:[['a','c','b']]});
  trace.start(0);
  assert.equal(trace.snapshot().targets.length,3);
  capture(trace,program.steps[0],0);
  let snapshot=trace.snapshot();
  assert.equal(snapshot.captures.length,1);
  assert.equal(snapshot.targets.length,2);
  assert.equal(snapshot.captures[0].x,.31);
  assert.equal(snapshot.captures[0].at,800);
  assert.equal(snapshot.captures[0].capturedAt,820);
  assert.equal(snapshot.lines.length,0);
  capture(trace,program.steps[1],900);
  assert.equal(trace.snapshot().lines.length,0); // c is still missing, no shortcut a-b.
  capture(trace,program.steps[2],1800);
  snapshot=trace.snapshot();
  assert.equal(snapshot.state,'complete');
  assert.equal(snapshot.lines.length,2);
  assert.equal(snapshot.targets.length,0);
  trace.tick(sample(2700),2700);
  assert.deepEqual(trace.snapshot(),snapshot);
  trace.start(3000);
  assert.deepEqual(trace.snapshot(),snapshot);
});
test('pause freezes measured points, explicit resume keeps captures but starts a new trail; reset erases all',()=>{
  const trace=new ConstellationTrace({program,lines:[['a','b']]});trace.start(0);
  capture(trace,program.steps[0],0);trace.stop();
  const frozen=trace.snapshot();trace.tick(sample(900),900);trace.watch(9999);
  assert.deepEqual(trace.snapshot(),frozen);assert.equal(frozen.current,null);
  trace.start(10000);
  assert.equal(trace.snapshot().captures.length,1);assert.equal(trace.snapshot().trail.length,0);
  capture(trace,program.steps[1],10000);
  assert.equal(trace.snapshot().captures.length,2);
  trace.reset();
  assert.equal(trace.snapshot().captures.length,0);assert.equal(trace.snapshot().lines.length,0);
  assert.equal(trace.snapshot().trail.length,0);assert.equal(trace.snapshot().targets.length,3);
});
test('tracking failure, stale, duplicate, out-of-range or wrong-joint input freezes until explicit restart',()=>{
  for(const value of [null,sample(0),sample(200),sample(50,NaN),sample(50,1.1),sample(50,.3,.3,'leftWrist'),{...sample(50),confidence:.1}]) {
    const trace=new ConstellationTrace();trace.start(0);trace.tick(sample(0),0);
    trace.tick(value,50);assert.equal(trace.state,'paused');
    const frozen=trace.snapshot();trace.tick(sample(100),100);assert.deepEqual(trace.snapshot(),frozen);
  }
});
test('no-frame watchdog and clock reversal stop; delayed pre-start frames do not enter trail',()=>{
  const trace=new ConstellationTrace();trace.start(100);
  trace.tick(sample(99),100);assert.equal(trace.snapshot().trail.length,0);
  trace.watch(251);assert.equal(trace.state,'paused');
  trace.start(300);trace.tick(sample(300),300);trace.watch(299);
  assert.equal(trace.reason,'invalid_clock');
});
test('long continuous tracking bounds memory to 120 points and four sensor seconds without fake captures',()=>{
  const trace=new ConstellationTrace({joint:'leftWrist'});trace.start(0);
  for(let i=0;i<20000;i++) trace.tick(sample(i*33,.3,.4,'leftWrist'),i*33);
  const frame=trace.snapshot();
  assert.equal(frame.trail.length,MAX_TRAIL_POINTS);
  assert.ok(frame.trail.at(-1).at-frame.trail[0].at<=4000);
  assert.ok(frame.trail[0].brightness<frame.trail.at(-1).brightness);
  assert.equal(frame.captures.length,0);assert.equal(frame.targets.length,0);
  frame.trail[0].x=999;assert.notEqual(trace.snapshot().trail[0].x,999);
});
test('unknown or malformed edges reject and duplicate catalog paths do not inflate line capacity',()=>{
  for(const lines of [[['a','missing']],[['a','a']],[[null,'a']],[['a']],new Array(2)])
    assert.throws(()=>new ConstellationTrace({program,lines}));
  assert.throws(()=>new ConstellationTrace({joint:'head'}));
  const trace=new ConstellationTrace({program,lines:[['a','b'],['b','a']]});
  assert.equal(trace.edges.length,1);
});
test('renderer mirrors only display, keeps depth flat and distinguishes current, targets, trail and captures',()=>{
  const {view}=renderer();
  const trace=new ConstellationTrace({program});trace.start(0);trace.tick(sample(0),0);
  const frame=trace.snapshot();view.draw(frame);
  assert.equal(view.layers.trail.geometry.drawRange.count,1);
  assert.equal(view.layers.captures.geometry.drawRange.count,0);
  assert.equal(view.layers.targets.geometry.drawRange.count,3);
  const positions=view.layers.current.geometry.getAttribute('position');
  assert.ok(Math.abs(positions.getX(0)-.19)<1e-6);
  assert.ok(Math.abs(positions.getY(0)-.19)<1e-6);
  assert.equal(positions.getZ(0),0);assert.equal(frame.current.x,.31);
  view.dispose();
});
test('GPU buffers are reused and reset zeros measured data; resize caps scale and backing dimensions',()=>{
  const {view,calls}=renderer();const trace=new ConstellationTrace();trace.start(0);
  const position=view.layers.trail.geometry.getAttribute('position');
  for(let at=0;at<10000;at+=100){trace.tick(sample(at),at);view.draw(trace.snapshot());}
  assert.equal(view.layers.trail.geometry.getAttribute('position'),position);
  trace.reset();view.draw(trace.snapshot());
  assert.equal(view.layers.trail.geometry.drawRange.count,0);
  assert.ok(position.array.every(v=>v===0));
  view.resize(640,360,4);assert.deepEqual(calls.at(-3),['ratio',2]);
  view.resize(4096,2048,4);assert.deepEqual(calls.at(-3),['ratio',.5]);
  view.dispose();
});
test('context loss notifies once and stops drawing; dispose releases every geometry/material and renderer once',()=>{
  const {view,calls,events,failures,canvas}=renderer();
  let geometries=0,materials=0;
  for(const object of Object.values(view.layers)){
    object.geometry.addEventListener('dispose',()=>geometries++);
    object.material.addEventListener('dispose',()=>materials++);
  }
  const loss=events.get('webglcontextlost');loss({preventDefault(){}});
  loss({preventDefault(){}});
  view.draw(new ConstellationTrace().snapshot());
  assert.deepEqual(failures,['context_lost']);assert.equal(calls.length,0);
  view.dispose();view.dispose();
  assert.equal(geometries,5);assert.equal(materials,5);
  assert.deepEqual(calls,[['dispose'],['lose']]);assert.equal(events.size,0);
  assert.equal(canvas.width,0);assert.equal(view.frame,null);
});
test('WebGL construction and invalid draw data fail explicitly rather than rendering success',()=>{
  const failure=[];const canvas={removeEventListener(){},width:0,height:0};
  const bad=new TraceRenderer(canvas,{createRenderer:()=>{throw Error('no GPU');},onFailure:r=>failure.push(r)});
  assert.equal(bad.disposed,true);assert.deepEqual(failure,['webgl_unavailable']);
  const {view,failures}=renderer();
  const frame=new ConstellationTrace().snapshot();frame.trail=[{x:NaN,y:0,brightness:1}];view.draw(frame);
  assert.deepEqual(failures,['render_failed']);view.dispose();
});
