import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestSession, parseCoordinates } from '../src/client/requests.js';
test('stopping invalidates an in-flight response even when transport ignores abort', async () => {
  const session = new RequestSession();
  const request = session.begin();
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  let rendered = false;
  const pending = response.then(() => { if (request.isCurrent()) rendered = true; });
  session.cancel();
  finish();
  await pending;
  assert.equal(rendered, false);
  assert.equal(request.signal.aborted, true);
});
test('a late response cannot replace a newer request or re-enable its controls', () => {
  const session = new RequestSession();
  const first = session.begin();
  const second = session.begin();
  assert.equal(first.isCurrent(), false);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.isCurrent(), true);
  session.cancel();
  assert.equal(second.isCurrent(), false);
});
test('empty coordinates are not treated as zero and ranges are enforced', () => {
  for (const values of [['', '0'], ['0', ' '], ['91', '0'], ['0', '-181'], ['NaN', '0'], ['Infinity', '0']]) {
    assert.throws(() => parseCoordinates(...values));
  }
  assert.deepEqual(parseCoordinates('0', '0'), { lat: 0, lng: 0 });
  assert.deepEqual(parseCoordinates('-90', '180'), { lat: -90, lng: 180 });
});

