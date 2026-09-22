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
    if (action === 'hidden') await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    if (action === 'pagehide') {
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await expect(page.locator('#camera-consent')).not.toBeChecked();
    }
    await expect(page.locator('#camera-video')).toBeHidden();
    expect(await page.evaluate(() => window.cameraCalls)).toBe(1);
    await startCamera(page);
    expect(await page.evaluate(() => window.cameraCalls)).toBe(2);
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
