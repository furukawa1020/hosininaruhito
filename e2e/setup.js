import { mkdir, writeFile } from 'node:fs/promises';

// A generated, looping YUV test pattern. It contains no captured image.
export default async function setup() {
  const width = 320, height = 240;
  const chunks = [Buffer.from('YUV4MPEG2 W320 H240 F10:1 Ip A1:1 C420jpeg\n')];
  for (let frame = 0; frame < 10; frame++) {
    const y = Buffer.alloc(width * height, 40);
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const disk = (col - (75 + frame * 15)) ** 2 + (row - 120) ** 2 < 28 ** 2;
        y[row * width + col] = disk ? 220 : 35 + Math.floor(col / 40) * 15;
      }
    }
    chunks.push(Buffer.from('FRAME\n'), y, Buffer.alloc(width * height / 2, 128));
  }
  await mkdir(new URL('./.generated/', import.meta.url), { recursive: true });
  await writeFile(new URL('./.generated/camera.y4m', import.meta.url), Buffer.concat(chunks));
}
