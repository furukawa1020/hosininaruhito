import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';
async function setup(page){
 await guestSdk(page);
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:guestAuth}}));
 await page.route('**/api/sky',r=>r.fulfill({json:{source:'hoshimiru-live',constellations:[0,1,2].map((i)=>({id:String(i+1),name:['最初の星座','真ん中の星座','最後の星座'][i],azimuthDeg:120,altitudeDeg:40,description:'説明。'.repeat(100)}))}}));
 await page.goto('/');await page.locator('#studio-action').click();await page.locator('#auth-guest').click();
 await expect(page.locator('#studio-location')).toBeVisible();await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();
 await expect(page.locator('#studio-choose')).toBeVisible();
}
test('modified, composing and consumed keys do not change constellation selection',async({page})=>{
 await setup(page);
 for(const option of ['altKey','ctrlKey','metaKey','shiftKey','isComposing','consumed']){
  const prevented=await page.locator('#studio-dialog').evaluate((el,option)=>{
   const event=new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true,[option]:true});
   if(option==='consumed')event.preventDefault();el.dispatchEvent(event);return event.defaultPrevented;
  },option);
  expect(prevented).toBe(option==='consumed');await expect(page.locator('#detail-name')).toHaveText('最初の星座');
 }
 await page.locator('#game-next').focus();await page.keyboard.press('ArrowRight');await expect(page.locator('#detail-name')).toHaveText('真ん中の星座');
 await page.keyboard.press('ArrowLeft');await expect(page.locator('#detail-name')).toHaveText('最初の星座');
});
test('text editing and location inputs keep their native arrow behavior',async({page})=>{
 await setup(page);
 await page.locator('#detail-name').evaluate(el=>{el.contentEditable='true';el.focus();});
 await page.keyboard.press('ArrowRight');await expect(page.locator('#detail-name')).toHaveText('最初の星座');
 await page.locator('#studio-back').click();await page.locator('#lat').focus();await page.keyboard.press('ArrowRight');
 await expect(page.locator('#lat')).toBeFocused();await expect(page.locator('#studio-dialog')).toHaveAttribute('data-page','location');
});
test('reading arrows stay within the story and preserve boundary focus',async({page})=>{
 await setup(page);await page.locator('#game-about').click();await page.keyboard.press('ArrowLeft');await expect(page.locator('#game-text-count')).toHaveText('1 / 3');
 await page.locator('#game-text-next').focus();await page.keyboard.press('ArrowRight');await expect(page.locator('#game-text-count')).toHaveText('2 / 3');await expect(page.locator('#game-text-next')).toBeFocused();
 await page.keyboard.press('ArrowRight');await expect(page.locator('#game-text-count')).toHaveText('3 / 3');await expect(page.locator('#game-reading-text')).toBeFocused();
 await page.keyboard.press('ArrowRight');await expect(page.locator('#game-text-count')).toHaveText('3 / 3');
 await page.keyboard.press('ArrowLeft');await expect(page.locator('#game-text-count')).toHaveText('2 / 3');await expect(page.locator('#detail-name')).toHaveText('最初の星座');
 await page.locator('#game-options').click();await page.keyboard.press('ArrowRight');await expect(page.locator('#studio-dialog')).toHaveAttribute('data-page','settings');
 await page.locator('#studio-back').click();await expect(page.locator('#game-text-count')).toHaveText('2 / 3');
});
test('Home and End select list endpoints only on the stars page',async({page})=>{
 await setup(page);await page.locator('#game-next').focus();await page.keyboard.press('End');await expect(page.locator('#detail-name')).toHaveText('最後の星座');
 await page.keyboard.press('End');await expect(page.locator('#game-page-count')).toHaveText('3 / 3');
 await page.keyboard.press('Home');await expect(page.locator('#detail-name')).toHaveText('最初の星座');
 await page.locator('#game-options').click();await page.keyboard.press('End');await page.locator('#studio-back').click();await expect(page.locator('#detail-name')).toHaveText('最初の星座');
 await page.keyboard.press('ArrowLeft');await expect(page.locator('#detail-name')).toHaveText('最後の星座');
});
test('selection changes announce name and count without moving focus or adding page overflow',async({page})=>{
 await page.setViewportSize({width:320,height:568});await setup(page);
 const live=page.locator('#game-selection-announcement');await expect(live).toHaveAttribute('role','status');await expect(live).toHaveAttribute('aria-atomic','true');
 await page.locator('#game-next').click();await expect(live).toHaveText('真ん中の星座、2 / 3');await expect(page.locator('#game-next')).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);
 await page.locator('#game-options').click();await expect(live).toBeHidden();await expect(live).toHaveText('');
 await page.locator('#studio-back').click();await expect(live).toHaveText('真ん中の星座、2 / 3');
});
test('play button names the current constellation and clears an invalidated selection',async({page})=>{
 await setup(page);const choose=page.locator('#studio-choose');await expect(choose).toHaveAccessibleName('この星座で遊ぶ：最初の星座');
 await page.locator('#game-next').click();await expect(choose).toHaveAccessibleName('この星座で遊ぶ：真ん中の星座');await expect(choose).toHaveText('この星座で遊ぶ →');
 await page.locator('#studio-back').click();await page.locator('#lat').fill('1');
 await expect(choose).toHaveAttribute('aria-label','この星座で遊ぶ');await expect(choose).toBeDisabled();
 await expect(page.locator('#game-selection-announcement')).toHaveText('');
});
