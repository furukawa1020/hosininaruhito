import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';
async function setup(page){
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:guestAuth}}));
 await guestSdk(page);await page.goto('/?view=details');await expect(page.locator('#auth-guest')).toBeVisible();
}

test('detail guide retains specific pose, measurement and preparation messages as their text changes',async({page})=>{
 await setup(page);await page.locator('#auth-guest').click();
 await expect(page.locator('#auth-notice')).toContainText('ゲストとして開始');
 // Presentation contract fixture only: no landmarks, camera or completion claims.
 await page.evaluate(()=>{document.getElementById('detail').hidden=false;document.getElementById('camera-notice').dataset.state='preview';});
 for(const [id,state,reason,message] of [
  ['pose-notice','loading','cpu','CPUで手首の推定を準備しています。'],
  ['pose-notice','error','model_failed','推定モデルを読み込めませんでした。通信を確認してください。'],
  ['pose-notice','error','inference_failed','推定処理が停止しました。もう一度開始してください。'],
  ['reach-notice','collecting','narrow_range','配置に使える広さを確認できませんでした。無理に手を伸ばさず中断してください。'],
  ['reach-notice','paused','time_limit','30秒を超えたため記録を消去しました。'],
  ['session-notice','loading','auth','認証情報を確認しています。'],
  ['session-notice','loading','projection','星の投影を取得しています。'],
  ['session-notice','loading','ai','AIの計画を待っています。'],
  ['session-notice','error','timeout','投影の取得が時間内に終わりませんでした。']
 ]){
  await page.evaluate(({id,state,reason,message})=>{
   if(id!=='pose-notice')document.getElementById('pose-notice').dataset.state='tracking';
   if(id==='session-notice')document.getElementById('reach-notice').dataset.state='ready';
   const el=document.getElementById(id);el.dataset.state=state;el.dataset.reason=reason;el.textContent=message;
  },{id,state,reason,message});
  await expect(page.locator('#guide-message')).toHaveText(message);
 }
 await page.evaluate(()=>{document.getElementById('session-notice').textContent='通信を確認して再試行してください。';});
 await expect(page.locator('#guide-message')).toHaveText('通信を確認して再試行してください。');
 await page.evaluate(()=>{const el=document.getElementById('reach-notice');el.dataset.state='collecting';el.dataset.reason='collecting';el.textContent='計測を開始しました。';});
 await expect(page.locator('#guide-message')).toContainText('3秒以上');
});
test('Japanese play instructions, guest navigation, selection and withdrawal agree',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/sky',r=>r.fulfill({json:{source:'hoshimiru-live',constellations:[{id:'1',name:'試験の星座',azimuthDeg:0,altitudeDeg:45}]}}));
 await setup(page);await expect(page.locator('h1')).toContainText('その手のあとが');
 await expect(page.locator('.play-illustration')).toContainText('0.8秒');
 await expect(page.locator('#guide-next')).toHaveAttribute('href','#start');
 await page.locator('#auth-guest').click();await expect(page.locator('#guide-next')).toHaveAttribute('href','#observe');
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();
 await expect(page.locator('#guide-message')).toContainText('試験の星座');await expect(page.locator('#guide-next')).toHaveAttribute('href','#camera-setup');
 await expect(page.locator('#step-body')).toHaveAttribute('aria-current','step');await expect(page.locator('#camera-consent')).not.toBeChecked();
 await page.locator('#consent').uncheck();await expect(page.locator('#guide-next')).toHaveAttribute('href','#observe');
 await page.locator('#auth-logout').click();await expect(page.locator('#guide-next')).toHaveAttribute('href','#start');expect(errors).toEqual([]);
});
test('explicit geolocation rounds coordinates but never checks consent or sends sky automatically',async({page})=>{
 let calls=0;await page.route('**/api/sky',r=>{calls++;return r.fulfill({json:{source:'hoshimiru-live',constellations:[]}});});
 await page.addInitScript(()=>{window.locationCalls=0;Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(ok){window.locationCalls++;ok({coords:{latitude:35.68123,longitude:139.76567}});}}});});
 await setup(page);expect(await page.evaluate(()=>window.locationCalls)).toBe(0);await page.locator('#auth-guest').click();
 await page.locator('#consent').check();await page.locator('#locate').click();await expect(page.locator('#lat')).toHaveValue('35.68');await expect(page.locator('#lng')).toHaveValue('139.77');await expect(page.locator('#consent')).not.toBeChecked();expect(calls).toBe(0);
 await page.locator('#consent').check();expect(calls).toBe(0);await page.locator('#sky').click();await expect(page.locator('#count')).toHaveText('0 星座');expect(calls).toBe(1);
});
test('geolocation refusal offers manual coordinates without hiding failure',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(ok,fail){fail({code:1});}}}));
 await setup(page);await page.locator('#locate').click();await expect(page.locator('#location-notice')).toContainText('取得できません');await expect(page.locator('#locate')).toBeEnabled();await expect(page.locator('#lat')).toHaveValue('');
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await expect(page.locator('#lat')).toHaveValue('0');
});
for(const action of ['stop','manual','hidden'])test('late location cannot replace input after '+action,async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(ok){window.finishLocation=()=>ok({coords:{latitude:35,longitude:139}});}}}));
 await setup(page);await page.locator('#locate').click();
 if(action==='stop')await page.locator('#stop').click();
 if(action==='manual')await page.locator('#lat').fill('1');
 if(action==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.evaluate(()=>window.finishLocation());await expect(page.locator('#lat')).toHaveValue(action==='manual'?'1':'');await expect(page.locator('#locate')).toBeEnabled();
});
test('mobile and desktop introduction are readable with stop always available',async({page})=>{
 await setup(page);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});await page.evaluate(()=>scrollTo(0,0));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator('.lead').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await expect(page.locator('#stop')).toBeInViewport();await page.screenshot({path:`test-results/play-intro-${width}.png`});
  await page.locator('#start').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/play-start-${width}.png`});
  await expect(page.locator('#auth-guest')).toBeInViewport();await expect(page.locator('#stop')).toBeInViewport();
 }
});
