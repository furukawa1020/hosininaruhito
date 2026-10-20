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
