import {test,expect} from '@playwright/test';
import {guestAuth,guestSdk} from './guest-fixture.js';

// UI fixtures only; all coordinates and identity data are synthetic.
const ready={mode:'live',services:{access:true,sky:true,planner:false,reflex:true}};
const sky={source:'hoshimiru-live',constellations:[
 {id:'1',name:'高い試験星座',azimuthDeg:90,altitudeDeg:40},
 {id:'2',name:'低い試験星座',azimuthDeg:180,altitudeDeg:20}
]};
const advice={source:'jev-live',advisoryOnly:true,action:'right',confidence:.5};
for(const [width,height] of [[320,568],[844,390]])test('game empty results keep retry and stop visible at '+width,async({page})=>{
 await page.setViewportSize({width,height});await guestSdk(page);
 await page.route('**/api/status',r=>r.fulfill({json:{...ready,auth:guestAuth}}));
 await page.route('**/api/sky',r=>r.fulfill({json:{...sky,constellations:[]}}));
 await page.goto('/');await page.locator('#studio-action').click();await page.locator('#auth-guest').click();
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();
 await expect(page.locator('#studio-dialog-notice')).toContainText('時間をおいてもう一度');
 for(const id of ['studio-dialog-notice','sky','studio-close'])await expect(page.locator('#'+id)).toBeInViewport({ratio:1});
 expect(await page.locator('.game-page').evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
 await page.screenshot({path:'test-results/empty-retry-'+width+'.png'});
});
async function prepare(page){
 await page.route('**/api/status',r=>r.fulfill({json:ready}));
 await page.goto('/?view=details');await expect(page.locator('#sky')).toBeEnabled();
 await page.locator('#token').fill('fixture-only');await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();
}

for(const code of ['constructor','toString','private diagnostic',{private:'diagnostic'},null])test('observation rejects unrecognized error code '+JSON.stringify(code),async({page})=>{
 await page.route('**/api/sky',r=>r.fulfill({status:502,json:code===null?null:{code,error:'private response'}}));
 await prepare(page);await page.locator('#sky').click();
 await expect(page.locator('#notice')).toHaveText('接続に失敗しました。時間をおいて再試行してください。');
 await expect(page.locator('#result')).toHaveText('HTTP 502 / request_failed');
 await expect(page.locator('.star-card')).toHaveCount(0);await expect(page.locator('#sky')).toBeEnabled();
});

for(const change of ['location','token','consent'])test('changing '+change+' replaces a stale search success message',async({page})=>{
 await page.route('**/api/sky',r=>r.fulfill({json:sky}));await prepare(page);await page.locator('#sky').click();
 await expect(page.locator('#notice')).toContainText('星APIに接続しました');
 if(change==='consent')await page.locator('#consent').uncheck();
 else await page.locator(change==='location'?'#lat':'#token').fill(change==='location'?'1':'fixture-replacement');
 await expect(page.locator('.star-card')).toHaveCount(0);
 await expect(page.locator('#notice')).toContainText(change==='consent'?'同意を取り消しました':change==='location'?'場所を変更しました':'認証情報を変更しました');
 await expect(page.locator('#notice')).toHaveAttribute('data-tone','');
 await page.locator('#consent').check();await page.locator('#sky').click();await expect(page.locator('.star-card')).toHaveCount(2);
});

test('condition invalidation during a pending search keeps new guidance after a late response',async({page})=>{
 let pending;await page.route('**/api/sky',r=>{pending=r;});await prepare(page);await page.locator('#sky').click();
 await expect.poll(()=>!!pending).toBe(true);
 await page.evaluate(()=>{const consent=document.getElementById('consent');consent.checked=false;consent.dispatchEvent(new Event('change',{bubbles:true}));});
 await expect(page.locator('#notice')).toContainText('同意を取り消しました');
 await pending.fulfill({json:sky}).catch(()=>{});
 await expect(page.locator('#notice')).toContainText('同意を取り消しました');await expect(page.locator('.star-card')).toHaveCount(0);
 await expect(page.locator('#sky')).toBeEnabled();
});

for(const mode of ['click','enter','moved','empty','error'])test('detail search focus after '+mode,async({page})=>{
 let pending;await page.route('**/api/sky',r=>{pending=r;});await prepare(page);
 if(mode==='enter')await page.locator('#lng').press('Enter');else await page.locator('#sky').click();
 await expect.poll(()=>!!pending).toBe(true);
 if(mode==='moved')await page.locator('#stop').focus();
 await pending.fulfill(mode==='error'?{status:503,json:{code:'upstream_unavailable'}}:{json:mode==='empty'?{...sky,constellations:[]}:sky});
 await expect(page.locator('#sky')).toBeEnabled();
 if(mode==='moved')await expect(page.locator('#stop')).toBeFocused();
 else if(['empty','error'].includes(mode))await expect(page.locator('#sky')).toBeFocused();
 else await expect(page.locator('.star-card').first()).toBeFocused();
});

test('empty results have their own guidance and reset on edit, nonempty response and failure',async({page})=>{
 let mode='empty';await page.route('**/api/sky',r=>r.fulfill(mode==='failure'?{status:503,json:{code:'upstream_unavailable'}}:{json:mode==='empty'?{...sky,constellations:[]}:sky}));
 await prepare(page);await expect(page.locator('#empty-title')).toHaveText('どんな星座に、なろう。');
 await page.locator('#sky').click();await expect(page.locator('#empty-title')).toContainText('見つかりませんでした');
 await expect(page.locator('#empty-help')).toContainText('時間をおいて');await expect(page.locator('#notice')).toHaveAttribute('data-tone','success');
 await page.locator('#lat').fill('1');await expect(page.locator('#empty-title')).toHaveText('どんな星座に、なろう。');
 mode='stars';await page.locator('#sky').click();await expect(page.locator('#empty')).toBeHidden();
 mode='failure';await page.locator('#sky').click();await expect(page.locator('#notice')).toHaveAttribute('data-tone','error');
 await expect(page.locator('#empty')).toBeVisible();await expect(page.locator('#empty-title')).toHaveText('どんな星座に、なろう。');
});

for(const mode of ['success','http-error','invalid'])test('Jev diagnostic preserves sky selection on '+mode,async({page})=>{
 await page.route('**/api/sky',r=>r.fulfill({json:sky}));
 await page.route('**/api/reflex',r=>r.fulfill(mode==='http-error'?{status:502,json:{code:'upstream_unavailable'}}:{json:mode==='invalid'?{private:'not advice'}:{...advice,private:'not displayed'}}));
 await prepare(page);await page.locator('#sky').click();await page.locator('.star-card').last().click();
 const selection=await page.locator('#session-selection').textContent();
 await page.locator('.diagnostics summary').click();await page.locator('#jev').click();
 await expect(page.locator('#notice')).toHaveAttribute('data-tone',mode==='success'?'success':'error');
 await expect(page.locator('.star-card')).toHaveCount(2);await expect(page.locator('.star-card').last()).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#detail-name')).toHaveText('低い試験星座');await expect(page.locator('#session-selection')).toHaveText(selection);
 await expect(page.locator('#result')).not.toContainText('private');await expect(page.locator('#result')).not.toContainText('not displayed');
 if(mode==='success')await expect(page.locator('#result')).toContainText('jev-live');
 else await expect(page.locator('#notice')).not.toContainText('接続を確認しました');
});

for(const view of ['details','game'])for(const outcome of ['success','failure','stop'])test('status feedback clears busy state in '+view+' after '+outcome,async({page})=>{
 let calls=0,pending;const config={...ready,auth:guestAuth};await guestSdk(page);
 await page.route('**/api/status',r=>{if(++calls===1)return r.fulfill({json:config});pending=r;});
 await page.goto(view==='details'?'/?view=details':'/');await expect(page.locator('#services')).toHaveAttribute('aria-busy','false');
 if(view==='details'){await page.locator('.connection summary').click();await page.locator('#refresh').click();}
 else{await page.locator('#studio-action').click();await page.locator('#game-options').click();await page.locator('#game-connection').click();await page.locator('#game-recheck').click();}
 await expect.poll(()=>!!pending).toBe(true);await expect(page.locator('#services')).toHaveAttribute('aria-busy','true');
 await expect(page.locator(view==='details'?'#notice':'#studio-dialog-notice')).toContainText('接続設定を確認しています');
 if(outcome==='stop'){await page.keyboard.press('Escape');await pending.fulfill({json:config}).catch(()=>{});}
 else await pending.fulfill(outcome==='success'?{json:config}:{status:503,json:{}});
 await expect(page.locator('#services')).toHaveAttribute('aria-busy','false');
 await expect(page.locator('#services')).toContainText(outcome==='stop'?'接続確認を停止':outcome==='failure'?'取得できません':'設定済み');
 await expect(page.locator('#refresh')).toBeEnabled();
});
