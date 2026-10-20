import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';

for(const dpr of [1,2])test.describe('dome buffer at device scale '+dpr,()=>{
 test.use({deviceScaleFactor:dpr});
 test('large backing store stays bounded and restores normal interaction',async({page})=>{
  await setup(page);await stars(page);
  const dome=page.locator('#game-sphere'),canvas=dome.locator('canvas');
  const initial=await dome.getAttribute('data-orientation'),style=await dome.getAttribute('style');
  const normal=await canvas.evaluate(el=>({width:el.width,css:el.getBoundingClientRect().width}));
  expect(normal.width).toBe(Math.round(normal.css*dpr));
  await dome.evaluate(el=>{el.style.cssText='position:fixed;left:0;top:0;width:5000px;min-width:5000px;max-width:none;height:3000px;min-height:3000px;max-height:none';});
  await expect.poll(()=>canvas.evaluate(el=>el.width)).toBe(2048);
  expect(await canvas.evaluate(el=>el.height)).toBe(1229);
  expect((await canvas.boundingBox()).width).toBe(5000);
  await expect(dome).toHaveAttribute('data-orientation',initial);await expect(dome).toHaveAttribute('data-markers','1');
  await dome.evaluate((el,value)=>{if(value===null)el.removeAttribute('style');else el.setAttribute('style',value);},style);
  await expect.poll(()=>canvas.evaluate(el=>el.width)).toBe(normal.width);
  const r=await canvas.boundingBox();
  await page.mouse.move(r.x+r.width*.4,r.y+r.height*.4);await page.mouse.down();await page.mouse.move(r.x+r.width*.6,r.y+r.height*.5);await page.mouse.up();
  await expect(dome).not.toHaveAttribute('data-orientation',initial);
  await page.locator('#game-center').click();await expect(dome).toHaveAttribute('data-orientation',initial);
  await page.locator('#studio-choose').click();await expect(page.locator('#camera-video')).toBeHidden();
 });
});
const rows=[{id:'1',name:'試験の星座',azimuthDeg:120,altitudeDeg:40,description:'星座の説明。'.repeat(40)}];
async function setup(page){
 await guestSdk(page);
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:guestAuth}}));
 await page.route('**/api/sky',r=>r.fulfill({json:{source:'hoshimiru-live',constellations:rows}}));
 await page.goto('/');await page.locator('#studio-action').click();
}
async function stars(page){
 await page.locator('#auth-guest').click();await expect(page.locator('#studio-location')).toBeVisible();
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();
 await expect(page.locator('#studio-choose')).toBeVisible();
}

for(const nested of [false,true])test('invalidated selection clears an old story and its history '+nested,async({page})=>{
 await setup(page);await stars(page);let pending;
 await page.route('**/api/status',r=>{pending=r;});await page.locator('#game-options').click();await page.locator('#refresh').click();
 await expect.poll(()=>!!pending).toBe(true);await page.locator('#studio-back').click();await page.locator('#game-about').click();
 if(nested)await page.locator('#game-options').click();
 await pending.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:{...guestAuth,siteKey:'changed-fixture'}}});
 await expect(page.locator('#studio-access')).toBeVisible();await expect(page.locator('#game-reading')).toBeHidden();
 await expect(page.locator('#game-reading-text')).not.toContainText('星座の説明');
 await page.locator('#game-options').click();await page.locator('#studio-back').click();await expect(page.locator('#studio-access')).toBeVisible();
});

test('selected representative below the horizon is named without blocking selection',async({page})=>{
 await setup(page);await page.route('**/api/sky',r=>r.fulfill({json:{source:'hoshimiru-live',constellations:[rows[0],{...rows[0],id:'2',name:'下の星座',altitudeDeg:-20}]}}));
 await stars(page);await expect(page.locator('#detail-angles')).not.toContainText('地平線下');
 await page.locator('#game-next').click();await expect(page.locator('#detail-angles')).toContainText('代表位置');
 await expect(page.locator('#detail-angles')).toContainText('地平線下');await expect(page.locator('#studio-choose')).toBeEnabled();
 await page.locator('#game-prev').click();await expect(page.locator('#detail-angles')).not.toContainText('地平線下');
});

for(const [width,height] of [[320,568],[844,390]])test('connection states and retry fit the menu '+width,async({page})=>{
 await page.setViewportSize({width,height});await setup(page);await page.locator('#game-options').click();await page.locator('#game-connection').click();
 await expect(page.locator('#services li')).toHaveCount(4);await expect(page.locator('#services')).toContainText('設定済み / 接続未確認');
 for(const id of ['services','game-recheck','studio-back'])await expect(page.locator('#'+id)).toBeInViewport({ratio:1});
 expect(await page.locator('.game-page').evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);
 await page.route('**/api/status',r=>r.fulfill({status:503,json:{}}));await page.locator('#game-recheck').click();
 await expect(page.locator('#services')).toContainText('取得できません');await expect(page.locator('#studio-dialog-notice')).toContainText('サーバーに接続できません');
 await expect(page.locator('#game-recheck')).toBeEnabled();
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:false,planner:false,reflex:false},auth:guestAuth}}));
 await page.locator('#game-recheck').click();await expect(page.locator('#services li').filter({hasText:'星をみるひとAPI'})).toContainText('未設定');
 await page.locator('#studio-back').click();await expect(page.locator('#game-settings')).toBeVisible();
});

test('unchanged location returns to existing stars without another request',async({page})=>{
 await page.setViewportSize({width:320,height:568});await setup(page);let calls=0;
 await page.route('**/api/sky',r=>{calls++;return r.fulfill({json:{source:'hoshimiru-live',constellations:rows}});});
 await stars(page);await page.locator('#studio-back').click();
 await expect(page.locator('#game-return-stars')).toBeInViewport({ratio:1});
 expect(await page.locator('.game-page').evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);
 await page.locator('#game-return-stars').click();await expect(page.locator('#studio-choose')).toBeVisible();expect(calls).toBe(1);
 await page.locator('#studio-back').click();await page.locator('#lat').fill('1');
 await expect(page.locator('#game-return-stars')).toBeHidden();await expect(page.locator('#studio-choose')).toBeHidden();expect(calls).toBe(1);
});
test('settings back restores account and reading position; reopening resets history',async({page})=>{
 await setup(page);await page.locator('#game-login').click();await page.locator('#game-options').click();
 await page.locator('#studio-back').click();await expect(page.locator('#game-account')).toBeVisible();
 await page.locator('#studio-back').click();await stars(page);await page.locator('#game-about').click();
 await page.locator('#game-text-next').click();const count=await page.locator('#game-text-count').textContent();
 await page.locator('#game-options').click();await page.locator('#game-options').click();await page.locator('#studio-back').click();
 await expect(page.locator('#game-reading')).toBeVisible();await expect(page.locator('#game-text-count')).toHaveText(count);
 await page.locator('#studio-back').click();await expect(page.locator('#studio-choose')).toBeVisible();
 await page.locator('#game-about').click();await page.locator('#studio-close').click();await page.locator('#studio-settings').click();
 await expect(page.locator('#studio-choose')).toBeVisible();await page.locator('#game-options').click();await page.locator('#studio-back').click();
 await expect(page.locator('#studio-choose')).toBeVisible();
});
