import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyToArrayBuffer } from '../_shared/bytes.ts';

test('copyToArrayBuffer copies only the visible range into an independent ArrayBuffer', () => {
  const source = new Uint8Array([9, 1, 2, 8]);
  const view = source.subarray(1, 3);
  const result = copyToArrayBuffer(view);

  assert.ok(result instanceof ArrayBuffer);
  assert.equal(result.byteLength, 2);
  assert.notEqual(result, source.buffer);
  assert.deepEqual([...new Uint8Array(result)], [1, 2]);

  new Uint8Array(result)[0] = 7;
  assert.equal(source[1], 1);
});
