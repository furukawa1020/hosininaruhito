import { createHash, randomUUID } from 'node:crypto';
import { fail } from './http.js';

export const DAILY_LIMITS = Object.freeze({ sky: [50,200], program: [10,50], reflex: [300,1500], project: [100,500], catalog: [100,500] });
let clients;
export async function firebaseClients(env) {
  if (!clients) clients = (async()=>{
    const [{initializeApp,getApps,applicationDefault},{getAuth},{getAppCheck},{getFirestore}]=await Promise.all([
      import('firebase-admin/app'),import('firebase-admin/auth'),import('firebase-admin/app-check'),import('firebase-admin/firestore')]);
    const app=getApps().find(a=>a.name==='hcr-runtime') || initializeApp({projectId:env.FIREBASE_PROJECT_ID,credential:applicationDefault()},'hcr-runtime');
    return {auth:getAuth(app),appCheck:getAppCheck(app),db:getFirestore(app)};
  })().catch(error=>{clients=null;throw error;});
  return clients;
}

export function accessConfigured(env) {
  return env.HCR_AUTH_MODE === 'firebase' && ['FIREBASE_PROJECT_ID','FIREBASE_APP_ID','FIREBASE_WEB_API_KEY','RECAPTCHA_SITE_KEY'].every(k=>typeof env[k]==='string'&&!!env[k].trim());
}

export async function verifyAccess(idToken, appToken, env, sdk) {
  if (!accessConfigured(env)) fail('Authentication not configured',503,'not_configured');
  if (typeof idToken!=='string'||idToken.length>8192||!idToken||typeof appToken!=='string'||appToken.length>8192||!appToken)
    fail('Sign in required',401,'unauthorized');
  try {
    sdk ||= await firebaseClients(env);
    const [user,app]=await Promise.all([sdk.auth.verifyIdToken(idToken,true),sdk.appCheck.verifyToken(appToken)]);
    if (app.appId!==env.FIREBASE_APP_ID || user.aud!==env.FIREBASE_PROJECT_ID ||
        user.iss!=='https://securetoken.google.com/'+env.FIREBASE_PROJECT_ID || typeof user.uid!=='string' || !user.uid ||
        user.hcrAccess!==true) throw Error();
    return user.uid;
  } catch { fail('Authentication failed',401,'unauthorized'); }
}

// Firestore transactions make quotas and a global one-request lease survive
// instance replacement and concurrent revisions. Failed upstream calls still count.
export async function reserveUsage(db, uid, route, {now=()=>Date.now(), namespace='hcrUsage'}={}) {
  const limits=DAILY_LIMITS[route];if(!limits)fail('Unknown operation',404,'not_found');
  const owner=randomUUID(), started=now(), day=new Date(started).toISOString().slice(0,10);
  const userKey=createHash('sha256').update(uid).digest('hex');
  const control=db.doc('hcrControl/runtime'), user=db.doc(`${namespace}/${day}-${userKey}`), global=db.doc(`${namespace}/${day}-global`), lease=db.doc(`${namespace}/lease`);
  try {
    await db.runTransaction(async tx=>{
      const [c,u,g,l]=await tx.getAll(control,user,global,lease);
      if(c.data()?.enabled!==true)fail('Service paused',503,'service_paused');
      if(Number(l.data()?.expiresAt)>now())fail('Busy',429,'busy');
      const counts=[u.data()?.[route]??0,g.data()?.[route]??0];
      if(counts.some(n=>!Number.isSafeInteger(n)||n<0))fail('Quota unavailable',503,'quota_unavailable');
      if(counts.some((n,i)=>n>=limits[i]))fail('Daily limit reached',429,'daily_limit');
      tx.set(user,{[route]:counts[0]+1},{merge:true});tx.set(global,{[route]:counts[1]+1},{merge:true});
      tx.set(lease,{owner,expiresAt:now()+60000});
    },{maxAttempts:3});
  } catch(error) {if(error.publicMessage)throw error;fail('Quota unavailable',503,'quota_unavailable');}
  return async()=>{
    try{await db.runTransaction(async tx=>{const current=await tx.get(lease);if(current.data()?.owner===owner)tx.delete(lease);},{maxAttempts:3});}
    catch{/* Fails closed until the lease expires; never reset counts on failure. */}
  };
}

export async function acquireAccess(uid, route, env) {
  const {db}=await firebaseClients(env);return reserveUsage(db,uid,route);
}
