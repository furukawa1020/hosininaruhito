import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { compileCatalog, validateCatalog, CATALOG_IDS } from '../src/core/catalog.js';
import { loadCatalog, getConstellationCatalog } from '../src/providers/catalog.js';
import { createApp } from '../src/server/app.js';
const metadata = JSON.parse(await readFile(new URL('../data/catalog/sources.json', import.meta.url)));
const source = {};
for (const [name, spec] of Object.entries(metadata.files)) {
  const stored = await readFile(new URL('../data/catalog/' + spec.file, import.meta.url));
  const bytes = spec.compression === 'gzip' ? gunzipSync(stored) : stored;
  assert.equal(bytes.length, spec.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), spec.sha256);
  source[name] = JSON.parse(bytes);
}
const compiled = compileCatalog(source.stars, source.lines);
const clone = value => structuredClone(value);
const used = new Set(compiled.constellations.flatMap(row => row.stars.map(star => Number(star.id.slice(4)))));
const endpointStars = { ...source.stars, features: source.stars.features.filter(star => used.has(star.id)) };
const rejectsCode = code => error => error.code === code;

test('pinned catalogue regenerates exactly; all 88 provider IDs are covered', async () => {
  const stored = await loadCatalog();
  assert.deepEqual(stored, { ...compiled, source: metadata.source });
  assert.equal(CATALOG_IDS.length, 88);
  assert.equal(new Set(CATALOG_IDS.map(row => row.iau)).size, 88);
  // Provider order deliberately differs from alphabetical catalogue order.
  for (const [id, iau] of [['4', 'Aql'], ['5', 'Aqr'], ['20', 'CMa'], ['30', 'CVn'], ['74', 'Ser'], ['88', 'Vul']])
    assert.equal(compiled.constellations.find(row => row.id === id).iau, iau);
});

test('every line endpoint roundtrips to its exact source HIP star without invented coordinates', () => {
  const sourceStars = new Map(source.stars.features.map(star => ['HIP:' + star.id, star]));
  for (const row of compiled.constellations) {
    const originalLines = source.lines.features.filter(feature => feature.id === row.iau).flatMap(feature => feature.geometry.coordinates);
    assert.equal(row.lines.length, originalLines.length);
    for (const [i, line] of row.lines.entries()) for (const [j, id] of line.entries()) {
      const original = sourceStars.get(id);
      assert.deepEqual(original.geometry.coordinates, originalLines[i][j]);
      const star = row.stars.find(star => star.id === id);
      const [ra, dec] = original.geometry.coordinates;
      assert.equal(star.raDeg, (ra + 360) % 360);
      assert.equal(star.decDeg, dec);
      assert.equal(star.magnitude, original.properties.mag);
    }
  }
  const serpent = compiled.constellations.find(row => row.iau === 'Ser');
  assert.equal(source.lines.features.filter(row => row.id === 'Ser').length, 2);
  assert.equal(serpent.lines.length, source.lines.features.filter(row => row.id === 'Ser').reduce((n, row) => n + row.geometry.coordinates.length, 0));
});

test('missing or ambiguous endpoint cannot be approximated to a nearby star', () => {
  const point = source.lines.features[0].geometry.coordinates[0][0];
  const index = endpointStars.features.findIndex(row => row.geometry.coordinates.every((v, i) => v === point[i]));
  const missing = clone(endpointStars);
  missing.features.splice(index, 1);
  assert.throws(() => compileCatalog(missing, source.lines), rejectsCode('missing_star'));
  const ambiguous = clone(endpointStars);
  ambiguous.features.push({ ...clone(ambiguous.features[index]), id: 199999 });
  assert.throws(() => compileCatalog(ambiguous, source.lines), rejectsCode('ambiguous_star'));
});

