import { readFile } from 'node:fs/promises';
import { validateCatalog, CATALOG_REVISION } from '../core/catalog.js';
import { fail } from './http.js';
let loaded;
export async function loadCatalog({ read = () => readFile(new URL('../../public/catalog/constellations.json', import.meta.url), 'utf8') } = {}) {
  try {
    const text = await read();
    if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024) throw Error('Invalid catalogue');
    const value = validateCatalog(JSON.parse(text));
    if (value.source?.catalog !== 'd3-celestial/XHIP' || value.source?.license !== 'BSD-3-Clause' ||
        value.source?.commit !== CATALOG_REVISION) throw Error('Invalid source');
    return value;
  } catch { fail('Catalog unavailable or invalid', 503, 'catalog_unavailable'); }
}
export async function getConstellationCatalog(input) {
  if (!input || Object.keys(input).some(k => k !== 'id') || typeof input.id !== 'string' ||
      !/^[1-9][0-9]?$/.test(input.id) || Number(input.id) > 88) fail('Invalid constellation ID');
  loaded ??= loadCatalog().catch(error => { loaded = undefined; throw error; });
  const data = await loaded;
  const constellation = data.constellations.find(row => row.id === input.id);
  if (!constellation) fail('Unknown constellation', 404, 'unknown_constellation');
  return structuredClone({ ...constellation, version: data.version, coordinateSystem: data.coordinateSystem, epoch: data.epoch, angleUnit: data.angleUnit, source: data.source });
}
