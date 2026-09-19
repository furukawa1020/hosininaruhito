import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../src/core/fixture.js';
import {compileConstellation,validateProgram} from '../src/core/program.js';
import {HumanRuntime} from '../src/core/runtime.js';
import {createApp} from '../src/server/app.js';
import {observeSky,decideReflex} from '../src/providers/live.js';
test('fixture compiles once per star',()=>assert.equal(compileConstellation(fixture).steps.length,7));
test('reject nonfinite and duplicate targets',()=>{
  const p=compileConstellation(fixture);p.steps[0].target.x=NaN;assert.throws(()=>validateProgram(p));
  const q=compileConstellation(fixture);q.steps[1].starId=q.steps[0].starId;assert.throws(()=>validateProgram(q));
});
test('hold then capture; pause prevents capture',()=>{
  const r=new HumanRuntime(compileConstellation(fixture));r.start();
  const target=r.target.target;
  for(let now=0;now<=800;now+=100) r.tick({...target,at:now,joint:'rightWrist',confidence:1},now);
  assert.equal(r.captures.length,1);r.stop();assert.equal(r.tick({},900).action,'stop');
});
test('stale frames and frame gaps reset hold',()=>{
  const r=new HumanRuntime(compileConstellation(fixture));r.start();const s={...r.target.target,joint:'rightWrist',confidence:1};
  r.tick({...s,at:0},0);assert.equal(r.tick({...s,at:900},900).action,'wait');
  assert.equal(r.tick({...s,at:0},1000).action,'wait');assert.equal(r.captures.length,0);
});
test('auth fails closed',async()=>{
  assert.equal((await createApp({}).request('/api/sky',{method:'POST'})).status,503);
  assert.equal((await createApp({HCR_ACCESS_TOKEN:'secret'}).request('/api/sky',{method:'POST'})).status,401);
});
test('authorized route delegates without mock fallback',async()=>{
  const app=createApp({HCR_ACCESS_TOKEN:'test'},{observeSky:async()=>({source:'test-spy'})});
  const r=await app.request('/api/sky',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:'{}'});
  assert.equal(r.status,200);assert.equal((await r.json()).source,'test-spy');
});
test('bad input and missing provider keys reject before network',async()=>{
  await assert.rejects(observeSky({lat:100,lng:0},{}));
  await assert.rejects(observeSky({lat:0,lng:0},{}));
  await assert.rejects(decideReflex({dx:NaN,dy:0,tracked:true},{}));
});
