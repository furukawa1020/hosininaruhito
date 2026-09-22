import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {guestAuth,guestSdk} from './guest-fixture.js';
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
async function prepare(page){
 await choose(page);
 await expect(page.locator('#studio-action')).toBeDisabled();
 await page.locator('#camera-consent').check();await page.locator('#studio-action').click();
 await expect(page.locator('#camera-notice')).toHaveAttribute('data-state','preview');
 await expect(page.locator('#studio-action')).toHaveText('手を見つける');
 await page.locator('#studio-action').click();await page.clock.runFor(200);
 await page.locator('#reach-joint').selectOption('leftWrist');
 await expect(page.locator('#studio-title')).toContainText('左手');
 await page.locator('#studio-action').click();await page.clock.runFor(2000);
 await expect(page.locator('#studio-action')).toBeDisabled();await page.clock.runFor(4600);
 await expect(page.locator('#studio-action')).toHaveText('この範囲で遊ぶ');
 await page.locator('#studio-action').click();await expect(page.locator('#studio-action')).toHaveText('この範囲に星を置く');
 await page.locator('#studio-action').click();await expect(page.locator('#studio-action')).toHaveText('星をつなぎはじめる');
 await page.locator('#studio-action').click();await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','running');await page.clock.runFor(100);
}
for(const width of [1440,390])test('single screen '+width+' keeps camera, instruction and measured completion together',async({page})=>{
 await page.setViewportSize({width,height:width===390?844:900});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await setup(page);
 await expect(page.locator('#studio-action')).toBeInViewport();await expect(page.locator('#stop')).toBeInViewport();
 expect((await page.locator('.studio-example svg').boundingBox()).width).toBeGreaterThan(250);
 await page.screenshot({path:'test-results/studio-welcome-'+width+'.png'});
 await prepare(page);
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
 await expect(page.locator('#studio-action')).toBeInViewport();
});
test('framing, loss and explicit restart are available without scrolling',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);await page.locator('#studio-practice').click();
 await page.locator('#camera-consent').check();await page.locator('#studio-action').click();await expect(page.locator('#camera-notice')).toHaveAttribute('data-state','preview');
 await page.evaluate(()=>{window.sessionFixture.lost=true;});await page.locator('#studio-action').click();await page.clock.runFor(300);
 await expect(page.locator('#studio-status')).toContainText('まだ人物');await expect(page.locator('#studio-action')).toBeDisabled();
 await page.evaluate(()=>{window.sessionFixture.lost=false;});await page.clock.runFor(100);
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
