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
test('story pages preserve combining marks and joined emoji at their boundaries',async({page})=>{
 const mark='か\u3099',emoji='👩‍🚀',description='あ'.repeat(119)+mark+emoji+'終わり';
 await setup(page,[{...row,description}]);await page.locator('#game-about').click();
 await expect(page.locator('#game-reading-text')).toHaveText('あ'.repeat(119)+mark);
 await page.locator('#game-text-next').click();await expect(page.locator('#game-reading-text')).toHaveText(emoji+'終わり');
 await page.locator('#game-text-prev').click();await expect(page.locator('#game-reading-text')).toHaveText('あ'.repeat(119)+mark);
});
test('revisiting settings collapses navigation cycles and preserves the story position',async({page})=>{
 await setup(page);await page.locator('#game-about').click();await page.locator('#game-text-next').click();
 const text=await page.locator('#game-reading-text').textContent();await page.locator('#game-options').click();
 for(let i=0;i<3;i++){await page.locator('#game-connection').click();await page.locator('#game-options').click();}
 await page.locator('#studio-back').click();await expect(page.locator('#game-reading')).toBeVisible();await expect(page.locator('#game-reading-text')).toHaveText(text);
 await page.locator('#studio-back').click();await expect(page.locator('#studio-choose')).toBeVisible();
});
test('closed menu discards dome markers when a delayed identity change invalidates selection',async({page})=>{
 await setup(page);let pending;await page.route('**/api/status',r=>{pending=r;});
 await page.locator('#game-options').click();await page.locator('#refresh').click();await expect.poll(()=>!!pending).toBe(true);
 await page.locator('#studio-back').click();await page.locator('#studio-choose').click();await expect(page.locator('#studio-dialog')).toBeHidden();
 await pending.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:{...guestAuth,siteKey:'changed'}}});
 await expect(page.locator('#detail')).toBeHidden();await expect(page.locator('#game-sphere')).toHaveAttribute('data-markers','0');
 await page.locator('#studio-action').click();await expect(page.locator('#studio-access')).toBeVisible();
});
test('same ID with new display metadata updates the dome without unrelated recentering',async({page})=>{
 await setup(page);const dome=page.locator('#game-sphere'),before=await dome.getAttribute('data-orientation');
 // Simulate a replaced display payload while keeping the stable catalogue ID.
 await page.locator('#constellations button').evaluate(el=>{el.dataset.azimuth='220';el.dataset.altitude='20';el.querySelector('strong').textContent='更新された星座';el.setAttribute('aria-pressed','true');});
 await expect(dome).not.toHaveAttribute('data-orientation',before);await expect(dome).toHaveAttribute('data-orientation','3.840,0.349');
 const box=await dome.boundingBox();await page.mouse.move(box.x+80,box.y+80);await page.mouse.down();await page.mouse.move(box.x+120,box.y+100);await page.mouse.up();
 const rotated=await dome.getAttribute('data-orientation');await page.locator('#game-options').click();await page.locator('#studio-back').click();
 await expect(dome).toHaveAttribute('data-orientation',rotated);
});
test('dome selection only operates on the stars page',async({page})=>{
 await setup(page,[row,{...row,id:'2',name:'次の星座'}]);await page.locator('#game-next').click();
 await page.locator('#game-options').click();await centerClick(page);await expect(page.locator('#detail-name')).toHaveText('次の星座');
 await page.locator('#studio-back').click();await page.locator('#game-about').click();await centerClick(page);await expect(page.locator('#detail-name')).toHaveText('次の星座');
 await page.locator('#studio-back').click();await centerClick(page);await expect(page.locator('#detail-name')).toHaveText('最初の星座');
});
