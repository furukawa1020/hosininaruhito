import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWithVertex, runVertexTurn, vertexConfig } from '../src/providers/vertex.js';
import { plannerStatus, planProgram } from '../src/providers/planning.js';
import { createApp } from '../src/server/app.js';

const env = { HCR_PLANNER_PROVIDER: 'vertex', VERTEX_PROJECT_ID: 'hosininaruhito-20260920', VERTEX_LOCATION: 'global', VERTEX_MODEL: 'gemini-test' };
const program = { version: 1, constellationId: 'test', source: 'baseline', steps: [0.3,0.5,0.7].map((x,i)=>({starId:String(i),joint:'leftWrist',target:{x,y:0.5},holdMs:800,tolerance:0.04})) };
const response = () => ({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{text:'{"order":["2","1","0"]}'}] } }], usageMetadata: {promptTokenCount:20,totalTokenCount:35} });
const options = (request, authClient = {getAccessToken:async()=>'fake-token'}) => ({env,signal:new AbortController().signal,outputSchema:{properties:{order:{minItems:3,maxItems:3,items:{enum:['0','1','2']}}}},request,authClient});

test('Vertex uses ADC, structured JSON and bounded HTTPS without subprocess tools',async()=>{
 const run=async(prompt,opts)=>runVertexTurn(prompt,{...opts,authClient:{getAccessToken:async()=>'fake-token'},request:async(url,request,limits)=>{
  assert.equal(url,'https://aiplatform.googleapis.com/v1/projects/hosininaruhito-20260920/locations/global/publishers/google/models/gemini-test:generateContent');
  assert.equal(request.headers.Authorization,'Bearer fake-token');
  const body=JSON.parse(request.body);assert.equal(body.generationConfig.maxOutputTokens,1024);assert.equal(body.generationConfig.candidateCount,1);
  assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.tools,undefined);
  assert.deepEqual(body.generationConfig.responseSchema.properties.order.items.enum,['0','1','2']);
  assert.ok(limits.signal instanceof AbortSignal);assert.ok(!request.body.includes('leftWrist'));return response();
 }});
 const result=await planWithVertex({program},env,{run});assert.equal(result.source,'vertex-live');assert.equal(result.planning.usageTokens,35);
 assert.deepEqual(result.steps,[...program.steps].reverse());assert.equal(result.planning.simulation,'synthetic-contract-only');
});

test('regional Vertex hostname and thought tokens are handled explicitly',async()=>{
 const opts=options(async(url)=>{assert.ok(url.startsWith('https://asia-east1-aiplatform.googleapis.com/'));const d=response();d.candidates[0].content.parts.unshift({text:'reasoning',thought:true});return d;});
 opts.env={...env,VERTEX_LOCATION:'asia-east1'};const result=await runVertexTurn('synthetic',opts);
 assert.equal(result.finalResponse,'{"order":["2","1","0"]}');assert.equal(result.usage.output_tokens,15);
});

for(const [name,mutate]of Object.entries({
 truncated:d=>d.candidates[0].finishReason='MAX_TOKENS', blocked:d=>d.candidates=[],
 tool:d=>d.candidates[0].content.parts=[{functionCall:{name:'shell'}}],
 role:d=>d.candidates[0].content.role='user', usage:d=>d.usageMetadata.totalTokenCount=-1,
 missingUsage:d=>delete d.usageMetadata, many:d=>d.candidates.push(d.candidates[0]),
 badPart:d=>d.candidates[0].content.parts=[null]
}))test('Vertex rejects '+name,async()=>{
 const d=response();mutate(d);await assert.rejects(runVertexTurn('synthetic',options(async()=>d)),{code:'invalid_response'});
});

