// Cliente da API oficial do TikTok (Login Kit v2 + Content Posting API).
// Sem dependências: `fetch` entra por injeção, o que permite testar com respostas simuladas.
// Sintaxe compatível com Deno e com Node (type stripping): sem parameter properties nem enums.
import type { CreatorInfo, PublishMode } from './types.ts';

const API_BASE = 'https://open.tiktokapis.com';
const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';

export const MB = 1024 * 1024;
const MAX_VIDEO_BYTES = 4096 * MB; // limite de 4 GB do TikTok

// ---------------------------------------------------------------------- erros

export type ErrorKind =
  | 'AUTH' // token inválido/expirado ou autorização revogada
  | 'SCOPE' // escopo não concedido
  | 'APPROVAL' // app não auditado
  | 'PRIVACY' // privacidade fora das opções do criador
  | 'BANNED' // conta impedida de publicar
  | 'QUOTA' // limite diário do criador
  | 'APP_QUOTA' // cota diária do app
  | 'RATE_LIMIT'
  | 'INVALID' // requisição rejeitada (definitivo)
  | 'SERVER' // 5xx
  | 'NETWORK' // sem resposta (rede/timeout)
  | 'MALFORMED' // resposta fora do contrato
  | 'OTHER';

export class TikTokError extends Error {
  kind: ErrorKind;
  code: string;
  status: number;
  logId?: string;
  constructor(kind: ErrorKind, code: string, message: string, status = 0, logId?: string) {
    super(message);
    this.name = 'TikTokError';
    this.kind = kind;
    this.code = code;
    this.status = status;
    this.logId = logId;
  }
}

/**
 * Erros em que NÃO se sabe se o TikTok processou a requisição (sem resposta, ou resposta fora
 * do contrato). Um 5xx explícito não entra aqui: o TikTok respondeu que falhou.
 */
export function isAmbiguous(kind: ErrorKind): boolean {
  return kind === 'NETWORK' || kind === 'MALFORMED';
}

/** (status HTTP, código do TikTok) -> categoria. O código tem precedência sobre o status. */
export function classify(status: number, code: string): ErrorKind {
  switch (code) {
    case 'access_token_invalid':
      return 'AUTH';
    case 'scope_not_authorized':
      return 'SCOPE';
    case 'unaudited_client_can_only_post_to_private_accounts':
      return 'APPROVAL';
    case 'privacy_level_option_mismatch':
      return 'PRIVACY';
    case 'spam_risk_user_banned_from_posting':
      return 'BANNED';
    case 'spam_risk_too_many_posts':
    case 'spam_risk_too_many_pending_share':
      return 'QUOTA';
    case 'reached_active_user_cap':
      return 'APP_QUOTA';
    case 'rate_limit_exceeded':
      return 'RATE_LIMIT';
    case 'invalid_param':
      return 'INVALID';
  }
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 500) return 'SERVER';
  if (status === 401) return 'AUTH';
  if (status === 400) return 'INVALID';
  return 'OTHER';
}

// --------------------------------------------------------------------- tipos

export interface TikTokConfig {
  clientKey: string;
  clientSecret: string;
}

export interface TokenResult {
  accessToken: string;
  refreshToken: string; // '' se o TikTok não devolver
  expiresIn: number; // segundos
  refreshExpiresIn: number | null;
  openId: string;
  scopes: string[];
}

export interface PostInfo {
  title?: string;
  privacy_level: string;
  disable_comment: boolean;
  disable_duet: boolean;
  disable_stitch: boolean;
  brand_content_toggle: boolean;
  brand_organic_toggle: boolean;
}

export interface ChunkPlan {
  videoSize: number;
  chunkSize: number;
  totalChunkCount: number;
}

export interface PublishStatus {
  status: string;
  failReason: string | null;
  publicPostIds: string[];
}

export interface InitParams {
  mode: PublishMode;
  plan: ChunkPlan;
  postInfo?: PostInfo;
}

// -------------------------------------------------------------------- chunks
// Regras do TikTok: cada parte entre 5 e 64 MB (arquivo menor vai inteiro); a última parte
// absorve o resto (até 128 MB); total = floor(tamanho / chunk_size); máximo de 4 GB.

export function planChunks(videoSize: number): ChunkPlan {
  if (!Number.isInteger(videoSize) || videoSize <= 0) {
    throw new TikTokError('INVALID', 'invalid_video_size', 'Tamanho de vídeo inválido.');
  }
  if (videoSize > MAX_VIDEO_BYTES) {
    throw new TikTokError('INVALID', 'video_too_large', 'Vídeo acima do limite de 4 GB do TikTok.');
  }
  if (videoSize <= 64 * MB) return { videoSize, chunkSize: videoSize, totalChunkCount: 1 };
  return { videoSize, chunkSize: 64 * MB, totalChunkCount: Math.floor(videoSize / (64 * MB)) };
}

