// Lógica dos três endpoints (worker, canal e callback OAuth) sem dependência de Deno/Supabase:
// tudo que faz I/O entra por Deps. Os index.ts só montam as dependências reais.
import { timingSafeEqual } from './crypto.ts';
import { callbackRedirectUrl, corsHeaders, isUuid, json, redirect } from './http.ts';
import { handleOAuthCallback } from './oauth.ts';
import type { OAuthDeps, OAuthResult } from './oauth.ts';
import { buildAuthorizeUrl, TikTokError } from './tiktok.ts';
import type { TikTokApi, TikTokConfig } from './tiktok.ts';
import type { Channel, CreatorInfo } from './types.ts';
import { runWorker } from './worker.ts';
import type { WorkerDeps } from './worker.ts';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// Worker (disparado pelo pg_cron via pg_net)
// ---------------------------------------------------------------------------
export interface WorkerHandlerDeps {
  /** Segredo compartilhado com o pg_cron (Vault: worker_secret). */
  secret: string;
  workerDeps: WorkerDeps;
  acquireLease(holder: string): Promise<boolean>;
  releaseLease(holder: string): Promise<void>;
  /** EdgeRuntime.waitUntil: responde logo e continua o trabalho em segundo plano. */
  background?(work: Promise<unknown>): void;
  newId(): string;
  budgetMs: number;
  log(msg: string, data?: unknown): void;
}

export async function handleWorker(req: Request, d: WorkerHandlerDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const given = req.headers.get('x-worker-secret') ?? '';
  if (!d.secret || !timingSafeEqual(given, d.secret)) return json({ error: 'unauthorized' }, 401);

  const holder = d.newId();
  // Uma execução por vez: evita refresh de token concorrente (quebraria a rotação do refresh_token).
  if (!(await d.acquireLease(holder))) return json({ accepted: false, reason: 'busy' }, 202);

  const work = (async () => {
    try {
      const r = await runWorker(d.workerDeps, { workerId: holder, budgetMs: d.budgetMs });
      d.log('worker.done', r);
    } catch (e) {
      d.log('worker.error', { error: errMsg(e) });
    } finally {
      await d.releaseLease(holder).catch((e) => d.log('worker.release_failed', { error: errMsg(e) }));
    }
  })();

  if (d.background) {
    d.background(work);
    return json({ accepted: true }, 202);
  }
  await work;
  return json({ accepted: true, done: true });
}

// ---------------------------------------------------------------------------
// Canal: conectar / consultar opções do criador / desconectar (chamado pelo front)
// ---------------------------------------------------------------------------
type RpcResult = { data: unknown; error: { code?: string; message: string } | null };

