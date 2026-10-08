import {GoogleAuth} from 'google-auth-library';
import {accessConfigured,firebaseClients,verifyGuestIdentity,reserveUsage} from './access.js';
import {fail,getJSON} from './http.js';

const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']});
export const CHALLENGE_TTL_MS=30*60*1000;
export function challengeConfigured(env) {
  return accessConfigured(env)&&env.HCR_GUEST_ENABLED==='true'&&
    /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(env.FIREBASE_PROJECT_ID)&&
    typeof env.RECAPTCHA_CHECKBOX_SITE_KEY==='string'&&/^[A-Za-z0-9_-]{20,100}$/.test(env.RECAPTCHA_CHECKBOX_SITE_KEY);
}
export async function verifyChallenge(idToken,input,env,{origin,signal,sdk,authClient=auth,request=getJSON,reserve=reserveUsage,now=()=>Date.now(),timeoutMs=25000}={}) {
  if(!challengeConfigured(env))fail('Guest verification unavailable',503,'not_configured');
  const hosts=[env.FIREBASE_PROJECT_ID+'.web.app',env.FIREBASE_PROJECT_ID+'.firebaseapp.com'];
  if(!hosts.some(h=>origin==='https://'+h))fail('Invalid verification origin',403,'verification_rejected');
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||
    typeof input.proof!=='string'||input.proof.length<20||input.proof.length>8192)
    fail('Invalid verification input',400,'invalid_request');
  const deadline=AbortSignal.timeout(timeoutMs), combined=signal?AbortSignal.any([signal,deadline]):deadline;
  let abort;
  const work=async()=>{
    let release;
    try {
      combined.throwIfAborted();sdk ||= await firebaseClients(env);combined.throwIfAborted();
      const uid=await verifyGuestIdentity(idToken,env,sdk);combined.throwIfAborted();
      release=await reserve(sdk.db,uid,'challenge');combined.throwIfAborted();
      const credential=await authClient.getAccessToken();combined.throwIfAborted();
      if(typeof credential!=='string'||!credential)throw Error();
      const result=await request('https://recaptchaenterprise.googleapis.com/v1/projects/'+env.FIREBASE_PROJECT_ID+'/assessments',{
        method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},
        // Explicit checkbox widgets do not support action names. No IP, body coordinates or user agent is sent.
        body:JSON.stringify({event:{token:input.proof,siteKey:env.RECAPTCHA_CHECKBOX_SITE_KEY}})
      },{signal:combined,timeoutMs});
      combined.throwIfAborted();
      const props=result?.tokenProperties,age=now()-Date.parse(props?.createTime);
      if(props?.valid!==true||!hosts.includes(props.hostname)||result?.event?.siteKey!==env.RECAPTCHA_CHECKBOX_SITE_KEY||
        !Number.isFinite(age)||age< -5000||age>120000)
        fail('Verification rejected',403,'verification_rejected');
      // Google validates the checkbox proof and rejects expired/reused proofs. Never mint from a score alone.
      const token=await sdk.appCheck.createToken(env.FIREBASE_APP_ID,{ttlMillis:CHALLENGE_TTL_MS});
      combined.throwIfAborted();
      if(typeof token?.token!=='string'||!token.token||token.token.length>8192||!Number.isFinite(token.ttlMillis)||token.ttlMillis<=60000||token.ttlMillis>CHALLENGE_TTL_MS)throw Error();
      return {token:token.token,ttlMillis:token.ttlMillis};
    }finally{await release?.();}
  };
  try {
    return await Promise.race([work(),new Promise((_,reject)=>{
      abort=()=>reject(combined.reason);combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();
    })]);
  }catch(error){
    if(signal?.aborted)fail('Request cancelled',499,'cancelled');
    if(deadline.aborted)fail('Verification timed out',504,'upstream_timeout');
    if(error.publicMessage)throw error;
    fail('Verification unavailable',502,'upstream_unavailable');
  }finally{if(abort)combined.removeEventListener('abort',abort);}
}
