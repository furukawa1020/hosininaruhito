import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';
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
