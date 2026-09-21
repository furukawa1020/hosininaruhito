import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import {guestAuth,guestSdk} from './guest-fixture.js';
const videoPath=fileURLToPath(new URL('./.generated/camera.y4m',import.meta.url));
test.use({launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--enable-unsafe-swiftshader','--use-file-for-fake-video-capture='+videoPath]}});
const projection=input=>({...input,ok:true,timeBasis:'explicit-utc-catalog-calculation',source:{catalog:'d3-celestial/XHIP',commit:'7e720a3de062059d4c5400a379146a601d9010e0',license:'BSD-3-Clause',calculation:'astronomy-engine@2.1.19'},
  projection:'gnomonic',coordinateSystem:'normalized-image-template',mirrored:false,excluded:[],
  stars:[{id:'a',x:.25,y:.25},{id:'b',x:.75,y:.25},{id:'c',x:.25,y:.75}],lines:[['a','b'],['b','c']]});
async function setup(page, respond, guest=false) {
  await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',plannerProvider:guest?'vertex':'codex',services:{access:true,sky:true,planner:guest,reflex:false},...(guest?{auth:guestAuth}:{})}}));
  if(guest)await guestSdk(page);
  await page.route('**/api/sky',r=>r.fulfill({json:{source:'hoshimiru-live',constellations:[{id:'1',name:'試験用星座',azimuthDeg:120,altitudeDeg:40}]}}));
  await page.route('**/api/project',respond|| (r=>r.fulfill({json:projection(r.request().postDataJSON())})));
  await page.addInitScript(()=>{
    window.sessionFixture={point:null,lost:false};
    window.createImageBitmap=async()=>({close(){}});
    HTMLVideoElement.prototype.requestVideoFrameCallback=function(cb){return setTimeout(()=>{const at=performance.now();cb(at,{captureTime:at});},33);};
    HTMLVideoElement.prototype.cancelVideoFrameCallback=function(id){clearTimeout(id);};
    const NativeWorker=Worker;window.Worker=class {
      constructor(url,options){if(!String(url).includes('pose-worker'))return new NativeWorker(url,options);this.n=0;}
      postMessage(m){
        if(m.type==='init')queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}));
        if(m.type!=='frame')return;m.bitmap.close();
        const i=Math.floor(this.n++/2),p=window.sessionFixture.point||{x:.3+i%5*.1,y:.3+Math.floor(i/5)%5*.1};
        const points=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:1}));
        Object.assign(points[15],p);Object.assign(points[16],p);
        queueMicrotask(()=>this.onmessage?.({data:{type:'pose',id:m.id,at:m.at,result:{landmarks:window.sessionFixture.lost?[]:[points]}}}));
      } terminate(){}
    };
  });
  await page.goto('/');
  if(guest){await page.locator('#auth-guest').click();await expect(page.locator('#auth-notice')).toContainText('ゲストとして開始');}
  else await page.locator('#token').fill('fixture-only');
  await page.locator('#lat').fill('36.56');await page.locator('#lng').fill('136.69');
  await page.locator('#consent').check();await page.locator('#sky').click();
  await expect(page.locator('#session-selection')).toContainText('試験用星座');
  await expect(page.locator('#session-prepare')).toBeDisabled();
  await page.locator('#camera-consent').check();await page.locator('#camera-start').click();
  await expect(page.locator('#camera-notice')).toHaveAttribute('data-state','preview');
  await page.locator('#pose-start').click();await page.clock.runFor(200);
  await page.locator('#reach-joint').selectOption('leftWrist');await page.locator('#reach-start').click();
  await page.clock.runFor(6600);await page.locator('#reach-finish').click();
  await expect(page.locator('#reach-notice')).toHaveAttribute('data-state','ready');
  await page.locator('#session-prepare').click();
}
test('fixture selection to measured captures completes, and reset removes all captures',async({page})=>{
  const posts=[];page.on('request',r=>{if(r.method()==='POST')posts.push({path:new URL(r.url()).pathname,body:r.postDataJSON()});});
  await setup(page);await expect(page.locator('#session-notice')).toHaveAttribute('data-state','ready');
  await expect(page.locator('#session-notice')).toContainText('一致は未確認');
  await expect(page.locator('#trace-joint')).toHaveValue('leftWrist');
  await page.locator('#trace-start').click();await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','running');
  for(let i=1;i<=3;i++){
    const point=await page.locator('#trace-target').evaluate(el=>({x:1-parseFloat(el.style.left)/100+.005,y:parseFloat(el.style.top)/100+.005}));
    await page.evaluate(p=>{window.sessionFixture.point=p;},point);
    await page.clock.runFor(900);await expect(page.locator('#trace-count')).toContainText('確定した星 '+i);
  }
  await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','complete');
  await expect(page.locator('#trace-start')).toBeDisabled();
  await page.locator('.trace-panel').screenshot({path:'test-results/session-fixture-complete.png'});
  expect(posts.map(p=>p.path)).toEqual(['/api/sky','/api/project']);
  expect(Object.keys(posts[1].body).sort()).toEqual(['at','id','lat','lng']);
  await page.locator('#lat').fill('35');await expect(page.locator('#trace-count')).toContainText('確定した星 0');
  await expect(page.locator('#session-selection')).toContainText('先に星API');
  await page.locator('#session-clear').click();await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','idle');
});
test('guest uses the same camera calibration, consented Vertex plan and measured completion',async({page})=>{
 const paths=[];page.on('request',r=>{if(r.method()==='POST'){expect(r.headers()['authorization']).toBe('Bearer guest-fixture');paths.push(new URL(r.url()).pathname);}});
 await setup(page,undefined,true);await expect(page.locator('#session-notice')).toHaveAttribute('data-state','ready');
 await page.route('**/api/program',r=>r.fulfill({json:{...r.request().postDataJSON().program,source:'vertex-live'}}));
 await page.locator('#planner-consent').check();await page.locator('#session-prepare').click();await expect(page.locator('#session-notice')).toHaveAttribute('data-state','ready');await expect(page.locator('#session-notice')).toContainText('Vertex AI');
 await page.locator('#trace-start').click();
 for(let i=1;i<=3;i++){
  const point=await page.locator('#trace-target').evaluate(el=>({x:1-parseFloat(el.style.left)/100+.005,y:parseFloat(el.style.top)/100+.005}));await page.evaluate(p=>{window.sessionFixture.point=p;},point);await page.clock.runFor(900);await expect(page.locator('#trace-count')).toContainText('確定した星 '+i);
 }
 await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','complete');expect(paths).toEqual(['/api/sky','/api/project','/api/project','/api/program']);
 await page.locator('#auth-logout').click();await expect(page.locator('#camera-notice')).not.toHaveAttribute('data-state','preview');await expect(page.locator('#trace-count')).toContainText('確定した星 0');
});
for(const action of ['loss','posture','location','consent','stop','hidden'])test('prepared session is invalidated by '+action,async({page})=>{
  await setup(page);await expect(page.locator('#session-notice')).toHaveAttribute('data-state','ready');
  await page.locator('#trace-start').click();await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','running');
  if(action==='loss'){await page.evaluate(()=>{window.sessionFixture.lost=true;});await page.clock.runFor(100);}
  if(action==='posture')await page.locator('#reach-posture').selectOption('standing');
  if(action==='location')await page.locator('#lat').fill('35');
  if(action==='consent')await page.locator('#consent').uncheck();
  if(action==='stop')await page.keyboard.press('Escape');
  if(action==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.locator('#trace-notice')).toHaveAttribute('data-state', action==='location' || action==='consent' ? 'idle' : 'paused');
  if(action!=='location' && action!=='consent') await expect(page.locator('#trace-start')).toBeDisabled();
  await expect(page.locator('#trace-count')).toContainText('確定した星 0');
});
test('late projection cannot restore a changed session',async({page})=>{
  let route;await setup(page,r=>{route=r;});await expect(page.locator('#session-notice')).toHaveAttribute('data-state','loading');
  await page.locator('#reach-posture').selectOption('standing');
  await route.fulfill({json:projection(route.request().postDataJSON())});
  await expect(page.locator('#session-notice')).toHaveAttribute('data-state','idle');
  await expect(page.locator('#trace-start')).not.toHaveText('配置した星座を開始する');
});
for(const failure of ['too_many','unsupported','http'])test('projection '+failure+' fails without starting a substitute',async({page})=>{
  await setup(page,r=>{
    const data=projection(r.request().postDataJSON());
    if(failure==='too_many')data.stars=Array.from({length:13},(_,i)=>({id:String(i),x:.1+i*.05,y:.5}));
    if(failure==='unsupported')data.source={};
    return r.fulfill({status:failure==='http'?503:200,json:failure==='http'?{code:'catalog_unavailable'}:data});
  });
  await expect(page.locator('#session-notice')).toHaveAttribute('data-state','error');
  await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','idle');
  await expect(page.locator('#trace-count')).toContainText('確定した星 0');
});
test('mobile session target and stop stay visible without overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await setup(page);
  await expect(page.locator('#session-notice')).toHaveAttribute('data-state','ready');
  await page.locator('#trace-start').click();await expect(page.locator('#trace-target')).toBeVisible();await page.clock.runFor(100);
  await expect(page.locator('#stop')).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/session-fixture-mobile.png'});
  await page.locator('#trace-clear').click();
  await expect(page.locator('#session-notice')).toHaveAttribute('data-state','idle');
  await expect(page.locator('#trace-count')).toContainText('確定した星 0');
});

