import {test,expect} from '@playwright/test';
import {holdJson,expireJson,releaseJson} from './late-json-fixture.js';
const status={mode:'live',services:{access:true,sky:true,planner:false,reflex:true}};
for(const path of ['/api/status','/api/sky','/api/reflex'])for(const mode of ['timer','late'])test('JSON deadline '+path+' '+mode+' ignores late bodies and permits retry',async({page})=>{
 await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
 await page.route('**/api/status',r=>r.fulfill({json:status}));
 await page.route('**/api/sky',r=>r.fulfill({json:{source:'hoshimiru-live',constellations:[{id:'1',name:'期限試験',azimuthDeg:0,altitudeDeg:30}]}}));
 await page.route('**/api/reflex',r=>r.fulfill({json:{source:'jev-live',advisoryOnly:true,action:'right',confidence:.5}}));
 await holdJson(page,path,true);await page.goto('/?view=details');
 if(path!=='/api/status'){
  await expect(page.locator('#sky')).toBeEnabled();await page.locator('#token').fill('fixture');
  await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();
  if(path==='/api/reflex')await page.locator('.diagnostics summary').click();
  await page.locator(path==='/api/sky'?'#sky':'#jev').click();
 }
 await expect.poll(()=>page.evaluate(()=>typeof window.releaseJson)).toBe('function');
 await expireJson(page,path==='/api/status'?8000:45000,mode);
 await expect(page.locator('#notice')).toHaveAttribute('data-tone','error');
 await expect(page.locator('#notice')).toContainText(path==='/api/status'?'サーバーに接続できません':'時間内');
 await releaseJson(page);await expect(page.locator('.star-card')).toHaveCount(0);
 if(path==='/api/status'){
  await page.locator('.connection summary').click();await page.locator('#refresh').click();await expect(page.locator('#sky')).toBeEnabled();
 }else{
  await page.locator(path==='/api/sky'?'#sky':'#jev').click();await expect(page.locator('#notice')).toHaveAttribute('data-tone','success');
 }
});
