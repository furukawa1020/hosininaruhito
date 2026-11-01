import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';
const rows=[{id:'1',name:'最初の星座',azimuthDeg:0,altitudeDeg:40,description:'説明。'.repeat(100)},{id:'2',name:'次の星座',azimuthDeg:30,altitudeDeg:20}];
async function setup(page){
 await guestSdk(page);
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:guestAuth}}));
 await page.route('**/api/sky',r=>r.fulfill({json:{source:'hoshimiru-live',constellations:rows}}));
 await page.goto('/');await page.locator('#studio-action').click();
}
async function stars(page){
 await page.locator('#auth-guest').click();await expect(page.locator('#studio-location')).toBeVisible();
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();await expect(page.locator('#studio-choose')).toBeVisible();
}
async function fits(page,ids){
 for(const id of ids)await expect(page.locator('#'+id)).toBeInViewport({ratio:1});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
 expect(await page.locator('.game-page').evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);
}
for(const [width,height]of [[320,568],[844,390]])test('game help and settings fit without scrolling '+width,async({page})=>{
 await page.setViewportSize({width,height});await setup(page);await page.locator('#game-options').click();
 await fits(page,['game-help','game-withdraw-camera','refresh','game-connection','studio-back']);
 await expect(page.locator('#game-withdraw-camera')).toBeDisabled();await page.locator('#game-help').click();
 for(let i=1;i<=4;i++){
  await expect(page.locator('#game-text-count')).toHaveText(i+' / 4');await expect(page.locator('#game-reading-announcement')).toContainText(i+' / 4ページ。');
  await fits(page,['game-reading-text','game-text-prev','game-text-next','studio-back']);
  if(i<4)await page.locator('#game-text-next').click();
 }
 await expect(page.locator('#game-reading-text')).toContainText('0.8秒');await expect(page.locator('#game-reading-text')).toContainText('Esc');await expect(page.locator('#game-reading-text')).toBeFocused();
 await expect(page.locator('#camera-video')).toBeHidden();await expect(page.locator('#camera-consent')).not.toBeChecked();
 await expect(page.locator('#studio-back')).toHaveAccessibleName('設定へ戻る');await page.locator('#studio-back').click();await expect(page.locator('#game-settings')).toBeVisible();
});
test('reading announces page and complete short name; settings restore reading position',async({page})=>{
 await setup(page);await stars(page);await page.locator('#game-about').click();
 await expect(page.locator('#game-reading-text')).toContainText('名前：最初の星座');
 await expect(page.locator('#game-reading-announcement')).toContainText('1 / 3ページ。名前：最初の星座');
 await expect(page.locator('#game-reading-text')).toHaveAttribute('aria-describedby','game-text-count');
 await page.locator('#game-text-next').click();await expect(page.locator('#game-reading-announcement')).toContainText('2 / 3ページ。');
 await page.locator('#game-options').click();await expect(page.locator('#game-reading-announcement')).toBeEmpty();
 await page.locator('#studio-back').click();await expect(page.locator('#game-text-count')).toHaveText('2 / 3');
});
test('menu names backward destinations and neighboring constellations',async({page})=>{
 await setup(page);await expect(page.locator('#studio-back')).toHaveAccessibleName('停止して閉じる');
 await page.locator('#game-login').click();await expect(page.locator('#studio-back')).toHaveAccessibleName('参加へ戻る');
 await page.locator('#game-options').click();await expect(page.locator('#studio-back')).toHaveAccessibleName('ログインへ戻る');
 await page.locator('#studio-back').click();await page.locator('#studio-back').click();await stars(page);
 await expect(page.locator('#studio-back')).toHaveAccessibleName('場所へ戻る');
 await expect(page.locator('#game-next')).toHaveAccessibleName('次の星座：次の星座');await expect(page.locator('#game-prev')).toHaveAccessibleName('前の星座：次の星座');
 await page.locator('#game-next').click();await expect(page.locator('#game-next')).toHaveAccessibleName('次の星座：最初の星座');
 await page.locator('#studio-back').click();await page.locator('#lat').fill('1');
 await expect(page.locator('#game-next')).toBeHidden();await expect(page.locator('#game-next')).toHaveAttribute('aria-label','次の星座');
});
test('dome context loss keeps arrow navigation and restoration permits fresh taps',async({page})=>{
 await setup(page);await stars(page);const dome=page.locator('#game-sphere'),canvas=dome.locator('canvas');
 await canvas.dispatchEvent('contextlost');await expect(dome).toHaveAttribute('data-fallback','true');await expect(canvas).toBeHidden();
 await page.locator('#game-next').click();await expect(page.locator('#detail-name')).toHaveText('次の星座');
 await canvas.dispatchEvent('contextrestored');await expect(canvas).toBeVisible();await expect(dome).not.toHaveAttribute('data-fallback','true');
 const r=await canvas.boundingBox();await page.mouse.click(r.x+r.width/2,r.y+r.height/2);await expect(page.locator('#detail-name')).toHaveText('次の星座');
});
