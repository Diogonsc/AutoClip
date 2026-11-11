import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';
import {
  decryptSellerCredential,
  encryptSellerCredential,
  importSellerCredentialKey,
  SellerCredentialError,
} from '../_shared/tiktok-shop-seller-crypto.ts';
import {
  completeSellerOAuthCallback,
  startSellerOAuth,
  SellerOAuthFlowError,
  type SellerOAuthPersistence,
} from '../_shared/tiktok-shop-seller-flow.ts';
import type { SellerTokens } from '../_shared/tiktok-shop-seller-oauth.ts';
import { createSellerOAuthPersistence } from '../_shared/tiktok-shop-seller-persistence.ts';

const workspaceA = '10000000-0000-0000-0000-000000000001';
const connectionA = '20000000-0000-0000-0000-000000000001';
const key = await importSellerCredentialKey('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=');

const tokens: SellerTokens = {
  accessToken: 'access-secret',
  refreshToken: 'refresh-secret',
  accessExpiresAt: '2033-05-18T03:33:20.000Z',
  refreshExpiresAt: '2033-05-18T04:33:20.000Z',
  openId: 'seller-open-id',
  sellerName: 'Sandbox seller',
  region: 'BR',
  scopes: ['seller.authorization.info', 'seller.product.basic'],
};

class Store implements SellerOAuthPersistence {
  readonly created: Array<{ workspaceId: string; stateHash: string }> = [];
  readonly failed: string[] = [];
  readonly completed: Array<Parameters<SellerOAuthPersistence['completeAuthorization']>[0]> = [];
  claimed = { id: '30000000-0000-0000-0000-000000000001', workspaceId: workspaceA, connectionId: null as string | null };
  claimError?: Error;

  async createState(workspaceId: string, stateHash: string): Promise<void> { this.created.push({ workspaceId, stateHash }); }
  async claimState() {
    if (this.claimError) throw this.claimError;
    return this.claimed;
  }
  async failState(stateId: string): Promise<void> { this.failed.push(stateId); }
  async completeAuthorization(input: Parameters<SellerOAuthPersistence['completeAuthorization']>[0]): Promise<void> {
    this.completed.push(input);
  }
}

describe('Seller credential encryption', () => {
  it('uses authenticated encryption with unique nonces and scoped AAD', async () => {
    const context = { workspaceId: workspaceA, connectionId: connectionA, kind: 'access' as const };
    const first = await encryptSellerCredential(key, 'secret', context);
    const second = await encryptSellerCredential(key, 'secret', context);
    assert.notEqual(first, second);
    assert.equal(await decryptSellerCredential(key, first, context), 'secret');
    await assert.rejects(
      () => decryptSellerCredential(key, first, { ...context, kind: 'refresh' }),
      SellerCredentialError,
    );
  });

  it('fails closed for missing keys, wrong keys, and modified ciphertext', async () => {
    const context = { workspaceId: workspaceA, connectionId: connectionA, kind: 'access' as const };
    await assert.rejects(() => importSellerCredentialKey(), SellerCredentialError);
    const cipher = await encryptSellerCredential(key, 'secret', context);
    const other = await importSellerCredentialKey('ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=');
    await assert.rejects(() => decryptSellerCredential(other, cipher, context), SellerCredentialError);
    await assert.rejects(() => decryptSellerCredential(key, `${cipher}x`, context), SellerCredentialError);
  });
});

