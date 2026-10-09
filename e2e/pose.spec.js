import { installPoseClock } from './pose-clock.js';
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const fakeVideoPath = fileURLToPath(new URL('./.generated/camera.y4m', import.meta.url));
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + fakeVideoPath] } });

async function camera(page) {
  await page.goto('/?view=details');
  await page.locator('#camera-consent').check();
  await page.locator('#camera-start').click();
  await expect(page.locator('#camera-notice')).toHaveAttribute('data-state', 'preview');
  await expect(page.locator('#pose-start')).toBeEnabled();
}
async function fixtureWorker(page, mode = 'normal') {
  await installPoseClock(page);
  await page.addInitScript(initial => {
    window.poseMode = initial;
    window.poseWorkers = [];
    const NativeWorker = window.Worker;
    window.Worker = class {
      constructor(url, options) {
        if (!String(url).includes('pose-worker')) return new NativeWorker(url, options);
        this.frames = 0;
        this.terminated = false;
        window.poseWorkers.push(this);
      }
      postMessage(message) {
        if (message.type === 'init') {
          if(window.poseMode==='gpu_stall' && message.delegate==='GPU')return;
          const data=window.poseMode==='gpu_fail' && message.delegate==='GPU'?{type:'error',reason:'model_failed'}:{type:'ready'};
          queueMicrotask(()=>this.onmessage?.({data}));
        }
        if (message.type !== 'frame') return;
        this.frames++;
        message.bitmap.close();
        if (window.poseMode === 'stall') return;
        const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
        points[15].x = 0.2;
        points[16].x = 0.7;
        if (window.poseMode === 'occluded') points[15].visibility = 0.1;
        if (window.poseMode === 'out_of_frame') points[16].y = 1.1;
        if (window.poseMode === 'invalid_pose') points[16].x = NaN;
        const landmarks = window.poseMode === 'no_person' ? [] :
          window.poseMode === 'multiple_people' ? [points, points] : [points];
        const reply = () => this.onmessage?.({ data: { type: 'pose', id: message.id, at: message.at, result: { landmarks } } });
        if(window.poseMode==='slow')setTimeout(reply,160);else queueMicrotask(reply);
      }
      terminate() { this.terminated = true; }
    };
  }, mode);
}

test('real pinned CPU SDK runs locally on blank synthetic input with no external requests', async ({ page, context }) => {
  test.setTimeout(45000);
  const urls = [];
  context.on('request', request => urls.push(request.url()));
  const response = await page.goto('/?view=details');
  expect(response.headers()['content-security-policy']).toContain("connect-src 'self'");
  const file = readdirSync('dist/assets').find(name => /^pose-worker-.*\.js$/.test(name));
  const result = await page.evaluate(async file => {
    const worker = new Worker('/assets/' + file, { type: 'module' });
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Model did not respond')), 25000);
        worker.onerror = () => { clearTimeout(timer); reject(new Error('Worker failed')); };
        worker.onmessage = async ({ data }) => {
          if (data.type === 'ready') {
            const canvas = document.createElement('canvas');
            canvas.width = 320; canvas.height = 240;
            canvas.getContext('2d').fillRect(0, 0, 320, 240);
            const bitmap = await createImageBitmap(canvas);
            worker.postMessage({ type: 'frame', id: 1, at: 1000, bitmap }, [bitmap]);
          } else {
            clearTimeout(timer);
            resolve({ type: data.type, reason: data.reason, count: data.result?.landmarks?.length });
          }
        };
        worker.postMessage({ type: 'init', delegate: 'CPU' });
      });
    } finally { worker.postMessage({ type: 'close' }); worker.terminate(); }
  }, file);
  expect(result).toEqual({ type: 'pose', reason: undefined, count: 0 });
  expect(urls.every(url => new URL(url).origin === 'http://127.0.0.1:8799')).toBe(true);
});

