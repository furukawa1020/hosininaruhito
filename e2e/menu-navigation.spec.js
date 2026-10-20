import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';
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
