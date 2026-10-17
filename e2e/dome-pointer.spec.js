import {test,expect} from '@playwright/test';
for(const mode of ['other-pointer','lost-capture'])test('dome drag handles '+mode+' without jumping or sticking',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:false,sky:false,planner:false,reflex:false}}}));
 await page.goto('/');const canvas=page.locator('#game-sphere canvas'),dome=page.locator('#game-sphere');
 const box=await canvas.boundingBox(),x=box.x+box.width*.4,y=box.y+box.height*.4;
 await canvas.evaluate(el=>el.addEventListener('pointerdown',e=>{window.firstPointer??=e.pointerId;},{capture:true}));
 await page.mouse.move(x,y);await page.mouse.down();
 const initial=await dome.getAttribute('data-orientation');
 if(mode==='other-pointer'){
  await canvas.evaluate((el,{x,y})=>{
   for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])el.dispatchEvent(new PointerEvent(type,{pointerId:999,button:0,clientX:x+70,clientY:y+50,bubbles:true}));
  },{x,y});
  await expect(dome).toHaveAttribute('data-orientation',initial);
  await page.mouse.move(x+40,y+20);
  await expect(dome).not.toHaveAttribute('data-orientation',initial);
 }else{
  await canvas.evaluate(el=>el.releasePointerCapture(window.firstPointer));
  await page.mouse.move(x+40,y+20);
  await expect(dome).toHaveAttribute('data-orientation',initial);
 }
 await page.mouse.up();
 const before=await dome.getAttribute('data-orientation');
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+60,y+10);await page.mouse.up();
 await expect(dome).not.toHaveAttribute('data-orientation',before);expect(errors).toEqual([]);
});
