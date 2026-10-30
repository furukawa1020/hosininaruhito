import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';
// No real Google challenge is solved: only the loading lifecycle is exercised.
for(const mode of ['network','timer','late','missing'])test('checkbox script '+mode+' releases failed loading and allows explicit retry',async({page})=>{
 await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
 await guestSdk(page);await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:{...guestAuth,checkboxSiteKey:'fixture-checkbox-key'}}}));
 let attempt=0;
 await page.route('https://www.google.com/recaptcha/enterprise.js?**',r=>{
  attempt++;
  if(attempt===1&&mode==='network')return r.abort();
  if(attempt===1&&mode==='missing')return r.fulfill({contentType:'text/javascript',body:'window.checkboxFixtureLoaded=true;'});
  return r.fulfill({contentType:'text/javascript',body:`
   window.grecaptcha={enterprise:{ready(cb){${attempt===1?'window.lateCheckboxReady=cb;':'cb();'}},reset(){},render(el,options){
    window.checkboxRendered=(window.checkboxRendered||0)+1;
    const button=document.createElement('button');button.textContent='Fixture confirmation';button.onclick=()=>options.callback('fixture-human-proof-123456789');el.append(button);return 1;
   }}};
  `});
 });
 await page.goto('/');await page.locator('#studio-action').click();await page.locator('#auth-human').click();
 if(['timer','late'].includes(mode)){
  await expect.poll(()=>page.evaluate(()=>typeof window.lateCheckboxReady)).toBe('function');
  if(mode==='timer')await page.clock.runFor(20001);
  else await page.evaluate(()=>{window.checkboxOriginalNow=performance.now.bind(performance);performance.now=()=>window.checkboxOriginalNow()+20001;window.lateCheckboxReady();});
 }
 await expect(page.locator('.human-check')).toHaveCount(0);
 await expect(page.locator('script[src*="recaptcha/enterprise.js"]')).toHaveCount(0);
 expect(await page.evaluate(()=>window.checkboxRendered||0)).toBe(0);
 await page.evaluate(()=>{if(window.checkboxOriginalNow)performance.now=window.checkboxOriginalNow;window.lateCheckboxReady?.();delete window.grecaptcha;});
 await page.locator('#auth-human').click();await page.getByText('Fixture confirmation',{exact:true}).click();
 await expect(page.locator('#studio-location')).toBeVisible();expect(attempt).toBe(2);
 expect(await page.evaluate(()=>window.humanGuestCalls)).toBe(1);
});