test('AI consent sends only the fitted program and retains measured capture',async({page})=>{
  await setup(page);await expect(page.locator('#session-notice')).toHaveAttribute('data-state','ready');
  await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',plannerProvider:'codex',services:{access:true,sky:true,planner:true,reflex:false}}}));
  await page.locator('#refresh').click();
  let input;
  await page.route('**/api/program',r=>{input=r.request().postDataJSON();return r.fulfill({json:{...input.program,source:'codex-live',steps:[...input.program.steps].reverse()}});});
  await page.locator('#planner-consent').check();await page.locator('#session-prepare').click();
  await expect(page.locator('#session-notice')).toContainText('Codex');
  await expect(page.locator('#session-notice')).toHaveAttribute('data-state','ready');
  expect(Object.keys(input)).toEqual(['program']);expect(input.program.steps[0].joint).toBe('leftWrist');
  await page.locator('#trace-start').click();
  await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','running');
  const point=await page.locator('#trace-target').evaluate(el=>({x:1-parseFloat(el.style.left)/100,y:parseFloat(el.style.top)/100}));
  await page.evaluate(p=>window.sessionFixture.point=p,point);await page.clock.runFor(900);
  await expect(page.locator('#trace-count')).toContainText('確定した星 1');
});
for(const failure of ['quota','modified','late'])test('AI '+failure+' cannot install an invalid or cancelled plan',async({page})=>{
  await setup(page);await expect(page.locator('#session-notice')).toHaveAttribute('data-state','ready');
  await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',plannerProvider:'codex',services:{access:true,sky:true,planner:true,reflex:false}}}));
  await page.locator('#refresh').click();
  let route;await page.route('**/api/program',r=>{route=r;});
  await page.locator('#planner-consent').check();await page.locator('#session-prepare').click();
  await expect.poll(()=>Boolean(route)).toBe(true);
  const candidate={...route.request().postDataJSON().program,source:'codex-live'};
  if(failure==='modified')candidate.steps[0].target.x+=.01;
  if(failure==='late')await page.locator('#planner-consent').uncheck();
  await route.fulfill({status:failure==='quota'?502:200,json:failure==='quota'?{code:'upstream_quota'}:candidate});
  await expect(page.locator('#session-notice')).toHaveAttribute('data-state',failure==='late'?'idle':'error');
  await expect(page.locator('#trace-start')).not.toHaveText('配置した星座を開始する');
});
test('AI preparation requires configured service',async({page})=>{
 await setup(page);await page.locator('#planner-consent').check();
 await expect(page.locator('#session-prepare')).toBeDisabled();
});

