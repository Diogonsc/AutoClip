import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { ShopApiError, TikTokShopSellerClient, sellerAuthorizeUrl, signSellerRequest, validPageSize } from '../_shared/tiktok-shop-seller.ts';

const client = (fetchImpl: typeof fetch) => new TikTokShopSellerClient({ appKey: 'app', appSecret: 'secret', accessToken: 'synthetic', fetchImpl });

test('Seller authorization uses explicit configured service and state', () => {
  const url = new URL(sellerAuthorizeUrl('https://services.br.tiktokshop.com/open/authorize', 'service', 'state', 'https://callback.example'));
  assert.equal(url.searchParams.get('service_id'), 'service');
  assert.equal(url.searchParams.get('state'), 'state');
  assert.throws(() => sellerAuthorizeUrl('http://invalid.example', 'service', 'state'));
});

test('Seller request signing is stable and excludes sign itself', async () => {
  assert.equal(await signSellerRequest('secret', '/x', { timestamp: '1', app_key: 'app', sign: 'ignored' }, ''), await signSellerRequest('secret', '/x', { app_key: 'app', timestamp: '1' }, ''));
});

test('Search Products defaults page_size to 20 and rejects zero', async () => {
  let seen = '';
  const result = await client(async (input) => { seen = String(input); return new Response(JSON.stringify({ code: 0, data: { products: [], next_page_token: 'next', total_count: 1 } })); }).searchProducts({ shopCipher: 'cipher' });
  assert.match(seen, /page_size=20/); assert.equal(result.next_page_token, 'next');
  assert.throws(() => validPageSize(0));
});

test('Seller client handles authorized shops, repeated page tokens and API failures safely', async () => {
  const shops = await client(async () => new Response(JSON.stringify({ code: 0, data: { shops: [{ shop_id: '7495028847767946451', shop_cipher: 'cipher', region: 'BR' }] } }))).authorizedShops();
  assert.equal(shops[0]?.shop_id, '7495028847767946451');
  await assert.rejects(client(async () => new Response('', { status: 429 })).authorizedShops(), (error: unknown) => error instanceof ShopApiError && error.code === 'rate_limited');
  await assert.rejects(client(async () => new Response(JSON.stringify({ code: 0, data: { products: null } }))).searchProducts({ shopCipher: 'cipher' }), /TikTok Shop request failed/);
});

test('Get Product remains adapter-gated until account-specific endpoint confirmation', async () => {
  await assert.rejects(client(async () => new Response('{}')).getProduct('/unconfirmed', 'cipher'), /not confirmed/);
});
