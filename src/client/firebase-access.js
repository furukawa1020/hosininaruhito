import {initializeApp} from 'firebase/app';
import {initializeAuth,inMemoryPersistence,browserSessionPersistence,setPersistence,signInAnonymously,signInWithEmailAndPassword,signOut} from 'firebase/auth';
import {initializeAppCheck,ReCaptchaEnterpriseProvider,getToken} from 'firebase/app-check';
let app,auth,check,identity,manualToken;
async function prepare(settings,guest,progress,manual=false) {
  manualToken=null;
  const key=JSON.stringify({config:settings.config,siteKey:settings.siteKey});
  if(identity&&identity!==key)throw Error('Reload required');
  if(!auth){
    app=initializeApp(settings.config);
    auth=initializeAuth(app,{persistence:guest?browserSessionPersistence:inMemoryPersistence});
    identity=key;
  }
  await auth.authStateReady();
  // Never persist an existing named account when switching to guest mode.
  if(guest&&auth.currentUser&&!auth.currentUser.isAnonymous)await signOut(auth);
  await setPersistence(auth,guest?browserSessionPersistence:inMemoryPersistence);
  if(!manual){
    check ||= initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(settings.siteKey),isTokenAutoRefreshEnabled:false});
    progress('verification');await getToken(check);
  }
  progress('identity');
}
export async function login(settings,email,password,progress=()=>{}) {
  try{
    await prepare(settings,false,progress);
    const result=await signInWithEmailAndPassword(auth,email,password);
    const claims=await result.user.getIdTokenResult();
    if(claims.claims.hcrAccess!==true)throw Error('Not invited');
    return result.user;
  }catch(error){await logout();throw error;}
}
export async function guest(settings,progress=()=>{}) {
  if(settings?.guestEnabled!==true)throw Error('Guest access disabled');
  try{
    await prepare(settings,true,progress);
    const result=await signInAnonymously(auth);
    if(!result.user.isAnonymous)throw Error('Guest identity required');
    return result.user;
  }catch(error){await logout();throw error;}
}
export async function guestWithProof(settings,proof,progress=()=>{},signal) {
  if(settings?.guestEnabled!==true||!settings.checkboxSiteKey)throw Error('Guest verification disabled');
  try {
    signal?.throwIfAborted();await prepare(settings,true,progress,true);signal?.throwIfAborted();
    const result=await signInAnonymously(auth);signal?.throwIfAborted();
    if(!result.user.isAnonymous)throw Error('Guest identity required');
    const id=await result.user.getIdToken();signal?.throwIfAborted();
    const started=performance.now();
    const response=await fetch('/api/challenge',{method:'POST',headers:{Authorization:'Bearer '+id,'Content-Type':'application/json'},
      body:JSON.stringify({proof}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
    if(!response.ok)throw Object.assign(Error('Verification failed'),{code:response.status===429?'hcr/verification-limit':'hcr/verification-rejected'});
    const data=await response.json();signal?.throwIfAborted();
    if(typeof data.token!=='string'||!data.token||data.token.length>8192||!Number.isFinite(data.ttlMillis)||data.ttlMillis<=60000||data.ttlMillis>1800000)throw Error('Invalid verification response');
    manualToken={token:data.token,until:started+data.ttlMillis-60000};
    return result.user;
  }catch(error){await logout();throw error;}
}
export async function headers(){
  if(!auth?.currentUser)throw Error('Sign in required');
  if(manualToken){
    if(performance.now()>=manualToken.until)throw Error('確認の期限が切れました。ゲストを終了して、もう一度開始してください。');
    const id=await auth.currentUser.getIdToken();
    if(!manualToken||performance.now()>=manualToken.until)throw Error('確認の期限が切れました。もう一度開始してください。');
    return {Authorization:'Bearer '+id,'X-Firebase-AppCheck':manualToken.token};
  }
  const [id,app]=await Promise.all([auth.currentUser.getIdToken(),getToken(check)]);
  return {Authorization:'Bearer '+id,'X-Firebase-AppCheck':app.token};
}
export async function logout(){manualToken=null;if(auth)await signOut(auth);}
