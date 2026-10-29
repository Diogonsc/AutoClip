import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSafeStorageKey, signMediaToken, verifyMediaToken } from '../_shared/media-token.ts';
import { handleMediaServe } from '../_shared/media-serve.ts';

const SECRET = 'segredo-de-teste-com-bastante-entropia';
const KEY = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/original.jpg';
const NOW = 1_800_000_000_000;

test('token: assina e verifica; expira; rejeita adulteração e segredo errado', async () => {
  const t = await signMediaToken(SECRET, KEY, NOW + 60_000);
  assert.deepEqual(await verifyMediaToken(SECRET, t, NOW), { ok: true, key: KEY });
  assert.deepEqual(await verifyMediaToken(SECRET, t, NOW + 120_000), { ok: false, reason: 'expired' });
  assert.deepEqual(await verifyMediaToken('outro', t, NOW), { ok: false, reason: 'bad_signature' });
  const [p, s] = t.split('.');
  const forged = `${Buffer.from(JSON.stringify({ k: 'x/y/z.jpg', e: 9e9 })).toString('base64url')}.${s}`;
  assert.equal((await verifyMediaToken(SECRET, forged, NOW)).ok, false);
  assert.equal((await verifyMediaToken(SECRET, `${p}.${s}.extra`, NOW)).ok, false);
  assert.equal((await verifyMediaToken(SECRET, 'lixo', NOW)).ok, false);
});

test('chave do Storage: bloqueia path traversal e formatos estranhos', async () => {
  assert.equal(isSafeStorageKey(KEY), true);
  for (const bad of ['../x/y.jpg', 'a/../b.jpg', '/a/b.jpg', 'a//b.jpg', 'a', 'a/b c.jpg', '', 'a/b/c/d/e.jpg']) {
    assert.equal(isSafeStorageKey(bad), false, bad);
  }
  await assert.rejects(() => signMediaToken(SECRET, '../segredo.jpg', NOW));
});

function req(method: string, token: string) {
  return new Request(`https://x.supabase.co/functions/v1/media-serve?t=${encodeURIComponent(token)}`, { method });
}

test('serve: imagem com token válido, HEAD sem corpo, tipos e cabeçalhos', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const d = { secret: SECRET, now: () => NOW, download: async () => bytes };
  const t = await signMediaToken(SECRET, KEY, NOW + 60_000);
  const res = await handleMediaServe(req('GET', t), d);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
  const head = await handleMediaServe(req('HEAD', t), d);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '4');
  assert.equal((await handleMediaServe(req('POST', t), d)).status, 405);
});

test('serve: token ruim=403, expirado=410, inexistente=404, vídeo nunca é servido', async () => {
  const d = { secret: SECRET, now: () => NOW, download: async () => new Uint8Array([1]) };
  assert.equal((await handleMediaServe(req('GET', 'lixo'), d)).status, 403);
  const expired = await signMediaToken(SECRET, KEY, NOW - 1000);
  assert.equal((await handleMediaServe(req('GET', expired), d)).status, 410);
  const valid = await signMediaToken(SECRET, KEY, NOW + 60_000);
  assert.equal((await handleMediaServe(req('GET', valid), { ...d, download: async () => null })).status, 404);
  const video = await signMediaToken(SECRET, KEY.replace('.jpg', '.mp4'), NOW + 60_000);
  assert.equal((await handleMediaServe(req('GET', video), d)).status, 403);
});
