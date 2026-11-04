import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { b64encode, decryptToken, encryptToken, importKey } from '../_shared/crypto.ts';
import { ensureAccessToken, type RefreshClaim, type TokenStore } from '../_shared/tokens.ts';
import { TikTokError } from '../_shared/tiktok.ts';
import type { Connection } from '../_shared/types.ts';

const key = await importKey(b64encode(crypto.getRandomValues(new Uint8Array(32))));
const encrypted = new Map<string, { access: string; refresh: string }>();
for (const id of ['ch', 'other', 'foreign']) encrypted.set(id, {
  access: await encryptToken(key, `access-old-${id}`, id),
  refresh: await encryptToken(key, `refresh-old-${id}`, id),
});
const future = new Date(Date.now() + 86_400_000).toISOString();
const expired = new Date(Date.now() - 1_000).toISOString();

class MemoryStore implements TokenStore {
  rows = new Map<string, Connection>();
  attempts = new Map<string, { attempt: string; version: number }>();
  failPersist = false;
  constructor(channels = ['ch']) {
    for (const channel of channels) this.rows.set(channel, {
      channel_id: channel, workspace_id: channel === 'foreign' ? 'workspace-b' : 'workspace-a',
      encrypted_access_token: encrypted.get(channel)!.access, encrypted_refresh_token: encrypted.get(channel)!.refresh,
      access_token_expires_at: expired, refresh_token_expires_at: future, granted_scopes: ['user.info.basic'],
      refresh_state: 'READY', token_version: 1,
    });
  }
  async getConnection(id: string) { const row = this.rows.get(id); return row ? structuredClone(row) : null; }
  async acquireRefresh(a: { channelId: string; workspaceId: string; attemptId: string }): Promise<RefreshClaim> {
    const row = this.rows.get(a.channelId);
    if (!row || row.workspace_id !== a.workspaceId) return { state: 'NOT_FOUND' };
    if (row.refresh_state === 'REAUTH_REQUIRED') return { state: 'REAUTH_REQUIRED' };
    if (row.refresh_state === 'IN_FLIGHT') return { state: 'BUSY' };
    if (!row.encrypted_refresh_token || !row.refresh_token_expires_at || Date.parse(row.refresh_token_expires_at) <= Date.now()) {
      row.refresh_state = 'REAUTH_REQUIRED'; return { state: 'REAUTH_REQUIRED' };
    }
    row.refresh_state = 'IN_FLIGHT';
    this.attempts.set(a.channelId, { attempt: a.attemptId, version: row.token_version });
    return { state: 'ACQUIRED', connection: structuredClone(row), token_version: row.token_version };
  }
  async completeRefresh(a: { channelId: string; workspaceId: string; attemptId: string; tokenVersion: number; encAccess: string; encRefresh: string; accessExp: Date; refreshExp: Date; scopes: string[] }) {
    if (this.failPersist) throw new Error('db unavailable');
    const row = this.rows.get(a.channelId); const current = this.attempts.get(a.channelId);
    if (!row || row.workspace_id !== a.workspaceId || row.refresh_state !== 'IN_FLIGHT' || !current || current.attempt !== a.attemptId || current.version !== a.tokenVersion) return false;
    Object.assign(row, { encrypted_access_token: a.encAccess, encrypted_refresh_token: a.encRefresh, access_token_expires_at: a.accessExp.toISOString(), refresh_token_expires_at: a.refreshExp.toISOString(), granted_scopes: a.scopes, token_version: row.token_version + 1, refresh_state: 'READY' as const });
    this.attempts.delete(a.channelId); return true;
  }
  async failRefresh(a: { channelId: string; workspaceId: string; attemptId: string; tokenVersion: number; code: string }) {
    const row = this.rows.get(a.channelId); const current = this.attempts.get(a.channelId);
    if (!row || row.workspace_id !== a.workspaceId || !current || current.attempt !== a.attemptId || current.version !== a.tokenVersion) return false;
    row.refresh_state = 'REAUTH_REQUIRED'; this.attempts.delete(a.channelId); return true;
  }
}

function ctx(store: MemoryStore, refresh: (token: string) => Promise<{ accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number; openId: string; scopes: string[] }>, ids?: string[]) {
  let i = 0;
  return { store, tiktok: { refreshAccessToken: async (_cfg: unknown, token: string) => refresh(token) }, cfg: { clientKey: 'fake', clientSecret: 'fake' }, key, now: () => new Date(), newId: () => ids?.[i++] ?? `attempt-${++i}` } as Parameters<typeof ensureAccessToken>[0];
}

