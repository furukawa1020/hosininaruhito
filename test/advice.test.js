import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdvisorySession,geometricCue} from '../src/client/advice.js';
import {decideReflex} from '../src/providers/live.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const answer=action=>({source:'jev-live',advisoryOnly:true,action,confidence:.01});
function setup(send=async()=>answer('right')){
 let now=0;const events=[],calls=[];
 const session=new AdvisorySession({now:()=>now,onChange:e=>events.push(e),send:(body,options)=>{calls.push({body,options,at:now});return send(body,options);}});
 session.start();
 return {session,events,calls,time:n=>{now=n;},tick:(input={})=>session.update({targetId:'a',dx:.1234,dy:0,tolerance:.045,at:now,...input})};
}
test('advice sends only rounded errors at most twice a second, regardless of frames',async()=>{
 const h=setup();h.tick();await flush();
 for(let t=10;t<500;t+=10){h.time(t);h.tick();await flush();}
 assert.equal(h.calls.length,1);h.time(500);h.tick();await flush();assert.equal(h.calls.length,2);
 assert.deepEqual(h.calls[0].body,{dx:.12,dy:0,tracked:true});
 assert.equal(h.events.at(-1).state,'advice');assert.equal(h.events.at(-1).action,'right');
});
test('one request remains in flight even when transport ignores abort across restart',async()=>{
 let resolve;const h=setup(()=>new Promise(r=>resolve=r));h.tick();h.session.stop();h.session.start();h.time(1000);h.tick();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.signal.aborted,true);
 resolve(answer('right'));await flush();assert.notEqual(h.events.at(-1).state,'advice');
 h.tick();assert.equal(h.calls.length,2);
});
test('target changes discard late replies and preserve the single owner',async()=>{
 let resolve;const h=setup(()=>new Promise(r=>resolve=r));h.tick();h.time(500);h.tick({targetId:'b'});
 assert.equal(h.calls.length,1);resolve(answer('right'));await flush();assert.notEqual(h.events.at(-1).state,'advice');
});
test('geometrically inconsistent reply cannot advise even with high confidence',async()=>{
 const h=setup(async()=>({...answer('left'),confidence:1}));h.tick();await flush();assert.notEqual(h.events.at(-1).state,'advice');
 assert.equal(geometricCue({dx:0,dy:.1,tolerance:.045}),'down');
 assert.equal(geometricCue({dx:0,dy:0,tolerance:.045}),'hold');
});
test('reply age and current sample freshness are independently checked',async()=>{
 for(const [replyAt,sampleAt] of [[1100,1100],[200,0]]){
 let resolve;const h=setup(()=>new Promise(r=>resolve=r));h.tick();h.time(replyAt);
 if(sampleAt)h.tick({at:sampleAt});
 resolve(answer('right'));await flush();assert.notEqual(h.events.at(-1).state,'advice');
 }
});
test('loss, invalid timestamps and clock reversal stop advisory processing',()=>{
 for(const input of [null,{targetId:'a',dx:0,dy:0,tolerance:.045,at:1},{targetId:'a',dx:0,dy:0,tolerance:.045,at:-1}]){
 const h=setup();h.session.update(input);assert.equal(h.session.active,false);
 }
 const h=setup();h.time(100);h.tick();h.time(90);h.tick();assert.equal(h.session.active,false);
});
test('stopped response never restores advice',async()=>{
 let resolve;const h=setup(()=>new Promise(r=>resolve=r));h.tick();h.session.stop();resolve(answer('right'));await flush();assert.equal(h.events.at(-1).state,'idle');
});
test('errors back off for 2 seconds and three failures stop until explicit restart',async()=>{
 const h=setup(async()=>{throw Error('429');});
 h.tick();await flush();h.time(1999);h.tick();assert.equal(h.calls.length,1);
 h.time(2000);h.tick();await flush();h.time(4000);h.tick();await flush();
 assert.equal(h.events.at(-1).state,'unavailable');h.time(10000);h.tick();assert.equal(h.calls.length,3);
});
test('malformed source and advisory flags do not become instructions',async()=>{
 for(const invalid of [{...answer('right'),source:'fixture'},{...answer('right'),advisoryOnly:false},{...answer('capture')}]) {
 const h=setup(async()=>invalid);h.tick();await flush();assert.equal(h.events.at(-1).state,'error');
 }
});
test('sixty requests exhaust the per-execution allowance',async()=>{
 const h=setup();
 for(let i=0;i<61;i++){h.time(i*500);h.tick();await flush();}
 assert.equal(h.calls.length,60);assert.equal(h.events.at(-1).state,'limit');
});
test('direction changes and expiry clear displayed advice',async()=>{
 const h=setup();h.tick();await flush();h.time(50);h.tick({dx:-.1});assert.equal(h.events.at(-1).state,'waiting');
});
test('Jev provider rejects extra data before sending or checking credentials',async()=>{
 await assert.rejects(decideReflex({dx:0,dy:0,tracked:true,location:'not-allowed'},{}),{code:'invalid_request'});
});

test('withdrawing and restoring consent within an execution does not reset its allowance',async()=>{
 const h=setup();
 for(let i=0;i<60;i++){h.time(i*500);h.tick();await flush();}
 h.session.stop();h.session.start({resetAllowance:false});h.time(40000);h.tick();
 assert.equal(h.calls.length,60);assert.equal(h.events.at(-1).state,'limit');
});
test('display age is measured from dispatch rather than delayed receipt',async()=>{
 let resolve;const h=setup(()=>new Promise(r=>resolve=r));h.tick();h.time(900);h.tick();
 resolve(answer('right'));await flush();assert.equal(h.events.at(-1).state,'advice');
 h.time(1001);h.tick();assert.equal(h.events.at(-1).state,'waiting');
});
