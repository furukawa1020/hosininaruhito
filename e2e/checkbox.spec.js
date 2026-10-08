import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';
async function setup(page,options={}){
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:{...guestAuth,checkboxSiteKey:'fixture-checkbox-key-12345'}}}));
 await guestSdk(page,options);
 await page.addInitScript(()=>{
  window.grecaptcha={enterprise:{ready:cb=>cb(),reset:()=>{window.checkboxResets=(window.checkboxResets||0)+1;},render:(element,options)=>{
   window.checkboxCallback=()=>options.callback('fixture-human-proof-123456789');window.checkboxError=options['error-callback'];
   const button=document.createElement('button');button.textContent='Fixture confirmation';button.onclick=window.checkboxCallback;element.append(button);
   const outside=document.createElement('button');outside.id='fixture-google-overlay';outside.hidden=true;document.body.append(outside);return 17;
  }}};
 });
 await page.goto('/');await page.evaluate(()=>{const el=document.createElement('div');el.id='fixture-existing-google-frame';document.body.append(el);});await page.locator('#studio-action').click();
}
for(const [width,height]of [[320,568],[844,390]])test('human guest path fits '+width+' and joins the same API flow after verification fixture',async({page})=>{
 await page.setViewportSize({width,height});await setup(page,{errorCode:'appCheck/initial-throttle'});
 await page.locator('#auth-guest').click();await expect(page.locator('#studio-dialog-notice')).toContainText('画面で確認して参加');
 await expect(page.locator('#auth-human')).toBeInViewport({ratio:1});await page.locator('#auth-human').click();await expect(page.locator('#studio-dialog')).toBeHidden();
 await expect(page.locator('#human-check-title')).toBeVisible();await expect(page.locator('#human-check-stop')).toBeInViewport({ratio:1});
 expect(await page.evaluate(()=>document.querySelector('#fixture-google-overlay').inert)).toBe(false);expect(await page.evaluate(()=>window.humanGuestCalls||0)).toBe(0);
 expect(await page.evaluate(()=>document.querySelector('#fixture-existing-google-frame').inert)).toBe(false);
 await page.screenshot({path:'test-results/checkbox-'+width+'.png'});await page.getByText('Fixture confirmation',{exact:true}).click();
 await expect(page.locator('#studio-location')).toBeVisible();await expect(page.locator('.human-check')).toHaveCount(0);
 await expect(page.locator('#consent')).not.toBeChecked();await expect(page.locator('#camera-consent')).not.toBeChecked();
 let calls=0;await page.route('**/api/sky',r=>{calls++;expect(r.request().headers()['authorization']).toBe('Bearer guest-fixture');expect(r.request().headers()['x-firebase-appcheck']).toBe('fixture-app');return r.fulfill({json:{source:'hoshimiru-live',constellations:[{id:'1',name:'fixture',azimuthDeg:0,altitudeDeg:30}]}});});
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();await expect(page.locator('#studio-choose')).toBeVisible();expect(calls).toBe(1);
});
for(const action of ['cancel','escape','hidden'])test('checkbox '+action+' ignores a late proof without signing in',async({page})=>{
 await setup(page);await page.locator('#auth-human').click();await expect(page.getByText('Fixture confirmation',{exact:true})).toBeVisible();
 if(action==='cancel')await page.locator('#human-check-stop').click();if(action==='escape')await page.keyboard.press('Escape');
 if(action==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.evaluate(()=>window.checkboxCallback());await expect(page.locator('.human-check')).toHaveCount(0);await expect(page.locator('#auth-guest')).toBeEnabled();
 expect(await page.evaluate(()=>window.humanGuestCalls||0)).toBe(0);expect(await page.evaluate(()=>document.querySelector('main').inert)).toBe(false);
});
test('stop after submitting proof discards delayed guest success',async({page})=>{
 await setup(page,{manualDelay:true});await page.locator('#auth-human').click();await page.getByText('Fixture confirmation',{exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>typeof window.releaseHuman)).toBe('function');await page.locator('#auth-logout').click();await page.evaluate(()=>window.releaseHuman());
 await expect(page.locator('#auth-human')).toBeEnabled();await expect(page.locator('#studio-location')).toBeHidden();await expect.poll(()=>page.evaluate(()=>window.guestSignouts)).toBe(1);
});
test('checkbox service failure restores controls and cannot enter location',async({page})=>{
 await setup(page);await page.locator('#auth-human').click();await expect(page.getByText('Fixture confirmation',{exact:true})).toBeVisible();await page.evaluate(()=>window.checkboxError());
 await expect(page.locator('.human-check')).toHaveCount(0);await expect(page.locator('#studio-access')).toBeVisible();await expect(page.locator('#auth-human')).toBeEnabled();expect(await page.evaluate(()=>window.humanGuestCalls||0)).toBe(0);
});
