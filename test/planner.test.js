import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalProgram,reorderProgram,evaluatePlan,validatePlannedProgram} from '../src/core/planner.js';
import {planWithCodex,PLANNER_LIMITS} from '../src/providers/planner.js';
const baseline=()=>({version:1,constellationId:'test',source:'catalog',steps:[.3,.5,.7].map((x,i)=>({starId:String(i),joint:'leftWrist',target:{x,y:.5},holdMs:850,tolerance:.03}))});
const env={OPENAI_API_KEY:'test-only',CODEX_MODEL:'test-only'};
const result=(order=['0','1','2'],tokens=10)=>({finalResponse:JSON.stringify({order}),usage:{input_tokens:tokens,output_tokens:10}});
test('planner preserves left wrist, coordinates and hold through reversed order and simulation',()=>{
 const b=baseline(),p=reorderProgram(b,{order:['2','1','0']});
 assert.equal(evaluatePlan(b,p).ok,true);assert.deepEqual(p.steps,[...b.steps].reverse());assert.equal(b.source,'catalog');
});
test('planner rejects missing duplicate invented IDs and additional instructions',()=>{
 for(const proposal of [{order:['0','0','2']},{order:['0']},{order:['0','1','x']},{order:['0','1','2'],target:{x:.5}}])
 assert.throws(()=>reorderProgram(baseline(),proposal));
});
test('client rejects changed constraints or longer route',()=>{
 const b=baseline();
 for(const modify of [p=>p.steps[0].target.x=.4,p=>p.steps[0].holdMs=800,p=>p.steps[0].joint='rightWrist',p=>p.steps[0].tolerance=.04,p=>p.constellationId='other',p=>p.source='fixture']){
 const p=reorderProgram(b,{order:['0','1','2']});modify(p);assert.throws(()=>validatePlannedProgram(b,p));
 }
 assert.deepEqual(evaluatePlan(b,reorderProgram(b,{order:['0','2','1']})),{ok:false,reason:'longer_path'});
});
test('planner successful call sends only target data and uses structured output',async()=>{
 const program=baseline();program.privateLocation='not-sent';let calls=0;
 const p=await planWithCodex({program},env,{run:async(prompt,options)=>{
 calls++;assert.ok(!prompt.includes('not-sent'));assert.ok(!prompt.includes('leftWrist'));assert.equal(options.outputSchema.additionalProperties,false);
 return result(['2','1','0']);}});
 assert.equal(calls,1);assert.equal(p.source,'codex-live');assert.equal(p.planning.simulation,'synthetic-contract-only');assert.equal(p.planning.usageTokens,20);
});
test('deterministic critic retries a longer route once',async()=>{
 let calls=0;
 const p=await planWithCodex({program:baseline()},env,{run:async(prompt)=>{
 calls++;if(calls===2)assert.match(prompt,/longer_path/);return result(calls===1?['0','2','1']:['2','1','0']);}});
 assert.equal(calls,2);assert.equal(p.planning.attempts,2);
});
test('invalid output terminates after two calls without fallback',async()=>{
 let calls=0;await assert.rejects(planWithCodex({program:baseline()},env,{run:async()=>{calls++;return {...result(),finalResponse:'invalid'};}}),{code:'planner_rejected'});
 assert.equal(calls,2);
});
test('usage over observed budget rejects immediately and does not replan',async()=>{
 let calls=0;await assert.rejects(planWithCodex({program:baseline()},env,{run:async()=>{calls++;return result(['0','1','2'],PLANNER_LIMITS.usageTokens);}}),{code:'planner_limit'});assert.equal(calls,1);
});
test('usage must be reported as nonnegative safe integers',async()=>{
 for(const usage of [null,{input_tokens:-1,output_tokens:10},{input_tokens:10,output_tokens:NaN}]){
 await assert.rejects(planWithCodex({program:baseline()},env,{run:async()=>({...result(),usage})}),{code:'invalid_response'});}
});
test('oversized model output is bounded and ultimately rejected',async()=>{
 await assert.rejects(planWithCodex({program:baseline()},env,{run:async()=>({...result(),finalResponse:' '.repeat(5000)})}),{code:'planner_rejected'});
});
test('missing configuration and invalid program reject before model invocation',async()=>{
 let calls=0;const run=async()=>{calls++;return result();};
 for(const config of [{},{OPENAI_API_KEY:'test'}])await assert.rejects(planWithCodex({program:baseline()},config,{run}),{code:'not_configured'});
 await assert.rejects(planWithCodex({program:baseline(),coordinates:{}},env,{run}),{code:'invalid_request'});assert.equal(calls,0);
});
test('pre-aborted and late-aborted plans cannot be returned',async()=>{
 const a=new AbortController();a.abort();let calls=0;
 await assert.rejects(planWithCodex({program:baseline()},env,{signal:a.signal,run:async()=>{calls++;return result();}}),{code:'cancelled'});assert.equal(calls,0);
 const b=new AbortController();
 await assert.rejects(planWithCodex({program:baseline()},env,{signal:b.signal,run:async()=>{b.abort();return result();}}),{code:'cancelled'});
});
test('deadline abort is forwarded and sanitized',async()=>{
 const keepAlive=setTimeout(()=>{},1000);
 try {await assert.rejects(planWithCodex({program:baseline()},env,{timeoutMs:10,run:async(_,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}),{code:'upstream_timeout'});}
 finally{clearTimeout(keepAlive);}
});
test('unknown provider exceptions do not expose credentials',async()=>{
 await assert.rejects(planWithCodex({program:baseline()},env,{run:async()=>{throw Error('secret credential');}}),e=>e.code==='upstream_unavailable'&&!e.message.includes('secret'));
});

test('SDK runner isolates environment, disables tools and cleans its temporary home',async()=>{
 const {runCodexTurn}=await import('../src/providers/planner.js');
 const {access}=await import('node:fs/promises');
 let home;
 class FakeCodex {
 constructor(options){home=options.env.CODEX_HOME;assert.equal(options.apiKey,env.OPENAI_API_KEY);
  assert.equal(options.env.HOSHIMIRU_API_TOKEN,undefined);assert.equal(options.config.features.shell_tool,false);
  assert.equal(options.config.history.persistence,'none');}
 startThread(options){assert.equal(options.sandboxMode,'read-only');assert.equal(options.approvalPolicy,'never');assert.equal(options.networkAccessEnabled,false);
 assert.equal(options.webSearchMode,'disabled');
 return {runStreamed:async()=>({events:(async function*(){
 yield {type:'item.completed',item:{type:'agent_message',text:'{"order":["0"]}'}};
 yield {type:'turn.completed',usage:{input_tokens:10,output_tokens:5}};
 })()})};}
 }
 const result=await runCodexTurn('synthetic',{env,model:'test',signal:new AbortController().signal,outputSchema:{},CodexClass:FakeCodex});
 assert.equal(result.usage.output_tokens,5);await assert.rejects(access(home),{code:'ENOENT'});
});
test('SDK runner rejects tool calls and classifies empty credits without response text',async()=>{
 const {runCodexTurn}=await import('../src/providers/planner.js');
 for(const [event,code] of [
 [{type:'item.started',item:{type:'command_execution',command:'forbidden'}},'planner_tool_rejected'],
 [{type:'error',message:'stream disconnected: You have no credits remaining. secret response'},'upstream_quota'],
 [{type:'turn.failed',error:{message:'sandbox ACL error'}},'planner_sandbox']
 ]){
 class FakeCodex{startThread(){return {runStreamed:async()=>({events:(async function*(){yield event;})()})};}}
 await assert.rejects(runCodexTurn('synthetic',{env,model:'test',signal:new AbortController().signal,outputSchema:{},CodexClass:FakeCodex}),
 e=>e.code===code&&!e.message.includes('secret'));
 }
});
