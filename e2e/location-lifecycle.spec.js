import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';
async function setup(page){
 await guestSdk(page);await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:guestAuth}}));
 await page.addInitScript(()=>{
  const now=performance.now.bind(performance);Object.defineProperty(performance,'now',{value:()=>window.geoNow??now()});
  Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(ok,fail){window.geoReply={ok,fail};}}});
 });
 await page.goto('/');await page.locator('#studio-action').click();await page.locator('#auth-guest').click();await expect(page.locator('#lat')).toBeVisible();
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();
 await page.evaluate(()=>{window.geoNow=0;});await page.locator('#locate').focus();await page.keyboard.press('Enter');
}
for(const [at,outcome] of [[11999,'success'],[12000,'success'],[12000,'failure']])test('location checks absolute deadline '+at+' '+outcome,async({page})=>{
 await setup(page);await page.evaluate(({at,outcome})=>{window.geoNow=at;if(outcome==='success')window.geoReply.ok({coords:{latitude:10.123,longitude:20.456}});else window.geoReply.fail({code:1});},{at,outcome});
 if(at<12000){await expect(page.locator('#lat')).toHaveValue('10.12');await expect(page.locator('#lng')).toHaveValue('20.46');await expect(page.locator('#consent')).not.toBeChecked();}
 else{await expect(page.locator('#studio-dialog-notice')).toContainText('時間切れ');await expect(page.locator('#lat')).toHaveValue('0');await expect(page.locator('#consent')).toBeChecked();}
 await expect(page.locator('#locate')).toBeEnabled();
});
for(const moved of [false,true])test('location success restores consent focus without stealing another control '+moved,async({page})=>{
 await setup(page);if(moved)await page.locator('#studio-dialog-title').focus();
 await page.evaluate(()=>window.geoReply.ok({coords:{latitude:10,longitude:20}}));
 await expect(page.locator(moved?'#studio-dialog-title':'#consent')).toBeFocused();await expect(page.locator('#consent')).not.toBeChecked();
 await expect(page.locator('#studio-dialog')).toHaveAttribute('data-page','location');
});
for(const outcome of ['success','failure'])test('identity reconfiguration cancels pending location '+outcome,async({page})=>{
 await setup(page);
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:{...guestAuth,siteKey:'changed'}}}));
 await page.locator('#game-options').click();await page.locator('#refresh').click();await expect(page.locator('#auth-notice')).toContainText('接続の設定が変わりました');
 await expect(page.locator('#locate')).toBeEnabled();
 await page.evaluate(outcome=>outcome==='success'?window.geoReply.ok({coords:{latitude:10,longitude:20}}):window.geoReply.fail({code:1}),outcome);
 await expect(page.locator('#lat')).toHaveValue('0');await expect(page.locator('#lng')).toHaveValue('0');await expect(page.locator('#location-notice')).toContainText('取り消しました');
});
