import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchJson} from '../src/client/requests.js';

test('JSON transport preserves HTTP status and parsed data and releases its signal',async t=>{
 let signal;t.mock.method(globalThis,'fetch',async(url,options)=>{signal=options.signal;assert.equal(url,'/fixture');return {status:503,ok:false,json:async()=>({code:'busy'})};});
 const {response,data}=await fetchJson('/fixture',{},100);
 assert.equal(response.status,503);assert.deepEqual(data,{code:'busy'});assert.equal(signal.aborted,true);
});
for(const phase of ['fetch','body'])test('JSON '+phase+' deadline settles even when the operation ignores abort',async t=>{
 let signal,release;const pending=new Promise(resolve=>{release=resolve;});
 t.mock.method(globalThis,'fetch',async(url,options)=>{signal=options.signal;if(phase==='fetch')await pending;return {json:async()=>{if(phase==='body')await pending;return {late:true};}};});
 await assert.rejects(fetchJson('/fixture',{},10),{name:'TimeoutError'});
 assert.equal(signal.aborted,true);release();await new Promise(r=>setImmediate(r));
});
for(const fail of [false,true])test('JSON late '+(fail?'failure':'success')+' loses to the monotonic deadline before timers run',async t=>{
 let now=0;t.mock.method(performance,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>({json:async()=>{now=101;if(fail)throw Error('late');return {};}}));
 await assert.rejects(fetchJson('/fixture',{},100),{name:'TimeoutError'});
});
test('JSON cancellation before dispatch sends nothing; cancellation during body settles immediately',async t=>{
 const controller=new AbortController();controller.abort();let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return {json:()=>new Promise(()=>{})};});
 await assert.rejects(fetchJson('/fixture',{signal:controller.signal},100),{name:'AbortError'});assert.equal(calls,0);
 const next=new AbortController(),pending=fetchJson('/fixture',{signal:next.signal},100);
 await Promise.resolve();next.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
});
test('JSON early network and parse failures retain their identity',async t=>{
 const failure=new SyntaxError('fixture');t.mock.method(globalThis,'fetch',async()=>({json:async()=>{throw failure;}}));
 await assert.rejects(fetchJson('/fixture',{},100),e=>e===failure);
});
