import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('public/models/pose-model.json', root)));
const model = await readFile(new URL('public/models/pose_landmarker_lite.task', root));
if (model.length !== manifest.bytes || createHash('sha256').update(model).digest('hex') !== manifest.sha256) {
  throw new Error('Pose model integrity check failed');
}
const sdk = new URL('node_modules/@mediapipe/tasks-vision/', root);
const installed = JSON.parse(await readFile(new URL('package.json', sdk)));
if (installed.version !== manifest.sdkVersion) throw new Error('Pose SDK version mismatch');
const target = new URL('public/pose/wasm/', root);
await mkdir(target, { recursive: true });
// Module Workers use the official ES module + SIMD loader. No runtime CDN.
for (const name of ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm']) {
  await copyFile(new URL('wasm/' + name, sdk), new URL(name, target));
}
console.log('Verified local pose model and prepared SDK ' + installed.version);