test('invalid destinations and providers cannot fall back to Codex',async()=>{
 for(const config of [{...env,VERTEX_PROJECT_ID:'https://evil'}, {...env,VERTEX_LOCATION:'../global'}, {...env,VERTEX_MODEL:'gemini-a/../../evil'}]){
  assert.throws(()=>vertexConfig(config),{code:'planner_configuration'});assert.equal(plannerStatus(config).configured,false);
 }
 assert.throws(()=>planProgram({program},{...env,HCR_PLANNER_PROVIDER:'typo'}),{code:'planner_configuration'});
 await assert.rejects(planWithVertex({program},{OPENAI_API_KEY:'present',CODEX_MODEL:'present'}),{code:'not_configured'});
});

test('ADC failure is sanitized and cannot send a generation request',async()=>{
 let calls=0;await assert.rejects(runVertexTurn('synthetic',options(async()=>{calls++;},{getAccessToken:async()=>{throw Error('private credential');}})),e=>e.code==='upstream_auth'&&!e.message.includes('private'));
 assert.equal(calls,0);
});

test('cancellation during ADC returns promptly and late credentials never generate',async()=>{
 let release,started,calls=0;const entered=new Promise(r=>started=r), token=new Promise(r=>release=r), abort=new AbortController();
 const opts=options(async()=>{calls++;return response();},{getAccessToken:()=>{started();return token;}});opts.signal=abort.signal;
 const pending=planWithVertex({program},env,{signal:abort.signal,run:(prompt,o)=>runVertexTurn(prompt,{...o,authClient:opts.authClient,request:opts.request})});
 await entered;abort.abort();await assert.rejects(pending,{code:'cancelled'});release('late-token');await Promise.resolve();assert.equal(calls,0);
});

test('Vertex authentication timeout is bounded without a successful mock fallback',async()=>{
 const keepAlive=setTimeout(()=>{},1000);
 try{await assert.rejects(planWithVertex({program},env,{timeoutMs:10,run:(prompt,o)=>runVertexTurn(prompt,{...o,authClient:{getAccessToken:()=>new Promise(()=>{})}})}),{code:'upstream_timeout'});}
 finally{clearTimeout(keepAlive);}
});

test('Vertex HTTP and malformed responses are sanitized by the real bounded transport',async t=>{
 for(const reply of [()=>new Response('private-token',{status:403}),()=>new Response('not JSON'),()=>new Response('x'.repeat(1024*1024+1))]){
  const mock=t.mock.method(globalThis,'fetch',async()=>reply());
  const opts=options(undefined);await assert.rejects(runVertexTurn('synthetic',opts),e=>e.status===502&&!e.message.includes('private-token'));mock.mock.restore();
 }
});

test('server advertises configured destination and rejects stale consent before provider',async()=>{
 let calls=0;const app=createApp({...env,HCR_ACCESS_TOKEN:'fixture'},{planProgram:async()=>{calls++;return {source:'vertex-live'};}});
 const status=await(await app.request('/api/status')).json();assert.equal(status.plannerProvider,'vertex');assert.equal(status.services.planner,true);
 for(const destination of [undefined,'codex','vertex']){
  const headers={Authorization:'Bearer fixture','Content-Type':'application/json'};if(destination)headers['X-HCR-Planner']=destination;
  const r=await app.request('/api/program',{method:'POST',headers,body:JSON.stringify({program})});assert.equal(r.status,destination==='vertex'?200:409);
 }
 assert.equal(calls,1);
});

test('Vertex order proposal cannot change constraints or exceed two attempts and usage',async()=>{
 for(const payload of [{order:['0','0','2']},{order:['0','1','2'],target:{x:.9,y:.9}}]){
  let calls=0;await assert.rejects(planWithVertex({program},env,{run:async()=>{calls++;return {finalResponse:JSON.stringify(payload),usage:{input_tokens:1,output_tokens:1}};}}),{code:'planner_rejected'});assert.equal(calls,2);
 }
 await assert.rejects(planWithVertex({program},env,{run:async()=>({finalResponse:'{"order":["0","1","2"]}',usage:{input_tokens:12001,output_tokens:1}})}),{code:'planner_limit'});
});
