import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleCallback, handleChannel, handleWorker } from '../_shared/handlers.ts';
import type { ChannelHandlerDeps, WorkerHandlerDeps } from '../_shared/handlers.ts';
import { TikTokError } from '../_shared/tiktok.ts';
import { decryptToken, importKey } from '../_shared/crypto.ts';
import type { OAuthDeps } from '../_shared/oauth.ts';
import type { Channel } from '../_shared/types.ts';
import { CREATOR } from './helpers.ts';

const CH = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'https://app.example.com';
const KEY_B64 = Buffer.alloc(32, 7).toString('base64');

// ------------------------------------------------------------------ worker
function workerDeps(over: Partial<WorkerHandlerDeps> = {}) {
  const calls: string[] = [];
  const d: WorkerHandlerDeps = {
    secret: 's3cret',
    workerDeps: {
      db: {
        claimPollingJob: () => Promise.resolve(null),
        claimPublishJob: () => Promise.resolve(null),
      },
      now: () => new Date(),
    } as unknown as WorkerHandlerDeps['workerDeps'],
    acquireLease: () => {
      calls.push('acquire');
      return Promise.resolve(true);
    },
    releaseLease: () => {
      calls.push('release');
      return Promise.resolve();
    },
    newId: () => 'holder-1',
    budgetMs: 1000,
    log: () => {},
    ...over,
  };
  return { d, calls };
}
const post = (headers: Record<string, string> = {}) =>
  new Request('https://x.test/fn', { method: 'POST', headers });

test('worker: só aceita POST', async () => {
  const { d } = workerDeps();
  assert.equal((await handleWorker(new Request('https://x.test/fn'), d)).status, 405);
});

test('worker: segredo ausente ou errado -> 401 e nenhum lease', async () => {
  const { d, calls } = workerDeps();
  assert.equal((await handleWorker(post(), d)).status, 401);
  assert.equal((await handleWorker(post({ 'x-worker-secret': 'errado' }), d)).status, 401);
  assert.deepEqual(calls, []);
});

test('worker: segredo vazio configurado nunca autoriza', async () => {
  const { d } = workerDeps({ secret: '' });
  assert.equal((await handleWorker(post({ 'x-worker-secret': '' }), d)).status, 401);
});

test('worker: lease ocupado -> 202 busy, sem rodar', async () => {
  const { d, calls } = workerDeps({ acquireLease: () => Promise.resolve(false) });
  const r = await handleWorker(post({ 'x-worker-secret': 's3cret' }), d);
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { accepted: false, reason: 'busy' });
  assert.deepEqual(calls, []);
});

test('worker: sem background espera terminar e libera o lease', async () => {
  const { d, calls } = workerDeps();
  const r = await handleWorker(post({ 'x-worker-secret': 's3cret' }), d);
  assert.equal(r.status, 200);
  assert.deepEqual(calls, ['acquire', 'release']);
});

test('worker: com background responde 202 e libera o lease ao terminar', async () => {
  let bg: Promise<unknown> | null = null;
  const { d, calls } = workerDeps({ background: (w) => (bg = w) });
  const r = await handleWorker(post({ 'x-worker-secret': 's3cret' }), d);
  assert.equal(r.status, 202);
  await bg;
  assert.deepEqual(calls, ['acquire', 'release']);
});

test('worker: erro no processamento é registrado e o lease é liberado', async () => {
  const logs: string[] = [];
  const { d, calls } = workerDeps({
    log: (m) => void logs.push(m),
    workerDeps: {
      db: {
        claimPollingJob: () => Promise.reject(new Error('boom')),
        claimPublishJob: () => Promise.resolve(null),
      },
      now: () => new Date(),
    } as unknown as WorkerHandlerDeps['workerDeps'],
  });
  const r = await handleWorker(post({ 'x-worker-secret': 's3cret' }), d);
  assert.equal(r.status, 200);
  assert.deepEqual(calls, ['acquire', 'release']);
  assert.ok(logs.includes('worker.error'));
});

test('worker: falha ao liberar o lease não derruba a resposta', async () => {
  const { d } = workerDeps({ releaseLease: () => Promise.reject(new Error('x')) });
  assert.equal((await handleWorker(post({ 'x-worker-secret': 's3cret' }), d)).status, 200);
});

