// Gestão de access/refresh tokens: decifra, renova quando necessário e grava a rotação.
import { decryptToken, encryptToken } from './crypto.ts';
import { TikTokError } from './tiktok.ts';
import type { TikTokApi, TikTokConfig } from './tiktok.ts';
import type { ChannelStatus, Connection } from './types.ts';

export interface TokenStore {
  getConnection(channelId: string): Promise<Connection | null>;
  saveTokens(args: {
    channelId: string;
    encAccess: string;
    encRefresh: string | null;
    accessExp: Date;
    refreshExp: Date | null;
    scopes: string[];
  }): Promise<void>;
  setChannelStatus(
    channelId: string,
    status: ChannelStatus,
    errorCode: string | null,
    errorMessage: string | null,
  ): Promise<void>;
}

export interface TokenContext {
  store: TokenStore;
  tiktok: Pick<TikTokApi, 'refreshAccessToken'>;
  cfg: TikTokConfig;
  key: CryptoKey;
  now: () => Date;
}

/** Renova quando faltarem menos de 5 minutos para expirar. */
const REFRESH_MARGIN_MS = 5 * 60_000;

async function needReauth(ctx: TokenContext, channelId: string, code: string, message: string): Promise<never> {
  await ctx.store.setChannelStatus(channelId, 'REAUTH_REQUIRED', code, message);
  throw new TikTokError('AUTH', code, message);
}

/**
 * Devolve um access token válido para o canal.
 * Lança TikTokError('AUTH') quando é preciso reconectar (e marca o canal como REAUTH_REQUIRED);
 * erros transitórios (rede/5xx) são relançados sem alterar o canal.
 */
export async function ensureAccessToken(
  ctx: TokenContext,
  channelId: string,
  opts: { force?: boolean } = {},
): Promise<string> {
  const conn = await ctx.store.getConnection(channelId);
  if (!conn) {
    return needReauth(ctx, channelId, 'NO_CONNECTION', 'Canal sem conexão OAuth com o TikTok.');
  }

  const now = ctx.now().getTime();
  const accessExp = conn.access_token_expires_at ? Date.parse(conn.access_token_expires_at) : 0;
  if (!opts.force && accessExp - now > REFRESH_MARGIN_MS) {
    return decryptToken(ctx.key, conn.encrypted_access_token, channelId);
  }

  if (!conn.encrypted_refresh_token) {
    return needReauth(ctx, channelId, 'NO_REFRESH_TOKEN', 'Sem refresh token: reconecte o canal.');
  }
  const refreshExp = conn.refresh_token_expires_at ? Date.parse(conn.refresh_token_expires_at) : null;
  if (refreshExp !== null && refreshExp <= now) {
    return needReauth(ctx, channelId, 'REFRESH_EXPIRED', 'Autorização expirada: reconecte o canal.');
  }

  const refreshToken = await decryptToken(ctx.key, conn.encrypted_refresh_token, channelId);

  let t;
  try {
    t = await ctx.tiktok.refreshAccessToken(ctx.cfg, refreshToken);
  } catch (e) {
    if (e instanceof TikTokError && e.kind === 'AUTH') {
      return needReauth(ctx, channelId, 'REFRESH_FAILED', 'O TikTok recusou a renovação: reconecte o canal.');
    }
    throw e;
  }

  const stamp = ctx.now().getTime();
  await ctx.store.saveTokens({
    channelId,
    encAccess: await encryptToken(ctx.key, t.accessToken, channelId),
    // Se o TikTok não devolver refresh token novo, mantém o atual.
    encRefresh: t.refreshToken ? await encryptToken(ctx.key, t.refreshToken, channelId) : conn.encrypted_refresh_token,
    accessExp: new Date(stamp + t.expiresIn * 1000),
    refreshExp: t.refreshExpiresIn !== null ? new Date(stamp + t.refreshExpiresIn * 1000) : (refreshExp ? new Date(refreshExp) : null),
    scopes: t.scopes.length > 0 ? t.scopes : conn.granted_scopes,
  });
  return t.accessToken;
}
