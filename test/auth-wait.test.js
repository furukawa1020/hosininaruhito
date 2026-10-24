import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForAuth} from '../src/client/requests.js';

for (const outcome of ['resolve','reject']) test('auth deadline also applies before delayed timer: '+outcome, async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let now=100, settle;
 t.mock.method(performance,'now',()=>now);
 const result=waitForAuth(new Promise((resolve,reject)=>{settle=outcome==='resolve'?resolve:reject;}));
 const check=assert.rejects(result,{name:'TimeoutError'});
 now=10100;settle(outcome==='resolve'?'late':Error('private SDK diagnostic'));await check;
 t.mock.timers.tick(10000);
});

test('cancelled auth retains abort even after a delayed SDK rejection',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let reject,now=0;
 t.mock.method(performance,'now',()=>now);
 const controller=new AbortController();
 const result=waitForAuth(new Promise((_,r)=>{reject=r;}),controller.signal);
 const check=assert.rejects(result,{name:'AbortError'});
 controller.abort();now=20000;reject(Error('late'));await check;
});
test('auth refresh resolves and clears its timeout on success or failure',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 assert.equal(await waitForAuth(Promise.resolve('ok')), 'ok');
 await assert.rejects(waitForAuth(Promise.reject(Error('failed'))),/failed/);
 t.mock.timers.tick(10000);
});
test('auth refresh times out and ignores later fulfillment',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let release;
 const result=waitForAuth(new Promise(r=>{release=r;}));
 const check=assert.rejects(result,{name:'TimeoutError'});
 t.mock.timers.tick(10000);await check;release('late');await Promise.resolve();
});
test('aborting token refresh rejects promptly even if SDK never settles',async()=>{
 for(const before of [true,false]){
  const controller=new AbortController();if(before)controller.abort();
  const result=waitForAuth(new Promise(()=>{}),controller.signal);
  const check=assert.rejects(result,{name:'AbortError'});
  if(!before)controller.abort();await check;
 }
});