test('fixture wrists display mirrored positions once and stop clears overlay and worker', async ({ page }) => {
  await fixtureWorker(page);
  await camera(page);
  await page.locator('#pose-start').click(); await page.clock.runFor(800);
  await expect(page.locator('#pose-overlay')).toBeVisible();
  const coordinates = await page.evaluate(() => ({
    width: document.getElementById('camera-video').videoWidth,
    left: Number(document.getElementById('left-wrist').getAttribute('cx')),
    right: Number(document.getElementById('right-wrist').getAttribute('cx'))
  }));
  expect(coordinates.left / coordinates.width).toBeCloseTo(0.8);
  expect(coordinates.right / coordinates.width).toBeCloseTo(0.3);
  await page.locator('.camera-panel').screenshot({ path: 'test-results/pose-fixture-desktop.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('#pose-overlay')).toBeHidden();
  await expect(page.locator('#camera-video')).toBeHidden();
  expect(await page.evaluate(() => window.poseWorkers.every(w => w.terminated))).toBe(true);
});

for (const mode of ['no_person', 'multiple_people', 'occluded', 'out_of_frame', 'stall']) {
  test('fixture ' + mode + ' stops inference and requires explicit restart', async ({ page }) => {
    await fixtureWorker(page);
    await camera(page);
    await page.locator('#pose-start').click(); await page.clock.runFor(800);
    await expect(page.locator('#pose-overlay')).toBeVisible();
    await page.evaluate(value=>{window.poseMode=value;},mode);await page.clock.runFor(250);
    await expect(page.locator('#pose-notice')).toHaveAttribute('data-state', 'paused');
    await expect(page.locator('#pose-notice')).toHaveAttribute('data-reason', mode === 'stall' ? 'stale_pose' : mode);
    await expect(page.locator('#pose-overlay')).toBeHidden();
    await expect(page.locator('#pose-start')).toBeEnabled();
    expect(await page.evaluate(() => window.poseWorkers.every(w => w.terminated))).toBe(true);
    expect(await page.evaluate(() => window.poseWorkers.length)).toBe(1);
    await page.evaluate(() => { window.poseMode = 'normal'; });
    await page.locator('#pose-start').click(); await page.clock.runFor(800);
    await expect(page.locator('#pose-overlay')).toBeVisible();
    expect(await page.evaluate(() => window.poseWorkers.length)).toBe(2);
  });
}

test('real model download failure is visible without fake tracking', async ({ page, context }) => {
  await context.route('**/models/pose_landmarker_lite.task', route => route.fulfill({ status: 404, body: '' }));
  await camera(page);
  await page.locator('#pose-start').click();
  await expect(page.locator('#pose-notice')).toHaveAttribute('data-reason', 'model_failed', { timeout: 20000 });
  await expect(page.locator('#pose-overlay')).toBeHidden();
  await expect(page.locator('#pose-start')).toBeEnabled();
});

test('hidden tab cancels fixture inference; return does not resume', async ({ page }) => {
  await fixtureWorker(page);
  await camera(page);
  await page.locator('#pose-start').click(); await page.clock.runFor(800);
  await expect(page.locator('#pose-overlay')).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#pose-overlay')).toBeHidden();
  expect(await page.evaluate(() => window.poseWorkers.every(w => w.terminated))).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#pose-start')).toBeDisabled();
  expect(await page.evaluate(() => window.poseWorkers.length)).toBe(1);
});

test('real model on synthetic camera reports initial absence without claiming tracking', async ({ page }) => {
  test.setTimeout(55000);
  await camera(page);
  await page.locator('#pose-start').click();
  await expect(page.locator('#pose-notice')).toHaveAttribute('data-reason', 'searching_no_person', { timeout: 45000 });
  await expect(page.locator('#pose-notice')).toHaveAttribute('data-state','searching');
  await expect(page.locator('#pose-overlay')).toBeHidden();
  await expect(page.locator('#pose-start')).toBeDisabled();
  await expect(page.locator('#reach-start')).toBeDisabled();
  await page.locator('#stop').click();
  await expect(page.locator('#pose-notice')).toHaveAttribute('data-state','paused');
});

test('mobile fixture overlay fits preview and consent withdrawal releases inference', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtureWorker(page);
  await camera(page);
  await page.locator('#pose-start').click(); await page.clock.runFor(800);
  await expect(page.locator('#pose-overlay')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.camera-panel').screenshot({ path: 'test-results/pose-fixture-mobile.png' });
  await page.locator('#camera-consent').uncheck();
  await expect(page.locator('#pose-overlay')).toBeHidden();
  expect(await page.evaluate(() => window.poseWorkers.every(w => w.terminated))).toBe(true);
  await expect(page.locator('#pose-start')).toBeDisabled();
});

test('synthetic frame loss still stops at the production deadline', async ({ page }) => {
  await fixtureWorker(page); await camera(page);
  await page.locator('#pose-start').click(); await page.clock.runFor(800);
  await expect(page.locator('#pose-overlay')).toBeVisible();
  await page.evaluate(() => { window.poseFixtureFrames = false; });
  await page.clock.runFor(200);
  await expect(page.locator('#pose-notice')).toHaveAttribute('data-reason', 'frame_gap');
  await expect(page.locator('#pose-overlay')).toBeHidden();
});

for(const mode of ['no_person','occluded','multiple_people','out_of_frame'])test('initial '+mode+' allows framing adjustment before any measurement',async({page})=>{
 await fixtureWorker(page,mode);await camera(page);
 await page.locator('#pose-start').click();await page.clock.runFor(800);
 await expect(page.locator('#pose-notice')).toHaveAttribute('data-state','searching');
 await expect(page.locator('#pose-notice')).toHaveAttribute('data-reason','searching_'+mode);
 await expect(page.locator('#pose-start')).toBeDisabled();await expect(page.locator('#reach-start')).toBeDisabled();
 await expect(page.locator('#trace-start')).toBeDisabled();await expect(page.locator('#pose-overlay')).toBeHidden();
 await page.evaluate(()=>{window.poseMode='normal';});await page.clock.runFor(800);
 await expect(page.locator('#pose-overlay')).toBeVisible();await expect(page.locator('#reach-start')).toBeEnabled();
 expect(await page.evaluate(()=>window.poseWorkers.length)).toBe(1);
});
test('initial search timeout offers explicit retry without reviving on its own',async({page})=>{
 await fixtureWorker(page,'no_person');await camera(page);await page.locator('#pose-start').click();await page.clock.runFor(15100);
 await expect(page.locator('#pose-notice')).toHaveAttribute('data-reason','person_timeout');
 await expect(page.locator('#pose-notice')).toHaveAttribute('data-search-reason','searching_no_person');
 await expect(page.locator('#pose-notice')).toContainText('顔と両手を、明るい場所へ');
 await expect(page.locator('#pose-start')).toBeEnabled();
 await page.evaluate(()=>{window.poseMode='normal';});await page.clock.runFor(800);
 await expect(page.locator('#pose-overlay')).toBeHidden();
 await page.locator('#pose-start').click();await page.clock.runFor(800);
 await expect(page.locator('#pose-overlay')).toBeVisible();
 await expect(page.locator('#pose-notice')).not.toHaveAttribute('data-search-reason');
});

for(const [width,height] of [[1440,900],[320,568],[844,390]])test('slow search recovery fits the game screen '+width,async({page})=>{
 await page.setViewportSize({width,height});await fixtureWorker(page,'slow');await page.goto('/');
 await page.locator('#studio-practice').click();await page.locator('#camera-consent').check();await page.locator('#studio-action').click();
 await expect(page.locator('#camera-notice')).toHaveAttribute('data-state','preview');
 await page.locator('#studio-action').click();await page.clock.runFor(15100);
 await expect(page.locator('#pose-notice')).toHaveAttribute('data-search-reason','searching_slow');
 await expect(page.locator('#studio-title')).toHaveText('映像の処理が追いつきません。');
 await expect(page.locator('#studio-instruction')).toContainText('ほかのアプリやタブを閉じて');
 await expect(page.locator('#studio-status')).toContainText('最後に確認できた状態');
 await expect(page.locator('#studio-action')).toBeEnabled();await expect(page.locator('#reach-start')).toBeDisabled();
 await expect(page.locator('#pose-overlay')).toBeHidden();
 for(const id of ['studio-title','studio-instruction','studio-action','stop'])await expect(page.locator('#'+id)).toBeInViewport({ratio:1});
 expect(await page.locator('.studio-coach').evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
 await page.screenshot({path:'test-results/pose-recovery-'+width+'.png'});
 await page.evaluate(()=>{window.poseMode='normal';});await page.clock.runFor(800);
 await expect(page.locator('#pose-overlay')).toBeHidden();
 await page.locator('#studio-action').click();await page.clock.runFor(800);
 await expect(page.locator('#studio-action')).toHaveText('動かせる範囲を教える');
 await expect(page.locator('#pose-notice')).not.toHaveAttribute('data-search-reason');
 await page.locator('#stop').click();expect(await page.evaluate(()=>window.poseWorkers.every(w=>w.terminated))).toBe(true);
});

test('search with no response exposes uncertainty instead of blaming framing',async({page})=>{
 await fixtureWorker(page,'stall');await camera(page);await page.locator('#pose-start').click();await page.clock.runFor(15100);
 await expect(page.locator('#pose-notice')).toHaveAttribute('data-reason','person_timeout');
 await expect(page.locator('#pose-notice')).toContainText('原因はまだ確認できていません');
 await expect(page.locator('#pose-notice')).not.toHaveAttribute('data-search-reason');
 await expect(page.locator('#pose-overlay')).toBeHidden();await expect(page.locator('#reach-start')).toBeDisabled();
});
test('stop during initial search releases camera and inference',async({page})=>{
 await fixtureWorker(page,'occluded');await camera(page);await page.locator('#pose-start').click();await page.clock.runFor(800);
 await page.locator('#stop').click();await page.clock.runFor(100);
 await expect(page.locator('#camera-video')).toBeHidden();await expect(page.locator('#pose-overlay')).toBeHidden();
 expect(await page.evaluate(()=>window.poseWorkers.every(w=>w.terminated))).toBe(true);
});

test('malformed initial pose does not enter the framing recovery path',async({page})=>{
 await fixtureWorker(page,'invalid_pose');await camera(page);
 await page.locator('#pose-start').click();await page.clock.runFor(800);
 await expect(page.locator('#pose-notice')).toHaveAttribute('data-reason','invalid_pose');
 await expect(page.locator('#pose-notice')).toHaveAttribute('data-state','paused');
 await expect(page.locator('#pose-overlay')).toBeHidden();
 await expect(page.locator('#reach-start')).toBeDisabled();
});

test('fleeting valid detection does not end initial framing or enable measurements',async({page})=>{
 await fixtureWorker(page);await camera(page);
 await page.locator('#pose-start').click();await page.clock.runFor(200);
 await expect(page.locator('#pose-notice')).toHaveAttribute('data-reason','searching_stable');
 await expect(page.locator('#pose-overlay')).toBeHidden();await expect(page.locator('#reach-start')).toBeDisabled();
 await page.evaluate(()=>{window.poseMode='occluded';});await page.clock.runFor(100);
 await expect(page.locator('#pose-notice')).toHaveAttribute('data-reason','searching_occluded');
 await page.evaluate(()=>{window.poseMode='normal';});await page.clock.runFor(400);
 await expect(page.locator('#pose-overlay')).toBeHidden();
 await page.clock.runFor(300);await expect(page.locator('#pose-overlay')).toBeVisible();
 expect(await page.evaluate(()=>window.poseWorkers.length)).toBe(1);
});

for(const mode of ['gpu_fail','gpu_stall'])test(mode+' replaces the worker before measurements and recovers through CPU',async({page})=>{
 await fixtureWorker(page,mode);await camera(page);await page.locator('#pose-start').click();
 if(mode==='gpu_stall')await page.clock.runFor(20000);
 await page.clock.runFor(800);
 await expect(page.locator('#pose-overlay')).toBeVisible();
 expect(await page.evaluate(()=>({workers:window.poseWorkers.length,firstStopped:window.poseWorkers[0].terminated,secondStopped:window.poseWorkers[1].terminated}))).toEqual({workers:2,firstStopped:true,secondStopped:false});
 await page.locator('#stop').click();
 expect(await page.evaluate(()=>window.poseWorkers.every(w=>w.terminated))).toBe(true);
});
