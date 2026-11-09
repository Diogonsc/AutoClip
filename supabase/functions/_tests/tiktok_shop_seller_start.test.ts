import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { handleSellerOAuthStart } from '../_shared/tiktok-shop-seller-start-handler.ts';
import type { SellerOAuthPersistence } from '../_shared/tiktok-shop-seller-flow.ts';

const workspaceA = '10000000-0000-0000-0000-000000000001';
const workspaceB = '10000000-0000-0000-0000-000000000002';

class Store implements SellerOAuthPersistence {
  created: Array<{ workspaceId: string; stateHash: string }> = [];
  deny = false;
  async createState(workspaceId: string, stateHash: string) {
    if (this.deny) throw new Error('forbidden');
    this.created.push({ workspaceId, stateHash });
  }
  async claimState() { throw new Error('not used'); }
  async failState() { throw new Error('not used'); }
  async completeAuthorization() { throw new Error('not used'); }
}

function request(body: unknown, token = 'valid-token', method = 'POST') {
  return new Request('https://example.test/functions/v1/tiktok-shop-seller-start', {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

function dependencies(store: Store, valid = true) {
  const validated: string[] = [];
  return {
    validated,
    dependencies: {
      enabled: true,
      validateToken: async (token: string) => { validated.push(token); return valid; },
      persistenceForUser: (token: string) => {
        assert.equal(token, 'valid-token');
        return store;
      },
      serviceId: () => 'trusted-service-id',
    },
  };
}

test('Seller start requires POST and a valid, non-expired JWT before any state work', async () => {
  const store = new Store();
  const missing = dependencies(store);
  assert.equal((await handleSellerOAuthStart(request({ workspace_id: workspaceA }, '', 'POST'), missing.dependencies)).status, 401);
  assert.equal(missing.validated.length, 0);

  const invalid = dependencies(store, false);
  assert.equal((await handleSellerOAuthStart(request({ workspace_id: workspaceA }, 'expired-token'), invalid.dependencies)).status, 401);
  assert.deepEqual(invalid.validated, ['expired-token']);
  assert.equal(store.created.length, 0);

  const method = dependencies(store);
  assert.equal((await handleSellerOAuthStart(request({}, 'valid-token', 'GET'), method.dependencies)).status, 405);
  assert.equal(method.validated.length, 0);
});

test('Seller start accepts only workspace UUID and uses trusted backend service id', async () => {
  const store = new Store();
  const { dependencies: d } = dependencies(store);
  const response = await handleSellerOAuthStart(request({
    workspace_id: workspaceA,
    service_id: 'browser-controlled-value',
    redirect_uri: 'https://evil.invalid',
    app_secret: 'must-not-be-used',
  }), d);
  assert.equal(response.status, 200);
  const body = await response.json() as { authorization_url?: string };
  const url = new URL(body.authorization_url);
  assert.equal(url.searchParams.get('service_id'), 'trusted-service-id');
  assert.equal(url.searchParams.has('redirect_uri'), false);
  assert.equal(body.authorization_url?.includes('must-not-be-used'), false);
  assert.equal(store.created.length, 1);
  assert.equal(store.created[0].workspaceId, workspaceA);
  assert.notEqual(store.created[0].stateHash, url.searchParams.get('state'));
  assert.match(store.created[0].stateHash, /^[a-f0-9]{64}$/);

  const invalidWorkspace = await handleSellerOAuthStart(request({ workspace_id: 'not-a-uuid' }), d);
  assert.equal(invalidWorkspace.status, 400);
});

test('Seller start creates independent states and does not disclose permission failures', async () => {
  const store = new Store();
  const { dependencies: d } = dependencies(store);
  const first = await handleSellerOAuthStart(request({ workspace_id: workspaceA }), d);
  const second = await handleSellerOAuthStart(request({ workspace_id: workspaceA }), d);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(store.created[0].stateHash, store.created[1].stateHash);

  store.deny = true;
  const denied = await handleSellerOAuthStart(request({ workspace_id: workspaceB }), d);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: 'seller_oauth_start_failed' });
});

test('Seller start remains completely unavailable while the feature is disabled', async () => {
  const store = new Store();
  const { dependencies: d, validated } = dependencies(store);
  const response = await handleSellerOAuthStart(request({ workspace_id: workspaceA }), { ...d, enabled: false });
  assert.equal(response.status, 404);
  assert.equal(validated.length, 0);
  assert.equal(store.created.length, 0);
});
