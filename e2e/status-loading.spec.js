import {test,expect} from '@playwright/test';
const ready={mode:'live',services:{access:true,sky:true,planner:false,reflex:false}};
for(const stop of [false,true])test('status loading survives token input and handles stop='+stop,async({page})=>{
 let pending;
 await page.route('**/api/status',r=>{pending=r;});
 await page.goto('/?view=details');
 await expect.poll(()=>Boolean(pending)).toBe(true);
 await page.locator('#token').fill('fixture-only');
 await expect(page.locator('#sky')).toBeDisabled();
 if(stop){
  await page.locator('#stop').click();
  await expect(page.locator('#services')).toContainText('接続確認を停止');
 }
 await pending.fulfill({json:ready});
 if(stop){
  await expect(page.locator('#sky')).toBeDisabled();
  await expect(page.locator('#services')).toContainText('接続確認を停止');
  await page.unroute('**/api/status');await page.route('**/api/status',r=>r.fulfill({json:ready}));
  await page.locator('.connection summary').click();await page.locator('#refresh').click();
 }
 await expect(page.locator('#sky')).toBeEnabled();
 await expect(page.locator('#services')).toContainText('設定済み');
 await expect(page.locator('#token')).toHaveValue('fixture-only');
});
