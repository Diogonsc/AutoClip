import assert from 'node:assert/strict';
import { test } from 'node:test';
import { b64encode, decryptToken, encryptToken, importKey, timingSafeEqual } from '../_shared/crypto.ts';
import {
  buildAuthorizeUrl,
  chunkRanges,
  classify,
  createTikTokApi,
  planChunks,
  TikTokError,
} from '../_shared/tiktok.ts';
import { MB } from './helpers.ts';

const KEY_B64 = b64encode(crypto.getRandomValues(new Uint8Array(32)));

// ------------------------------------------------------------------ crypto
test('crypto: cifra e decifra', async () => {
  const key = await importKey(KEY_B64);
  const enc = await encryptToken(key, 'act.segredo', 'canal-1');
  assert.match(enc, /^v1:[^:]+:[^:]+$/);
  assert.ok(!enc.includes('act.segredo'));
  assert.equal(await decryptToken(key, enc, 'canal-1'), 'act.segredo');
});

test('crypto: IV aleatório (mesmo texto => cifras diferentes)', async () => {
  const key = await importKey(KEY_B64);
  assert.notEqual(await encryptToken(key, 'x', 'c'), await encryptToken(key, 'x', 'c'));
});

test('crypto: AAD diferente (outro canal) falha', async () => {
  const key = await importKey(KEY_B64);
  const enc = await encryptToken(key, 'tok', 'canal-1');
  await assert.rejects(() => decryptToken(key, enc, 'canal-2'), /decifrar/);
});

test('crypto: adulteração e chave errada falham', async () => {
  const key = await importKey(KEY_B64);
  const other = await importKey(b64encode(crypto.getRandomValues(new Uint8Array(32))));
  const enc = await encryptToken(key, 'tok', 'c');
  const parts = enc.split(':');
  const flipped = `v1:${parts[1]}:${parts[2].slice(0, -4)}AAAA`;
  await assert.rejects(() => decryptToken(key, flipped, 'c'));
  await assert.rejects(() => decryptToken(other, enc, 'c'));
  await assert.rejects(() => decryptToken(key, 'lixo', 'c'), /inválido/);
});

test('crypto: chave precisa ter 32 bytes', async () => {
  await assert.rejects(() => importKey(b64encode(new Uint8Array(16))), /32 bytes/);
  await assert.rejects(() => importKey('%%%'), /base64/);
});

test('timingSafeEqual', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual('', ''), true);
});

// ------------------------------------------------------------------ chunks
test('planChunks: arquivos até 64 MB vão inteiros em 1 chunk', () => {
  assert.deepEqual(planChunks(3 * MB), { videoSize: 3 * MB, chunkSize: 3 * MB, totalChunkCount: 1 });
  assert.deepEqual(planChunks(50 * MB), { videoSize: 50 * MB, chunkSize: 50 * MB, totalChunkCount: 1 });
  assert.equal(planChunks(64 * MB).totalChunkCount, 1);
});

test('planChunks: acima de 64 MB divide em chunks de 64 MB e o último absorve o resto', () => {
  const p = planChunks(200 * MB); // floor(200/64) = 3 chunks; último = 72 MB (<= 128)
  assert.equal(p.chunkSize, 64 * MB);
  assert.equal(p.totalChunkCount, 3);
  const r = chunkRanges(p);
  assert.deepEqual(r[0], { start: 0, end: 64 * MB - 1 });
  assert.deepEqual(r[2], { start: 128 * MB, end: 200 * MB - 1 });
  assert.ok(r[2].end - r[2].start + 1 <= 128 * MB);
  // cobertura contínua e sem sobreposição
  for (let i = 1; i < r.length; i++) assert.equal(r[i].start, r[i - 1].end + 1);
  assert.equal(planChunks(65 * MB).totalChunkCount, 1);
});

test('planChunks: valida limites', () => {
  assert.throws(() => planChunks(0), TikTokError);
  assert.throws(() => planChunks(-1), TikTokError);
  assert.throws(() => planChunks(4097 * MB), /4 GB/);
});

// ------------------------------------------------------------------ classify
test('classify: códigos documentados', () => {
  const k = (s: number, c: string) => classify(s, c);
  assert.equal(k(401, 'access_token_invalid'), 'AUTH');
  assert.equal(k(401, 'scope_not_authorized'), 'SCOPE');
  assert.equal(k(403, 'unaudited_client_can_only_post_to_private_accounts'), 'APPROVAL');
  assert.equal(k(403, 'privacy_level_option_mismatch'), 'PRIVACY');
  assert.equal(k(403, 'spam_risk_user_banned_from_posting'), 'BANNED');
  assert.equal(k(403, 'spam_risk_too_many_posts'), 'QUOTA');
  assert.equal(k(403, 'spam_risk_too_many_pending_share'), 'QUOTA');
  assert.equal(k(403, 'reached_active_user_cap'), 'APP_QUOTA');
  assert.equal(k(429, 'rate_limit_exceeded'), 'RATE_LIMIT');
  assert.equal(k(400, 'invalid_param'), 'INVALID');
  assert.equal(k(503, 'http_503'), 'SERVER');
  assert.equal(k(200, 'algo_novo'), 'OTHER');
});

