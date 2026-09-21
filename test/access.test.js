import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyAccess,reserveUsage,DAILY_LIMITS} from '../src/providers/access.js';
import {createApp} from '../src/server/app.js';
const env={HCR_AUTH_MODE:'firebase',FIREBASE_PROJECT_ID:'test-project',FIREBASE_APP_ID:'test-app',FIREBASE_WEB_API_KEY:'public-key',RECAPTCHA_SITE_KEY:'public-site'};
const user=()=>({uid:'user1',aud:env.FIREBASE_PROJECT_ID,iss:'https://securetoken.google.com/'+env.FIREBASE_PROJECT_ID,hcrAccess:true});
const sdk=(u=user(),a={appId:env.FIREBASE_APP_ID,token:{}})=>({auth:{verifyIdToken:async(token,revoked)=>{assert.equal(token,'id');assert.equal(revoked,true);return u;}},appCheck:{verifyToken:async(token)=>{assert.equal(token,'app');return a;}}});
test('production auth verifies revocation, project, app and invitation claim',async()=>{
 assert.equal(await verifyAccess('id','app',env,sdk()),'user1');
 for(const u of [{...user(),aud:'other'},{...user(),iss:'other'},{...user(),hcrAccess:false},{...user(),uid:''}])await assert.rejects(verifyAccess('id','app',env,sdk(u)),{code:'unauthorized'});
 await assert.rejects(verifyAccess('id','app',env,sdk(user(),{appId:'other',token:{}})),{code:'unauthorized'});
});
test('missing oversized expired and revoked tokens never become a development bypass',async()=>{
 for(const tokens of [['','app'],['id',''],['id','x'.repeat(8193)]])await assert.rejects(verifyAccess(...tokens,env,sdk()),{code:'unauthorized'});
 for(const code of ['auth/id-token-expired','auth/id-token-revoked','app-check/invalid-argument']){
  const s=sdk();s.auth.verifyIdToken=async()=>{throw Error(code+' private detail');};
  await assert.rejects(verifyAccess('id','app',env,s),e=>e.code==='unauthorized'&&!e.message.includes('private'));
 }
});
// A serialized transactional store exercises competing consumers of shared data.
function store(){const values=new Map([['hcrControl/runtime',{enabled:true}]]);let tail=Promise.resolve();return {values,doc:path=>({path}),runTransaction(fn){const job=tail.then(async()=>{const snapshot=new Map([...values].map(([k,v])=>[k,structuredClone(v)]));const read=r=>({data:()=>snapshot.get(r.path)});const result=await fn({get:async r=>read(r),getAll:async(...refs)=>refs.map(read),set:(r,v,o)=>snapshot.set(r.path,o?.merge?{...snapshot.get(r.path),...v}:v),delete:r=>snapshot.delete(r.path)});values.clear();for(const [k,v]of snapshot)values.set(k,v);return result;});tail=job.catch(()=>{});return job;}};}
test('shared lease rejects concurrent instances, release preserves daily charge',async()=>{
 const db=store(),opts={now:()=>Date.UTC(2026,0,1)};
 const both=await Promise.allSettled([reserveUsage(db,'user','program',opts),reserveUsage(db,'other','program',opts)]);
 assert.equal(both.filter(r=>r.status==='fulfilled').length,1);assert.equal(both.find(r=>r.status==='rejected').reason.code,'busy');
 await both.find(r=>r.status==='fulfilled').value();assert.equal(db.values.get('hcrUsage/2026-01-01-global').program,1);
 assert.ok(![...db.values.keys()].some(k=>k.includes('-user')));
});
test('per-user and global daily limits persist across instances and days reset independently',async()=>{
 const db=store();let time=Date.UTC(2026,0,1);const options={now:()=>time};
 for(let i=0;i<DAILY_LIMITS.program[0];i++)await(await reserveUsage(db,'same','program',options))();
 await assert.rejects(reserveUsage(db,'same','program',options),{code:'daily_limit'});
 db.values.set('hcrUsage/2026-01-01-global',{program:DAILY_LIMITS.program[1]});
 await assert.rejects(reserveUsage(db,'fresh','program',options),{code:'daily_limit'});
 time+=86400000;await(await reserveUsage(db,'same','program',options))();
});
test('expired old lease cannot release a newer request and faults fail closed',async()=>{
 const db=store();let time=0;const options={now:()=>time};const old=await reserveUsage(db,'a','sky',options);
 time=60001;const next=await reserveUsage(db,'b','sky',options);await old();
 await assert.rejects(reserveUsage(db,'a','sky',options),{code:'busy'});await next();
 db.values.set('hcrControl/runtime',{enabled:false});await assert.rejects(reserveUsage(db,'a','sky',options),{code:'service_paused'});
 db.values.delete('hcrControl/runtime');await assert.rejects(reserveUsage(db,'a','sky',options),{code:'service_paused'});
 await assert.rejects(reserveUsage({...db,runTransaction:async()=>{throw Error('private');}},'a','sky',options),e=>e.code==='quota_unavailable'&&!e.message.includes('private'));
});
test('Cloud Run rejects development mode even if a shared token is configured',async()=>{
 for(const mode of [undefined,'development','typo']){
  const r=await createApp({K_SERVICE:'hcr',HCR_AUTH_MODE:mode,HCR_ACCESS_TOKEN:'legacy'}).request('/api/sky',{method:'POST',headers:{Authorization:'Bearer legacy'},body:'{}'});
  assert.equal(r.status,503);assert.equal((await r.json()).code,'not_configured');
 }
});
test('production routes authenticate before quota and release after upstream failure',async()=>{
 let reserved=0,released=0;const access={verify:async(id,app)=>{assert.equal(id,'id');assert.equal(app,'app');return 'uid';},acquire:async(uid,route)=>{assert.equal(uid,'uid');assert.equal(route,'sky');reserved++;return async()=>released++;}};
 const app=createApp(env,{observeSky:async()=>{throw Error('upstream secret');}},access);
 assert.equal((await app.request('/api/sky',{method:'POST',body:'{}'})).status,401);assert.equal(reserved,0);
 const r=await app.request('/api/sky',{method:'POST',headers:{Authorization:'Bearer id','X-Firebase-AppCheck':'app','Content-Type':'application/json'},body:'{}'});
 assert.equal(r.status,502);assert.equal(reserved,1);assert.equal(released,1);assert.ok(!(await r.text()).includes('secret'));
});
test('emergency switch prevents paid provider and status exposes only public config',async()=>{
 const app=createApp({...env,HCR_API_ENABLED:'false',HOSHIMIRU_API_TOKEN:'private-secret'});
 const r=await app.request('/api/sky',{method:'POST',body:'{}'});assert.equal(r.status,503);assert.equal((await r.json()).code,'service_paused');
 const status=await(await app.request('/api/status')).text();assert.ok(status.includes('public-key'));assert.ok(!status.includes('private-secret'));
});
