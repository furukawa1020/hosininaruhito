import {test,expect} from '@playwright/test';
// Real installed Firebase SDK; only network responses and the checkbox UI are fixtures.
// This verifies our identity/token adapter, not live Google attestation.
const config={apiKey:'fixture-web-api-key',projectId:'test-project',appId:'1:123:web:fixture',authDomain:'test-project.firebaseapp.com'};
function identity(){const seconds=Math.floor(Date.now()/1000);return [Buffer.from(JSON.stringify({alg:'none'})).toString('base64url'),Buffer.from(JSON.stringify({sub:'fixture-user',user_id:'fixture-user',aud:'test-project',iss:'https://securetoken.google.com/test-project',iat:seconds,exp:seconds+3600,auth_time:seconds,firebase:{sign_in_provider:'anonymous'}})).toString('base64url'),'fixture-signature'].join('.');}
for(const allowed of [true,false])test('installed Firebase SDK manual guest '+(allowed?'passes both tokens to sky and clears them on logout':'rejects failed proof without granting access'),async({page})=>{
 const id=identity();let assessments=0,skyCalls=0,automaticCalls=0;
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,reflex:false,planner:false},auth:{mode:'firebase',guestEnabled:true,config,siteKey:'fixture-score',checkboxSiteKey:'fixture-checkbox'}}}));
 await page.route('https://identitytoolkit.googleapis.com/**',r=>r.fulfill({json:{idToken:id,refreshToken:'fixture-refresh',expiresIn:'3600',localId:'fixture-user',isNewUser:true}}));
 await page.route('https://**firebaseappcheck.googleapis.com/**',r=>{automaticCalls++;return r.abort();});
 await page.route('**/api/challenge',r=>{assessments++;expect(r.request().headers()['authorization']).toBe('Bearer '+id);expect(r.request().postDataJSON()).toEqual({proof:'fixture-human-proof-123456789'});return r.fulfill({status:allowed?200:403,json:allowed?{token:'fixture-minted-app-check',ttlMillis:1799999.5}:{code:'verification_rejected'}});});
 await page.route('**/api/sky',r=>{skyCalls++;expect(r.request().headers()['authorization']).toBe('Bearer '+id);expect(r.request().headers()['x-firebase-appcheck']).toBe('fixture-minted-app-check');return r.fulfill({json:{source:'hoshimiru-live',constellations:[{id:'1',name:'fixture',azimuthDeg:0,altitudeDeg:30}]}});});
 await page.addInitScript(()=>{window.grecaptcha={enterprise:{render:(el,o)=>{const b=document.createElement('button');b.textContent='Fixture confirmation';b.onclick=()=>o.callback('fixture-human-proof-123456789');el.append(b);return 1;},reset:()=>{}}};});
 await page.goto('/');await page.locator('#studio-action').click();await page.locator('#auth-human').click();await page.getByText('Fixture confirmation',{exact:true}).click();
 if(allowed){
  await expect(page.locator('#studio-location')).toBeVisible();await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();await expect(page.locator('#studio-choose')).toBeVisible();expect(skyCalls).toBe(1);
  await page.locator('#auth-logout').click();await expect(page.locator('#studio-access')).toBeVisible();await expect(page.locator('#auth-human')).toBeEnabled();
 }else{await expect(page.locator('#studio-dialog-notice')).toContainText('確認が通りません');await expect(page.locator('#studio-location')).toBeHidden();expect(skyCalls).toBe(0);}
 expect(assessments).toBe(1);expect(automaticCalls).toBe(0);
});
