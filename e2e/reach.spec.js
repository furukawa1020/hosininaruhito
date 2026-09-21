import { installPoseClock } from './pose-clock.js';
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const videoPath = fileURLToPath(new URL('./.generated/camera.y4m', import.meta.url));
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + videoPath] } });

async function setup(page, mode = 'moving') {
  await installPoseClock(page);
  await page.addInitScript(mode => {
    window.reachFixtureMode = mode;
    const NativeWorker = window.Worker;
    window.Worker = class {
      constructor(url, options) {
        if (!String(url).includes('pose-worker')) return new NativeWorker(url, options);
      }
      postMessage(message) {
        if (message.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
        if (message.type !== 'frame') return;
        message.bitmap.close();
        const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
        // Only the LEFT wrist moves. Right stays static to prove hand selection.
        if (window.reachFixtureMode === 'moving') {
          points[15].x = 0.5 + 0.15 * Math.cos(message.at / 200);
          points[15].y = 0.5 + 0.15 * Math.sin(message.at / 200);
        }
        const landmarks = window.reachFixtureMode === 'lost' ? [] : [points];
        queueMicrotask(() => this.onmessage?.({ data: { type: 'pose', id: message.id, at: message.at, result: { landmarks } } }));
      }
      terminate() {}
    };
  }, mode);
  await page.goto('/');
  await expect(page.locator('#reach-start')).toBeDisabled();
  await page.locator('#camera-consent').check();
  await page.locator('#camera-start').click();
  await expect(page.locator('#camera-notice')).toHaveAttribute('data-state', 'preview');
  await page.locator('#pose-start').click(); await page.clock.runFor(200);
  await expect(page.locator('#reach-start')).toBeEnabled();
}
async function begin(page) {
  await page.locator('#reach-joint').selectOption('leftWrist');
  await page.locator('#reach-start').click();
  await expect(page.locator('#reach-notice')).toHaveAttribute('data-state', 'collecting');
  await page.clock.runFor(100);
}
async function complete(page) {
  await page.clock.runFor(3300);
  expect(parseFloat(await page.locator('#reach-progress').textContent())).toBeGreaterThan(3.1);
  await page.locator('#reach-finish').click();
  await expect(page.locator('#reach-notice')).toHaveAttribute('data-state', 'ready');
}

test('fixture measurement requires tracking, enough time and selected left wrist; retry clears old points', async ({ page, context }) => {
  const requests = [];
  context.on('request', r => requests.push({ url: r.url(), method: r.method() }));
  await setup(page);
  await page.locator('#reach-posture').selectOption('standing');
  await begin(page);
  await page.locator('#reach-finish').click();
  await expect(page.locator('#reach-notice')).toHaveAttribute('data-reason', 'insufficient_samples');
  await complete(page);
  await expect(page.locator('#reach-overlay')).toBeVisible();
  await page.locator('.camera-panel').screenshot({ path: 'test-results/reach-fixture-desktop.png' });
  expect(requests.every(r => new URL(r.url).origin === 'http://127.0.0.1:8799' && r.method === 'GET')).toBe(true);
  await page.locator('#reach-start').click();
  await expect(page.locator('#reach-notice')).toHaveAttribute('data-state', 'collecting');
  await page.locator('#reach-clear').click();
  await expect(page.locator('#reach-overlay')).toBeHidden();
  await expect(page.locator('#reach-points')).toHaveAttribute('d', '');
});

test('static selected right hand reports a narrow range without claiming completion', async ({ page }) => {
  await setup(page);
  await page.locator('#reach-start').click();
  await page.clock.runFor(3300);
  expect(parseFloat(await page.locator('#reach-progress').textContent())).toBeGreaterThan(3.1);
  await page.locator('#reach-finish').click();
  await expect(page.locator('#reach-notice')).toHaveAttribute('data-reason', 'narrow_range');
  await expect(page.locator('#reach-notice')).toHaveAttribute('data-state', 'collecting');
  await page.locator('#reach-clear').click();
  await expect(page.locator('#reach-overlay')).toBeHidden();
});

for (const action of ['escape', 'consent', 'loss']) {
  test('completed fixture calibration is erased on ' + action + ' and never resumes automatically', async ({ page }) => {
    await setup(page); await begin(page); await complete(page);
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'consent') await page.locator('#camera-consent').uncheck();
    if (action === 'loss') { await page.evaluate(() => { window.reachFixtureMode = 'lost'; }); await page.clock.runFor(100); }
    await expect(page.locator('#reach-notice')).toHaveAttribute('data-state', 'paused');
    await expect(page.locator('#reach-overlay')).toBeHidden();
    await expect(page.locator('#reach-points')).toHaveAttribute('d', '');
    await expect(page.locator('#reach-start')).toBeDisabled();
    if (action === 'loss') {
      await page.evaluate(() => { window.reachFixtureMode = 'moving'; });
      await page.locator('#pose-start').click(); await page.clock.runFor(200);
      await expect(page.locator('#reach-start')).toBeEnabled();
      await expect(page.locator('#reach-overlay')).toBeHidden();
    }
  });
}

test('posture and hand changes discard completed or pending measurement', async ({ page }) => {
  await setup(page); await begin(page); await complete(page);
  await page.locator('#reach-posture').selectOption('standing');
  await expect(page.locator('#reach-notice')).toHaveAttribute('data-reason', 'changed');
  await expect(page.locator('#reach-overlay')).toBeHidden();
  await page.locator('#reach-start').click();
  await page.locator('#reach-joint').selectOption('rightWrist');
  await expect(page.locator('#reach-notice')).toHaveAttribute('data-reason', 'changed');
  await expect(page.locator('#reach-points')).toHaveAttribute('d', '');
});

test('hidden tab clears an in-progress measurement', async ({ page }) => {
  await setup(page); await begin(page);
  await expect(page.locator('#reach-overlay')).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#reach-overlay')).toBeHidden();
  await expect(page.locator('#reach-start')).toBeDisabled();
  await expect(page.locator('#reach-points')).toHaveAttribute('d', '');
});

test('mobile fixture measurement fits controls with persistent stop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page); await begin(page); await complete(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#stop')).toBeInViewport();
  await expect(page.locator('#camera-video')).toBeInViewport();
  await page.screenshot({ path: 'test-results/reach-fixture-mobile.png' });
});
