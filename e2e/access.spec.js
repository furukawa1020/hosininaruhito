import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';

// SDK fixture tests only: real Firebase/App Check verification is a separate live check.
const status={mode:'live',services:{access:true,sky:true,reflex:false,planner:false},auth:{mode:'firebase',config:{projectId:'fixture'},siteKey:'fixture'}};
async function setup(page,fail=false){
 await page.route('**/api/status',r=>r.fulfill({json:status}));
 await page.route('**/assets/firebase-access-*.js',r=>r.fulfill({contentType:'text/javascript',body:`export async function login(){${fail?'throw Error("fixture failure")':'return {uid:"fixture"}'}}; export async function logout(){}; export async function headers(){return {Authorization:'Bearer fixture-id','X-Firebase-AppCheck':'fixture-app'}};`}));
 await page.goto('/');await expect(page.locator('#cloud-login')).toBeVisible();
 await expect(page.locator('#development-token')).toBeHidden();
 await page.locator('#auth-email').fill('fixture@example.test');await page.locator('#auth-password').fill('fixture-password');
 await page.locator('#auth-login').click();
}
test('cloud login sends both credentials; logout clears results and prevents another request',async({page})=>{
 let calls=0;await page.route('**/api/sky',r=>{calls++;expect(r.request().headers()['authorization']).toBe('Bearer fixture-id');expect(r.request().headers()['x-firebase-appcheck']).toBe('fixture-app');return r.fulfill({json:{source:'hoshimiru-live',constellations:[{id:'1',name:'fixture',azimuthDeg:0,altitudeDeg:30}]}});});
 await setup(page);await expect(page.locator('#auth-logout')).toBeVisible();await expect(page.locator('#auth-password')).toHaveValue('');
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();
 await expect(page.locator('.star-card')).toHaveCount(1);await page.locator('#auth-logout').click();await expect(page.locator('.star-card')).toHaveCount(0);await page.locator('#sky').click();expect(calls).toBe(1);
});
async function prepareGuest(page,options){
 await page.route('**/api/status',r=>r.fulfill({json:{...status,auth:guestAuth}}));await guestSdk(page,options);
 await page.goto('/');await expect(page.locator('#auth-guest')).toBeVisible();
 await expect(page.locator('#auth-email')).toBeHidden();await expect(page.locator('#development-token')).toBeHidden();
 await page.locator('#auth-guest').click();
}
test('guest starts without credentials, requires location consent, and shares member API and logout behavior',async({page})=>{
 let calls=0;await page.route('**/api/sky',r=>{calls++;expect(r.request().headers()['authorization']).toBe('Bearer guest-fixture');expect(r.request().headers()['x-firebase-appcheck']).toBe('fixture-app');return r.fulfill({json:{source:'hoshimiru-live',constellations:[{id:'1',name:'fixture',azimuthDeg:0,altitudeDeg:30}]}});});
 await prepareGuest(page);await expect(page.locator('#auth-notice')).toContainText('ゲストとして開始');await expect(page.locator('#auth-email')).toHaveValue('');
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#sky').click();expect(calls).toBe(0);
 await expect(page.locator('#camera-consent')).not.toBeChecked();await expect(page.locator('#planner-consent')).not.toBeChecked();
 await page.locator('#consent').check();await page.locator('#sky').click();await expect(page.locator('.star-card')).toHaveCount(1);
 await page.locator('#auth-logout').click();await expect(page.locator('.star-card')).toHaveCount(0);await page.locator('#sky').click();expect(calls).toBe(1);
});
test('failed guest login is explicit and mobile guest entry fits',async({page})=>{
 await page.setViewportSize({width:390,height:844});await prepareGuest(page,{fail:true});
 await expect(page.locator('#auth-notice')).toContainText('開始できません');await expect(page.locator('#auth-guest')).toBeEnabled();await expect(page.locator('#auth-logout')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('#cloud-login').screenshot({path:'test-results/guest-entry-mobile.png'});
});
for(const action of ['stop','escape','hidden','cancel'])test('late guest login cannot restore access after '+action,async({page})=>{
 await prepareGuest(page,{delayed:true});await expect.poll(()=>page.evaluate(()=>typeof window.releaseGuest)).toBe('function');
 await expect(page.locator('#auth-guest')).toBeDisabled();await expect(page.locator('#auth-login')).toBeDisabled();
 if(action==='stop')await page.locator('#stop').click();
 if(action==='escape')await page.keyboard.press('Escape');
 if(action==='cancel')await page.locator('#auth-logout').click();
 if(action==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.evaluate(()=>window.releaseGuest());await expect(page.locator('#auth-guest')).toBeEnabled();await expect(page.locator('#auth-logout')).toBeHidden();
 expect(await page.evaluate(()=>window.guestSignouts)).toBe(1);await expect(page.locator('#auth-notice')).toContainText('取り消しました');
});
test('switching from guest to invited login clears observation and uses the new identity',async({page})=>{
 let calls=0;await page.route('**/api/sky',r=>{expect(r.request().headers()['authorization']).toBe('Bearer '+(++calls===1?'guest-fixture':'member-fixture'));return r.fulfill({json:{source:'hoshimiru-live',constellations:[{id:'1',name:'fixture',azimuthDeg:0,altitudeDeg:30}]}});});
 await prepareGuest(page);await expect(page.locator('#auth-notice')).toContainText('ゲストとして開始');await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();await expect(page.locator('.star-card')).toHaveCount(1);
 await page.locator('#auth-account summary').click();await page.locator('#auth-email').fill('fixture@example.test');await page.locator('#auth-password').fill('fixture');await page.locator('#auth-login').click();await expect(page.locator('#auth-notice')).toContainText('ログインしました');await expect(page.locator('.star-card')).toHaveCount(0);
 await page.locator('#sky').click();await expect(page.locator('.star-card')).toHaveCount(1);expect(calls).toBe(2);
});
test('failed login cannot call sky and mobile controls fit',async({page})=>{
 await page.setViewportSize({width:390,height:844});let calls=0;await page.route('**/api/sky',r=>{calls++;return r.abort();});
 await setup(page,true);await expect(page.locator('#auth-login')).toBeEnabled();await expect(page.locator('#auth-password')).toHaveValue('');await expect(page.locator('#auth-logout')).toBeHidden();
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();expect(calls).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/cloud-login-mobile.png',fullPage:true});
});
test('CSP permits the actual App Check exchange host while blocking unrelated outbound requests',async({page})=>{
 await page.route('https://content-firebaseappcheck.googleapis.com/**',r=>r.fulfill({json:{fixture:true},headers:{'access-control-allow-origin':'*'}}));
 await setup(page);
 const result=await page.evaluate(async()=>{
  const allowed=await fetch('https://content-firebaseappcheck.googleapis.com/fixture').then(r=>r.ok).catch(()=>false);
  const blocked=await fetch('https://example.com/fixture').then(()=>false).catch(()=>true);
  return {allowed,blocked};
 });expect(result).toEqual({allowed:true,blocked:true});
});