/** Intervalos de bytes (inclusivos) de cada parte; a última vai até o fim do arquivo. */
export function chunkRanges(plan: ChunkPlan): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < plan.totalChunkCount; i++) {
    const start = i * plan.chunkSize;
    const end = i === plan.totalChunkCount - 1 ? plan.videoSize - 1 : start + plan.chunkSize - 1;
    out.push({ start, end });
  }
  return out;
}

// ---------------------------------------------------------------------- OAuth

export function buildAuthorizeUrl(p: { clientKey: string; redirectUri: string; scopes: string[]; state: string }): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set('client_key', p.clientKey);
  u.searchParams.set('scope', p.scopes.join(','));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('state', p.state);
  return u.toString();
}

// ------------------------------------------------------------------- cliente

type Json = Record<string, unknown>;

export interface ApiOptions {
  baseUrl?: string;
  apiTimeoutMs?: number;
  uploadTimeoutMs?: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/**
 * O TikTok devolve ids de vídeo como int64; JSON.parse perderia precisão acima de 2^53.
 * Converte, antes do parse, os números longos da lista de ids públicos em strings.
 */
function parseJson(text: string): Json | null {
  if (!text) return null;
  const safe = text.replace(
    /("publicaly_available_post_id"\s*:\s*\[)([^\]]*)\]/,
    (_m, head: string, body: string) => `${head}${body.replace(/\d{16,}/g, '"$&"')}]`,
  );
  try {
    const v = JSON.parse(safe);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
  } catch {
    return null;
  }
}

