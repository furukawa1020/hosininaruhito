import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';
for(const mode of ['normal','late','failure'])test('logout recovery '+mode+' never races a new identity',async({page})=>{
 await page.clock.install();await page.clock.pauseAt(new Date());
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:guestAuth}}));
 await guestSdk(page,{logoutDelay:mode==='late',logoutFailure:mode==='failure'});
 await page.goto('/?view=details');await page.locator('#auth-guest').click();
 await expect(page.locator('#auth-notice')).toContainText('ゲストとして開始');await page.locator('#auth-logout').click();
 if(mode==='normal'){
  await expect(page.locator('#auth-notice')).toHaveText('ログアウトしました。');await expect(page.locator('#auth-guest')).toBeEnabled();
 }else{
  if(mode==='late'){
   await page.clock.runFor(9900);await expect(page.locator('#auth-guest')).toBeDisabled();await expect(page.locator('#auth-recovery')).toBeHidden();
   await page.clock.runFor(101);
  }
  await expect(page.locator('#auth-notice')).toContainText('ページを読み直して');
  await expect(page.locator('#auth-notice')).not.toContainText('private');await expect(page.locator('#auth-reload')).toBeVisible();
  if(mode==='late'){await page.evaluate(()=>window.releaseLogout());await page.clock.runFor(100);}
  await expect(page.locator('#auth-guest')).toBeDisabled();await expect(page.locator('#auth-login')).toBeDisabled();
  await page.evaluate(()=>document.getElementById('auth-guest').dispatchEvent(new Event('click')));
  expect(await page.evaluate(()=>window.guestCalls)).toBe(1);
 }
});