const success = async (token: string) => ({ accessToken: `access-${token}`, refreshToken: `rotated-${token}`, expiresIn: 7200, refreshExpiresIn: 15_552_000, openId: 'open-id', scopes: ['user.info.basic'] });

test('two and ten workers share one refresh; losers reuse committed access token', async () => {
  for (const count of [2, 10]) {
    const store = new MemoryStore(); let calls = 0; let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const context = ctx(store, async (token) => { calls++; await barrier; return success(token); }, Array.from({ length: count }, (_, i) => `a-${count}-${i}`));
    const workers = Array.from({ length: count }, () => ensureAccessToken(context, 'ch'));
    await new Promise((resolve) => setTimeout(resolve, 30)); release();
    const results = await Promise.all(workers);
    assert.equal(calls, 1);
    assert.ok(results.every((result) => result === 'access-refresh-old-ch'));
    assert.equal(store.rows.get('ch')?.token_version, 2);
    assert.equal(store.rows.get('ch')?.encrypted_refresh_token?.startsWith('v1:'), true);
  }
});

test('different workspaces/connections renew independently', async () => {
  const store = new MemoryStore(['ch', 'other']); let calls = 0;
  const context = ctx(store, async (token) => { calls++; return success(token); }, ['one', 'two']);
  await Promise.all([ensureAccessToken(context, 'ch'), ensureAccessToken(context, 'other')]);
  assert.equal(calls, 2);
  assert.equal(store.rows.get('ch')?.workspace_id, 'workspace-a');
  assert.equal(store.rows.get('other')?.workspace_id, 'workspace-a');
});

test('old attempt cannot overwrite a newer token generation', async () => {
  const store = new MemoryStore();
  const claim = await store.acquireRefresh({ channelId: 'ch', workspaceId: 'workspace-a', attemptId: 'old' });
  assert.equal(claim.state, 'ACQUIRED');
  const row = store.rows.get('ch')!; row.refresh_state = 'READY'; row.token_version = 2; row.encrypted_access_token = 'newer';
  assert.equal(await store.completeRefresh({ channelId: 'ch', workspaceId: 'workspace-a', attemptId: 'old', tokenVersion: 1, encAccess: 'stale', encRefresh: 'stale', accessExp: new Date(Date.now() + 10_000), refreshExp: new Date(Date.now() + 20_000), scopes: [] }), false);
  assert.equal(row.encrypted_access_token, 'newer');
});

test('late ambiguous failure after reauthorization cannot overwrite the new channel state', async () => {
  const store = new MemoryStore();
  let rejectRefresh!: (error: Error) => void;
  const pending = new Promise<never>((_resolve, reject) => { rejectRefresh = reject; });
  const context = ctx(store, () => pending, ['stale-attempt']);
  const refreshing = ensureAccessToken(context, 'ch');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const row = store.rows.get('ch')!;
  row.encrypted_access_token = await encryptToken(key, 'access-after-reauth', 'ch');
  row.encrypted_refresh_token = await encryptToken(key, 'refresh-after-reauth', 'ch');
  row.token_version = 2;
  row.refresh_state = 'READY';
  store.attempts.delete('ch');
  rejectRefresh(new Error('timeout after remote request may have been accepted'));
  await assert.rejects(refreshing, (e) => e instanceof TikTokError && e.code === 'REFRESH_OUTCOME_UNKNOWN');
  assert.equal(row.token_version, 2);
  assert.equal(row.refresh_state, 'READY');
  assert.equal(await decryptToken(key, row.encrypted_refresh_token!, 'ch'), 'refresh-after-reauth');
});

test('late successful response after reauthorization returns persisted generation without overwriting it', async () => {
  const store = new MemoryStore();
  let finishRefresh!: (value: Awaited<ReturnType<typeof success>>) => void;
  const pending = new Promise<Awaited<ReturnType<typeof success>>>((resolve) => { finishRefresh = resolve; });
  const context = ctx(store, () => pending, ['stale-success']);
  const refreshing = ensureAccessToken(context, 'ch');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const row = store.rows.get('ch')!;
  row.encrypted_access_token = await encryptToken(key, 'access-after-reauth', 'ch');
  row.encrypted_refresh_token = await encryptToken(key, 'refresh-after-reauth', 'ch');
  row.access_token_expires_at = future;
  row.token_version = 2;
  row.refresh_state = 'READY';
  store.attempts.delete('ch');
  finishRefresh({ ...await success('stale-worker'), accessToken: 'stale-worker-access' });
  assert.equal(await refreshing, 'access-after-reauth');
  assert.equal(row.token_version, 2);
  assert.equal(await decryptToken(key, row.encrypted_refresh_token!, 'ch'), 'refresh-after-reauth');
});

