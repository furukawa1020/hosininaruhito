import { test, expect } from '@playwright/test';

// UI fixtures only. No external API is called by these tests.
const ready = { mode: 'live', configured: false, services: { access: true, sky: true, reflex: false, planner: false } };
const sky = {
  source: 'hoshimiru-live', timeBasis: 'provider-default',
  constellations: [
    { id: '1', name: 'アンドロメダ座', englishName: 'Andromeda', azimuthDeg: 279.17, altitudeDeg: 42.01, drawingIds: '[8961|8976]', description: 'テスト用の応答です。', story: 'テスト用の物語です。' },
    { id: '60', name: 'オリオン座', azimuthDeg: 90, altitudeDeg: -5, drawingIds: null }
  ]
};
async function prepare(page) {
  await page.route('**/api/status', route => route.fulfill({ json: ready }));
  await page.goto('/');
  await expect(page.locator('#sky')).toBeEnabled();
  await page.locator('#lat').fill('0');
  await page.locator('#lng').fill('0');
  await page.locator('#token').fill('ui-test-token');
}
test('unconfigured server shows the real missing state and no fabricated stars', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#services')).toContainText('未設定');
  await expect(page.locator('#sky')).toBeDisabled();
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('.star-card')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/observation-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('requires separate location consent, then displays and selects test-only sky data', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/sky', route => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({ lat: 0, lng: 0 });
    return route.fulfill({ json: sky });
  });
  await prepare(page);
  await page.locator('#sky').click();
  expect(calls).toBe(0);
  await page.locator('#consent').check();
  await page.locator('#sky').click();
  await expect(page.locator('.star-card')).toHaveCount(2);
  await expect(page.locator('#detail-name')).toHaveText('アンドロメダ座');
  await expect(page.locator('#notice')).toContainText('接続しました');
  await page.getByRole('button', { name: /オリオン座/ }).click();
  await expect(page.locator('#detail-name')).toHaveText('オリオン座');
  await expect(page.locator('#story-section')).toBeHidden();
  await expect(page.locator('.star-card').last()).toContainText('地平線下');
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await page.screenshot({ path: 'test-results/observation-fixture-desktop.png', fullPage: true });
});
test('authentication error clears previous results and leaves retry available', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/sky', route => ++calls === 1
    ? route.fulfill({ json: sky })
    : route.fulfill({ status: 401, json: { code: 'unauthorized', error: 'Unauthorized' } }));
  await prepare(page);
  await page.locator('#consent').check();
  await page.locator('#sky').click();
  await expect(page.locator('.star-card')).toHaveCount(2);
  await page.locator('#sky').click();
  await expect(page.locator('#notice')).toContainText('一致しません');
  await expect(page.locator('.star-card')).toHaveCount(0);
  await expect(page.locator('#sky')).toBeEnabled();
});
for (const mode of ['button', 'escape', 'hidden']) {
  test('stops pending requests via ' + mode + ' without accepting a late response', async ({ page }) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/sky', async route => {
      await gate;
      await route.fulfill({ json: sky }).catch(() => {});
    });
    await prepare(page);
    await page.locator('#consent').check();
    const pending = page.waitForRequest('**/api/sky');
    await page.locator('#sky').click();
    await pending;
    await expect(page.locator('#sky')).toBeDisabled();
    if (mode === 'button') await page.locator('#stop').click();
    if (mode === 'escape') await page.keyboard.press('Escape');
    if (mode === 'hidden') await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('#notice')).toContainText('停止しました');
    release();
    await expect(page.locator('.star-card')).toHaveCount(0);
    await expect(page.locator('#sky')).toBeEnabled();
  });
}
test('empty successful response is distinct from failure and mobile has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/sky', route => route.fulfill({ json: { ...sky, constellations: [] } }));
  await prepare(page);
  await page.locator('#consent').check();
  await page.locator('#sky').click();
  await expect(page.locator('#notice')).toContainText('星座が返されませんでした');
  await expect(page.locator('#count')).toHaveText('0 CONSTELLATIONS');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('#stop')).toBeInViewport();
  await page.screenshot({ path: 'test-results/observation-mobile.png', fullPage: true });
});
test('provider text is rendered as text, never HTML', async ({ page }) => {
  const malicious = { ...sky, constellations: [{ ...sky.constellations[0], name: '<img src=x onerror=alert(1)>', description: '<script>window.bad=true</script>' }] };
  await page.route('**/api/sky', route => route.fulfill({ json: malicious }));
  await prepare(page);
  await page.locator('#consent').check();
  await page.locator('#sky').click();
  await expect(page.locator('#detail-name')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#detail img, #detail script')).toHaveCount(0);
});
