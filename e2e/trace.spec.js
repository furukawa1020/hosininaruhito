import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
const videoPath=fileURLToPath(new URL('./.generated/camera.y4m',import.meta.url));
test.use({launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--enable-unsafe-swiftshader','--use-file-for-fake-video-capture='+videoPath]}});
async function setup(page, { failure = false } = {}) {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.addInitScript(()=>{
    window.traceFixtureLost=false;
    // UI contract fixture: synthetic landmarks, bitmap ownership and a controlled clock.
    // Real capture/decode timing remains covered by pose.spec.js and manual acceptance.
    window.createImageBitmap=async()=>({close(){}});
    HTMLVideoElement.prototype.requestVideoFrameCallback=function(cb){return setTimeout(()=>{const at=performance.now();cb(at,{captureTime:at});},33);};
    HTMLVideoElement.prototype.cancelVideoFrameCallback=function(id){clearTimeout(id);};
    const NativeWorker=window.Worker;
    window.Worker=class{
      constructor(url,options){if(!String(url).includes('pose-worker'))return new NativeWorker(url,options);}
      postMessage(message){
        if(message.type==='init')queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}));
        if(message.type!=='frame')return;
        message.bitmap.close();
        const points=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:1}));
        points[15].x=.5+.25*Math.cos(message.at/500);points[15].y=.5+.25*Math.sin(message.at/500);
        queueMicrotask(()=>this.onmessage?.({data:{type:'pose',id:message.id,at:message.at,result:{landmarks:window.traceFixtureLost?[]:[points]}}}));
      }
      terminate(){}
    };
  });
  await page.goto('/?view=details');
  await expect(page.locator('#trace-start')).toBeDisabled();
  await page.locator('#camera-consent').check();await page.locator('#camera-start').click();
  await expect(page.locator('#camera-notice')).toHaveAttribute('data-state','preview');
  await page.locator('#pose-start').click();await page.clock.runFor(200);
  await expect(page.locator('#trace-start')).toBeEnabled();
  await page.locator('#trace-joint').selectOption('leftWrist');
  await page.locator('#trace-start').click();
  if (failure) return;
  await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','running');
  await page.clock.runFor(1000);
  await expect.poll(async()=>parseInt(await page.locator('#trace-count').textContent())).toBeGreaterThan(8);
}
test('local wrist trail stays distinct from captured stars; stop freezes, restart replaces and consent clears',async({page,context})=>{
  const requests=[];context.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await setup(page);
  await expect(page.locator('#trace-count')).toContainText('確定した星 0');
  await page.locator('.trace-panel').screenshot({path:'test-results/trail-fixture-desktop.png'});
  await page.keyboard.press('Escape');
  await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','paused');
  const count=await page.locator('#trace-count').textContent();
  await page.clock.runFor(250);
  await expect(page.locator('#trace-count')).toHaveText(count);
  await expect(page.locator('#trace-start')).toBeDisabled();
  await page.locator('#camera-start').click();await page.locator('#pose-start').click();await page.clock.runFor(200);
  await expect(page.locator('#trace-start')).toBeEnabled();
  await page.locator('#trace-start').click();
  await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','running');
  await page.locator('#camera-consent').uncheck();
  await expect(page.locator('#trace-count')).toHaveText('0 点の軌跡 / 確定した星 0');
  await expect(page.locator('#trace-empty')).toBeVisible();
  expect(requests.every(r=>new URL(r.url).origin==='http://127.0.0.1:8799'&&r.method==='GET')).toBe(true);
});
for(const action of ['loss','hidden','clear','joint'])test('trail handles '+action+' without automatic continuation',async({page})=>{
  await setup(page);
  if(action==='loss'){await page.evaluate(()=>{window.traceFixtureLost=true;});await page.clock.runFor(100);}
  if(action==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  if(action==='clear')await page.locator('#trace-clear').click();
  if(action==='joint')await page.locator('#trace-joint').selectOption('rightWrist');
  await expect(page.locator('#trace-notice')).toHaveAttribute('data-state',action==='clear'||action==='joint'?'idle':'paused');
  if(action==='clear'||action==='joint')await expect(page.locator('#trace-count')).toHaveText('0 点の軌跡 / 確定した星 0');
});
test('real WebGL context loss stops camera and requires explicit restart',async({page})=>{
  await setup(page);
  await page.locator('#trace-canvas').evaluate(canvas=>{
    const extension=canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
    if(!extension)throw Error('Test environment lacks context loss extension');
    extension.loseContext();
  });
  await expect(page.locator('#trace-notice')).toHaveAttribute('data-reason','context_lost');
  await expect(page.locator('#camera-notice')).not.toHaveAttribute('data-state','preview');
  await expect(page.locator('#trace-start')).toBeDisabled();
  await page.locator('#camera-start').click();await page.locator('#pose-start').click();await page.clock.runFor(200);
  await expect(page.locator('#trace-start')).toBeEnabled();await page.locator('#trace-start').click();
  await expect(page.locator('#trace-notice')).toHaveAttribute('data-state','running');
});
test('WebGL unavailable is visible and does not claim trace success',async({page})=>{
  await page.addInitScript(()=>{
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){if(this.id==='trace-canvas'&&type.startsWith('webgl'))return null;return get.call(this,type,...args);};
  });
  await setup(page, { failure: true });
  await expect(page.locator('#trace-notice')).toHaveAttribute('data-reason','webgl_unavailable');
  await expect(page.locator('#trace-count')).toContainText('確定した星 0');
});
test('mobile trace fits its viewport while keeping stop reachable',async({page})=>{
  await page.setViewportSize({width:390,height:844});await setup(page);
  await page.locator('.trace-panel').scrollIntoViewIfNeeded();
  await expect(page.locator('#stop')).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/trail-fixture-mobile.png'});
});
let bundle;
async function harness(page){
  bundle??=build({configFile:false,logLevel:'silent',build:{write:false,minify:true,rollupOptions:{preserveEntrySignatures:'strict',input:fileURLToPath(new URL('./trace-harness.js',import.meta.url)),output:{inlineDynamicImports:true}}}}).then(result=>result.output.find(item=>item.type==='chunk').code);
  await page.route('**/trace-harness.js',async route=>route.fulfill({contentType:'text/javascript',body:await bundle}));
  await page.goto('/?view=details');
  await page.evaluate(async()=>{
    const {ConstellationTrace,TraceRenderer}=await import('/trace-harness.js');
    const program={version:1,constellationId:'test-only',source:'fixture',steps:[
      {starId:'a',joint:'rightWrist',target:{x:.3,y:.3},holdMs:800,tolerance:.045},
      {starId:'b',joint:'rightWrist',target:{x:.7,y:.3},holdMs:800,tolerance:.045},
      {starId:'c',joint:'rightWrist',target:{x:.5,y:.7},holdMs:800,tolerance:.045}]};
    const trace=new ConstellationTrace({program,lines:[['a','b','c','a']]});
    const canvas=document.getElementById('trace-canvas');
    const renderer=new TraceRenderer(canvas,{onFailure:r=>{throw Error(r);}});
    const rect=canvas.getBoundingClientRect();renderer.resize(rect.width,rect.height,3);
    trace.start(0);let now=0;
    for(const step of program.steps){for(let i=0;i<=8;i++){trace.tick({joint:'rightWrist',at:now,x:step.target.x+.01,y:step.target.y+.01,confidence:1},now+10);now+=100;}}
    renderer.draw(trace.snapshot());
    document.getElementById('trace-empty').hidden=true;
    document.getElementById('trace-notice').textContent='試験用の座標を保持して確定した3点です。実人体の計測ではありません。';
    window.traceHarness={trace,renderer};
  });
}
test('actual WebGL renders measured captures and original edges, resets and frees resources',async({page})=>{
  await harness(page);
  const state=await page.evaluate(()=>{
    const {renderer,trace}=window.traceHarness;
    return {state:trace.state,captures:renderer.layers.captures.geometry.drawRange.count,lines:renderer.layers.lines.geometry.drawRange.count,
      calls:renderer.renderer.info.render.calls,geometries:renderer.renderer.info.memory.geometries,ratio:renderer.renderer.getPixelRatio()};
  });
  expect(state.geometries).toBeLessThanOrEqual(5);
  expect(state.geometries).toBeGreaterThanOrEqual(3);
  const {geometries,...visible}=state;
  expect(visible).toEqual({state:'complete',captures:3,lines:6,calls:3,ratio:2});
  await page.locator('.trace-panel').screenshot({path:'test-results/capture-fixture-desktop.png'});
  const reset=await page.evaluate(()=>{
    const {renderer,trace}=window.traceHarness;trace.reset();renderer.draw(trace.snapshot());
    const count=renderer.layers.captures.geometry.drawRange.count;
    renderer.dispose();return {count,objects:renderer.scene.children.length,disposed:renderer.disposed};
  });
  expect(reset).toEqual({count:0,objects:0,disposed:true});
});