test('ambiguous provider error never retries the old refresh token and marks reauth', async () => {
  const store = new MemoryStore(); let calls = 0;
  const context = ctx(store, async () => { calls++; throw new Error('socket timeout'); });
  await assert.rejects(ensureAccessToken(context, 'ch'), (e) => e instanceof TikTokError && e.code === 'REFRESH_OUTCOME_UNKNOWN');
  assert.equal(store.rows.get('ch')?.refresh_state, 'REAUTH_REQUIRED');
  await assert.rejects(ensureAccessToken(context, 'ch'), TikTokError);
  assert.equal(calls, 1);
});

test('successful provider rotation without a new refresh token is rejected', async () => {
  const store = new MemoryStore(); const context = ctx(store, async () => ({ accessToken: 'a', refreshToken: '', expiresIn: 7200, refreshExpiresIn: 1, openId: 'open-id', scopes: [] }));
  await assert.rejects(ensureAccessToken(context, 'ch'), TikTokError);
  assert.equal(store.rows.get('ch')?.refresh_state, 'REAUTH_REQUIRED');
  assert.equal(store.rows.get('ch')?.encrypted_refresh_token, encrypted.get('ch')!.refresh);
});

test('refresh token expiration and missing connection do not call provider', async () => {
  const store = new MemoryStore(); let calls = 0;
  const context = ctx(store, async () => { calls++; return success('x'); });
  store.rows.get('ch')!.refresh_token_expires_at = expired;
  await assert.rejects(ensureAccessToken(context, 'ch'), TikTokError);
  store.rows.get('ch')!.refresh_token_expires_at = null;
  await assert.rejects(ensureAccessToken(context, 'ch'), TikTokError);
  await assert.rejects(ensureAccessToken(context, 'absent'), TikTokError);
  assert.equal(calls, 0);
});

test('stale IN_FLIGHT attempt is not reclaimed and requires reauthorization', async () => {
  const store = new MemoryStore(); const row = store.rows.get('ch')!; row.refresh_state = 'IN_FLIGHT';
  let calls = 0; const context = ctx(store, async () => { calls++; return success('x'); });
  // The SQL lease owns the timeout transition. This fake reports REAUTH_REQUIRED for an expired claim.
  store.acquireRefresh = async () => { row.refresh_state = 'REAUTH_REQUIRED'; return { state: 'REAUTH_REQUIRED' }; };
  await assert.rejects(ensureAccessToken(context, 'ch'), TikTokError);
  assert.equal(calls, 0);
});

test('persistence response failure does not expose tokens and becomes reauthorization', async () => {
  const store = new MemoryStore(); store.failPersist = true; let calls = 0;
  const context = ctx(store, async (token) => { calls++; return success(token); });
  await assert.rejects(ensureAccessToken(context, 'ch'), TikTokError);
  assert.equal(store.rows.get('ch')?.refresh_state, 'REAUTH_REQUIRED');
  assert.equal(calls, 1);
});

test('channel/workspace binding is checked before remote refresh', async () => {
  const store = new MemoryStore(['foreign']); let calls = 0;
  const context = ctx(store, async () => { calls++; return success('x'); });
  const original = store.getConnection.bind(store);
  store.getConnection = async (id) => { const row = await original(id); return row ? { ...row, workspace_id: 'workspace-a' } : null; };
  await assert.rejects(ensureAccessToken(context, 'foreign'), TikTokError);
  assert.equal(calls, 0);
});

test('refresh lease database error before provider call leaves provider untouched', async () => {
  const store = new MemoryStore(); store.acquireRefresh = async () => { throw new Error('rpc unavailable'); };
  let calls = 0; const context = ctx(store, async () => { calls++; return success('x'); });
  await assert.rejects(ensureAccessToken(context, 'ch'));
  assert.equal(calls, 0);
});