async function vertexStatus(page, provider = 'vertex') {
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',plannerProvider:provider,services:{access:true,sky:true,planner:true,reflex:false}}}));
 await page.locator('#refresh').click();
 await expect(page.locator('#services')).not.toContainText('確認中');
}
test('cloud planner displays Google destination and preserves manual start after verified order',async({page})=>{
 await setup(page);await vertexStatus(page);
 await expect(page.locator('#planner-destination')).toHaveText('Google Cloud / Vertex AI');
 let calls=0;
 await page.route('**/api/program',r=>{calls++;expect(r.request().headers()['x-hcr-planner']).toBe('vertex');const input=r.request().postDataJSON();expect(Object.keys(input)).toEqual(['program']);return r.fulfill({json:{...input.program,source:'vertex-live',steps:[...input.program.steps].reverse()}});});
 await page.locator('#session-prepare').click();await expect(page.locator('#session-notice')).toHaveAttribute('data-state','ready');expect(calls).toBe(0);
 await page.locator('#planner-consent').check();await page.locator('#session-prepare').click();
 await expect(page.locator('#session-notice')).toHaveAttribute('data-state','ready');
 await expect(page.locator('#session-notice')).toContainText('Vertex AI');expect(calls).toBe(1);
 await expect(page.locator('#trace-notice')).not.toHaveAttribute('data-state','running');
 await page.screenshot({path:'test-results/vertex-fixture-consent.png'});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('#planner-destination').scrollIntoViewIfNeeded();
 await expect(page.locator('#stop')).toBeInViewport();
 await page.screenshot({path:'test-results/vertex-fixture-mobile.png'});
 await page.locator('#trace-start').click();await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','running');
});
test('cloud planner rejects a response with another provider provenance',async({page})=>{
 await setup(page);await vertexStatus(page);
 await page.route('**/api/program',r=>r.fulfill({json:{...r.request().postDataJSON().program,source:'codex-live'}}));
 await page.locator('#planner-consent').check();await page.locator('#session-prepare').click();
 await expect(page.locator('#session-notice')).toHaveAttribute('data-state','error');
 await expect(page.locator('#trace-start')).not.toHaveText('配置した星座を開始する');
});
test('destination refresh revokes consent and a late cloud response cannot restore the plan',async({page})=>{
 await setup(page);await vertexStatus(page);let route;
 await page.route('**/api/program',r=>{route=r;});
 await page.locator('#planner-consent').check();await page.locator('#session-prepare').click();
 await expect.poll(()=>Boolean(route)).toBe(true);
 await vertexStatus(page,'codex');await expect(page.locator('#planner-consent')).not.toBeChecked();
 await expect(page.locator('#planner-destination')).toHaveText('OpenAI / Codex');
 await route.fulfill({json:{...route.request().postDataJSON().program,source:'vertex-live'}});
 await expect(page.locator('#session-notice')).toHaveAttribute('data-state','idle');
 await expect(page.locator('#trace-start')).not.toHaveText('配置した星座を開始する');
});
test('unknown cloud destination disables AI preparation',async({page})=>{
 await setup(page);await vertexStatus(page,'unknown');await page.locator('#planner-consent').check();
 await expect(page.locator('#session-prepare')).toBeDisabled();
});

