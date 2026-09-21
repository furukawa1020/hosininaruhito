import {initializeApp} from 'firebase/app';
import {initializeAuth,inMemoryPersistence,browserSessionPersistence,setPersistence,signInAnonymously,signInWithEmailAndPassword,signOut} from 'firebase/auth';
import {initializeAppCheck,ReCaptchaEnterpriseProvider,getToken} from 'firebase/app-check';
let auth,check,identity;
async function prepare(settings,guest) {
  const key=JSON.stringify({config:settings.config,siteKey:settings.siteKey});
  if(identity&&identity!==key)throw Error('Reload required');
  if(!auth){
    const app=initializeApp(settings.config);
    auth=initializeAuth(app,{persistence:guest?browserSessionPersistence:inMemoryPersistence});
    check=initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(settings.siteKey),isTokenAutoRefreshEnabled:false});
    identity=key;
  }
  await auth.authStateReady();
  // Never persist an existing named account when switching to guest mode.
  if(guest&&auth.currentUser&&!auth.currentUser.isAnonymous)await signOut(auth);
  await setPersistence(auth,guest?browserSessionPersistence:inMemoryPersistence);
  await getToken(check);
}
export async function login(settings,email,password) {
  try{
    await prepare(settings,false);
    const result=await signInWithEmailAndPassword(auth,email,password);
    const claims=await result.user.getIdTokenResult();
    if(claims.claims.hcrAccess!==true)throw Error('Not invited');
    return result.user;
  }catch(error){await logout();throw error;}
}
export async function guest(settings) {
  if(settings?.guestEnabled!==true)throw Error('Guest access disabled');
  try{
    await prepare(settings,true);
    const result=await signInAnonymously(auth);
    if(!result.user.isAnonymous)throw Error('Guest identity required');
    return result.user;
  }catch(error){await logout();throw error;}
}
export async function headers(){
  if(!auth?.currentUser)throw Error('Sign in required');
  const [id,app]=await Promise.all([auth.currentUser.getIdToken(),getToken(check)]);
  return {Authorization:'Bearer '+id,'X-Firebase-AppCheck':app.token};
}
export async function logout(){if(auth)await signOut(auth);}