export function createTikTokApi(fetchImpl?: typeof fetch, opts: ApiOptions = {}) {
  const f: typeof fetch = fetchImpl ?? ((...a) => fetch(...a));
  const base = (opts.baseUrl ?? API_BASE).replace(/\/$/, '');
  const apiTimeout = opts.apiTimeoutMs ?? 30_000;
  const uploadTimeout = opts.uploadTimeoutMs ?? 120_000;

  /** Executa a requisição; falha de rede/timeout vira TikTokError('NETWORK'). */
  async function send(
    url: string,
    init: { method: string; headers: Record<string, string>; body: string | Uint8Array },
    timeoutMs: number,
  ): Promise<{ status: number; ok: boolean; text: string }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await f(url, { ...init, body: init.body as BodyInit, signal: ctl.signal });
      return { status: res.status, ok: res.ok, text: await res.text() };
    } catch (e) {
      const timedOut = ctl.signal.aborted;
      throw new TikTokError(
        'NETWORK',
        timedOut ? 'timeout' : 'network_error',
        timedOut ? 'Tempo esgotado na chamada ao TikTok.' : e instanceof Error ? e.message : 'Falha de rede.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Endpoints de API: { data, error: { code, message, log_id } } (o erro pode vir com HTTP 200). */
  async function api(path: string, token: string, body: Json): Promise<Json> {
    const r = await send(
      base + path,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(body),
      },
      apiTimeout,
    );
    const json = parseJson(r.text);
    const e = json?.error;
    if (e && typeof e === 'object') {
      const code = str((e as Json).code);
      if (code && code !== 'ok') {
        throw new TikTokError(classify(r.status, code), code, str((e as Json).message) || code, r.status, str((e as Json).log_id) || undefined);
      }
    }
    if (!r.ok) throw new TikTokError(classify(r.status, `http_${r.status}`), `http_${r.status}`, `TikTok respondeu HTTP ${r.status}.`, r.status);
    if (!json) throw new TikTokError('MALFORMED', 'invalid_json', 'Resposta inválida do TikTok.', r.status);
    return (json.data as Json | undefined) ?? {};
  }

  /** Endpoints OAuth: form-urlencoded; erro no topo do JSON: { error, error_description, log_id }. */
  async function oauth(path: string, form: Record<string, string>, allowEmpty = false): Promise<Json> {
    const r = await send(
      base + path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      },
      apiTimeout,
    );
    const json = parseJson(r.text);
    const topError = json && typeof json.error === 'string' && json.error ? json.error : null;
    if (topError || !r.ok) {
      const kind: ErrorKind = r.status >= 500 ? 'SERVER' : r.status === 429 ? 'RATE_LIMIT' : 'AUTH';
      throw new TikTokError(
        kind,
        topError ?? `http_${r.status}`,
        str(json?.error_description) || `TikTok respondeu HTTP ${r.status}.`,
        r.status,
        str(json?.log_id) || undefined,
      );
    }
    if (!json && !allowEmpty) throw new TikTokError('MALFORMED', 'invalid_json', 'Resposta inválida do TikTok.', r.status);
    return json ?? {};
  }

  function toTokenResult(j: Json): TokenResult {
    const accessToken = str(j.access_token);
    if (!accessToken) throw new TikTokError('MALFORMED', 'missing_access_token', 'Resposta de token sem access_token.');
    return {
      accessToken,
      refreshToken: str(j.refresh_token),
      expiresIn: typeof j.expires_in === 'number' ? j.expires_in : 86_400,
      refreshExpiresIn: typeof j.refresh_expires_in === 'number' ? j.refresh_expires_in : null,
      openId: str(j.open_id),
      scopes: str(j.scope)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  return {
    async exchangeCode(cfg: TikTokConfig, code: string, redirectUri: string): Promise<TokenResult> {
      return toTokenResult(
        await oauth('/v2/oauth/token/', {
          client_key: cfg.clientKey,
          client_secret: cfg.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      );
    },

    async refreshAccessToken(cfg: TikTokConfig, refreshToken: string): Promise<TokenResult> {
      return toTokenResult(
        await oauth('/v2/oauth/token/', {
          client_key: cfg.clientKey,
          client_secret: cfg.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      );
    },

    async revokeToken(cfg: TikTokConfig, token: string): Promise<void> {
      await oauth('/v2/oauth/revoke/', { client_key: cfg.clientKey, client_secret: cfg.clientSecret, token }, true);
    },

    async queryCreatorInfo(token: string): Promise<CreatorInfo> {
      const d = await api('/v2/post/publish/creator_info/query/', token, {});
      return {
        creator_username: str(d.creator_username),
        creator_nickname: str(d.creator_nickname),
        privacy_level_options: Array.isArray(d.privacy_level_options) ? d.privacy_level_options.map(String) : [],
        comment_disabled: d.comment_disabled === true,
        duet_disabled: d.duet_disabled === true,
        stitch_disabled: d.stitch_disabled === true,
        max_video_post_duration_sec: typeof d.max_video_post_duration_sec === 'number' ? d.max_video_post_duration_sec : null,
      };
    },

    /** INBOX: envia ao rascunho do criador (escopo video.upload). DIRECT: Direct Post (video.publish). */
    async initVideoPost(token: string, p: InitParams): Promise<{ publishId: string; uploadUrl: string }> {
      const source_info = {
        source: 'FILE_UPLOAD',
        video_size: p.plan.videoSize,
        chunk_size: p.plan.chunkSize,
        total_chunk_count: p.plan.totalChunkCount,
      };
      let path = '/v2/post/publish/inbox/video/init/';
      let body: Json = { source_info };
      if (p.mode === 'DIRECT') {
        if (!p.postInfo) throw new TikTokError('INVALID', 'missing_post_info', 'Direct Post exige post_info.');
        const post_info: Json = { ...p.postInfo };
        if (!p.postInfo.title) delete post_info.title;
        path = '/v2/post/publish/video/init/';
        body = { post_info, source_info };
      }
      const d = await api(path, token, body);
      const publishId = str(d.publish_id);
      const uploadUrl = str(d.upload_url);
      if (!publishId || !uploadUrl) {
        throw new TikTokError('MALFORMED', 'init_without_upload_url', 'Resposta de init sem publish_id/upload_url.');
      }
      return { publishId, uploadUrl };
    },

    /** Envia o arquivo em partes sequenciais (206 = parte aceita; 201 = upload completo). */
    async uploadVideo(uploadUrl: string, bytes: Uint8Array, contentType: string, plan: ChunkPlan): Promise<void> {
      if (bytes.length !== plan.videoSize) {
        throw new TikTokError('INVALID', 'size_mismatch', 'O tamanho do arquivo difere do plano de upload.');
      }
      const ranges = chunkRanges(plan);
      for (let i = 0; i < ranges.length; i++) {
        const { start, end } = ranges[i];
        const isLast = i === ranges.length - 1;
        const r = await send(
          uploadUrl,
          {
            method: 'PUT',
            headers: { 'Content-Type': contentType, 'Content-Range': `bytes ${start}-${end}/${plan.videoSize}` },
            body: bytes.subarray(start, end + 1),
          },
          uploadTimeout,
        );
        const okStatus = isLast ? r.status === 201 || r.status === 200 : r.status === 206;
        if (okStatus) continue;
        if (r.status >= 200 && r.status < 300) {
          throw new TikTokError('MALFORMED', 'unexpected_upload_status', `Status de upload inesperado (${r.status}).`, r.status);
        }
        throw new TikTokError(classify(r.status, `http_${r.status}`), `http_${r.status}`, `Upload recusado (HTTP ${r.status}).`, r.status);
      }
    },

    async fetchPublishStatus(token: string, publishId: string): Promise<PublishStatus> {
      const d = await api('/v2/post/publish/status/fetch/', token, { publish_id: publishId });
      return {
        status: str(d.status),
        failReason: d.fail_reason ? str(d.fail_reason) : null,
        publicPostIds: Array.isArray(d.publicaly_available_post_id) ? d.publicaly_available_post_id.map(String) : [],
      };
    },
  };
}

export type TikTokApi = ReturnType<typeof createTikTokApi>;
