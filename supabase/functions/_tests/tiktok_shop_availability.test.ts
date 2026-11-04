import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTikTokShopEnabled, tikTokShopUnavailableResponse } from '../_shared/tiktok-shop-availability.ts';

test('TikTok Shop availability is hard-disabled pending homologation and owner authorization', () => {
  assert.equal(isTikTokShopEnabled(), false);
});

test('disabled Shop response is generic, uncached, and not an authentication oracle', async () => {
  const response = tikTokShopUnavailableResponse();
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await response.json(), { error: 'feature_unavailable' });
});