export interface ChannelHandlerDeps {
  origins: string[];
  cfg: TikTokConfig;
  redirectUri: string;
  baseScopes: string[];
  /** Chama uma RPC COMO o usuário (JWT dele): é o banco que decide a permissão. */
  rpcAsUser(authorization: string, fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  ensureToken(channelId: string, opts?: { force?: boolean }): Promise<string>;
  tiktok: Pick<TikTokApi, 'queryCreatorInfo' | 'revokeToken'>;
  db: {
    getChannel(channelId: string): Promise<Channel | null>;
    saveCreatorInfo(channelId: string, info: CreatorInfo): Promise<void>;
    disconnectChannel(channelId: string): Promise<void>;
  };
  log(msg: string, data?: unknown): void;
}

const ACTIONS = ['connect', 'creator_info', 'disconnect'] as const;
type Action = (typeof ACTIONS)[number];

function tiktokErrorResponse(e: TikTokError, h: Record<string, string>): Response {
  switch (e.kind) {
    case 'AUTH':
      return json({ error: 'reauth_required', message: 'A autorização do TikTok expirou: reconecte o canal.' }, 409, h);
    case 'SCOPE':
      return json({ error: 'missing_scope', message: 'O canal não concedeu a permissão necessária.' }, 409, h);
    case 'QUOTA':
    case 'APP_QUOTA':
    case 'RATE_LIMIT':
      return json({ error: e.code, message: 'O TikTok limitou novas consultas agora. Tente em instantes.' }, 429, h);
    default:
      return json({ error: e.code, message: e.message }, 502, h);
  }
}

export async function handleChannel(req: Request, d: ChannelHandlerDeps): Promise<Response> {
  const h = corsHeaders(req.headers.get('origin'), d.origins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, h);

  const auth = req.headers.get('authorization');
  if (!auth) return json({ error: 'unauthorized' }, 401, h);

  const body = (await req.json().catch(() => null)) as { action?: unknown; channel_id?: unknown } | null;
  const action = body?.action as Action | undefined;
  const channelId = body?.channel_id;
  if (!action || !ACTIONS.includes(action) || !isUuid(channelId)) return json({ error: 'invalid_request' }, 400, h);

  try {
    // Autorização no banco: assert_channel_access valida membro/papel com o JWT do usuário.
    const level = action === 'disconnect' ? 'admin' : 'edit';
    const access = await d.rpcAsUser(auth, 'assert_channel_access', { p_channel: channelId, p_level: level });
    if (access.error) {
      if (access.error.code === 'PGRST301' || access.error.code === 'PGRST303') return json({ error: 'unauthorized' }, 401, h);
      if (access.error.code === '42501') return json({ error: 'forbidden' }, 403, h);
      d.log('channel.access_check_failed', { code: access.error.code });
      return json({ error: 'internal' }, 500, h);
    }

    if (action === 'connect') {
      const r = await d.rpcAsUser(auth, 'create_oauth_state', { p_channel: channelId, p_base_scopes: d.baseScopes });
      if (r.error || !r.data) {
        d.log('channel.create_state_failed', { code: r.error?.code });
        return json({ error: 'internal' }, 500, h);
      }
      const st = r.data as { state: string; scopes: string[]; publish_mode: string };
      const url = buildAuthorizeUrl({
        clientKey: d.cfg.clientKey,
        redirectUri: d.redirectUri,
        scopes: st.scopes,
        state: st.state,
      });
      return json({ url, publish_mode: st.publish_mode }, 200, h);
    }

    if (action === 'creator_info') {
      const channel = await d.db.getChannel(channelId);
      if (!channel || channel.connection_status !== 'CONNECTED') {
        return json({ error: 'channel_not_connected', message: 'Conecte o canal ao TikTok primeiro.' }, 409, h);
      }
      if (!channel.granted_scopes.includes('video.publish')) {
        return json({ error: 'missing_scope', message: 'Reconecte o canal autorizando a publicação direta.' }, 409, h);
      }
      const token = await d.ensureToken(channelId);
      const info = await d.tiktok.queryCreatorInfo(token);
      await d.db.saveCreatorInfo(channelId, info);
      return json({ creator_info: info }, 200, h);
    }

    // disconnect: revoga no TikTok (melhor esforço), apaga os tokens e bloqueia o que estava agendado.
    try {
      const token = await d.ensureToken(channelId);
      await d.tiktok.revokeToken(d.cfg, token);
    } catch (e) {
      d.log('channel.revoke_skipped', { error: errMsg(e) });
    }
    await d.db.disconnectChannel(channelId);
    return json({ ok: true }, 200, h);
  } catch (e) {
    if (e instanceof TikTokError) return tiktokErrorResponse(e, h);
    d.log('channel.unexpected', { action, error: errMsg(e) });
    return json({ error: 'internal' }, 500, h);
  }
}

// ---------------------------------------------------------------------------
// Callback do OAuth (o TikTok redireciona o navegador para cá; sem JWT)
// ---------------------------------------------------------------------------
export interface CallbackHandlerDeps {
  oauth: OAuthDeps;
  /** WEB_URL: o resultado volta para o front como /canais?tiktok=<resultado>. */
  webUrl: string | undefined;
  log(msg: string, data?: unknown): void;
}

export async function handleCallback(req: Request, d: CallbackHandlerDeps): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const q = new URL(req.url).searchParams;
  let result: OAuthResult;
  try {
    result = await handleOAuthCallback(
      { code: q.get('code'), state: q.get('state'), error: q.get('error'), scopes: q.get('scopes') },
      d.oauth,
    );
  } catch (e) {
    d.log('callback.unexpected', { error: errMsg(e) });
    result = 'error';
  }

  const target = callbackRedirectUrl(d.webUrl, result);
  if (!target) {
    return new Response('Conexão processada. Pode fechar esta janela e voltar ao aplicativo.', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return redirect(target);
}
