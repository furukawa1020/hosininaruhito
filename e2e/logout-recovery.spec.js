import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';
for(const mode of ['normal','late','failure'])test('logout recovery '+mode+' never races a new identity',async({page})=>{
 await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
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

for(const mode of ['normal','late','failure'])test('cancelled guest cleanup '+mode+' preserves identity serialization',async({page})=>{
 await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:guestAuth}}));
 await guestSdk(page,{delayed:true,logoutDelay:mode==='late',logoutFailure:mode==='failure'});
 await page.goto('/?view=details');await page.locator('#auth-guest').click();
 await expect.poll(()=>page.evaluate(()=>typeof window.releaseGuest)).toBe('function');
 await page.locator('#auth-logout').click();await page.evaluate(()=>window.releaseGuest());
 if(mode==='normal'){await expect(page.locator('#auth-guest')).toBeEnabled();await expect.poll(()=>page.evaluate(()=>window.guestSignouts)).toBe(1);return;}
 if(mode==='late'){await expect.poll(()=>page.evaluate(()=>typeof window.releaseLogout)).toBe('function');await page.clock.runFor(10001);}
 await expect(page.locator('#auth-notice')).toContainText('ログアウトを完了できません');await expect(page.locator('#auth-reload')).toBeVisible();
 if(mode==='late')await page.evaluate(()=>window.releaseLogout());
 for(const id of ['auth-guest','auth-human','auth-login','auth-email','auth-password'])await expect(page.locator('#'+id)).toBeDisabled();
 await page.evaluate(()=>document.getElementById('auth-guest').click());expect(await page.evaluate(()=>window.guestCalls)).toBe(1);
});

test('page departure clears an idle password without initiating login',async({page})=>{
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:guestAuth}}));await guestSdk(page);
 await page.goto('/?view=details');await page.locator('#auth-account summary').click();await page.locator('#auth-password').fill('fixture-not-a-secret');
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
 await expect(page.locator('#auth-password')).toHaveValue('');expect(await page.evaluate(()=>window.memberCalls||0)).toBe(0);
});