test('buildAuthorizeUrl', () => {
  const u = new URL(
    buildAuthorizeUrl({ clientKey: 'ck', redirectUri: 'https://x.co/cb', scopes: ['user.info.basic', 'video.upload'], state: 'st' }),
  );
  assert.equal(u.origin + u.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
  assert.equal(u.searchParams.get('scope'), 'user.info.basic,video.upload');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://x.co/cb');
  assert.equal(u.searchParams.get('state'), 'st');
  assert.equal(u.searchParams.get('client_key'), 'ck');
});

// ------------------------------------------------------------------ cliente HTTP
type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function api(handler: Handler) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  }) as unknown as typeof fetch;
  return { api: createTikTokApi(f), calls };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

test('initVideoPost INBOX: endpoint e corpo sem post_info', async () => {
  const { api: a, calls } = api(() => json({ data: { publish_id: 'p1', upload_url: 'https://u' }, error: { code: 'ok' } }));
  const r = await a.initVideoPost('tok', { mode: 'INBOX', plan: planChunks(10 * MB) });
  assert.deepEqual(r, { publishId: 'p1', uploadUrl: 'https://u' });
  assert.equal(calls[0].url, 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/');
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body, {
    source_info: { source: 'FILE_UPLOAD', video_size: 10 * MB, chunk_size: 10 * MB, total_chunk_count: 1 },
  });
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer tok');
});

test('initVideoPost DIRECT: endpoint e post_info', async () => {
  const { api: a, calls } = api(() => json({ data: { publish_id: 'p2', upload_url: 'https://u' }, error: { code: 'ok' } }));
  await a.initVideoPost('tok', {
    mode: 'DIRECT',
    plan: planChunks(MB),
    postInfo: {
      title: 't',
      privacy_level: 'SELF_ONLY',
      disable_comment: true,
      disable_duet: false,
      disable_stitch: false,
      brand_content_toggle: false,
      brand_organic_toggle: false,
    },
  });
  assert.equal(calls[0].url, 'https://open.tiktokapis.com/v2/post/publish/video/init/');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.post_info.privacy_level, 'SELF_ONLY');
  assert.equal(body.post_info.disable_comment, true);
});

test('erro de negócio com HTTP 200 (creator_info) é detectado', async () => {
  const { api: a } = api(() => json({ data: {}, error: { code: 'spam_risk_too_many_posts', message: 'cap', log_id: 'L1' } }));
  await assert.rejects(
    () => a.queryCreatorInfo('tok'),
    (e: unknown) => e instanceof TikTokError && e.kind === 'QUOTA' && e.logId === 'L1',
  );
});

test('erros HTTP mapeados: 401, 403 unaudited, 429, 5xx', async () => {
  const cases: Array<[number, unknown, string]> = [
    [401, { error: { code: 'access_token_invalid', message: 'x' } }, 'AUTH'],
    [403, { error: { code: 'unaudited_client_can_only_post_to_private_accounts', message: 'x' } }, 'APPROVAL'],
    [429, { error: { code: 'rate_limit_exceeded', message: 'x' } }, 'RATE_LIMIT'],
    [502, 'bad gateway', 'SERVER'],
  ];
  for (const [status, body, kind] of cases) {
    const { api: a } = api(() => (typeof body === 'string' ? new Response(body, { status }) : json(body, status)));
    await assert.rejects(
      () => a.fetchPublishStatus('t', 'p'),
      (e: unknown) => e instanceof TikTokError && e.kind === kind,
      `${status} => ${kind}`,
    );
  }
});

test('falha de rede => NETWORK (ambíguo)', async () => {
  const f = (() => Promise.reject(new Error('ECONNRESET'))) as unknown as typeof fetch;
  const a = createTikTokApi(f);
  await assert.rejects(
    () => a.initVideoPost('t', { mode: 'INBOX', plan: planChunks(MB) }),
    (e: unknown) => e instanceof TikTokError && e.kind === 'NETWORK',
  );
});

