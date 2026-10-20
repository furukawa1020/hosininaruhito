import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {guestAuth,guestSdk} from './guest-fixture.js';
// Multiple setup pages, screenshots and three sensor holds share one end-to-end test.
test.setTimeout(60000);
const videoPath=fileURLToPath(new URL('./.generated/camera.y4m',import.meta.url));
test.use({launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--enable-unsafe-swiftshader','--use-file-for-fake-video-capture='+videoPath]}});
const projection=input=>({...input,ok:true,timeBasis:'explicit-utc-catalog-calculation',source:{catalog:'d3-celestial/XHIP',commit:'7e720a3de062059d4c5400a379146a601d9010e0',license:'BSD-3-Clause',calculation:'astronomy-engine@2.1.19'},
 projection:'gnomonic',coordinateSystem:'normalized-image-template',mirrored:false,excluded:[],stars:[{id:'a',x:.25,y:.25},{id:'b',x:.75,y:.25},{id:'c',x:.25,y:.75}],lines:[['a','b'],['b','c']]});
async function setup(page){
 await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',services:{access:true,sky:true,planner:false,reflex:false},auth:guestAuth}}));await guestSdk(page);
 await page.route('**/api/sky',r=>r.fulfill({json:{source:'hoshimiru-live',constellations:[{id:'1',name:'試験の星座',azimuthDeg:120,altitudeDeg:40}]}}));
 await page.route('**/api/project',r=>r.fulfill({json:projection(r.request().postDataJSON())}));
 await page.addInitScript(()=>{
  window.sessionFixture={point:null,lost:false};
  window.createImageBitmap=async()=>({close(){}});
  HTMLVideoElement.prototype.requestVideoFrameCallback=function(cb){return setTimeout(()=>{const at=performance.now();cb(at,{captureTime:at});},33);};
  HTMLVideoElement.prototype.cancelVideoFrameCallback=function(id){clearTimeout(id);};
  const NativeWorker=Worker;window.Worker=class{
   constructor(url,options){if(!String(url).includes('pose-worker'))return new NativeWorker(url,options);this.n=0;}
   postMessage(m){
    if(m.type==='init')queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}));
    if(m.type!=='frame')return;m.bitmap.close();
    const i=Math.floor(this.n++/2),p=window.sessionFixture.point||{x:.3+i%5*.1,y:.3+Math.floor(i/5)%5*.1};
    const points=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:1}));Object.assign(points[15],p);Object.assign(points[16],p);
    queueMicrotask(()=>this.onmessage?.({data:{type:'pose',id:m.id,at:m.at,result:{landmarks:window.sessionFixture.lost?[]:[points]}}}));
   }terminate(){}
  };
 });
 await page.goto('/');
}
async function choose(page){
 await page.locator('#studio-action').click();await page.locator('#auth-guest').click();
 await expect(page.locator('#studio-location')).toBeVisible();
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();
 await expect(page.locator('#studio-choose')).toBeVisible();await page.locator('#studio-choose').click();
}
async function beginCalibration(page){
 await choose(page);await noScroll(page,['camera-consent','studio-action']);
 await expect(page.locator('#studio-action')).toBeDisabled();
 await page.locator('#camera-consent').check();await page.locator('#studio-action').click();
 await expect(page.locator('#camera-notice')).toHaveAttribute('data-state','preview');
 await expect(page.locator('#studio-action')).toHaveText('手を見つける');
 await page.locator('#studio-action').click();await page.clock.runFor(800);
 await noScroll(page,['reach-joint','reach-posture','studio-action']);
 await page.locator('#reach-joint').selectOption('leftWrist');
 await expect(page.locator('#studio-title')).toContainText('左手');
 await page.locator('#studio-action').click();
 await noScroll(page,['studio-action','studio-recalibrate','stop']);
}
async function prepare(page){
 await beginCalibration(page);await page.clock.runFor(2000);
 await expect(page.locator('#studio-action')).toBeDisabled();await page.clock.runFor(4600);
 await expect(page.locator('#studio-action')).toHaveText('この範囲で遊ぶ');
 await page.locator('#studio-action').click();await expect(page.locator('#studio-action')).toHaveText('この範囲に星を置く');
 await page.locator('#studio-action').click();await expect(page.locator('#studio-action')).toHaveText('星をつなぎはじめる');
 await page.locator('#studio-action').click();await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','running');await page.clock.runFor(100);
}

