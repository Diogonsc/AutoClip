import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { b64encode, decryptToken, encryptToken, importKey } from '../_shared/crypto.ts';
import { freshShopToken } from '../_shared/tiktok-shop-tokens.ts';
import { fetchShopOAuth } from '../_shared/tiktok-shop-oauth.ts';
import type { SbClient } from '../_shared/supabase-db.ts';

const key = await importKey(b64encode(crypto.getRandomValues(new Uint8Array(32))));
const expires = () => new Date(Date.now() + 60_000).toISOString();

function storeFor(id = 'shop-1') {
  const row: Record<string, unknown> = {
    id, workspace_id: 'ws-a', channel_id: 'ch-a', connection_status: 'CONNECTED', refresh_state: 'READY', token_version: 1,
    encrypted_access_token: 'old-access-cipher', encrypted_refresh_token: 'old-refresh-cipher',
    access_token_expires_at: new Date(Date.now() - 1_000).toISOString(), refresh_token_expires_at: expires(), granted_scopes: ['shop.read'],
  };
  const calls: string[] = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push(name);
      if (name === 'acquire_tiktok_shop_token_refresh') {
        if (row.refresh_state === 'IN_FLIGHT') return { data: { state: 'BUSY' }, error: null };
        row.refresh_state = 'IN_FLIGHT'; row.refresh_attempt_id = args.p_attempt;
        return { data: { state: 'ACQUIRED', token_version: row.token_version, connection: { ...row } }, error: null };
      }
      if (name === 'complete_tiktok_shop_token_refresh') {
        if (row.refresh_state !== 'IN_FLIGHT' || row.refresh_attempt_id !== args.p_attempt || row.token_version !== args.p_token_version) return { data: false, error: null };
        Object.assign(row, { encrypted_access_token: args.p_enc_access, encrypted_refresh_token: args.p_enc_refresh, access_token_expires_at: args.p_access_exp, refresh_token_expires_at: args.p_refresh_exp, token_version: Number(row.token_version) + 1, refresh_state: 'READY' });
        return { data: true, error: null };
      }
      if (name === 'fail_tiktok_shop_token_refresh') {
        if (row.refresh_state === 'IN_FLIGHT' && row.refresh_attempt_id === args.p_attempt) { row.refresh_state = 'REAUTH_REQUIRED'; row.connection_status = 'REAUTH_REQUIRED'; }
        return { data: true, error: null };
      }
      return { data: null, error: { message: 'unknown rpc' } };
    },
    from() {
      return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: row, error: null }) };
    },
  } as unknown as SbClient;
  return { client, row, calls };
}

async function initializedStore(id = 'shop-1') {
  const store = storeFor(id);
  store.row.encrypted_access_token = await encryptToken(key, 'old-access', id);
  store.row.encrypted_refresh_token = await encryptToken(key, 'old-refresh', id);
  return store;
}

test('Shop 2/10 concorrentes usam uma única rotação e recebem access token persistido', async () => {
  for (const count of [2, 10]) {
    const { client, row } = await initializedStore(); let requests = 0; let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fakeFetch: typeof fetch = async () => {
      requests++; await gate;
      return new Response(JSON.stringify({ code: 0, data: { access_token: 'new-access', refresh_token: 'new-refresh', access_token_expire_in: 7200, refresh_token_expire_in: 15_552_000 } }));
    };
    const workers = Array.from({ length: count }, () => freshShopToken(client, { ...row }, 'shop-1', key, (name) => name, Date.now, fakeFetch));
    await new Promise((resolve) => setTimeout(resolve, 40)); release();
    const results = await Promise.all(workers);
    assert.equal(requests, 1);
    assert.deepEqual(new Set(results), new Set(['new-access']));
    assert.equal(row.token_version, 2);
    assert.equal(row.refresh_state, 'READY');
    assert.equal(await decryptToken(key, String(row.encrypted_refresh_token), 'shop-1'), 'new-refresh');
  }
});

test('Shop rotação ambígua não reutiliza refresh token anterior e não vaza token no erro', async () => {
  const { client, row } = await initializedStore(); let requests = 0;
  const fakeFetch: typeof fetch = async () => { requests++; throw new Error('sensitive socket internals'); };
  await assert.rejects(freshShopToken(client, { ...row }, 'shop-1', key, (name) => name, Date.now, fakeFetch), /resultado indeterminado/);
  assert.equal(row.refresh_state, 'REAUTH_REQUIRED');
  assert.equal(requests, 1);
});

test('Shop não aceita resposta sem refresh token rotacionado', async () => {
  const { client, row } = await initializedStore();
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({ code: 0, data: { access_token: 'new-access', access_token_expire_in: 7200, refresh_token_expire_in: 15_552_000 } }));
  await assert.rejects(freshShopToken(client, { ...row }, 'shop-1', key, (name) => name, Date.now, fakeFetch), /resultado indeterminado/);
  assert.equal(row.refresh_state, 'REAUTH_REQUIRED');
});

test('Shop OAuth pins its credential-bearing GET destination and rejects redirects', async () => {
  let observedRedirect: RequestRedirect | undefined;
  const response = await fetchShopOAuth(
    new URL('https://auth.tiktok-shops.com/api/v2/token/refresh?app_secret=synthetic&refresh_token=fake'),
    {},
    async (_input, init) => {
      observedRedirect = init?.redirect;
      return new Response('{}');
    },
  );
  assert.equal(response.status, 200);
  assert.equal(observedRedirect, 'error');
  await assert.rejects(fetchShopOAuth(new URL('https://attacker.invalid/api/v2/token/refresh?refresh_token=fake')),
    /destination guard/);
  await assert.rejects(fetchShopOAuth(new URL('https://auth.tiktok-shops.com.evil.invalid/api/v2/token/refresh?refresh_token=fake')),
    /destination guard/);
});