test('init com 200 mas sem upload_url => MALFORMED (ambíguo)', async () => {
  const { api: a } = api(() => json({ data: { publish_id: 'p' }, error: { code: 'ok' } }));
  await assert.rejects(
    () => a.initVideoPost('t', { mode: 'INBOX', plan: planChunks(MB) }),
    (e: unknown) => e instanceof TikTokError && e.kind === 'MALFORMED',
  );
});

test('token: form-urlencoded, rotação e erro no topo do JSON', async () => {
  const cfg = { clientKey: 'ck', clientSecret: 'cs' };
  const ok = api(() =>
    json({ open_id: 'o1', scope: 'user.info.basic,video.upload', access_token: 'a1', expires_in: 86400, refresh_token: 'r2', refresh_expires_in: 31536000, token_type: 'Bearer' }),
  );
  const t = await ok.api.refreshAccessToken(cfg, 'r1');
  assert.deepEqual(t.scopes, ['user.info.basic', 'video.upload']);
  assert.equal(t.refreshToken, 'r2');
  assert.equal(t.expiresIn, 86400);
  const sent = new URLSearchParams(String(ok.calls[0].init.body));
  assert.equal(sent.get('grant_type'), 'refresh_token');
  assert.equal(sent.get('refresh_token'), 'r1');
  assert.equal(sent.get('client_secret'), 'cs');
  assert.equal((ok.calls[0].init.headers as Record<string, string>)['Content-Type'], 'application/x-www-form-urlencoded');

  const bad = api(() => json({ error: 'invalid_request', error_description: 'refresh token inválido', log_id: 'L' }, 400));
  await assert.rejects(
    () => bad.api.refreshAccessToken(cfg, 'r1'),
    (e: unknown) => e instanceof TikTokError && e.kind === 'AUTH' && e.code === 'invalid_request',
  );

  const down = api(() => new Response('oops', { status: 503 }));
  await assert.rejects(
    () => down.api.refreshAccessToken(cfg, 'r1'),
    (e: unknown) => e instanceof TikTokError && e.kind === 'SERVER',
  );
});

test('uploadVideo: Content-Range correto e validação de status', async () => {
  const bytes = new Uint8Array(10);
  const seen: string[] = [];
  const { api: a } = api((_u, init) => {
    seen.push((init.headers as Record<string, string>)['Content-Range']);
    return new Response('', { status: 201 });
  });
  await a.uploadVideo('https://u/x?sig=1', bytes, 'video/mp4', planChunks(10));
  assert.deepEqual(seen, ['bytes 0-9/10']);

  const rej = api(() => new Response('', { status: 400 }));
  await assert.rejects(
    () => rej.api.uploadVideo('https://u', bytes, 'video/mp4', planChunks(10)),
    (e: unknown) => e instanceof TikTokError && e.kind === 'INVALID',
  );
  const srv = api(() => new Response('', { status: 500 }));
  await assert.rejects(
    () => srv.api.uploadVideo('https://u', bytes, 'video/mp4', planChunks(10)),
    (e: unknown) => e instanceof TikTokError && e.kind === 'SERVER',
  );
});

test('uploadVideo: vários chunks em sequência (206 ... 201)', async () => {
  const size = 130 * MB; // 2 chunks: 64 MB + 66 MB
  const plan = planChunks(size);
  assert.equal(plan.totalChunkCount, 2);
  const ranges: string[] = [];
  const { api: a } = api((_u, init) => {
    ranges.push((init.headers as Record<string, string>)['Content-Range']);
    return new Response('', { status: ranges.length < 2 ? 206 : 201 });
  });
  await a.uploadVideo('https://u', new Uint8Array(size), 'video/mp4', plan);
  assert.deepEqual(ranges, [`bytes 0-${64 * MB - 1}/${size}`, `bytes ${64 * MB}-${size - 1}/${size}`]);
});

test('fetchPublishStatus e queryCreatorInfo: parsing', async () => {
  const s = api(() => json({ data: { status: 'FAILED', fail_reason: 'internal', publicaly_available_post_id: [123] }, error: { code: 'ok' } }));
  assert.deepEqual(await s.api.fetchPublishStatus('t', 'p'), { status: 'FAILED', failReason: 'internal', publicPostIds: ['123'] });
  const c = api(() =>
    json({ data: { creator_username: 'u', privacy_level_options: ['SELF_ONLY'], comment_disabled: true, duet_disabled: false, stitch_disabled: false, max_video_post_duration_sec: 300 }, error: { code: 'ok' } }),
  );
  const info = await c.api.queryCreatorInfo('t');
  assert.deepEqual(info.privacy_level_options, ['SELF_ONLY']);
  assert.equal(info.comment_disabled, true);
  assert.equal(info.max_video_post_duration_sec, 300);
});