for(const viewport of [{width:320,height:568},{width:844,height:390}])test('failed placement offers another constellation at '+viewport.width,async({page})=>{
 await page.setViewportSize(viewport);await setup(page);
 await page.route('**/api/project',r=>r.fulfill({status:422,json:{error:'below_horizon'}}));
 await beginCalibration(page);await expect(page.locator('#studio-other-star')).toBeHidden();
 await page.clock.runFor(6600);await page.locator('#studio-action').click();await page.locator('#studio-action').click();
 await expect(page.locator('#session-notice')).toHaveAttribute('data-state','error');
 await noScroll(page,['studio-other-star','studio-action','studio-recalibrate','stop']);
 await page.locator('#studio-other-star').click();await expect(page.locator('#studio-choose')).toBeVisible();
 await expect(page.locator('#camera-video')).toBeHidden();await expect(page.locator('#trace-start')).toBeDisabled();
 await page.locator('#studio-choose').click();await expect(page.locator('#studio-other-star')).toBeHidden();
 await expect(page.locator('#studio-action')).toHaveText('カメラをつける');await expect(page.locator('#camera-video')).toBeHidden();
});

test('hidden game actions pass keyboard focus to an available control without stealing dialog focus',async({page})=>{
 await setup(page);await prepare(page);
 await expect(page.locator('#studio-action')).toBeHidden();await expect(page.locator('#stop')).toBeFocused();
 await page.keyboard.press('Enter');await expect(page.locator('#camera-video')).toBeHidden();
 await expect(page.locator('#stop')).toBeFocused();
 await page.locator('#studio-settings').focus();await page.keyboard.press('Enter');
 await expect(page.locator('#studio-dialog')).toBeVisible();
 const focused=await page.evaluate(()=>document.activeElement.id);await page.clock.runFor(500);
 expect(await page.evaluate(()=>document.activeElement.id)).toBe(focused);
 expect(await page.evaluate(()=>document.getElementById('studio-dialog').contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(page.locator('#studio-dialog')).toBeHidden();
});

test('hiding the camera practice action focuses unchecked consent without enabling it',async({page})=>{
 await setup(page);await page.locator('#studio-practice').focus();await page.keyboard.press('Enter');
 await expect(page.locator('#studio-practice')).toBeHidden();await expect(page.locator('#camera-consent')).toBeFocused();
 await expect(page.locator('#camera-consent')).not.toBeChecked();await expect(page.locator('#camera-video')).toBeHidden();
 await page.keyboard.press('Space');await expect(page.locator('#camera-consent')).toBeChecked();
 await expect(page.locator('#camera-consent')).toBeFocused();await expect(page.locator('#camera-video')).toBeHidden();
});

test('first sample inside a ring says hold at zero progress without capturing early',async({page})=>{
 await setup(page);await prepare(page);
 const p=await page.locator('#trace-target').evaluate(el=>({x:1-parseFloat(el.style.left)/100,y:parseFloat(el.style.top)/100}));
 await page.evaluate(p=>{window.sessionFixture.point={x:p.x+.08,y:p.y};},p);await page.clock.runFor(33);
 await expect(page.locator('#studio-title')).toContainText('画面の右へ');
 await page.evaluate(p=>{window.sessionFixture.point={x:p.x+.02,y:p.y};},p);await page.clock.runFor(33);
 await expect(page.locator('#studio-title')).toHaveText('そこで、ひと呼吸。');
 await expect(page.locator('#studio-progress-value')).toHaveText('0%');await expect(page.locator('#trace-count')).toContainText('確定した星 0');
 await page.clock.runFor(500);await expect(page.locator('#trace-count')).toContainText('確定した星 0');
 await page.evaluate(p=>{window.sessionFixture.point={x:p.x+.08,y:p.y};},p);await page.clock.runFor(33);
 await expect(page.locator('#studio-title')).toContainText('画面の右へ');await expect(page.locator('#studio-progress-value')).toHaveText('0%');
 await page.evaluate(p=>{window.sessionFixture.point=p;},p);await page.clock.runFor(33);await page.clock.runFor(750);
 await expect(page.locator('#trace-count')).toContainText('確定した星 0');await page.clock.runFor(100);
 await expect(page.locator('#trace-count')).toContainText('確定した星 1');
});

test('partial constellation loss explains that the next attempt starts over',async({page})=>{
 await page.setViewportSize({width:320,height:568});await setup(page);await prepare(page);
 const p=await page.locator('#trace-target').evaluate(el=>({x:1-parseFloat(el.style.left)/100,y:parseFloat(el.style.top)/100}));
 await page.evaluate(p=>{window.sessionFixture.point=p;},p);await page.clock.runFor(900);
 await expect(page.locator('#trace-count')).toContainText('確定した星 1');
 await page.evaluate(()=>{window.sessionFixture.lost=true;});await page.clock.runFor(100);
 await expect(page.locator('#studio-status')).toContainText('途中の星は、次の開始で最初から');
 await noScroll(page,['studio-status','studio-action','stop']);
 await page.clock.runFor(500);await expect(page.locator('#trace-count')).toContainText('確定した星 1');
 await page.evaluate(()=>{window.sessionFixture.lost=false;window.sessionFixture.point=null;});
 await page.locator('#studio-action').click();await page.clock.runFor(800);
 await page.locator('#studio-action').click();await page.clock.runFor(6600);await page.locator('#studio-action').click();
 await page.locator('#studio-action').click();await expect(page.locator('#session-notice')).toHaveAttribute('data-state','ready');
 await expect(page.locator('#trace-count')).toContainText('確定した星 0');
 await expect(page.locator('#studio-status')).not.toContainText('途中の星');
 await expect(page.locator('#trace-notice')).not.toHaveAttribute('data-state','running');
});

for(const failure of ['context_lost','render_failed','webgl_unavailable'])test('game retains '+failure+' after camera shutdown and permits a fresh attempt',async({page})=>{
 await page.setViewportSize({width:320,height:568});await setup(page);
 if(failure==='webgl_unavailable'){
  await beginCalibration(page);await page.clock.runFor(6600);await page.locator('#studio-action').click();await page.locator('#studio-action').click();
  await expect(page.locator('#studio-action')).toHaveText('星をつなぎはじめる');
  await page.evaluate(()=>{
   const get=HTMLCanvasElement.prototype.getContext;
   window.restoreTraceContext=()=>{HTMLCanvasElement.prototype.getContext=get;};
   HTMLCanvasElement.prototype.getContext=function(type,...args){return this.id==='trace-canvas'&&type.startsWith('webgl')?null:get.call(this,type,...args);};
  });
  await page.locator('#studio-action').click();
 }else{
  await prepare(page);
  await page.locator('#trace-canvas').evaluate((canvas,failure)=>{
   const gl=canvas.getContext('webgl2');
   if(failure==='context_lost')gl.getExtension('WEBGL_lose_context').loseContext();
   else {const clear=gl.clear;gl.clear=function(){gl.clear=clear;throw Error('Synthetic draw failure');};}
  },failure);
  await page.clock.runFor(100);
 }
 await expect(page.locator('#trace-notice')).toHaveAttribute('data-reason',failure);
 await expect(page.locator('#studio-title')).toHaveText('星の表示が止まりました。');
 await expect(page.locator('#studio-status')).toHaveText(await page.locator('#trace-notice').textContent());
 await expect(page.locator('#camera-video')).toBeHidden();await expect(page.locator('#pose-overlay')).toBeHidden();
 await noScroll(page,['studio-title','studio-instruction','studio-status','studio-action','stop']);
 await page.clock.runFor(500);await expect(page.locator('#camera-video')).toBeHidden();
 await page.screenshot({path:'test-results/game-render-error-'+failure+'.png'});
 await page.evaluate(()=>window.restoreTraceContext?.());await page.locator('#studio-action').click();
 await expect(page.locator('#camera-notice')).toHaveAttribute('data-state','preview');
 await expect(page.locator('#trace-notice')).not.toHaveAttribute('data-state','error');
 await page.locator('#studio-action').click();await page.clock.runFor(800);
 await expect(page.locator('#studio')).toHaveAttribute('data-phase','reach');
});

for(const [width,height] of [[1440,900],[320,568],[844,390]])test('calibration rejection and hand retry remain on screen '+width,async({page})=>{
 await page.setViewportSize({width,height});await setup(page);
 await page.evaluate(()=>{window.sessionFixture.point={x:.5,y:.5};});
 await beginCalibration(page);await page.clock.runFor(3300);await page.locator('#studio-action').click();
 await expect(page.locator('#reach-notice')).toHaveAttribute('data-reason','narrow_range');
 await expect(page.locator('#studio-status')).toContainText('広さを確認できません');
 await expect(page.locator('#studio-action')).toHaveText('もう一度、範囲を確かめる');
 await noScroll(page,['studio-status','studio-action','studio-recalibrate','stop']);
 await page.screenshot({path:'test-results/calibration-rejected-'+width+'.png'});
 await page.locator('#studio-recalibrate').click();
 await expect(page.locator('#studio')).toHaveAttribute('data-phase','reach');
 await expect(page.locator('#reach-joint')).toBeFocused();
 await expect(page.locator('#reach-points')).toHaveAttribute('d','');
 await expect(page.locator('#camera-notice')).toHaveAttribute('data-state','preview');
 await expect(page.locator('#pose-notice')).toHaveAttribute('data-state','tracking');
 await page.clock.runFor(300);
 await expect(page.locator('#reach-notice')).toHaveAttribute('data-state','paused');
 await noScroll(page,['reach-joint','reach-posture','studio-action']);
 await page.locator('#reach-joint').selectOption('rightWrist');
 await page.evaluate(()=>{window.sessionFixture.point=null;});
 await page.locator('#studio-action').click();await page.clock.runFor(6600);await page.locator('#studio-action').click();
 await expect(page.locator('#reach-notice')).toHaveAttribute('data-state','ready');
 await expect(page.locator('#studio-recalibrate')).toBeVisible();
 await noScroll(page,['studio-action','studio-recalibrate','stop']);
 await page.locator('#studio-action').click();
 await expect(page.locator('#session-notice')).toHaveAttribute('data-state','ready');
 await noScroll(page,['studio-action','studio-recalibrate','stop']);
 await page.locator('#studio-action').click();
 await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','running');
 await expect(page.locator('#studio-recalibrate')).toBeHidden();
});

for(const phase of ['pending','rejected','ready'])test('recalibration clears '+phase+' placement without restarting camera',async({page})=>{
 await page.setViewportSize({width:320,height:568});await setup(page);
 let pending;
 if(phase==='pending')await page.route('**/api/project',r=>{pending=r;});
 if(phase==='rejected')await page.route('**/api/project',r=>r.fulfill({status:422,json:{code:'below_horizon'}}));
 await beginCalibration(page);await page.clock.runFor(6600);await page.locator('#studio-action').click();
 await page.locator('#studio-action').click();
 await expect(page.locator('#session-notice')).toHaveAttribute('data-state',phase==='pending'?'loading':phase==='ready'?'ready':'error');
 await noScroll(page,['studio-recalibrate','stop']);
 await page.locator('#studio-recalibrate').click();
 if(pending)await pending.fulfill({json:projection(pending.request().postDataJSON())});
 await expect(page.locator('#session-notice')).toHaveAttribute('data-state','idle');
 await expect(page.locator('#session-metadata')).toBeEmpty();
 await expect(page.locator('#reach-points')).toHaveAttribute('d','');
 await expect(page.locator('#trace-count')).toContainText('確定した星 0');
 await expect(page.locator('#trace-notice')).not.toHaveAttribute('data-state','running');
 if(phase==='ready')await expect(page.locator('#trace-start')).toBeDisabled();
 await expect(page.locator('#studio')).toHaveAttribute('data-phase','reach');
 await expect(page.locator('#camera-notice')).toHaveAttribute('data-state','preview');
 await expect(page.locator('#pose-notice')).toHaveAttribute('data-state','tracking');
 await page.clock.runFor(300);
 await expect(page.locator('#reach-notice')).toHaveAttribute('data-state','paused');
});
for(const [width,height] of [[1440,900],[390,844],[320,568],[844,390]])test('single screen '+width+' keeps camera, instruction and measured completion together',async({page})=>{
 await page.setViewportSize({width,height});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await setup(page);
 await expect(page.locator('#studio-action')).toBeInViewport();await expect(page.locator('#stop')).toBeInViewport();
 expect((await page.locator('#game-sphere canvas').boundingBox()).width).toBeGreaterThan(250);
 await page.screenshot({path:'test-results/studio-welcome-'+width+'.png'});
 await prepare(page);await noScroll(page,['studio-title','stop']);
 await expect(page.locator('#camera-video')).toBeInViewport();await expect(page.locator('#studio-title')).toBeInViewport();await expect(page.locator('#trace-target')).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const rects=await page.evaluate(()=>['camera-video','trace-stage'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [r.x,r.y,r.width,r.height];}));
 expect(rects[0]).toEqual(rects[1]);
 const first=await page.locator('#trace-target').evaluate(el=>({x:1-parseFloat(el.style.left)/100,y:parseFloat(el.style.top)/100}));
 await page.evaluate(p=>{window.sessionFixture.point={x:p.x+.08,y:p.y};},first);await page.clock.runFor(100);
 await expect(page.locator('#studio-title')).toContainText('画面の右へ');
 await page.screenshot({path:'test-results/studio-play-'+width+'.png'});
 for(let i=1;i<=3;i++){
  const p=await page.locator('#trace-target').evaluate(el=>({x:1-parseFloat(el.style.left)/100+.005,y:parseFloat(el.style.top)/100+.005}));
  await page.evaluate(p=>{window.sessionFixture.point=p;},p);
  await page.clock.runFor(400);await expect(page.locator('#studio-title')).toHaveText('そこで、ひと呼吸。');
  await page.clock.runFor(500);await expect(page.locator('#trace-count')).toContainText('確定した星 '+i);
 }
 await expect(page.locator('#studio-title')).toHaveText('星座が、できました。');expect(errors).toEqual([]);
 await expect(page.locator('#camera-notice')).toContainText('星座が完成したため');
 await expect(page.locator('#camera-video')).toBeHidden();
 await page.locator('#studio-action').click();
 await expect(page.locator('#studio-action')).toHaveText('カメラをつける');
 await expect(page.locator('#trace-count')).toContainText('確定した星 0');
 await page.clock.runFor(300);await expect(page.locator('#camera-video')).toBeHidden();
 await expect(page.locator('#studio-action')).toBeInViewport();
});
test('framing, loss and explicit restart are available without scrolling',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);await page.locator('#studio-practice').click();
 await page.locator('#camera-consent').check();await page.locator('#studio-action').click();await expect(page.locator('#camera-notice')).toHaveAttribute('data-state','preview');
 await page.evaluate(()=>{window.sessionFixture.lost=true;});await page.locator('#studio-action').click();await page.clock.runFor(300);
 await expect(page.locator('#studio-status')).toContainText('まだ人物');await expect(page.locator('#studio-action')).toBeDisabled();
 await page.evaluate(()=>{window.sessionFixture.lost=false;});await page.clock.runFor(800);
 await expect(page.locator('#studio-action')).toHaveText('動かせる範囲を教える');
 await page.evaluate(()=>{window.sessionFixture.lost=true;});await page.clock.runFor(100);
 await expect(page.locator('#studio-action')).toHaveText('もう一度、手を見つける');await expect(page.locator('#studio-action')).toBeInViewport();
 await page.locator('#stop').click();await expect(page.locator('#studio-action')).toHaveText('カメラをつける');await expect(page.locator('#camera-video')).toBeHidden();
});
test('opening settings during play stops capture and Esc closes without restarting',async({page})=>{
 await setup(page);await prepare(page);await page.locator('#studio-settings').click();
 await expect(page.locator('#studio-dialog')).toBeVisible();await expect(page.locator('#camera-video')).toBeHidden();
 await expect(page.locator('#trace-notice')).not.toHaveAttribute('data-state','running');
 await page.keyboard.press('Escape');await expect(page.locator('#studio-dialog')).not.toBeVisible();
 await expect(page.locator('#studio-action')).toHaveText('カメラをつける');await page.clock.runFor(1000);await expect(page.locator('#camera-video')).toBeHidden();
});
test('star request failure stays visible and consent is never selected by navigation',async({page})=>{
 let posts=0;await setup(page);await page.route('**/api/sky',r=>{posts++;return r.fulfill({status:503,json:{code:'upstream_unavailable'}});});
 await page.locator('#studio-action').click();await page.locator('#auth-guest').click();
 await expect(page.locator('#consent')).not.toBeChecked();expect(posts).toBe(0);
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();
 await expect(page.locator('#studio-dialog-notice')).toContainText('接続できません');await expect(page.locator('#studio-location')).toBeVisible();expect(posts).toBe(1);
 await expect(page.locator('#camera-consent')).not.toBeChecked();
});

