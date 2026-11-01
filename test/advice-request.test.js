import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestAdvice} from '../src/client/advice-request.js';
const body={dx:.1,dy:0,tracked:true};
const flush=()=>new Promise(r=>setImmediate(r));
test('advice authenticates once, sends rounded payload and releases its signal',async t=>{
 let signal;t.mock.method(globalThis,'fetch',async(url,options)=>{signal=options.signal;assert.equal(url,'/api/reflex');assert.equal(options.headers.Authorization,'fixture');assert.deepEqual(JSON.parse(options.body),body);return {ok:true,json:async()=>({action:'right'})};});
 assert.deepEqual(await requestAdvice(body,{headers:async()=>({Authorization:'fixture'})}),{action:'right'});assert.equal(signal.aborted,true);
});
for(const phase of ['auth','fetch','body'])test('advice deadline bounds abort-ignoring '+phase,async t=>{
 let release,signal,calls=0;const held=new Promise(r=>{release=r;});
 t.mock.timers.enable({apis:['setTimeout']});
 t.mock.method(globalThis,'fetch',async(url,options)=>{calls++;signal=options.signal;if(phase==='fetch')await held;return {ok:true,json:async()=>{if(phase==='body')await held;return {};}};});
 const result=requestAdvice(body,{headers:async owned=>{signal=owned;if(phase==='auth')await held;return {};}});
 const rejected=assert.rejects(result,{name:'TimeoutError'});await flush();t.mock.timers.tick(1000);await rejected;
 assert.equal(signal.aborted,true);release();await flush();assert.equal(calls,phase==='auth'?0:1);
});
for(const phase of ['auth','body'])test('late '+phase+' cannot beat a delayed deadline timer',async t=>{
 let now=0,calls=0;t.mock.method(performance,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{calls++;return {ok:true,json:async()=>{now=1001;return {};}};});
 await assert.rejects(requestAdvice(body,{headers:async()=>{if(phase==='auth')now=1001;return {};}}),{name:'TimeoutError'});assert.equal(calls,phase==='auth'?0:1);
});
test('cancelled advice never dispatches after authentication resolves',async t=>{
 let release,calls=0;const controller=new AbortController();t.mock.method(globalThis,'fetch',()=>{calls++;});
 const result=requestAdvice(body,{signal:controller.signal,headers:()=>new Promise(r=>{release=r;})});
 const rejected=assert.rejects(result,{name:'AbortError'});await flush();controller.abort();await rejected;release({});await flush();assert.equal(calls,0);
});
