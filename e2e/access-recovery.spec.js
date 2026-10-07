import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';

// Identity/App Check are fixtures here. No production credentials or real camera.
async function open(page,options={}) {
  await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:guestAuth}}));
  await guestSdk(page,options);
  await page.goto('/');
  await page.locator('#studio-action').click();
}
for(const [code,message] of [
  ['appCheck/initial-throttle','ブラウザーの確認が通らず'],
  ['appCheck/throttled','続けて押さず'],
  ['appCheck/recaptcha-error','通常のブラウザー'],
  ['auth/network-request-failed','通信が途切れました'],
  ['appCheck/fetch-network-error','通信が途切れました'],
  ['auth/operation-not-allowed','この開始方法を利用できません'],
])test('guest explains '+code+' without granting access or exposing SDK details',async({page})=>{
  let calls=0;await page.route('**/api/sky',r=>{calls++;return r.abort();});
  await page.setViewportSize({width:320,height:568});await open(page,{errorCode:code});
  await page.locator('#auth-guest').click();
  await expect(page.locator('#studio-dialog-notice')).toContainText(message);
  await expect(page.locator('#studio-dialog-notice')).not.toContainText('fixture private');
  await expect(page.locator('#studio-access')).toBeVisible();
  await expect(page.locator('#studio-location')).toBeHidden();
  await expect(page.locator('#auth-recovery')).toBeHidden();
  await expect(page.locator('#auth-guest')).toBeEnabled();
  await expect(page.locator('#studio-dialog-notice')).toBeInViewport({ratio:1});
  expect(calls).toBe(0);
});

for(const member of [false,true])test('timed out '+(member?'member':'guest')+' cannot accept late success; recovery fits the small screen',async({page})=>{
  await page.clock.install();await page.clock.pauseAt(new Date());
  await page.setViewportSize({width:320,height:568});await open(page,{delayed:true});
  if(member){await page.locator('#game-login').click();await page.locator('#auth-email').fill('fixture@example.test');await page.locator('#auth-password').fill('fixture');}
  await page.locator(member?'#auth-login':'#auth-guest').click();
  await expect.poll(()=>page.evaluate(()=>typeof window.releaseGuest)).toBe('function');
  await expect(page.locator('#studio-dialog-notice')).toContainText('ブラウザーを確認');
  await page.clock.fastForward(45000);
  await expect(page.locator('#studio-dialog-notice')).toContainText('45秒');
  await expect(page.locator('#auth-password')).toHaveValue('');
  await expect(page.locator('#auth-reload')).toBeInViewport({ratio:1});
  await expect(page.locator('#auth-guest')).toBeDisabled();await expect(page.locator('#auth-login')).toBeDisabled();
  expect(await page.evaluate(()=>document.getElementById('studio-dialog').scrollHeight<=document.getElementById('studio-dialog').clientHeight+1)).toBe(true);
  await page.screenshot({path:'test-results/access-timeout-'+(member?'member':'guest')+'.png'});
  await page.evaluate(()=>window.releaseGuest());
  await expect(page.locator('#auth-login')).toBeEnabled();
  expect(await page.evaluate(()=>window.guestSignouts)).toBe(1);
  await expect(page.locator('#studio-dialog-notice')).toContainText('45秒');
  await expect(page.locator('#studio-location')).toBeHidden();
  await expect(page.locator('#auth-password')).toHaveValue('');
  await page.locator('#auth-reload').click();await page.waitForLoadState('load');
  await expect(page.locator('#studio-dialog')).toBeHidden();
  await expect(page.locator('#camera-consent')).not.toBeChecked();await expect(page.locator('#consent')).not.toBeChecked();
  await page.locator('#studio-action').click();await expect(page.locator('#auth-guest')).toBeEnabled();
});

test('cancelling a stuck start exposes reload when cleanup never completes',async({page})=>{
  await page.clock.install();await page.clock.pauseAt(new Date());await open(page,{delayed:true});
  await page.locator('#auth-guest').click();
  await expect.poll(()=>page.evaluate(()=>typeof window.releaseGuest)).toBe('function');
  await page.locator('#auth-logout').click();
  await expect(page.locator('#studio-dialog-notice')).toContainText('終了処理');
  await page.clock.fastForward(45000);
  await expect(page.locator('#studio-dialog-notice')).toContainText('取消の処理が終わりません');
  await expect(page.locator('#auth-reload')).toBeVisible();
  await expect(page.locator('#auth-guest')).toBeDisabled();
});

test('late result is expired even before a delayed deadline timer runs',async({page})=>{
  await open(page,{delayed:true});await page.locator('#auth-guest').click();
  await expect.poll(()=>page.evaluate(()=>typeof window.releaseGuest)).toBe('function');
  await page.evaluate(()=>{const original=Date.now;Date.now=()=>original()+45001;window.releaseGuest();});
  await expect(page.locator('#studio-dialog-notice')).toContainText('45秒');
  await expect(page.locator('#studio-location')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>window.guestSignouts)).toBe(1);
});
