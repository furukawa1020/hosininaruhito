import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountAdvice} from '../src/client/advice-view.js';
const flush=()=>new Promise(r=>setImmediate(r));
function setup(){
 let now=0;const nodes=Object.fromEntries(['advice-notice','advice-consent','camera-consent','token'].map(id=>[id,{dataset:{},checked:true,value:'fixture',addEventListener(){},removeEventListener(){}}]));
 const view=mountAdvice({hidden:false,getElementById:id=>nodes[id]},{performance:{now:()=>now},addEventListener(){}});
 view.setServices({access:true,reflex:true});
 return {view,nodes,tick:(id,time=0)=>{now=time;view.update({state:'running',executionId:id,current:{x:.4,y:.5,at:time},activeTarget:{starId:'a',target:{x:.5,y:.5},tolerance:.04}});}};
}
test('continuous running with a new execution discards the old reply',async t=>{
 let resolve,signal;t.mock.method(globalThis,'fetch',async(url,options)=>{signal=options.signal;return {ok:true,json:()=>new Promise(r=>{resolve=r;})};});
 const h=setup();h.tick(1);await flush();h.tick(2,100);assert.equal(signal.aborted,true);
 resolve({source:'jev-live',advisoryOnly:true,action:'right',confidence:1});await flush();assert.equal(h.nodes['advice-notice'].dataset.state,'waiting');h.view.stop();
});
test('access revocation aborts immediately without another frame',async t=>{
 let signal;t.mock.method(globalThis,'fetch',async(url,options)=>{signal=options.signal;return new Promise(()=>{});});
 const h=setup();h.tick(1);await flush();h.view.setServices({access:false,reflex:true});
 assert.equal(signal.aborted,true);assert.equal(h.nodes['advice-notice'].dataset.state,'unconfigured');await flush();
});

test('missing configuration disables consent, removes it, and never silently restores it',()=>{
 const h=setup();h.view.setServices({access:true,reflex:false});
 assert.equal(h.nodes['advice-consent'].disabled,true);assert.equal(h.nodes['advice-consent'].checked,false);
 h.view.stop();assert.equal(h.nodes['advice-notice'].dataset.state,'unconfigured');
 h.view.setServices({access:true,reflex:true});assert.equal(h.nodes['advice-consent'].disabled,false);assert.equal(h.nodes['advice-consent'].checked,false);
 assert.equal(h.nodes['advice-notice'].dataset.state,'idle');
});