async function prepareAdvice(page,respond) {
 await setup(page);await expect(page.locator('#session-notice')).toHaveAttribute('data-state','ready');
 await page.route('**/api/status',r=>r.fulfill({json:{mode:'live',plannerProvider:'codex',services:{access:true,sky:true,planner:false,reflex:true}}}));
 await page.locator('#refresh').click();
 await page.route('**/api/reflex',respond);
 await page.locator('#trace-start').click();await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','running');
 const target=await page.locator('#trace-target').evaluate(el=>({x:1-parseFloat(el.style.left)/100+.1,y:parseFloat(el.style.top)/100}));
 await page.evaluate(p=>window.sessionFixture.point=p,target);
}
test('Jev requires separate consent and sends only rounded error, without deciding captures',async({page})=>{
 const bodies=[];
 await prepareAdvice(page,r=>{bodies.push(r.request().postDataJSON());return r.fulfill({json:{source:'jev-live',advisoryOnly:true,action:'left',confidence:.01}});});
 await page.clock.runFor(500);expect(bodies).toHaveLength(0);
 await page.locator('#advice-consent').check();await page.clock.runFor(100);
 await expect(page.locator('#advice-notice')).toHaveAttribute('data-state','advice');
 expect(bodies).toHaveLength(1);expect(Object.keys(bodies[0]).sort()).toEqual(['dx','dy','tracked']);
 expect(bodies[0].dx).toBe(-.1);await expect(page.locator('#advice-notice')).toContainText('表示の右側');
 await page.clock.runFor(500);await expect.poll(()=>bodies.length).toBe(2);
 await expect(page.locator('#trace-count')).toContainText('確定した星 0');
 await page.locator('#advice-consent').uncheck();await page.clock.runFor(1000);expect(bodies).toHaveLength(2);
 await expect(page.locator('#advice-notice')).toHaveAttribute('data-state','idle');
});
for(const stop of ['consent','escape'])test('late Jev reply is discarded after '+stop,async({page})=>{
 let route;await prepareAdvice(page,r=>{route=r;});
 await page.locator('#advice-consent').check();await page.clock.runFor(100);await expect.poll(()=>Boolean(route)).toBe(true);
 if(stop==='consent')await page.locator('#advice-consent').uncheck();else await page.keyboard.press('Escape');
 await route.fulfill({json:{source:'jev-live',advisoryOnly:true,action:'left',confidence:1}});
 await expect(page.locator('#advice-notice')).toHaveAttribute('data-state','idle');
});
test('high confidence wrong-direction Jev response cannot advise or capture',async({page})=>{
 await prepareAdvice(page,r=>r.fulfill({json:{source:'jev-live',advisoryOnly:true,action:'hold',confidence:1}}));
 await page.locator('#advice-consent').check();await page.clock.runFor(900);
 await expect(page.locator('#advice-notice')).not.toHaveAttribute('data-state','advice');
 await expect(page.locator('#trace-count')).toContainText('確定した星 0');
});
test('Jev upstream failures stop after bounded retries while local geometry continues',async({page})=>{
 let calls=0;await prepareAdvice(page,r=>{calls++;return r.fulfill({status:503,json:{code:'upstream_unavailable'}});});
 await page.locator('#advice-consent').check();
 for(let i=0;i<3;i++){
   await page.clock.runFor(i===0?100:2100);
   await expect.poll(()=>calls).toBe(i+1);
   await expect(page.locator('#advice-notice')).toHaveAttribute('data-state',i===2?'unavailable':'error');
 }
 await page.clock.runFor(2100);expect(calls).toBe(3);
 await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','running');
});
