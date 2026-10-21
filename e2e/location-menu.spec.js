import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';

for(const [code,message] of [[1,'許可されていません'],[2,'端末が位置を確認できません'],[3,'時間切れ'],[99,'再試行するか']])test('location failure provides recovery for code '+code,async({page})=>{
 await page.setViewportSize({width:320,height:568});
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:guestAuth}}));await guestSdk(page);
 await page.addInitScript(code=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(ok,fail){fail({code,message:'private diagnostic'});}}}),code);
 await page.goto('/');await page.locator('#studio-action').click();await page.locator('#auth-guest').click();
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#locate').click();
 await expect(page.locator('#studio-dialog-notice')).toContainText(message);await expect(page.locator('#studio-dialog-notice')).not.toContainText('private');
 await expect(page.locator('#lat')).toHaveValue('0');await expect(page.locator('#lng')).toHaveValue('0');await expect(page.locator('#consent')).toBeChecked();
 await expect(page.locator('#locate')).toBeEnabled();await expect(page.locator('#studio-dialog-notice')).toBeInViewport({ratio:1});
});

for(const outcome of ['success','failure'])test('Enter search cancels pending location '+outcome,async({page})=>{
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:guestAuth}}));await guestSdk(page);
 let pending;await page.route('**/api/sky',r=>{pending=r;});
 await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(ok,fail){window.locationReply={ok,fail};}}}));
 await page.goto('/');await page.locator('#studio-action').click();await page.locator('#auth-guest').click();
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();
 await page.locator('#locate').click();await page.locator('#lng').press('Enter');
 await expect.poll(()=>!!pending).toBe(true);
 await page.evaluate(outcome=>outcome==='success'?window.locationReply.ok({coords:{latitude:10,longitude:20}}):window.locationReply.fail({code:1}),outcome);
 await expect(page.locator('#lat')).toHaveValue('0');await expect(page.locator('#lng')).toHaveValue('0');await expect(page.locator('#consent')).toBeChecked();
 await pending.fulfill({json:{source:'hoshimiru-live',constellations:[{id:'1',name:'試験の星座',azimuthDeg:120,altitudeDeg:40}]}});
 await expect(page.locator('#studio-choose')).toBeVisible();await expect(page.locator('#detail-name')).toHaveText('試験の星座');
});
for(const [width,height] of [[844,390],[320,568],[1440,900]])test('location guidance stays visible without scrolling '+width,async({page})=>{
 await page.setViewportSize({width,height});
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:guestAuth}}));await guestSdk(page);
 await page.route('**/api/sky',r=>r.fulfill({status:503,json:{code:'upstream_unavailable'}}));
 await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(ok,fail){window.rejectLocation=()=>fail({code:1});}}}));
 await page.goto('/');await page.locator('#studio-action').click();await page.locator('#auth-guest').click();
 await page.locator('#locate').click();await expect(page.locator('#studio-dialog-notice')).toContainText('位置情報の許可');
 await page.evaluate(()=>window.rejectLocation());await expect(page.locator('#studio-dialog-notice')).toContainText('現在地を取得できません');
 for(const id of ['studio-dialog-notice','locate','lat','lng','consent','sky','studio-close'])await expect(page.locator('#'+id)).toBeInViewport({ratio:1});
 expect(await page.locator('.game-page').evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);
 await page.screenshot({path:'test-results/location-recovery-'+width+'.png'});
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();
 await expect(page.locator('#studio-dialog-notice')).toContainText('外部APIに接続できません');
 await expect(page.locator('#studio-dialog-notice')).not.toContainText('現在地を取得できません');
});