// ------------------------------------------------------------------ channel
interface Rec {
  rpcs: Array<{ auth: string; fn: string; args: Record<string, unknown> }>;
  disconnected: string[];
  saved: unknown[];
  revoked: string[];
  logs: string[];
}

function channelDeps(over: Partial<ChannelHandlerDeps> = {}, ch: Partial<Channel> | null = {}) {
  const rec: Rec = { rpcs: [], disconnected: [], saved: [], revoked: [], logs: [] };
  const channel: Channel | null =
    ch === null
      ? null
      : {
          id: CH,
          workspace_id: 'ws',
          connection_status: 'CONNECTED',
          provider_user_id: 'open-1',
          granted_scopes: ['user.info.basic', 'video.publish'],
          creator_info: null,
          ...ch,
        };
  const d: ChannelHandlerDeps = {
    origins: [ORIGIN],
    cfg: { clientKey: 'ck', clientSecret: 'cs' },
    redirectUri: 'https://proj.supabase.co/functions/v1/tiktok-oauth-callback',
    baseScopes: ['user.info.basic'],
    rpcAsUser: (auth, fn, args) => {
      rec.rpcs.push({ auth, fn, args });
      if (fn === 'create_oauth_state') {
        return Promise.resolve({
          data: { state: 'st-1', scopes: ['user.info.basic', 'video.upload'], publish_mode: 'INBOX' },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    ensureToken: () => Promise.resolve('access-tok'),
    tiktok: {
      queryCreatorInfo: () => Promise.resolve(CREATOR),
      revokeToken: (_cfg: unknown, tok: string) => {
        rec.revoked.push(tok);
        return Promise.resolve();
      },
    } as unknown as ChannelHandlerDeps['tiktok'],
    db: {
      getChannel: () => Promise.resolve(channel),
      saveCreatorInfo: (_id, info) => {
        rec.saved.push(info);
        return Promise.resolve();
      },
      disconnectChannel: (id) => {
        rec.disconnected.push(id);
        return Promise.resolve();
      },
    },
    log: (m) => void rec.logs.push(m),
    ...over,
  };
  return { d, rec };
}

const call = (body: unknown, headers: Record<string, string> = { authorization: 'Bearer jwt', origin: ORIGIN }, method = 'POST') =>
  new Request('https://x.test/fn', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });

test('channel: preflight OPTIONS devolve CORS só para origem permitida', async () => {
  const { d } = channelDeps();
  const ok = await handleChannel(new Request('https://x.test/fn', { method: 'OPTIONS', headers: { origin: ORIGIN } }), d);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  const bad = await handleChannel(new Request('https://x.test/fn', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }), d);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('channel: GET -> 405; sem Authorization -> 401; corpo inválido -> 400', async () => {
  const { d, rec } = channelDeps();
  assert.equal((await handleChannel(call(null, {}, 'GET'), d)).status, 405);
  assert.equal((await handleChannel(call({ action: 'connect', channel_id: CH }, {}), d)).status, 401);
  const h = { authorization: 'Bearer jwt' };
  assert.equal((await handleChannel(call('não é json', h), d)).status, 400);
  assert.equal((await handleChannel(call({ action: 'hack', channel_id: CH }, h), d)).status, 400);
  assert.equal((await handleChannel(call({ action: 'connect', channel_id: 'nao-uuid' }, h), d)).status, 400);
  assert.equal(rec.rpcs.length, 0, 'nada chega ao banco com pedido inválido');
});

test('channel: connect checa acesso "edit" com o JWT do usuário e devolve a URL do TikTok', async () => {
  const { d, rec } = channelDeps();
  const r = await handleChannel(call({ action: 'connect', channel_id: CH }), d);
  assert.equal(r.status, 200);
  const body = (await r.json()) as { url: string; publish_mode: string };
  assert.equal(body.publish_mode, 'INBOX');
  const u = new URL(body.url);
  assert.equal(u.origin + u.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
  assert.equal(u.searchParams.get('client_key'), 'ck');
  assert.equal(u.searchParams.get('state'), 'st-1');
  assert.equal(u.searchParams.get('scope'), 'user.info.basic,video.upload');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://proj.supabase.co/functions/v1/tiktok-oauth-callback');
  assert.equal(rec.rpcs[0].fn, 'assert_channel_access');
  assert.equal(rec.rpcs[0].auth, 'Bearer jwt');
  assert.equal(rec.rpcs[0].args.p_level, 'edit');
  assert.equal(rec.rpcs[1].fn, 'create_oauth_state');
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
});

test('channel: sem permissão (42501) -> 403 e não cria state; JWT inválido -> 401', async () => {
  const mk = (code: string) =>
    channelDeps({ rpcAsUser: () => Promise.resolve({ data: null, error: { code, message: 'x' } }) });
  const a = mk('42501');
  assert.equal((await handleChannel(call({ action: 'connect', channel_id: CH }), a.d)).status, 403);
  const b = mk('PGRST301');
  assert.equal((await handleChannel(call({ action: 'connect', channel_id: CH }), b.d)).status, 401);
  const c = mk('XX000');
  assert.equal((await handleChannel(call({ action: 'connect', channel_id: CH }), c.d)).status, 500);
});

test('channel: connect com falha ao criar o state -> 500', async () => {
  const { d } = channelDeps({
    rpcAsUser: (_a, fn) =>
      Promise.resolve(fn === 'assert_channel_access' ? { data: null, error: null } : { data: null, error: { message: 'x' } }),
  });
  assert.equal((await handleChannel(call({ action: 'connect', channel_id: CH }), d)).status, 500);
});

test('channel: creator_info exige canal conectado e escopo video.publish', async () => {
  const off = channelDeps({}, { connection_status: 'REAUTH_REQUIRED' });
  assert.equal((await handleChannel(call({ action: 'creator_info', channel_id: CH }), off.d)).status, 409);
  const none = channelDeps({}, null);
  assert.equal((await handleChannel(call({ action: 'creator_info', channel_id: CH }), none.d)).status, 409);
  const noScope = channelDeps({}, { granted_scopes: ['user.info.basic', 'video.upload'] });
  const r = await handleChannel(call({ action: 'creator_info', channel_id: CH }), noScope.d);
  assert.equal(r.status, 409);
  assert.equal(((await r.json()) as { error: string }).error, 'missing_scope');
});

test('channel: creator_info ok salva e devolve', async () => {
  const { d, rec } = channelDeps();
  const r = await handleChannel(call({ action: 'creator_info', channel_id: CH }), d);
  assert.equal(r.status, 200);
  assert.deepEqual(((await r.json()) as { creator_info: unknown }).creator_info, CREATOR);
  assert.deepEqual(rec.saved, [CREATOR]);
  assert.equal(rec.rpcs[0].args.p_level, 'edit');
});

test('channel: creator_info mapeia erros do TikTok (AUTH->409, rate limit->429, outros->502)', async () => {
  const mk = (e: TikTokError) =>
    channelDeps({
      tiktok: { queryCreatorInfo: () => Promise.reject(e), revokeToken: () => Promise.resolve() } as unknown as ChannelHandlerDeps['tiktok'],
    });
  const req = () => call({ action: 'creator_info', channel_id: CH });
  const auth = await handleChannel(req(), mk(new TikTokError('AUTH', 'access_token_invalid', 'x', 401)).d);
  assert.equal(auth.status, 409);
  assert.equal(((await auth.json()) as { error: string }).error, 'reauth_required');
  const rl = await handleChannel(req(), mk(new TikTokError('RATE_LIMIT', 'rate_limit_exceeded', 'x', 429)).d);
  assert.equal(rl.status, 429);
  const srv = await handleChannel(req(), mk(new TikTokError('SERVER', 'internal_error', 'x', 500)).d);
  assert.equal(srv.status, 502);
});

test('channel: disconnect exige nível admin, revoga e limpa o canal', async () => {
  const { d, rec } = channelDeps();
  const r = await handleChannel(call({ action: 'disconnect', channel_id: CH }), d);
  assert.equal(r.status, 200);
  assert.equal(rec.rpcs[0].args.p_level, 'admin');
  assert.deepEqual(rec.revoked, ['access-tok']);
  assert.deepEqual(rec.disconnected, [CH]);
});

test('channel: disconnect tolera falha na revogação e ainda apaga os tokens', async () => {
  const { d, rec } = channelDeps({
    ensureToken: () => Promise.reject(new TikTokError('AUTH', 'refresh_token_expired', 'x', 401)),
  });
  const r = await handleChannel(call({ action: 'disconnect', channel_id: CH }), d);
  assert.equal(r.status, 200);
  assert.deepEqual(rec.disconnected, [CH]);
  assert.ok(rec.logs.includes('channel.revoke_skipped'));
});

test('channel: disconnect sem permissão admin não toca no canal', async () => {
  const { d, rec } = channelDeps({
    rpcAsUser: () => Promise.resolve({ data: null, error: { code: '42501', message: 'x' } }),
  });
  assert.equal((await handleChannel(call({ action: 'disconnect', channel_id: CH }), d)).status, 403);
  assert.deepEqual(rec.disconnected, []);
  assert.deepEqual(rec.revoked, []);
});

test('channel: falha ao desconectar no banco -> 500 (não finge sucesso)', async () => {
  const { d } = channelDeps();
  d.db.disconnectChannel = () => Promise.reject(new Error('db'));
  assert.equal((await handleChannel(call({ action: 'disconnect', channel_id: CH }), d)).status, 500);
});

// ----------------------------------------------------------------- callback
async function oauthDeps(over: Partial<OAuthDeps> = {}) {
  const saved: Array<Parameters<OAuthDeps['saveConnection']>[0]> = [];
  const marks: string[] = [];
  const consumed: string[] = [];
  const key = await importKey(KEY_B64);
  const d: OAuthDeps = {
    tiktok: {
      exchangeCode: () =>
        Promise.resolve({
          accessToken: 'AT',
          refreshToken: 'RT',
          expiresIn: 86400,
          refreshExpiresIn: 31536000,
          openId: 'open-1',
          scopes: ['user.info.basic', 'video.upload'],
        }),
    },
    cfg: { clientKey: 'ck', clientSecret: 'cs' },
    redirectUri: 'https://proj/cb',
    key,
    now: () => new Date('2026-10-21T12:00:00Z'),
    consumeState: (s) => {
      consumed.push(s);
      return Promise.resolve(
        s === 'good' ? { workspace_id: 'ws', channel_id: CH, required_scopes: ['video.upload'] } : null,
      );
    },
    getChannel: () => Promise.resolve({ id: CH, provider_user_id: null }),
    saveConnection: (a) => {
      saved.push(a);
      return Promise.resolve('ok');
    },
    markChannel: (_id, status) => {
      marks.push(status);
      return Promise.resolve();
    },
    ...over,
  };
  return { d, saved, marks, consumed, key };
}

const cb = (qs: string) => new Request(`https://proj.supabase.co/functions/v1/tiktok-oauth-callback?${qs}`);
const loc = (r: Response) => r.headers.get('location');

test('callback: só GET', async () => {
  const { d } = await oauthDeps();
  const r = await handleCallback(new Request('https://x.test/cb', { method: 'POST' }), { oauth: d, webUrl: ORIGIN, log: () => {} });
  assert.equal(r.status, 405);
});

test('callback: sucesso cifra os tokens com AAD = canal e redireciona para /canais', async () => {
  const { d, saved, key } = await oauthDeps();
  const r = await handleCallback(cb('code=abc&state=good&scopes=user.info.basic,video.upload'), { oauth: d, webUrl: `${ORIGIN}/`, log: () => {} });
  assert.equal(r.status, 302);
  assert.equal(loc(r), `${ORIGIN}/canais?tiktok=connected`);
  assert.equal(saved.length, 1);
  const s = saved[0];
  assert.equal(s.channelId, CH);
  assert.equal(s.openId, 'open-1');
  assert.ok(s.encAccess.startsWith('v1:'));
  assert.ok(!s.encAccess.includes('AT') || s.encAccess !== 'AT');
  assert.equal(await decryptToken(key, s.encAccess, CH), 'AT');
  assert.equal(await decryptToken(key, s.encRefresh!, CH), 'RT');
  await assert.rejects(decryptToken(key, s.encAccess, 'outro-canal'), 'AAD amarra o token ao canal');
  assert.equal(s.accessExp.toISOString(), '2026-10-22T12:00:00.000Z');
});

test('callback: state inválido/ausente -> invalid_state, nada salvo', async () => {
  const { d, saved } = await oauthDeps();
  const deps = { oauth: d, webUrl: ORIGIN, log: () => {} };
  assert.equal(loc(await handleCallback(cb('code=abc&state=forjado'), deps)), `${ORIGIN}/canais?tiktok=invalid_state`);
  assert.equal(loc(await handleCallback(cb('code=abc'), deps)), `${ORIGIN}/canais?tiktok=invalid_state`);
  assert.equal(saved.length, 0);
});

test('callback: usuário negou -> denied, mas o state é consumido', async () => {
  const { d, saved, consumed } = await oauthDeps();
  const r = await handleCallback(cb('error=access_denied&state=good'), { oauth: d, webUrl: ORIGIN, log: () => {} });
  assert.equal(loc(r), `${ORIGIN}/canais?tiktok=denied`);
  assert.deepEqual(consumed, ['good']);
  assert.equal(saved.length, 0);
});

test('callback: escopo obrigatório não concedido -> missing_scope e canal bloqueado', async () => {
  const { d, saved, marks } = await oauthDeps({
    tiktok: {
      exchangeCode: () =>
        Promise.resolve({ accessToken: 'AT', refreshToken: 'RT', expiresIn: 1, refreshExpiresIn: null, openId: 'o', scopes: ['user.info.basic'] }),
    },
  });
  const r = await handleCallback(cb('code=abc&state=good'), { oauth: d, webUrl: ORIGIN, log: () => {} });
  assert.equal(loc(r), `${ORIGIN}/canais?tiktok=missing_scope`);
  assert.deepEqual(marks, ['PERMISSION_BLOCKED']);
  assert.equal(saved.length, 0);
});

test('callback: outra conta TikTok -> account_mismatch; troca de code falha -> error', async () => {
  const mism = await oauthDeps({ getChannel: () => Promise.resolve({ id: CH, provider_user_id: 'outra-conta' }) });
  const r1 = await handleCallback(cb('code=abc&state=good'), { oauth: mism.d, webUrl: ORIGIN, log: () => {} });
  assert.equal(loc(r1), `${ORIGIN}/canais?tiktok=account_mismatch`);
  assert.equal(mism.saved.length, 0);

  const fail = await oauthDeps({
    tiktok: { exchangeCode: () => Promise.reject(new TikTokError('AUTH', 'invalid_grant', 'x', 400)) },
  });
  const r2 = await handleCallback(cb('code=abc&state=good'), { oauth: fail.d, webUrl: ORIGIN, log: () => {} });
  assert.equal(loc(r2), `${ORIGIN}/canais?tiktok=error`);
});

test('callback: conta já usada em outro canal -> duplicate', async () => {
  const { d } = await oauthDeps({ saveConnection: () => Promise.resolve('duplicate') });
  const r = await handleCallback(cb('code=abc&state=good'), { oauth: d, webUrl: ORIGIN, log: () => {} });
  assert.equal(loc(r), `${ORIGIN}/canais?tiktok=duplicate`);
});

test('callback: exceção inesperada vira redirect error (sem vazar detalhes)', async () => {
  const { d } = await oauthDeps({ consumeState: () => Promise.reject(new Error('segredo interno')) });
  const r = await handleCallback(cb('code=abc&state=good'), { oauth: d, webUrl: ORIGIN, log: () => {} });
  assert.equal(r.status, 302);
  assert.equal(loc(r), `${ORIGIN}/canais?tiktok=error`);
});

test('callback: sem WEB_URL responde texto simples 200', async () => {
  const { d } = await oauthDeps();
  const r = await handleCallback(cb('code=abc&state=good'), { oauth: d, webUrl: undefined, log: () => {} });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /text\/plain/);
});
