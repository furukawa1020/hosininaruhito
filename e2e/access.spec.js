import {test,expect} from '@playwright/test';

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
