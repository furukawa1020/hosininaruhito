import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('./.generated/camera-hd.y4m',import.meta.url));
// Real browser capture and ImageBitmap conversion; no physical camera is opened.
test.use({launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-video-capture='+source]}});

for(const ignoresSize of [false,true])test('camera size '+(ignoresSize?'fallback':'preferred')+' preserves bounded full-frame pose input',async({page})=>{
 await page.addInitScript(ignoresSize=>{
  window.sizeProbe={requests:[],frames:[],feeds:[]};
  const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async constraints=>{
   window.sizeProbe.requests.push(structuredClone(constraints));
   // Model a device that cannot supply the preferred size, using a real HD feed.
   const requested=ignoresSize?{...constraints,video:{width:{exact:1280},height:{exact:720}}}:constraints;
   const stream=await capture(requested);window.sizeProbe.feeds.push(stream);return stream;
  };
  const bitmap=window.createImageBitmap.bind(window);
  window.createImageBitmap=async (...args)=>{
   const result=await bitmap(...args);
   window.sizeProbe.frames.push({input:[args[0].videoWidth,args[0].videoHeight],output:[result.width,result.height],resized:args.length>1});
   return result;
  };
  const NativeWorker=window.Worker;
  window.Worker=class{
   constructor(url,options){if(!String(url).includes('pose-worker'))return new NativeWorker(url,options);}
   postMessage(m){
    if(m.type==='init')queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}));
    if(m.type==='frame'){m.bitmap.close();queueMicrotask(()=>this.onmessage?.({data:{type:'pose',id:m.id,at:m.at,result:{landmarks:[]}}}));}
   }
   terminate(){}
  };
 },ignoresSize);
 await page.goto('/?view=details');
 expect(await page.evaluate(()=>window.sizeProbe.requests.length)).toBe(0);
 await page.locator('#camera-consent').check();await page.locator('#camera-start').click();
 await expect(page.locator('#camera-notice')).toHaveAttribute('data-state','preview');
 await page.locator('#pose-start').click();
 await expect.poll(()=>page.evaluate(()=>window.sizeProbe.frames.length)).toBeGreaterThan(0);
 const probe=await page.evaluate(()=>({request:window.sizeProbe.requests[0],frame:window.sizeProbe.frames[0],audio:window.sizeProbe.feeds[0].getAudioTracks().length}));
 expect(probe.request).toEqual({audio:false,video:{facingMode:{ideal:'user'},width:{ideal:640},height:{ideal:360},frameRate:{ideal:30}}});
 expect(probe.frame).toEqual({input:ignoresSize?[1280,720]:[640,360],output:[640,360],resized:ignoresSize});
 expect(probe.audio).toBe(0);await expect(page.locator('#pose-overlay')).toBeHidden();
 await page.locator('#stop').click();
 expect(await page.evaluate(()=>window.sizeProbe.feeds.every(s=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
 await expect(page.locator('#camera-video')).toBeHidden();
});
