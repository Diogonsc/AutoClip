import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { ShopApiError, TikTokShopSellerClient, normalizeSellerShop, sellerAuthorizeUrl, signSellerRequest, validPageSize, validatedApiHost } from '../_shared/tiktok-shop-seller.ts';

const client = (fetchImpl: typeof fetch) => new TikTokShopSellerClient({ appKey: 'app', appSecret: 'secret', accessToken: 'synthetic', fetchImpl });

test('normalizes observed Partner Center id/cipher shape and rejects incomplete shops', () => {
  const auth = new URL(sellerAuthorizeUrl('https://services.br.tiktokshop.com/open/authorize', 'service', 'state'));
  assert.equal(auth.searchParams.get('service_id'), 'service');
  assert.deepEqual(normalizeSellerShop({ id: '7495028847767946451', cipher: 'SANITIZED_SHOP_CIPHER', name: 'SANDBOX_BR7703293130270885633', region: 'BR', seller_type: 'LOCAL' }), { shop_id: '7495028847767946451', shop_cipher: 'SANITIZED_SHOP_CIPHER', name: 'SANDBOX_BR7703293130270885633', region: 'BR', seller_type: 'LOCAL' });
  assert.equal(normalizeSellerShop({ id: '7495028847767946451' }), null);
  assert.throws(() => validatedApiHost('https://attacker.invalid'));
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

test('pagination preserves total_count, stops repeated tokens and forwards cancellation', async () => {
  const calls: string[] = [];
  const paged = client(async (url) => { calls.push(String(url)); const second = String(url).includes('page_token=next'); return new Response(JSON.stringify({ code: 0, data: { products: [{ id: second ? '2' : '1' }], next_page_token: second ? 'next' : 'next', total_count: 1 } })); });
  const pages: unknown[] = []; for await (const page of paged.searchProductPages({ shopCipher: 'cipher', maxPages: 5 })) pages.push(page);
  assert.equal(calls.length, 2); assert.equal((pages[0] as { total_count:number }).total_count, 1);
  await assert.rejects(paged.searchProductPages({ shopCipher: 'cipher', maxPages: 0 }).next(), /maxPages/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client(async () => new Response('{}')).searchProducts({ shopCipher: 'cipher', signal: controller.signal }), (e: unknown) => e instanceof ShopApiError && e.code === 'cancelled');
});

test('Seller client handles authorized shops, repeated page tokens and API failures safely', async () => {
  const shops = await client(async () => new Response(JSON.stringify({ code: 0, data: { shops: [{ id: '7495028847767946451', cipher: 'cipher', region: 'BR' }, { id: 'bad' }] } }))).authorizedShops();
  assert.equal(shops[0]?.shop_id, '7495028847767946451');
  await assert.rejects(client(async () => new Response('', { status: 429 })).authorizedShops(), (error: unknown) => error instanceof ShopApiError && error.code === 'rate_limited');
  await assert.rejects(client(async () => new Response(JSON.stringify({ code: 0, data: { products: null } }))).searchProducts({ shopCipher: 'cipher' }), /TikTok Shop request failed/);
});

test('Get Product remains adapter-gated until account-specific endpoint confirmation', async () => {
  await assert.rejects(client(async () => new Response('{}')).getProduct('1738448341508261075', 'cipher'), /not confirmed/);
});
