import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';
for(const details of [false,true])test('account form validates and submits Enter once details='+details,async({page})=>{
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:guestAuth}}));await guestSdk(page,{delayed:true});
 await page.goto(details?'/?view=details':'/');
 if(details)await page.locator('#auth-account summary').click();
 else{await page.locator('#studio-action').click();await page.locator('#game-login').click();}
 await page.locator('#auth-password').press('Enter');
 expect(await page.evaluate(()=>window.memberCalls||0)).toBe(0);
 await page.locator('#auth-email').fill('broken');await page.locator('#auth-password').fill('fixture');
 await page.locator('#auth-password').press('Enter');
 expect(await page.evaluate(()=>window.memberCalls||0)).toBe(0);
 await page.locator('#auth-email').fill('fixture@example.test');await page.locator('#auth-password').press('Enter');
 await expect.poll(()=>page.evaluate(()=>window.memberCalls)).toBe(1);
 await expect(page.locator('#auth-login')).toBeDisabled();
 await page.locator('#auth-password').press('Enter');expect(await page.evaluate(()=>window.memberCalls)).toBe(1);
 await page.evaluate(()=>window.releaseGuest());await expect(page.locator('#auth-notice')).toContainText('ログインしました');
 await expect(page.locator('#auth-password')).toHaveValue('');
 if(!details)await expect(page.locator('#studio-location')).toBeVisible();
});
