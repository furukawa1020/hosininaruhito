import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSky, observeSky } from '../src/providers/sky.js';
import { getJSON } from '../src/providers/http.js';
import { decideReflex } from '../src/providers/live.js';

// Test-only examples of the documented response shape; never a live fallback.
const row = { id: '1', jpName: 'アンドロメダ座', directionNum: 279.17, altitudeNum: 42.01, drowing: '[8961|8976]', enName: 'Andromeda' };
const response = rows => ({ errors: null, metadata: { status: 200 }, results: rows });
test('sky preserves representative angles and opaque drawing IDs without making stars', () => {
  const data = normalizeSky(response([row]));
  assert.equal(data.source, 'hoshimiru-live');
  assert.equal(data.timeBasis, 'provider-default');
  assert.deepEqual(data.constellations[0], {
    id: '1', name: 'アンドロメダ座', azimuthDeg: 279.17, altitudeDeg: 42.01,
    drawingIds: '[8961|8976]', englishName: 'Andromeda'
  });
  assert.deepEqual(normalizeSky(response([])).constellations, []);
  assert.equal(normalizeSky(response([{ ...row, altitudeNum: -10 }])).constellations[0].altitudeDeg, -10);
});
test('sky rejects malformed, duplicate, oversized or unsuccessful provider payloads', () => {
  for (const data of [null, {}, { results: {} }, { errors: ['failure'], results: [] },
    { metadata: { status: 401 }, results: [] }, response([null]), response([row, row]),
    response(Array(89).fill(row)), ...[
      { id: undefined }, { id: 89 }, { id: {} }, { id: '' }, { jpName: '' }, { jpName: 1 },
      { altitudeNum: 91 }, { directionNum: -1 }, { directionNum: 361 },
      { directionNum: '279.17' }, { altitudeNum: NaN }, { drowing: [1, 2] },
      { story: undefined, origin: {} }, { content: 'x'.repeat(8001) }
    ].map(change => response([{ ...row, ...change }]))]) {
    assert.throws(() => normalizeSky(data), { status: 502, code: 'invalid_response' });
  }
});
test('sky sends only coordinates with a server-side bearer token and no inferred time', async t => {
  let called = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    called++;
    assert.equal(url.origin, 'https://app.livlog.xyz');
    assert.equal(url.pathname, '/hoshimiru/constellation');
    assert.deepEqual([...url.searchParams], [['lat', '35.68'], ['lng', '139.76']]);
    assert.equal(options.headers.Authorization, 'Bearer provider-test-token');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(response([row]));
  });
  const result = await observeSky({ lat: 35.68, lng: 139.76 }, { HOSHIMIRU_API_TOKEN: 'provider-test-token' });
  assert.equal(result.constellations.length, 1);
  assert.equal(called, 1);
});
test('missing keys, invalid coordinates and unsupported times never call upstream', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network'); });
  for (const input of [null, {}, { lat: '', lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 },
    { lat: 0, lng: 0, date: '2026-09-20' }]) {
    await assert.rejects(observeSky(input, { HOSHIMIRU_API_TOKEN: 'test' }), { status: 400 });
  }
  await assert.rejects(observeSky({ lat: 0, lng: 0 }, { HOSHIMIRU_API_TOKEN: '  ' }), { status: 503 });
  assert.equal(fetch.mock.callCount(), 0);
});
test('HTTP errors, non-JSON and excessive responses never leak upstream data', async t => {
  const cases = [
    [() => new Response('sensitive-provider-body', { status: 401 }), 'upstream_http'],
    [() => new Response('<html>sensitive-provider-body</html>'), 'invalid_response'],
    [() => new Response('x'.repeat(1024 * 1024 + 1)), 'invalid_response'],
    [() => { throw new Error('sensitive-provider-body'); }, 'upstream_unavailable']
  ];
  for (const [makeResponse, code] of cases) {
    const mock = t.mock.method(globalThis, 'fetch', async () => makeResponse());
    await assert.rejects(getJSON('https://example.invalid', {}), error => {
      assert.equal(error.status, 502);
      assert.equal(error.code, code);
      assert.ok(!error.message.includes('sensitive-provider-body'));
      return true;
    });
    mock.mock.restore();
  }
});
test('cancellation reaches upstream and differs from a timeout', async t => {
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const controller = new AbortController();
  const pending = getJSON('https://example.invalid', {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { status: 499, code: 'cancelled' });
  // Keep the loop alive because AbortSignal.timeout intentionally uses an unref timer.
  const timer = setTimeout(() => {}, 100);
  try { await assert.rejects(getJSON('https://example.invalid', {}, { timeoutMs: 5 }), { status: 504, code: 'upstream_timeout' }); }
  finally { clearTimeout(timer); }
});
test('pre-aborted request makes no external call', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network'); });
  await assert.rejects(getJSON('https://example.invalid', {}, { signal: AbortSignal.abort() }), { code: 'cancelled' });
  assert.equal(fetch.mock.callCount(), 0);
});
test('Jev remains advisory and validates its answer using the shared transport', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ answers: { action: { choice: 'right', confidence: 0.9 } } }));
  assert.deepEqual(await decideReflex({ dx: 0.1, dy: 0, tracked: true }, { TYPESAFE_API_KEY: 'test' }),
    { source: 'jev-live', advisoryOnly: true, action: 'right', confidence: 0.9 });
  fetch.mock.mockImplementation(async () => Response.json(null));
  await assert.rejects(decideReflex({ dx: 0.1, dy: 0, tracked: true }, { TYPESAFE_API_KEY: 'test' }), { code: 'invalid_response' });
});

