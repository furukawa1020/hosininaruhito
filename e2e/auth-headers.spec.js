import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';
for(const action of ['timeout','stop','logout'])test('pending auth headers '+action+' cannot send a late sky request',async({page})=>{
 await page.clock.install();await page.clock.pauseAt(new Date());
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:guestAuth}}));
 await guestSdk(page,{headersDelay:true});
 let posts=0;await page.route('**/api/sky',r=>{posts++;return r.fulfill({json:{source:'hoshimiru-live',constellations:[]}});});
 await page.goto('/?view=details');await page.locator('#auth-guest').click();
 await expect(page.locator('#auth-notice')).toContainText('ゲストとして開始');
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();
 await expect.poll(()=>page.evaluate(()=>typeof window.releaseHeaders)).toBe('function');
 if(action==='timeout'){
  await page.clock.runFor(9900);await expect(page.locator('#sky')).toBeDisabled();
  await page.clock.runFor(101);await expect(page.locator('#notice')).toContainText('時間内');
 }else await page.locator(action==='stop'?'#stop':'#auth-logout').click();
 await expect(page.locator('#sky')).toBeEnabled();expect(posts).toBe(0);
 await page.evaluate(()=>window.releaseHeaders());await page.clock.runFor(50);expect(posts).toBe(0);
 if(action==='timeout'){
  await page.locator('#sky').click();await expect(page.locator('#count')).toHaveText('0 星座');expect(posts).toBe(1);
 }
});