describe('local Seller OAuth flow', () => {
  it('uses user-scoped creation and backend-only claim/completion RPCs', async () => {
    const userCalls: string[] = [];
    const backendCalls: string[] = [];
    const persistence = createSellerOAuthPersistence(
      { rpc: async (name) => { userCalls.push(name); return { data: 'state-id', error: null }; } },
      {
        rpc: async (name) => {
          backendCalls.push(name);
          if (name === 'claim_seller_oauth_state') {
            return { data: { id: 'state-id', workspace_id: workspaceA, connection_id: null }, error: null };
          }
          return { data: connectionA, error: null };
        },
      },
    );
    await persistence.createState(workspaceA, 'hash');
    const claim = await persistence.claimState('hash');
    await persistence.completeAuthorization({
      stateId: claim.id, workspaceId: workspaceA, connectionId: connectionA, openId: 'seller', scopes: [],
      encryptedAccessToken: 'cipher', encryptedRefreshToken: 'cipher',
      accessExpiresAt: tokens.accessExpiresAt, refreshExpiresAt: tokens.refreshExpiresAt, keyVersion: 1,
    });
    assert.deepEqual(userCalls, ['create_seller_oauth_state']);
    assert.deepEqual(backendCalls, ['claim_seller_oauth_state', 'complete_seller_oauth_authorization']);
  });

  it('starts only when enabled and stores a hash rather than raw state', async () => {
    const store = new Store();
    const result = await startSellerOAuth(workspaceA, {
      enabled: true,
      serviceId: 'service-id-from-backend',
      persistence: store,
      state: () => 'raw-state-only-in-browser',
    });
    assert.equal(result.authorizationUrl.startsWith('https://services.tiktokshop.com/open/authorize?'), true);
    assert.equal(new URL(result.authorizationUrl).searchParams.get('service_id'), 'service-id-from-backend');
    assert.equal(store.created.length, 1);
    assert(store.created[0].stateHash !== result.state);

    await assert.rejects(
      () => startSellerOAuth(workspaceA, { enabled: false, serviceId: 'ignored', persistence: store }),
      SellerOAuthFlowError,
    );
    assert.equal(store.created.length, 1);
  });

  it('completes a mock exchange atomically with ciphertext only', async () => {
    const store = new Store();
    const result = await completeSellerOAuthCallback({ state: 'valid-state', code: 'authorization-code' }, {
      enabled: true,
      persistence: store,
      encryptionKey: key,
      connectionId: () => connectionA,
      exchangeCode: async (code) => {
        assert.equal(code, 'authorization-code');
        return tokens;
      },
    });
    assert.equal(result.connectionId, connectionA);
    assert.equal(store.completed.length, 1);
    const saved = store.completed[0];
    assert(!saved.encryptedAccessToken.includes(tokens.accessToken));
    assert(!saved.encryptedRefreshToken.includes(tokens.refreshToken));
    assert.equal(await decryptSellerCredential(key, saved.encryptedAccessToken, {
      workspaceId: workspaceA, connectionId: connectionA, kind: 'access',
    }), tokens.accessToken);
  });

  it('marks a claimed state failed after denial or exchange failure without replay', async () => {
    const denied = new Store();
    await assert.rejects(
      () => completeSellerOAuthCallback({ state: 's', error: 'access_denied' }, {
        enabled: true, persistence: denied, encryptionKey: key, exchangeCode: async () => tokens,
      }),
      SellerOAuthFlowError,
    );
    assert.deepEqual(denied.failed, [denied.claimed.id]);

    const failed = new Store();
    await assert.rejects(
      () => completeSellerOAuthCallback({ state: 's', code: 'bad-code' }, {
        enabled: true, persistence: failed, encryptionKey: key,
        exchangeCode: async () => { throw new Error('access_token=must-not-leak'); },
      }),
      SellerOAuthFlowError,
    );
    assert.deepEqual(failed.failed, [failed.claimed.id]);
    assert.equal(failed.completed.length, 0);

    const replay = new Store();
    replay.claimError = new Error('consumed state');
    await assert.rejects(
      () => completeSellerOAuthCallback({ state: 'replay', code: 'x' }, {
        enabled: true, persistence: replay, encryptionKey: key, exchangeCode: async () => tokens,
      }),
    );
    assert.equal(replay.completed.length, 0);
  });

  it('rejects a Seller token with missing required scopes before persistence', async () => {
    for (const scopes of [['seller.product.basic'], ['seller.authorization.info']]) {
      const store = new Store();
      await assert.rejects(
        () => completeSellerOAuthCallback({ state: 's', code: 'code' }, {
          enabled: true, persistence: store, encryptionKey: key,
          exchangeCode: async () => ({ ...tokens, scopes }),
        }),
        SellerOAuthFlowError,
      );
      assert.equal(store.completed.length, 0);
      assert.deepEqual(store.failed, [store.claimed.id]);
    }
  });

  it('does not start external work when the feature remains disabled', async () => {
    const store = new Store();
    let exchanged = false;
    await assert.rejects(
      () => completeSellerOAuthCallback({ state: 's', code: 'c' }, {
        enabled: false, persistence: store, encryptionKey: key,
        exchangeCode: async () => { exchanged = true; return tokens; },
      }),
      SellerOAuthFlowError,
    );
    assert.equal(exchanged, false);
    assert.equal(store.failed.length, 0);
  });
});
