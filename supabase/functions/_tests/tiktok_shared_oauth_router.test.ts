import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  readSharedTikTokOAuthParams,
  routeSharedTikTokOAuthCallback,
  type SharedTikTokOAuthProvider,
} from '../_shared/tiktok-shared-oauth-router.ts';

function request(body: unknown, method = 'POST') {
  return new Request('https://autoclipe.vercel.app/tiktok/callback', {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

function dependencies(classify: (state: string) => Promise<SharedTikTokOAuthProvider | 'unknown' | 'ambiguous'>) {
  const calls = { content: 0, seller: 0, invalid: 0, unavailable: 0 };
  return {
    calls,
    dependencies: {
      classifyState: classify,
      handleContentPosting: async () => {
        calls.content++;
        return Response.json({ result: 'content' });
      },
      handleSeller: async (params: { state: string | null; code: string | null }) => {
        calls.seller++;
        return Response.json({ result: 'seller', state: params.state, code: params.code });
      },
      invalidState: () => {
        calls.invalid++;
        return Response.json({ result: 'invalid_state' });
      },
      unavailable: () => {
        calls.unavailable++;
        return Response.json({ result: 'error' }, { status: 503 });
      },
    },
  };
}

test('shared router preserves the Content Posting callback request', async () => {
  const { calls, dependencies: d } = dependencies(async (state) => {
    assert.equal(state, 'content-state');
    return 'content_posting';
  });
  const response = await routeSharedTikTokOAuthCallback(request({ state: 'content-state', code: 'code' }), d);
  assert.deepEqual(await response.json(), { result: 'content' });
  assert.deepEqual(calls, { content: 1, seller: 0, invalid: 0, unavailable: 0 });
});

test('shared router dispatches Seller only after server-side classification', async () => {
  const { calls, dependencies: d } = dependencies(async (state) => {
    assert.equal(state, 'seller-state');
    return 'seller';
  });
  const response = await routeSharedTikTokOAuthCallback(request({ state: 'seller-state', code: 'seller-code', provider: 'content_posting' }), d);
  assert.deepEqual(await response.json(), { result: 'seller', state: 'seller-state', code: 'seller-code' });
  assert.deepEqual(calls, { content: 0, seller: 1, invalid: 0, unavailable: 0 });
});

test('shared router rejects unknown, expired/replayed and ambiguous states without a fallback', async () => {
  for (const result of ['unknown', 'ambiguous'] as const) {
    const { calls, dependencies: d } = dependencies(async () => result);
    const response = await routeSharedTikTokOAuthCallback(request({ state: 'untrusted-state', code: 'code' }), d);
    assert.deepEqual(await response.json(), { result: 'invalid_state' });
    assert.deepEqual(calls, { content: 0, seller: 0, invalid: 1, unavailable: 0 });
  }
});

test('shared router rejects missing state and fails closed when classification is unavailable', async () => {
  const missing = dependencies(async () => 'content_posting');
  await routeSharedTikTokOAuthCallback(request({ code: 'code' }), missing.dependencies);
  assert.deepEqual(missing.calls, { content: 0, seller: 0, invalid: 1, unavailable: 0 });

  const unavailable = dependencies(async () => { throw new Error('database unavailable'); });
  const response = await routeSharedTikTokOAuthCallback(request({ state: 'state', code: 'code' }), unavailable.dependencies);
  assert.equal(response.status, 503);
  assert.deepEqual(unavailable.calls, { content: 0, seller: 0, invalid: 0, unavailable: 1 });
});

test('shared router parses GET callbacks without provider parameters', async () => {
  const params = await readSharedTikTokOAuthParams(new Request('https://autoclipe.vercel.app/tiktok/callback?state=s&code=c&provider=seller'));
  assert.deepEqual(params, { state: 's', code: 'c', error: null, scopes: null });
});
