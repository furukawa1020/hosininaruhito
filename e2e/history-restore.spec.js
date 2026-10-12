import {test,expect} from '@playwright/test';
const ready={mode:'live',services:{access:true,sky:true,reflex:false,planner:false}};
for(const persisted of [false,true])test('history pageshow persisted='+persisted+' resets only a cached document',async({page})=>{
 let checks=0;await page.route('**/api/status',r=>{checks++;return r.fulfill({json:ready});});
 await page.goto('/');await expect(page.locator('#sky')).toBeEnabled();
 await page.evaluate(()=>{window.previousDocument=true;document.getElementById('token').value='fixture-only';document.getElementById('lat').value='0';});
 if(persisted){
  const loaded=page.waitForEvent('domcontentloaded');
  await page.evaluate(()=>{
   // Lifecycle fixture: browser delivery of pagehide/pageshow is tested here,
   // not browser-specific eligibility for retaining a page in its history cache.
   window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
   window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
  });
  await loaded;
  await expect.poll(()=>checks).toBe(2);
  expect(await page.evaluate(()=>window.previousDocument)).toBeUndefined();
  await expect(page.locator('#token')).toHaveValue('');await expect(page.locator('#lat')).toHaveValue('');
  await expect(page.locator('#camera-consent')).not.toBeChecked();
  await expect(page.locator('#studio')).toHaveAttribute('data-phase','welcome');
  await page.locator('#studio-practice').click();
  await expect(page.locator('#studio')).toHaveAttribute('data-phase','camera');
  await expect(page.locator('#studio-action')).toBeDisabled();
 }else{
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:false})));
  expect(await page.evaluate(()=>window.previousDocument)).toBe(true);expect(checks).toBe(1);
 }
});
