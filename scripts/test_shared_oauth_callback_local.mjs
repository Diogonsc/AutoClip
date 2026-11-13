import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { classifySharedTikTokOAuthState } from '../supabase/functions/_shared/tiktok-shared-oauth-classifier.ts';
import { TIKTOK_SHOP_ENABLED } from '../supabase/functions/_shared/tiktok-shop-availability.ts';

function envFrom(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const index = line.indexOf('=');
    return index < 0 ? [] : [[line.slice(0, index), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')]];
  }));
}

function localUrl(value, label) {
  const host = new URL(value).hostname;
  assert(['localhost', '127.0.0.1', '::1'].includes(host), `${label} não é local; teste abortado`);
}

const status = envFrom(execFileSync('supabase', ['status', '-o', 'env'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
}));
assert(status.API_URL && status.ANON_KEY && status.SERVICE_ROLE_KEY, 'Supabase local não forneceu credenciais de teste');
localUrl(status.API_URL, 'Supabase API');

const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const suffix = randomBytes(6).toString('hex');
const email = `shared-oauth-${suffix}@example.test`;
const password = `SharedOAuth-${randomBytes(18).toString('hex')}!`;
let userId;
let workspaceId;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function lookup(table, column, value, extra = (query) => query) {
  const result = await extra(admin.from(table).select('*').eq(column, value)).maybeSingle();
  if (result.error) throw new Error(`consulta local ${table} falhou: ${result.error.code ?? 'unknown'}`);
  return { found: Boolean(result.data), failed: Boolean(result.error) };
}

try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: 'Shared OAuth local fixture' } });
  assert.equal(created.error, null, 'não criou usuário local');
  userId = created.data.user.id;

  const membership = await admin.from('workspace_members').select('workspace_id').eq('user_id', userId).single();
  assert.equal(membership.error, null, 'usuário não recebeu workspace local');
  workspaceId = membership.data.workspace_id;

  const loginClient = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await loginClient.auth.signInWithPassword({ email, password });
  assert.equal(login.error, null, 'login local falhou');
  const user = createClient(status.API_URL, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${login.data.session.access_token}` } },
  });

  const channelId = randomUUID();
  const channel = await admin.from('channels').insert({ id: channelId, workspace_id: workspaceId, display_name: `Shared OAuth ${suffix}` });
  assert.equal(channel.error, null, 'canal Content Posting local não criado');

  const contentCreated = await user.rpc('create_oauth_state', { p_channel: channelId, p_base_scopes: ['user.info.basic'] });
  assert.equal(contentCreated.error, null, 'state Content Posting não criado pelo cliente autenticado');
  const contentState = contentCreated.data.state;

  const sellerState = `seller-${randomUUID()}`;
  const sellerCreated = await user.rpc('create_seller_oauth_state', {
    p_workspace: workspaceId,
    p_state_hash: sha256(sellerState),
    p_connection: null,
  });
  assert.equal(sellerCreated.error, null, 'state Seller não criado pelo cliente autenticado');

  const database = {
    contentState: (state) => lookup('oauth_states', 'state', state, (query) => query.gt('expires_at', new Date().toISOString())),
    sellerState: (hash) => lookup('seller_oauth_states', 'state_hash', hash, (query) => query.eq('status', 'PENDING').gt('expires_at', new Date().toISOString())),
  };
  assert.equal(await classifySharedTikTokOAuthState(contentState, database), 'content_posting', 'service_role não classificou state Content');
  assert.equal(await classifySharedTikTokOAuthState(sellerState, database), 'seller', 'service_role não classificou state Seller');
  assert.equal(await classifySharedTikTokOAuthState(`unknown-${suffix}`, database), 'unknown', 'state desconhecido não foi rejeitado');

  const expiredState = `expired-${suffix}`;
  const expired = await admin.from('seller_oauth_states').insert({
    workspace_id: workspaceId,
    initiated_by: userId,
    state_hash: sha256(expiredState),
    created_at: new Date(Date.now() - 120_000).toISOString(),
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  });
  assert.equal(expired.error, null, 'fixture expirada não criada');
  assert.equal(await classifySharedTikTokOAuthState(expiredState, database), 'unknown', 'state Seller expirado foi classificado');

  const ambiguousState = `ambiguous-${suffix}`;
  const ambiguousContent = await admin.from('oauth_states').insert({
    state: ambiguousState,
    workspace_id: workspaceId,
    channel_id: channelId,
    user_id: userId,
    required_scopes: [],
  });
  assert.equal(ambiguousContent.error, null, 'fixture Content ambígua não criada');
  const ambiguousSeller = await admin.from('seller_oauth_states').insert({
    workspace_id: workspaceId,
    initiated_by: userId,
    state_hash: sha256(ambiguousState),
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  });
  assert.equal(ambiguousSeller.error, null, 'fixture Seller ambígua não criada');
  assert.equal(await classifySharedTikTokOAuthState(ambiguousState, database), 'ambiguous', 'colisão não foi bloqueada');

  // Reuse the state created through the authenticated start path. The local
  // start hardening permits only one active attempt per user/workspace.
  const claimed = await admin.rpc('claim_seller_oauth_state', { p_state_hash: sha256(sellerState) });
  assert.equal(claimed.error, null, 'service_role não fez claim Seller');
  const completed = await admin.rpc('complete_seller_oauth_authorization', {
    p_state: claimed.data.id,
    p_connection: randomUUID(),
    p_open_id: `seller-${suffix}`,
    p_name: 'Local seller fixture',
    p_region: 'BR',
    p_scopes: ['seller.authorization.info', 'seller.product.basic'],
    p_enc_access: 'ciphertext-access-fixture',
    p_enc_refresh: 'ciphertext-refresh-fixture',
    p_access_exp: new Date(Date.now() + 3_600_000).toISOString(),
    p_refresh_exp: new Date(Date.now() + 7_200_000).toISOString(),
    p_key_version: 1,
  });
  assert.equal(completed.error, null, 'conclusão transacional Seller falhou');
  const replay = await admin.rpc('claim_seller_oauth_state', { p_state_hash: sha256(sellerState) });
  assert.notEqual(replay.error, null, 'replay Seller foi aceito');

  const userStates = await user.from('seller_oauth_states').select('id').limit(1);
  assert.notEqual(userStates.error, null, 'usuário autenticado leu state Seller diretamente');
  const anonymous = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const anonymousCredentials = await anonymous.from('seller_credentials').select('connection_id').limit(1);
  assert.notEqual(anonymousCredentials.error, null, 'anon leu credenciais Seller');
  assert.equal(TIKTOK_SHOP_ENABLED, false, 'feature flag Shop deve permanecer desativada');

  process.stdout.write('Shared OAuth local integration passou: service_role classificou states, callback Seller foi concluído atomicamente e replay/RLS foram rejeitados.\n');
} finally {
  if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
}