test('guest can end access from the compact settings without opening the full page',async({page})=>{
 await setup(page);await choose(page);await page.locator('#studio-settings').click();
 await expect(page.locator('#auth-logout')).toBeVisible();await page.locator('#auth-logout').click();
 await expect(page.locator('#studio-access')).toBeVisible();await expect(page.locator('#camera-video')).toBeHidden();
 await expect(page.locator('#studio-choose')).toBeHidden();
 await page.locator('#studio-close').click();await expect(page.locator('#studio-dialog')).not.toBeVisible();
});

async function noScroll(page, controls=[]){
 expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 for(const selector of ['#studio-dialog','.game-page','.studio-coach']){
  const el=page.locator(selector);
  if(await el.isVisible())expect(await el.evaluate(e=>({x:e.scrollWidth<=e.clientWidth+1,y:e.scrollHeight<=e.clientHeight+1})),selector).toEqual({x:true,y:true});
 }
 for(const id of controls)await expect(page.locator('#'+id)).toBeInViewport({ratio:1});
}
for(const [width,height] of [[1440,900],[390,844],[320,568],[844,390],[1024,600]])test('paged setup never needs scrolling '+width+'x'+height,async({page})=>{
 await page.setViewportSize({width,height});await setup(page);
 await noScroll(page,['studio-action','stop']);
 await page.locator('#studio-action').click();
 await noScroll(page,['auth-guest','studio-close','game-login']);
 await page.screenshot({path:'test-results/game-access-'+width+'.png'});
 await page.locator('#game-login').click();
 await noScroll(page,['auth-email','auth-password','auth-login','studio-back']);
 await page.locator('#studio-back').click();
 await page.locator('#game-privacy').click();
 await noScroll(page,['game-text-next','studio-back']);
 await page.locator('#game-text-next').click();
 await page.locator('#studio-back').click();
 await page.locator('#auth-guest').click();
 await expect(page.locator('#studio-location')).toBeVisible();
 await noScroll(page,['locate','lat','lng','consent','sky','studio-close']);
 await page.screenshot({path:'test-results/game-location-'+width+'.png'});
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');
 await page.locator('#consent').check();await page.locator('#sky').click();
 await expect(page.locator('#studio-choose')).toBeVisible();
 await noScroll(page,['game-prev','game-next','studio-choose','studio-back']);
 await page.screenshot({path:'test-results/game-stars-'+width+'.png'});
 await page.locator('#game-about').click();await noScroll(page,['studio-back']);
 await page.locator('#studio-back').click();
 await page.locator('#game-options').click();
 await noScroll(page,['planner-consent','refresh','auth-logout','studio-back']);
 await page.locator('#studio-back').click();
 await page.locator('#studio-choose').click();
 await noScroll(page,['camera-consent','studio-action','stop']);
});