test('duplicate HIP IDs, non-finite and out-of-range star coordinates are rejected', () => {
  for (const mutate of [
    data => { data.features[1].id = data.features[0].id; },
    data => { data.features[0].geometry.coordinates[0] = NaN; },
    data => { data.features[0].geometry.coordinates[1] = 91; },
    data => { data.features[0].properties.mag = Infinity; }
  ]) {
    const data = clone(endpointStars); mutate(data);
    assert.throws(() => compileCatalog(data, source.lines), rejectsCode('invalid_star'));
  }
});

test('unknown, duplicate or missing constellations and degenerate paths fail closed', () => {
  for (const [mutate, code] of [
    [data => { data.features[0].id = 'Unknown'; }, 'invalid_lines'],
    [data => { data.features[1] = clone(data.features[0]); }, 'duplicate_constellation'],
    [data => { data.features.pop(); }, 'incomplete_catalog'],
    [data => { const p = data.features[0].geometry.coordinates[0][0]; data.features[0].geometry.coordinates[0] = [p, p]; }, 'degenerate_line']
  ]) {
    const data = clone(source.lines); mutate(data);
    assert.throws(() => compileCatalog(source.stars, data), rejectsCode(code));
  }
});

test('compiled catalogue rejects wrong units, ID mapping, duplicate stars and dangling lines', () => {
  for (const mutate of [
    data => { data.epoch = 'of-date'; },
    data => { data.angleUnit = 'radian'; },
    data => { data.constellations[0].id = '2'; },
    data => { data.constellations[0].iau = 'Ori'; },
    data => { data.constellations[0].stars[1].id = data.constellations[0].stars[0].id; },
    data => { data.constellations[0].stars[0].raDeg = 360; },
    data => { data.constellations[0].lines[0][0] = 'HIP:199999'; }
  ]) {
    const data = clone(compiled); mutate(data);
    assert.throws(() => validateCatalog(data));
  }
});

test('unavailable, malformed, oversized and uncredited catalogue fails with sanitized 503', async () => {
  for (const read of [
    async () => { throw Error('private path'); },
    async () => '{',
    async () => ' '.repeat(1024 * 1024 + 1),
    async () => JSON.stringify(compiled),
    async () => JSON.stringify({ ...compiled, source: { ...metadata.source, commit: '0'.repeat(40) } })
  ]) await assert.rejects(loadCatalog({ read }), error => error.status === 503 && error.code === 'catalog_unavailable' && !error.message.includes('private'));
});

test('catalogue API returns an isolated copy with explicit epoch, units and provenance', async () => {
  const first = await getConstellationCatalog({ id: '60' });
  assert.equal(first.iau, 'Ori');
  assert.equal(first.epoch, 'J2000');
  assert.equal(first.angleUnit, 'degree');
  assert.equal(first.coordinateSystem, 'equatorial');
  assert.equal(first.source.commit, metadata.source.commit);
  first.stars[0].raDeg = -1000;
  assert.ok((await getConstellationCatalog({ id: '60' })).stars[0].raDeg >= 0);
});

test('catalogue input rejects unknown IDs, coerced IDs and observation coordinates', async () => {
  for (const input of [null, {}, { id: 1 }, { id: '0' }, { id: '89' }, { id: '01' }, { id: 'And' }, { id: '1', lat: 0 }])
    await assert.rejects(getConstellationCatalog(input), error => error.status === 400);
});

test('catalogue route is authenticated and validates JSON and body size before lookup', async () => {
  const app = createApp({ HCR_ACCESS_TOKEN: 'test-access' });
  const post = (body, authorized = true) => ({ method: 'POST', headers: {
    'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer test-access' } : {})
  }, body });
  assert.equal((await app.request('/api/catalog', post('{"id":"60"}', false))).status, 401);
  assert.equal((await app.request('/api/catalog', post('{'))).status, 400);
  assert.equal((await app.request('/api/catalog', post('{"id":"89"}'))).status, 400);
  assert.equal((await app.request('/api/catalog', post(JSON.stringify({ id: 'x'.repeat(17000) })))).status, 413);
  const result = await app.request('/api/catalog', post('{"id":"60"}'));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).iau, 'Ori');
});
