import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';
const row={id:'1',name:'最初の星座',azimuthDeg:120,altitudeDeg:40,description:'説明。'.repeat(100)};
async function setup(page,rows=[row]){
 await guestSdk(page);
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:guestAuth}}));
 await page.route('**/api/sky',r=>r.fulfill({json:{source:'hoshimiru-live',constellations:rows}}));
 await page.goto('/');await page.locator('#studio-action').click();await page.locator('#auth-guest').click();
 await expect(page.locator('#studio-location')).toBeVisible();await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();
 await expect(page.locator('#studio-choose')).toBeVisible();
}
async function centerClick(page){const box=await page.locator('#game-sphere canvas').boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);}
test('dome selection only operates on the stars page',async({page})=>{
 await setup(page,[row,{...row,id:'2',name:'次の星座'}]);await page.locator('#game-next').click();
 await page.locator('#game-options').click();await centerClick(page);await expect(page.locator('#detail-name')).toHaveText('次の星座');
 await page.locator('#studio-back').click();await page.locator('#game-about').click();await centerClick(page);await expect(page.locator('#detail-name')).toHaveText('次の星座');
 await page.locator('#studio-back').click();await centerClick(page);await expect(page.locator('#detail-name')).toHaveText('最初の星座');
});
