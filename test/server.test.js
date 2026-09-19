import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server/app.js';
const env = { HCR_ACCESS_TOKEN: 'access-test-secret', HOSHIMIRU_API_TOKEN: 'sky-test-secret' };
const headers = { Authorization: 'Bearer ' + env.HCR_ACCESS_TOKEN, 'Content-Type': 'application/json' };
const post = (body = '{}', extra = {}) => ({ method: 'POST', headers, body, ...extra });

test('status separates provider configuration, never exposes keys, and disables caching', async () => {
  const r = await createApp(env).request('/api/status');
  const body = await r.json();
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(body.configured, false);
  assert.deepEqual(body.services, { access: true, sky: true, reflex: false, planner: false });
  assert.ok(!JSON.stringify(body).includes('secret'));
});
test('auth and input failures reject before provider invocation with JSON errors', async () => {
  let calls = 0;
  const app = createApp(env, { observeSky: async () => { calls++; return {}; } });
  for (const [options, status, code] of [
    [post('{}', { headers: {} }), 401, 'unauthorized'],
    [post('{'), 400, 'invalid_json'],
    [post(JSON.stringify({ text: 'x'.repeat(17000) })), 413, 'payload_too_large']
  ]) {
    const r = await app.request('/api/sky', options);
    assert.equal(r.status, status);
    assert.equal((await r.json()).code, code);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls, 0);
  assert.equal((await app.request('/api/sky', post())).status, 200);
  assert.equal(calls, 1);
});
test('concurrent requests are rejected and failure releases the instance slot', async () => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const app = createApp(env, { observeSky: async () => {
    calls++;
    if (calls === 1) { entered(); await gate; throw new Error('private URL, coordinates and credentials'); }
    return { source: 'test-spy' };
  } });
  const first = app.request('/api/sky', post());
  await started;
  const second = await app.request('/api/sky', post());
  assert.equal(second.status, 429);
  assert.equal(second.headers.get('retry-after'), '1');
  assert.equal((await second.json()).code, 'busy');
  assert.equal((await app.request('/api/status')).status, 200);
  release();
  const failure = await first;
  assert.equal(failure.status, 502);
  assert.ok(!(await failure.text()).includes('private'));
  assert.equal((await app.request('/api/sky', post())).status, 200);
});
test('request cancellation is forwarded and releases the instance slot', async () => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const app = createApp(env, { observeSky: async (_input, _env, { signal }) => {
    entered();
    await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const controller = new AbortController();
  const pending = app.request('/api/sky', post('{}', { signal: controller.signal }));
  await started;
  controller.abort();
  const result = await pending;
  assert.equal(result.status, 499);
  assert.equal((await result.json()).code, 'cancelled');
  assert.equal((await app.request('/api/sky', post('{'))).status, 400);
});
test('real sky route fails closed when upstream is malformed; it never serves fixtures', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ results: [null] }));
  const response = await createApp(env).request('/api/sky', post('{"lat":0,"lng":0}'));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, 'invalid_response');
});

