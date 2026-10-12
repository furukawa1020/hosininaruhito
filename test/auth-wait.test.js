import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForAuth} from '../src/client/requests.js';
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
