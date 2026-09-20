import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { compileCatalog, validateCatalog, CATALOG_REVISION } from '../src/core/catalog.js';
const root = new URL('../data/catalog/', import.meta.url);
const metadata = JSON.parse(await readFile(new URL('sources.json', root), 'utf8'));
if (metadata.source.commit !== CATALOG_REVISION) throw Error('Catalog revision mismatch');
async function source(name) {
  const spec = metadata.files[name];
  const stored = await readFile(new URL(spec.file, root));
  const bytes = spec.compression === 'gzip' ? gunzipSync(stored, { maxOutputLength: 6000000 }) : stored;
  if (bytes.length !== spec.bytes || createHash('sha256').update(bytes).digest('hex') !== spec.sha256) throw Error('Catalog source integrity mismatch');
  return JSON.parse(bytes.toString('utf8'));
}
const compiled = validateCatalog(compileCatalog(await source('stars'), await source('lines')));
const output = { ...compiled, source: metadata.source };
const destination = new URL('../public/catalog/', import.meta.url);
await mkdir(destination, { recursive: true });
await writeFile(new URL('constellations.json', destination), JSON.stringify(output) + '\n');
console.log('Verified catalogue: 88 constellations; exact HIP endpoint matching; J2000.');
