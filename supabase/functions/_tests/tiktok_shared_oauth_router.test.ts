import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  readSharedTikTokOAuthParams,
  routeSharedTikTokOAuthCallback,
  type SharedTikTokOAuthProvider,
} from '../_shared/tiktok-shared-oauth-router.ts';
import { sellerOAuthCallbackResponse } from '../_shared/tiktok-shared-oauth-response.ts';
import { classifySharedTikTokOAuthState } from '../_shared/tiktok-shared-oauth-classifier.ts';

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
      handleSeller: async (_request: Request, params: { state: string | null; code: string | null }) => {
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
      methodNotAllowed: () => Response.json({ error: 'method_not_allowed' }, { status: 405 }),
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

test('unsupported methods do not classify or consume a state', async () => {
  const { calls, dependencies: d } = dependencies(async () => {
    throw new Error('must not classify unsupported method');
  });
  const response = await routeSharedTikTokOAuthCallback(new Request('https://autoclipe.vercel.app/tiktok/callback', {
    method: 'PUT',
  }), d);
  assert.equal(response.status, 405);
  assert.deepEqual(calls, { content: 0, seller: 0, invalid: 0, unavailable: 0 });
});

test('Seller GET result is a clean redirect and POST result is controlled JSON', async () => {
  const get = sellerOAuthCallbackResponse(
    new Request('https://edge.example/callback?code=secret-code&state=secret-state'),
    {},
    'https://autoclipe.vercel.app',
    'error',
  );
  assert.equal(get.status, 302);
  assert.equal(get.headers.get('location'), 'https://autoclipe.vercel.app/canais?tiktok_shop=error');
  assert.equal(get.headers.get('location')?.includes('secret'), false);

  const post = sellerOAuthCallbackResponse(request({ state: 'state', code: 'code' }), {}, 'https://autoclipe.vercel.app', 'connected');
  assert.equal(post.status, 200);
  assert.deepEqual(await post.json(), { result: 'connected', provider: 'seller' });
});

test('state classifier rejects database failure and does not choose a provider by fallback', async () => {
  await assert.rejects(
    () => classifySharedTikTokOAuthState('state', {
      contentState: async () => ({ found: false, failed: true }),
      sellerState: async () => ({ found: true, failed: false }),
    }),
    /oauth state lookup failed/,
  );
});
