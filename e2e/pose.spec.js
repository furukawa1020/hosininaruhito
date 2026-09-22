import { installPoseClock } from './pose-clock.js';
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const fakeVideoPath = fileURLToPath(new URL('./.generated/camera.y4m', import.meta.url));
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + fakeVideoPath] } });

async function camera(page) {
  await page.goto('/');
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
        if (message.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
        if (message.type !== 'frame') return;
        this.frames++;
        message.bitmap.close();
        if (window.poseMode === 'stall') return;
        const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
        points[15].x = 0.2;
        points[16].x = 0.7;
        if (window.poseMode === 'occluded') points[15].visibility = 0.1;
        const landmarks = window.poseMode === 'no_person' ? [] :
          window.poseMode === 'multiple_people' ? [points, points] : [points];
        queueMicrotask(() => this.onmessage?.({ data: { type: 'pose', id: message.id, at: message.at, result: { landmarks } } }));
      }
      terminate() { this.terminated = true; }
    };
  }, mode);
}

test('real pinned SDK runs locally on blank synthetic input with no external requests', async ({ page, context }) => {
  test.setTimeout(45000);
  const urls = [];
  context.on('request', request => urls.push(request.url()));
  const response = await page.goto('/');
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
        worker.postMessage({ type: 'init' });
      });
    } finally { worker.postMessage({ type: 'close' }); worker.terminate(); }
  }, file);
  expect(result).toEqual({ type: 'pose', reason: undefined, count: 0 });
  expect(urls.every(url => new URL(url).origin === 'http://127.0.0.1:8799')).toBe(true);
});

test('fixture wrists display mirrored positions once and stop clears overlay and worker', async ({ page }) => {
  await fixtureWorker(page);
  await camera(page);
  await page.locator('#pose-start').click(); await page.clock.runFor(250);
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

for (const mode of ['no_person', 'multiple_people', 'occluded', 'stall']) {
  test('fixture ' + mode + ' stops inference and requires explicit restart', async ({ page }) => {
    await fixtureWorker(page);
    await camera(page);
    await page.locator('#pose-start').click(); await page.clock.runFor(100);
    await expect(page.locator('#pose-overlay')).toBeVisible();
    await page.evaluate(value=>{window.poseMode=value;},mode);await page.clock.runFor(250);
    await expect(page.locator('#pose-notice')).toHaveAttribute('data-state', 'paused');
    await expect(page.locator('#pose-notice')).toHaveAttribute('data-reason', mode === 'stall' ? 'stale_pose' : mode);
    await expect(page.locator('#pose-overlay')).toBeHidden();
    await expect(page.locator('#pose-start')).toBeEnabled();
    expect(await page.evaluate(() => window.poseWorkers.every(w => w.terminated))).toBe(true);
    expect(await page.evaluate(() => window.poseWorkers.length)).toBe(1);
    await page.evaluate(() => { window.poseMode = 'normal'; });
    await page.locator('#pose-start').click(); await page.clock.runFor(250);
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
  await page.locator('#pose-start').click(); await page.clock.runFor(250);
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
  await camera(page);
  await page.locator('#pose-start').click();
  await expect(page.locator('#pose-notice')).toHaveAttribute('data-reason', 'searching_no_person', { timeout: 20000 });
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
  await page.locator('#pose-start').click(); await page.clock.runFor(250);
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
  await page.locator('#pose-start').click(); await page.clock.runFor(100);
  await expect(page.locator('#pose-overlay')).toBeVisible();
  await page.evaluate(() => { window.poseFixtureFrames = false; });
  await page.clock.runFor(200);
  await expect(page.locator('#pose-notice')).toHaveAttribute('data-reason', 'frame_gap');
  await expect(page.locator('#pose-overlay')).toBeHidden();
});

for(const mode of ['no_person','occluded','multiple_people'])test('initial '+mode+' allows framing adjustment before any measurement',async({page})=>{
 await fixtureWorker(page,mode);await camera(page);
 await page.locator('#pose-start').click();await page.clock.runFor(500);
 await expect(page.locator('#pose-notice')).toHaveAttribute('data-state','searching');
 await expect(page.locator('#pose-notice')).toHaveAttribute('data-reason','searching_'+mode);
 await expect(page.locator('#pose-start')).toBeDisabled();await expect(page.locator('#reach-start')).toBeDisabled();
 await expect(page.locator('#trace-start')).toBeDisabled();await expect(page.locator('#pose-overlay')).toBeHidden();
 await page.evaluate(()=>{window.poseMode='normal';});await page.clock.runFor(100);
 await expect(page.locator('#pose-overlay')).toBeVisible();await expect(page.locator('#reach-start')).toBeEnabled();
 expect(await page.evaluate(()=>window.poseWorkers.length)).toBe(1);
});
test('initial search timeout offers explicit retry without reviving on its own',async({page})=>{
 await fixtureWorker(page,'no_person');await camera(page);await page.locator('#pose-start').click();await page.clock.runFor(15100);
 await expect(page.locator('#pose-notice')).toHaveAttribute('data-reason','person_timeout');
 await expect(page.locator('#pose-start')).toBeEnabled();
 await page.evaluate(()=>{window.poseMode='normal';});await page.clock.runFor(100);
 await expect(page.locator('#pose-overlay')).toBeHidden();
 await page.locator('#pose-start').click();await page.clock.runFor(100);
 await expect(page.locator('#pose-overlay')).toBeVisible();
});
test('stop during initial search releases camera and inference',async({page})=>{
 await fixtureWorker(page,'occluded');await camera(page);await page.locator('#pose-start').click();await page.clock.runFor(100);
 await page.locator('#stop').click();await page.clock.runFor(100);
 await expect(page.locator('#camera-video')).toBeHidden();await expect(page.locator('#pose-overlay')).toBeHidden();
 expect(await page.evaluate(()=>window.poseWorkers.every(w=>w.terminated))).toBe(true);
});
