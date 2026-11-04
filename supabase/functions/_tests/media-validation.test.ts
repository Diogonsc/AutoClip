import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyToArrayBuffer } from '../_shared/bytes.ts';
import { validateImage } from '../_shared/media-validation.ts';

function uint32be(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode(type);
  const crcInput = new Uint8Array(name.length + data.length);
  crcInput.set(name);
  crcInput.set(data, name.length);
  const crc = uint32be(crc32(crcInput));
  const result = new Uint8Array(12 + data.length);
  result.set(uint32be(data.length), 0);
  result.set(name, 4);
  result.set(data, 8);
  result.set(crc, 8 + data.length);
  return result;
}

async function makePng(width: number, height: number): Promise<Uint8Array> {
  const scanlines = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    scanlines[row] = 0;
    for (let x = 0; x < width; x++) {
      const pixel = row + 1 + x * 4;
      scanlines.set([40, 100, 180, 255], pixel);
    }
  }
  const compressed = new Uint8Array(await new Response(
    new Blob([scanlines]).stream().pipeThrough(new CompressionStream('deflate')),
  ).arrayBuffer());
  const header = new Uint8Array(13);
  header.set(uint32be(width), 0);
  header.set(uint32be(height), 4);
  header.set([8, 6, 0, 0, 0], 8);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [pngChunk('IHDR', header), pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array())];
  const output = new Uint8Array(signature.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  output.set(signature);
  let offset = signature.length;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

test('validateImage decodes a PNG subarray and hashes only its visible bytes', async () => {
  const png = await makePng(360, 360);
  const padded = new Uint8Array(png.length + 4);
  padded.set([1, 2], 0);
  padded.set(png, 2);
  padded.set([3, 4], png.length + 2);
  const view = padded.subarray(2, png.length + 2);

  const validated = await validateImage(view, 'image/png');
  const expectedDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', copyToArrayBuffer(png)));
  const expectedSha256 = [...expectedDigest].map((value) => value.toString(16).padStart(2, '0')).join('');

  assert.deepEqual(validated, {
    mime: 'image/png',
    width: 360,
    height: 360,
    sha256: expectedSha256,
    size: png.byteLength,
  });
});
