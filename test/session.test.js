import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSession } from '../src/core/session.js';
import { ReachCalibration } from '../src/core/reach.js';
import { ConstellationTrace } from '../src/core/trace.js';
const request = { id: '1', at: '2026-01-01T00:00:00.000Z' };
const projection = { ...request, ok: true, timeBasis: 'explicit-utc-catalog-calculation', source: {catalog:'d3-celestial/XHIP',commit:'7e720a3de062059d4c5400a379146a601d9010e0',license:'BSD-3-Clause',calculation:'astronomy-engine@2.1.19'},
  projection:'gnomonic',coordinateSystem:'normalized-image-template',mirrored:false,excluded:[],
  stars:[{id:'a',x:.25,y:.25},{id:'b',x:.75,y:.25},{id:'c',x:.25,y:.75}],lines:[['a','b'],['b','c']] };
function measured() {
  const r=new ReachCalibration(),size={width:640,height:480};r.start({joint:'leftWrist',posture:'seated',size},0);
  for(let at=0,i=0;at<=6000;at+=50,i++)r.tick({joint:'leftWrist',x:.3+i%5*.1,y:.3+Math.floor(i/5)%5*.1,at,confidence:1},at,size);
  r.finish(6000);return r.result;
}
test('selected live ID plus separate UTC projection and measured reach produce original IDs and edges',()=>{
  const prepared=prepareSession(projection,request,measured());assert.equal(prepared.ok,true);
  assert.deepEqual(prepared.lines,projection.lines);assert.equal(prepared.joint,'leftWrist');
  const trace=new ConstellationTrace(prepared);trace.start(0);let at=0;
  for(const step of prepared.program.steps)for(let i=0;i<=8;i++,at+=100)trace.tick({joint:step.joint,...step.target,x:step.target.x+.005,at,confidence:1},at);
  assert.equal(trace.state,'complete');assert.equal(trace.snapshot().lines.length,2);
  assert.equal(trace.snapshot().captures[0].x,prepared.program.steps[0].target.x+.005);
});
test('wrong ID, time, coordinate system, mirror and missing source cannot prepare',()=>{
  for(const patch of [{id:'2'},{at:'2026-01-02T00:00:00.000Z'},{source:{}},{source:{...projection.source,commit:'unknown'}},{source:{...projection.source,license:null}},{lines:undefined},{mirrored:true},{coordinateSystem:'world'},{stars:[]},{lines:[['a','missing']]}])
    assert.equal(prepareSession({...projection,...patch},request,measured()).ok,false);
});
test('too many stars reject explicitly, failures never synthesize a replacement',()=>{
  assert.equal(prepareSession({...projection,stars:Array.from({length:13},(_,i)=>({id:String(i),x:.2+i*.02,y:.5}))},request,measured()).reason,'too_many_stars');
  assert.equal(prepareSession({...projection,ok:false,reason:'below_horizon'},request,measured()).reason,'below_horizon');
  assert.equal(prepareSession(projection,request,null).reason,'invalid_calibration');
});
test('active target and hold progress advance only on fresh measured time',()=>{
  const prepared=prepareSession(projection,request,measured()),trace=new ConstellationTrace(prepared);
  trace.start(0);const step=prepared.program.steps[0];
  for(let at=0;at<=400;at+=100)trace.tick({joint:step.joint,...step.target,at,confidence:1},at);
  assert.equal(trace.snapshot().holdProgress,.5);assert.equal(trace.snapshot().activeTarget.starId,'a');
  trace.watch(551);assert.equal(trace.state,'paused');assert.equal(trace.snapshot().holdProgress,0);
  assert.equal(trace.snapshot().captures.length,0);
});
