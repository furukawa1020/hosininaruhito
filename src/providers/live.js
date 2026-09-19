import { compileConstellation, validateProgram } from '../core/program.js';
function fail(message,status=400) { throw Object.assign(new Error(message),{publicMessage:message,status}); }
function required(env,key) { if (!env[key]) fail(`${key} not configured`,503); return env[key]; }
async function getJSON(url,options) {
  const response = await fetch(url,{...options,signal:AbortSignal.timeout(12000),redirect:'error'});
  if (!response.ok) fail(`Upstream HTTP ${response.status}`,502);
  return response.json();
}
export async function observeSky(input,env) {
  if (!input || !Number.isFinite(input.lat) || Math.abs(input.lat)>90 || !Number.isFinite(input.lng) || Math.abs(input.lng)>180) fail('Invalid coordinates');
  const token=required(env,'HOSHIMIRU_API_TOKEN');
  const url=new URL('https://app.livlog.xyz/hoshimiru/constellation');
  url.searchParams.set('lat',String(input.lat)); url.searchParams.set('lng',String(input.lng));
  const data=await getJSON(url,{headers:{Authorization:`Bearer ${token}`}});
  if (data.errors || !Array.isArray(data.results)) fail('Invalid sky response',502);
  return {source:'hoshimiru-live',timeBasis:'provider-default',constellations:data.results.map(row=>{
    if (!Number.isFinite(row.directionNum)||!Number.isFinite(row.altitudeNum)) fail('Invalid sky angles',502);
    return {id:String(row.id),name:row.jpName,azimuthDeg:row.directionNum,altitudeDeg:row.altitudeNum,drawingIds:row.drowing};
  })};
}
export async function decideReflex(input,env) {
  if (!input || !Number.isFinite(input.dx)||!Number.isFinite(input.dy)||Math.abs(input.dx)>1||Math.abs(input.dy)>1||typeof input.tracked!=='boolean') fail('Invalid reflex input');
  const key=required(env,'TYPESAFE_API_KEY');
  const criteria={left:'decrease image x',right:'increase image x',up:'decrease image y',down:'increase image y',hold:'close to target',wait:'tracking unavailable'};
  const data=await getJSON('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.JEV_MODEL||'jev-latest',state:JSON.stringify(input),questions:{action:{type:'choice',instructions:'Choose an advisory cue. dx/dy = target minus current. If not tracked, wait. Never decide capture or safety.',criteria}}})});
  const answer=data.answers?.action;
  if (!answer||!Object.hasOwn(criteria,answer.choice)||!Number.isFinite(answer.confidence)||answer.confidence<0||answer.confidence>1) fail('Invalid Jev response',502);
  return {source:'jev-live',advisoryOnly:true,action:answer.choice,confidence:answer.confidence};
}
export async function planWithCodex(input,env) {
  required(env,'OPENAI_API_KEY'); const model=required(env,'CODEX_MODEL');
  const constellation=input?.constellation;
  if (!constellation||typeof constellation.id!=='string'||!Array.isArray(constellation.stars)) fail('Catalog-backed normalized constellation required');
  let baseline; try { baseline=compileConstellation(constellation); } catch { fail('Invalid constellation'); }
  const {Codex}=await import('@openai/codex-sdk');
  const codex=new Codex({apiKey:env.OPENAI_API_KEY});
  const thread=codex.startThread({model,sandboxMode:'read-only',approvalPolicy:'never',skipGitRepoCheck:true,networkAccessEnabled:false});
  const result=await thread.run(`Return only JSON ProgramV1. Reorder steps to minimize hand travel; preserve each step exactly. No tools, files, shell or new coordinates. Symbolic choreography, not safety certification. Input: ${JSON.stringify(baseline)}`,{signal:AbortSignal.timeout(40000)});
  let program; try {program=validateProgram(JSON.parse(result.finalResponse));} catch {fail('Invalid planner output',502);}
  if (program.steps.length!==baseline.steps.length||program.steps.some(s=>{
    const b=baseline.steps.find(t=>t.starId===s.starId);
    return !b||b.joint!==s.joint||b.target.x!==s.target.x||b.target.y!==s.target.y||b.holdMs!==s.holdMs||b.tolerance!==s.tolerance;
  })) fail('Planner changed constraints',502);
  return {...program,source:'codex-live',constellationId:baseline.constellationId};
}
