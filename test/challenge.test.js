import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyChallenge,challengeConfigured,CHALLENGE_TTL_MS} from '../src/providers/challenge.js';
import {verifyGuestIdentity} from '../src/providers/access.js';
import {createApp} from '../src/server/app.js';
const env={HCR_AUTH_MODE:'firebase',HCR_GUEST_ENABLED:'true',FIREBASE_PROJECT_ID:'test-project',FIREBASE_APP_ID:'test-app',FIREBASE_WEB_API_KEY:'public-key',RECAPTCHA_SITE_KEY:'public-score',RECAPTCHA_CHECKBOX_SITE_KEY:'public-checkbox-key-12345'};
const proof='fixture-proof-not-a-real-token',origin='https://test-project.web.app',time=Date.UTC(2026,9,8);
function setup(){
 const calls={mint:0,assess:0,reserve:0,release:0};
 const user={uid:'fixture-user',aud:env.FIREBASE_PROJECT_ID,iss:'https://securetoken.google.com/'+env.FIREBASE_PROJECT_ID,firebase:{sign_in_provider:'anonymous'}};
 const result={event:{siteKey:env.RECAPTCHA_CHECKBOX_SITE_KEY},tokenProperties:{valid:true,hostname:'test-project.web.app',createTime:new Date(time-1000).toISOString()}};
 const options={origin,now:()=>time,sdk:{auth:{verifyIdToken:async(token,revoked)=>{assert.equal(token,'id');assert.equal(revoked,true);return user;}},appCheck:{createToken:async(app,opts)=>{calls.mint++;assert.equal(app,env.FIREBASE_APP_ID);assert.equal(opts.ttlMillis,CHALLENGE_TTL_MS);return {token:'minted-fixture',ttlMillis:CHALLENGE_TTL_MS};}},db:{}},
  authClient:{getAccessToken:async()=>'server-credential'},reserve:async(db,uid,route)=>{calls.reserve++;assert.equal(uid,'fixture-user');assert.equal(route,'challenge');return async()=>{calls.release++;};},
  request:async(url,options,limits)=>{calls.assess++;assert.equal(url,'https://recaptchaenterprise.googleapis.com/v1/projects/test-project/assessments');assert.deepEqual(JSON.parse(options.body),{event:{token:proof,siteKey:env.RECAPTCHA_CHECKBOX_SITE_KEY}});assert.ok(limits.signal);return result;}};
 return {options,user,result,calls};
}
test('checkbox proof plus verified guest identity mints bounded App Check; quota is released',async()=>{
 const s=setup();assert.deepEqual(await verifyChallenge('id',{proof},env,s.options),{token:'minted-fixture',ttlMillis:1800000});assert.deepEqual(s.calls,{mint:1,assess:1,reserve:1,release:1});
});
test('SDK fractional remaining lifetime is accepted but cannot extend the requested lifetime',async()=>{
 for(const ttlMillis of [1799999.5,1800001,0,Infinity]){
  const s=setup();s.options.sdk.appCheck.createToken=async()=>({token:'fixture',ttlMillis});
  if(ttlMillis===1799999.5)assert.equal((await verifyChallenge('id',{proof},env,s.options)).ttlMillis,ttlMillis);
  else await assert.rejects(verifyChallenge('id',{proof},env,s.options),{code:'upstream_unavailable'});
 }
});
test('challenge requires explicit configuration and never appears for disabled guests',async()=>{
 for(const patch of [{HCR_GUEST_ENABLED:'false'},{RECAPTCHA_CHECKBOX_SITE_KEY:''},{FIREBASE_PROJECT_ID:'bad/path'},{HCR_AUTH_MODE:'development'}]){
  const settings={...env,...patch};assert.equal(challengeConfigured(settings),false);await assert.rejects(verifyChallenge('id',{proof},settings,setup().options),{code:'not_configured'});
  const status=await(await createApp(settings).request('/api/status')).json();assert.equal(status.auth.checkboxSiteKey,undefined);
 }
});
test('untrusted origin and malformed proof do not consume quota or call Google',async()=>{
 for(const bad of [undefined,'https://evil.test','https://test-project.web.app.evil.test','http://test-project.web.app']){
  const s=setup();await assert.rejects(verifyChallenge('id',{proof},env,{...s.options,origin:bad}),{code:'verification_rejected'});assert.equal(s.calls.reserve,0);
 }
 for(const input of [null,[],{}, {proof:''},{proof:'x'.repeat(8193)},{proof,siteKey:'other'}]){
  const s=setup();await assert.rejects(verifyChallenge('id',input,env,s.options),{code:'invalid_request'});assert.equal(s.calls.assess,0);
 }
});
test('named revoked missing and other-project identities cannot request verification',async()=>{
 for(const change of [{aud:'other'},{iss:'other'},{uid:''},{firebase:{sign_in_provider:'password'},hcrAccess:true}]){
  const s=setup();Object.assign(s.user,change);await assert.rejects(verifyChallenge('id',{proof},env,s.options),{code:'unauthorized'});assert.equal(s.calls.reserve,0);
 }
 for(const token of ['',null,'x'.repeat(8193)])await assert.rejects(verifyGuestIdentity(token,env,setup().options.sdk),{code:'unauthorized'});
 const s=setup();s.options.sdk.auth.verifyIdToken=async()=>{throw Error('private revoked details');};await assert.rejects(verifyChallenge('id',{proof},env,s.options),e=>e.code==='unauthorized'&&!e.message.includes('private'));assert.equal(s.calls.mint,0);
});
for(const [name,edit]of [
 ['failed or reused proof',s=>s.result.tokenProperties.valid=false],
 ['different site',s=>s.result.tokenProperties.hostname='evil.test'],
 ['different key',s=>s.result.event.siteKey='other-key'],
 ['expired proof',s=>s.result.tokenProperties.createTime=new Date(time-120001).toISOString()],
 ['future proof',s=>s.result.tokenProperties.createTime=new Date(time+5001).toISOString()],
 ['missing timestamp',s=>delete s.result.tokenProperties.createTime],
 ['score without checkbox proof',s=>{s.result.tokenProperties={};s.result.riskAnalysis={score:1};}],
])test('no token is issued for '+name,async()=>{
 const s=setup();edit(s);await assert.rejects(verifyChallenge('id',{proof},env,s.options),{code:'verification_rejected'});assert.equal(s.calls.mint,0);assert.equal(s.calls.release,1);
});
test('quota failure never calls assessment or token minting',async()=>{
 const s=setup();s.options.reserve=async()=>{throw Object.assign(Error('Daily limit'),{publicMessage:'Daily limit',code:'daily_limit',status:429});};await assert.rejects(verifyChallenge('id',{proof},env,s.options),{code:'daily_limit'});assert.equal(s.calls.assess,0);assert.equal(s.calls.mint,0);
});
test('assessment and signing faults are sanitized and release quota',async()=>{
 for(const stage of ['request','mint']){
  const s=setup();const fail=async()=>{throw Error('private proof credential');};if(stage==='request')s.options.request=fail;else s.options.sdk.appCheck.createToken=fail;
  await assert.rejects(verifyChallenge('id',{proof},env,s.options),e=>e.code==='upstream_unavailable'&&!e.message.includes('private'));assert.equal(s.calls.release,1);
 }
});
test('cancellation during credentials never starts an assessment',async()=>{
 const s=setup(),controller=new AbortController();let done;
 s.options.authClient.getAccessToken=()=>new Promise(r=>{done=r;});const task=verifyChallenge('id',{proof},env,{...s.options,signal:controller.signal});
 while(!done)await new Promise(r=>setTimeout(r,1));controller.abort();await assert.rejects(task,{code:'cancelled'});done('late credential');await new Promise(r=>setTimeout(r,0));assert.equal(s.calls.assess,0);assert.equal(s.calls.release,1);
});
test('deadline during assessment ignores late proof and never mints',async()=>{
 const s=setup();let done;s.options.request=()=>new Promise(r=>{done=r;});
 const keepAlive=setTimeout(()=>{},1000);
 try{await assert.rejects(verifyChallenge('id',{proof},env,{...s.options,timeoutMs:20}),{code:'upstream_timeout'});done(s.result);await new Promise(r=>setTimeout(r,0));assert.equal(s.calls.mint,0);assert.equal(s.calls.release,1);}finally{clearTimeout(keepAlive);}
});
test('verification endpoint preserves no-store size limit kill switch and paid-route authentication',async()=>{
 let calls=0;const access={challenge:async(id,input,settings,options)=>{calls++;assert.equal(id,'id');assert.equal(options.origin,origin);assert.deepEqual(input,{proof});return {token:'fixture',ttlMillis:1800000};},verify:async()=>{throw Object.assign(Error(),{publicMessage:'Denied',status:401});}};
 const app=createApp(env,{},access),headers={Origin:origin,Authorization:'Bearer id','Content-Type':'application/json'};
 const r=await app.request('/api/challenge',{method:'POST',headers,body:JSON.stringify({proof})});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal((await app.request('/api/challenge',{method:'POST',body:'{}'})).status,401);
 assert.equal((await app.request('/api/challenge',{method:'POST',headers,body:'x'.repeat(13000)})).status,413);
 assert.equal((await app.request('/api/sky',{method:'POST',headers,body:'{}'})).status,401);
 assert.equal((await createApp({...env,HCR_API_ENABLED:'false'},{},access).request('/api/challenge',{method:'POST',headers,body:'{}'})).status,503);
 assert.equal(calls,1);
});
