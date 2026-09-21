import {initializeApp} from 'firebase/app';
import {initializeAuth,inMemoryPersistence,signInWithEmailAndPassword,signOut} from 'firebase/auth';
import {initializeAppCheck,ReCaptchaEnterpriseProvider,getToken} from 'firebase/app-check';
let auth,check,identity;
export async function login(settings,email,password) {
  const key=JSON.stringify(settings);
  if(identity&&identity!==key)throw Error('Reload required');
  if(!auth){
    const app=initializeApp(settings.config);
    auth=initializeAuth(app,{persistence:inMemoryPersistence});
    check=initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(settings.siteKey),isTokenAutoRefreshEnabled:false});
    identity=key;
  }
  const result=await signInWithEmailAndPassword(auth,email,password);
  const claims=await result.user.getIdTokenResult();
  if(claims.claims.hcrAccess!==true){await signOut(auth);throw Error('Not invited');}
  await getToken(check);
  return result.user;
}
export async function headers(){
  if(!auth?.currentUser)throw Error('Sign in required');
  const [id,app]=await Promise.all([auth.currentUser.getIdToken(),getToken(check)]);
  return {Authorization:'Bearer '+id,'X-Firebase-AppCheck':app.token};
}
export async function logout(){if(auth)await signOut(auth);}
