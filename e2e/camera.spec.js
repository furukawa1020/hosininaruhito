import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const fakeVideoPath = fileURLToPath(new URL('./.generated/camera.y4m', import.meta.url));

// Synthetic capture only: no host webcam or microphone is opened.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + fakeVideoPath] } });

async function watchCamera(page) {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.cameraCalls = 0;
    window.cameraFeeds = [];
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.cameraCalls++;
      const stream = await original(constraints);
      window.cameraFeeds.push(stream);
      return stream;
    };
  });
}
async function startCamera(page) {
  await page.locator('#camera-consent').check();
  await page.locator('#camera-start').click();
  await expect(page.locator('#camera-notice')).toHaveAttribute('data-state', 'preview');
  await expect.poll(() => page.locator('#camera-video').evaluate(v => v.videoWidth)).toBeGreaterThan(0);
}
async function expectReleased(page) {
  await expect(page.locator('#camera-video')).toBeHidden();
  expect(await page.evaluate(() => document.getElementById('camera-video').srcObject === null &&
    window.cameraFeeds.every(s => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
}

test('game distinguishes permission from pending playback and offers retry after playback timeout',async({page})=>{
 await page.setViewportSize({width:320,height:568});await watchCamera(page);
 await page.clock.install();
 await page.addInitScript(()=>{
  const play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){if(window.allowPlayback)return play.call(this);return new Promise(resolve=>{window.finishPlayback=resolve;});};
 });
 await page.goto('/');await page.locator('#studio-practice').click();await page.locator('#camera-consent').check();await page.locator('#studio-action').click();
 await expect(page.locator('#studio-status')).toContainText('映像を表示する準備中');
 await expect(page.locator('#studio-status')).not.toContainText('許可を確認');await expect(page.locator('#studio-action')).toBeDisabled();
 await page.clock.runFor(8001);await expect(page.locator('#studio-status')).toContainText('8秒以内');
 await expectReleased(page);await expect(page.locator('#studio-action')).toBeEnabled();
 for(const id of ['studio-status','studio-action','stop'])await expect(page.locator('#'+id)).toBeInViewport({ratio:1});
 await page.evaluate(()=>{window.finishPlayback();window.allowPlayback=true;});await expect(page.locator('#camera-video')).toBeHidden();
 await page.locator('#studio-action').click();await expect(page.locator('#camera-notice')).toHaveAttribute('data-state','preview');await page.locator('#stop').click();await expectReleased(page);
});
test('separate camera consent, synthetic local preview, withdrawal and explicit restart', async ({ page }) => {
  await watchCamera(page);
  const outbound = [];
  page.on('request', request => { if (request.method() !== 'GET') outbound.push(request.url()); });
  await page.goto('/?view=details');
  await expect(page.locator('#camera-start')).toBeDisabled();
  expect(await page.evaluate(() => window.cameraCalls)).toBe(0);
  await page.locator('#consent').check();
  await expect(page.locator('#camera-start')).toBeDisabled();
  await page.locator('#consent').uncheck();
  await startCamera(page);
  await expect(page.locator('#consent')).not.toBeChecked();
  expect(await page.evaluate(() => window.cameraFeeds[0].getAudioTracks().length)).toBe(0);
  await page.locator('.camera-panel').screenshot({ path: 'test-results/camera-synthetic-desktop.png' });
  await page.locator('#camera-consent').uncheck();
  await expectReleased(page);
  await startCamera(page);
  expect(await page.evaluate(() => window.cameraCalls)).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.camera-panel').screenshot({ path: 'test-results/camera-synthetic-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(outbound).toEqual([]);
});
for (const action of ['button', 'escape', 'hidden', 'pagehide']) {
  test('camera release on ' + action, async ({ page }) => {
    await watchCamera(page);
    await page.goto('/?view=details');
    await startCamera(page);
    if (action === 'button') await page.locator('#stop').click();
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'hidden') await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    if (action === 'pagehide') await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await expectReleased(page);
    expect(await page.evaluate(() => window.cameraCalls)).toBe(1);
    if (action === 'hidden') await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    if (action === 'pagehide') {
      const loaded = page.waitForEvent('domcontentloaded');
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await loaded;
      await expect(page.locator('#camera-consent')).not.toBeChecked();
    }
    await expect(page.locator('#camera-video')).toBeHidden();
    // A cached-page restore creates a fresh document with no automatic capture.
    const previousCalls = action === 'pagehide' ? 0 : 1;
    expect(await page.evaluate(() => window.cameraCalls)).toBe(previousCalls);
    await startCamera(page);
    expect(await page.evaluate(() => window.cameraCalls)).toBe(previousCalls + 1);
  });
}
for (const [error, message] of [
  ['NotAllowedError', 'アクセスが許可されませんでした'],
  ['NotFoundError', 'カメラが見つかりません'],
  ['NotReadableError', '他のアプリでの使用状況']
]) {
  test('camera error ' + error, async ({ page }) => {
    await page.addInitScript(name => {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('private hardware detail', name); };
    }, error);
    await page.goto('/?view=details');
    await page.locator('#camera-consent').check();
    await page.locator('#camera-start').click();
    await expect(page.locator('#camera-notice')).toContainText(message);
    await expect(page.locator('#camera-notice')).not.toContainText('private');
    await expect(page.locator('#camera-start')).toBeEnabled();
    await expect(page.locator('#camera-video')).toBeHidden();
  });
}
test('stopped pending permission releases late synthetic stream without showing it', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.cameraCalls = 0;
    window.cameraFeeds = [];
    navigator.mediaDevices.getUserMedia = constraints => {
      window.cameraCalls++;
      return new Promise(resolve => {
        window.completePermission = async () => {
          const stream = await original(constraints);
          window.cameraFeeds.push(stream);
          resolve(stream);
        };
      });
    };
  });
  await page.goto('/?view=details');
  await page.locator('#camera-consent').check();
  await page.locator('#camera-start').click();
  await page.locator('#stop').click();
  await expect(page.locator('#camera-start')).toBeDisabled();
  await page.evaluate(() => window.completePermission());
  await expect(page.locator('#camera-start')).toBeEnabled();
  await expectReleased(page);
  expect(await page.evaluate(() => window.cameraCalls)).toBe(1);
});
test('unanswered permission shows a deadline without allowing parallel acquisition',async({page})=>{
 await page.clock.install();await page.clock.pauseAt(new Date());
 await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=()=>{window.cameraRequests=(window.cameraRequests||0)+1;return new Promise(()=>{});};});
 await page.goto('/');await page.locator('#studio-practice').click();await page.locator('#camera-consent').check();await page.locator('#studio-action').click();
 await page.clock.runFor(30000);await expect(page.locator('#studio-status')).toContainText('30秒');
 await expect(page.locator('#studio-action')).toBeDisabled();await expect(page.locator('#camera-video')).toBeHidden();
 expect(await page.evaluate(()=>window.cameraRequests)).toBe(1);await page.locator('#stop').click();
});
