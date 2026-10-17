import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';
test('changed access settings permit rejoining and searching without a second refresh',async({page})=>{
 let changed=false,posts=0;
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:{...guestAuth,siteKey:changed?'fixture-new':'fixture'}}}));await guestSdk(page);
 await page.route('**/api/sky',r=>{posts++;return r.fulfill({json:{source:'hoshimiru-live',constellations:[]}});});
 await page.goto('/?view=details');await page.locator('#auth-guest').click();await expect(page.locator('#auth-notice')).toContainText('ゲストとして開始');
 changed=true;await page.locator('.connection summary').click();await page.locator('#refresh').click();
 await expect(page.locator('#services')).toContainText('設定済み');
 await expect(page.locator('#auth-notice')).toContainText('もう一度参加');await expect(page.locator('#auth-logout')).toBeHidden();
 await expect(page.locator('#sky')).toBeEnabled();
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();
 await expect(page.locator('#notice')).toContainText('ログイン');expect(posts).toBe(0);
 await page.locator('#auth-guest').click();await expect(page.locator('#auth-notice')).toContainText('ゲストとして開始');
 await page.locator('#sky').click();await expect(page.locator('#count')).toHaveText('0 星座');expect(posts).toBe(1);
});
