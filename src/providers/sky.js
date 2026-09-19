import { fail, getJSON, required } from './http.js';

function text(value, max = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

export function normalizeSky(data) {
  if (!data || typeof data !== 'object' || data.errors || !Array.isArray(data.results) || data.results.length > 88 ||
      (data.metadata?.status !== undefined && data.metadata.status !== 200)) {
    fail('Invalid sky response', 502, 'invalid_response');
  }
  const ids = new Set();
  const constellations = data.results.map(row => {
    if (!row || !['string', 'number'].includes(typeof row.id)) fail('Invalid sky ID', 502, 'invalid_response');
    const id = String(row.id);
    if (!/^[1-9]\d?$/.test(id) || Number(id) > 88 || ids.has(id) || !text(row.jpName)) {
      fail('Invalid sky identity', 502, 'invalid_response');
    }
    ids.add(id);
    if (!Number.isFinite(row.directionNum) || row.directionNum < 0 || row.directionNum > 360 ||
        !Number.isFinite(row.altitudeNum) || Math.abs(row.altitudeNum) > 90) {
      fail('Invalid sky angles', 502, 'invalid_response');
    }
    if (row.drowing != null && (typeof row.drowing !== 'string' || row.drowing.length > 20000)) {
      fail('Invalid sky drawing', 502, 'invalid_response');
    }
    const result = {
      id, name: row.jpName, azimuthDeg: row.directionNum, altitudeDeg: row.altitudeNum,
      // Opaque provider value. Catalog IDs and line syntax remain unverified.
      drawingIds: row.drowing ?? null
    };
    for (const [source, target, limit] of [
      ['enName', 'englishName', 200], ['season', 'season', 100],
      ['roughly', 'summary', 2000], ['content', 'description', 8000], ['origin', 'story', 16000]
    ]) {
      if (row[source] != null && row[source] !== '') {
        if (!text(row[source], limit)) fail('Invalid sky text', 502, 'invalid_response');
        result[target] = row[source];
      }
    }
    return result;
  });
  return { source: 'hoshimiru-live', timeBasis: 'provider-default', constellations };
}

export async function observeSky(input, env, options = {}) {
  if (!input || !Number.isFinite(input.lat) || Math.abs(input.lat) > 90 ||
      !Number.isFinite(input.lng) || Math.abs(input.lng) > 180) fail('Invalid coordinates');
  if (Object.keys(input).some(key => !['lat', 'lng'].includes(key))) fail('Only lat and lng are supported');
  const token = required(env, 'HOSHIMIRU_API_TOKEN');
  const url = new URL('https://app.livlog.xyz/hoshimiru/constellation');
  url.searchParams.set('lat', String(input.lat));
  url.searchParams.set('lng', String(input.lng));
  return normalizeSky(await getJSON(url, { headers: { Authorization: 'Bearer ' + token } }, options));
}