test('dome reflects API directions and selection works with arrows, drag and keyboard',async({page})=>{
 await setup(page);
 const rows=[{id:'a',name:'南の星座',azimuthDeg:180,altitudeDeg:40},{id:'b',name:'北の星座',azimuthDeg:0,altitudeDeg:10},{id:'c',name:'地平線の下の星座',azimuthDeg:90,altitudeDeg:-20}];
 await page.route('**/api/sky',r=>r.fulfill({json:{source:'hoshimiru-live',constellations:rows}}));
 await page.locator('#studio-action').click();await page.locator('#auth-guest').click();
 await page.locator('#lat').fill('0');await page.locator('#lng').fill('0');await page.locator('#consent').check();await page.locator('#sky').click();
 await expect(page.locator('#game-sphere')).toHaveAttribute('data-markers','3');
 await expect(page.locator('#detail-name')).toHaveText('南の星座');
 await page.locator('#game-next').click();await expect(page.locator('#detail-name')).toHaveText('北の星座');
 await expect(page.locator('#game-sphere')).toHaveAttribute('data-orientation','0.000,0.175');
 await page.keyboard.press('ArrowRight');await expect(page.locator('#detail-name')).toHaveText('地平線の下の星座');
 await expect(page.locator('#game-page-count')).toHaveText('3 / 3');
 const before=await page.locator('#game-sphere').getAttribute('data-orientation');
 const r=await page.locator('#game-sphere canvas').boundingBox();
 await page.mouse.move(r.x+r.width*.4,r.y+r.height*.4);await page.mouse.down();await page.mouse.move(r.x+r.width*.6,r.y+r.height*.5);await page.mouse.up();
 expect(await page.locator('#game-sphere').getAttribute('data-orientation')).not.toBe(before);
 await page.locator('#game-center').click();await expect(page.locator('#game-sphere')).toHaveAttribute('data-orientation',before);
 await page.locator('#game-next').click();await expect(page.locator('#game-page-count')).toHaveText('1 / 3');
 await page.screenshot({path:'test-results/game-dome.png'});
});

test('dome failure keeps the star selection and consent path usable',async({page})=>{
 await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='2d'?null:original.call(this,type,...args);};});
 await setup(page);await choose(page);await expect(page.locator('#camera-consent')).not.toBeChecked();await expect(page.locator('#studio-action')).toBeDisabled();
});
