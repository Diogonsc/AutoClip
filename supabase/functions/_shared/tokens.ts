// Gestão server-side de tokens OAuth com lease persistente e fencing por versão.
import { decryptToken, encryptToken } from './crypto.ts';
import { TikTokError } from './tiktok.ts';
import type { TikTokApi, TikTokConfig } from './tiktok.ts';
import type { Connection } from './types.ts';

export interface RefreshClaim {
  state: 'ACQUIRED' | 'BUSY' | 'REAUTH_REQUIRED' | 'NOT_FOUND';
  connection?: Connection;
  token_version?: number;
}

export interface TokenStore {
  getConnection(channelId: string): Promise<Connection | null>;
  acquireRefresh(args: { channelId: string; workspaceId: string; attemptId: string }): Promise<RefreshClaim>;
  completeRefresh(args: {
    channelId: string; workspaceId: string; attemptId: string; tokenVersion: number;
    encAccess: string; encRefresh: string; accessExp: Date; refreshExp: Date; scopes: string[];
  }): Promise<boolean>;
  failRefresh(args: { channelId: string; workspaceId: string; attemptId: string; tokenVersion: number; code: string }): Promise<boolean>;
}

export interface TokenContext {
  store: TokenStore;
  tiktok: Pick<TikTokApi, 'refreshAccessToken'>;
  cfg: TikTokConfig;
  key: CryptoKey;
  now: () => Date;
  newId?: () => string;
}

const REFRESH_MARGIN_MS = 5 * 60_000;
const BUSY_WAIT_MS = 2_000;
const BUSY_POLL_MS = 100;

function needReauth(code: string, message: string): never {
  throw new TikTokError('AUTH', code, message);
}

function safeAttemptId(ctx: TokenContext): string {
  return ctx.newId?.() ?? crypto.randomUUID();
}

async function latestUsableToken(ctx: TokenContext, channelId: string, newerThanVersion: number): Promise<string | null> {
  const current = await ctx.store.getConnection(channelId);
  if (!current || current.refresh_state === 'REAUTH_REQUIRED') return null;
  if (current.token_version <= newerThanVersion) return null;
  const exp = current.access_token_expires_at ? Date.parse(current.access_token_expires_at) : 0;
  if (exp - ctx.now().getTime() <= REFRESH_MARGIN_MS) return null;
  return decryptToken(ctx.key, current.encrypted_access_token, channelId);
}

/**
 * Refresh lease is persisted before network I/O. A timed-out or crashed attempt is
 * never retried with its old refresh token: the SQL RPC moves an expired IN_FLIGHT
 * row to REAUTH_REQUIRED because the provider may already have rotated it.
 */
export async function ensureAccessToken(
  ctx: TokenContext,
  channelId: string,
  opts: { force?: boolean } = {},
): Promise<string> {
  const conn = await ctx.store.getConnection(channelId);
  if (!conn) return needReauth('NO_CONNECTION', 'Canal sem conexão OAuth com o TikTok.');

  const now = ctx.now().getTime();
  const accessExp = conn.access_token_expires_at ? Date.parse(conn.access_token_expires_at) : 0;
  if (!opts.force && accessExp - now > REFRESH_MARGIN_MS && conn.refresh_state !== 'REAUTH_REQUIRED') {
    return decryptToken(ctx.key, conn.encrypted_access_token, channelId);
  }
  if (conn.refresh_state === 'REAUTH_REQUIRED') {
    return needReauth('REAUTH_REQUIRED', 'A autorização precisa ser renovada pelo proprietário do canal.');
  }
  const attemptId = safeAttemptId(ctx);
  const claim = await ctx.store.acquireRefresh({ channelId, workspaceId: conn.workspace_id, attemptId });
  if (claim.state === 'BUSY') {
    const deadline = Date.now() + BUSY_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, BUSY_POLL_MS));
      const currentToken = await latestUsableToken(ctx, channelId, conn.token_version);
      if (currentToken) return currentToken;
    }
    throw new TikTokError('SERVER', 'refresh_in_progress', 'A renovação desta conexão já está em andamento.');
  }
  if (claim.state !== 'ACQUIRED' || !claim.connection || claim.token_version === undefined) {
    return needReauth('REFRESH_REAUTH_REQUIRED', 'A renovação anterior teve resultado indeterminado; reconecte o canal.');
  }

  const claimed = claim.connection;
  if (claimed.workspace_id !== conn.workspace_id || claimed.channel_id !== channelId || !claimed.encrypted_refresh_token) {
    await ctx.store.failRefresh({ channelId, workspaceId: conn.workspace_id, attemptId, tokenVersion: claim.token_version, code: 'REFRESH_CONTEXT_MISMATCH' });
    return needReauth('REFRESH_CONTEXT_MISMATCH', 'A conexão OAuth mudou durante a renovação; reconecte o canal.');
  }

  let tokens;
  try {
    const refreshToken = await decryptToken(ctx.key, claimed.encrypted_refresh_token, channelId);
    tokens = await ctx.tiktok.refreshAccessToken(ctx.cfg, refreshToken);
    // Login Kit rotates the refresh token. Missing/invalid rotation data is not safe
    // to paper over with the old credential.
    if (!tokens.refreshToken || !Number.isFinite(tokens.expiresIn) || tokens.expiresIn <= 0 ||
      !Number.isFinite(tokens.refreshExpiresIn) || (tokens.refreshExpiresIn ?? 0) <= 0) {
      throw new TikTokError('MALFORMED', 'incomplete_rotation', 'Resposta de renovação incompleta; reconecte o canal.');
    }
  } catch (error) {
    // Once fetch may have reached TikTok, a transport/server failure is ambiguous.
    // Do not release the old refresh token for another attempt.
    await ctx.store.failRefresh({ channelId, workspaceId: conn.workspace_id, attemptId, tokenVersion: claim.token_version, code: 'REFRESH_OUTCOME_UNKNOWN' }).catch(() => false);
    throw new TikTokError('AUTH', 'REFRESH_OUTCOME_UNKNOWN', 'A renovação teve resultado indeterminado; reconecte o canal.');
  }

  const stamp = ctx.now().getTime();
  const encAccess = await encryptToken(ctx.key, tokens.accessToken, channelId);
  const encRefresh = await encryptToken(ctx.key, tokens.refreshToken, channelId);
  const committed = await ctx.store.completeRefresh({
    channelId,
    workspaceId: conn.workspace_id,
    attemptId,
    tokenVersion: claim.token_version,
    encAccess,
    encRefresh,
    accessExp: new Date(stamp + tokens.expiresIn * 1000),
    refreshExp: new Date(stamp + (tokens.refreshExpiresIn as number) * 1000),
    scopes: tokens.scopes.length > 0 ? tokens.scopes : claimed.granted_scopes,
  }).catch(() => false);

  if (committed) return tokens.accessToken;

  // The RPC response may have been lost after COMMIT. Reconcile by reading the
  // persisted version; never write the late response over another generation.
  const persisted = await ctx.store.getConnection(channelId).catch(() => null);
  if (persisted && persisted.workspace_id === conn.workspace_id && persisted.refresh_state === 'READY' &&
    persisted.token_version > claim.token_version && persisted.access_token_expires_at &&
    Date.parse(persisted.access_token_expires_at) - ctx.now().getTime() > REFRESH_MARGIN_MS) {
    return decryptToken(ctx.key, persisted.encrypted_access_token, channelId);
  }
  await ctx.store.failRefresh({ channelId, workspaceId: conn.workspace_id, attemptId, tokenVersion: claim.token_version, code: 'REFRESH_PERSISTENCE_UNKNOWN' }).catch(() => false);
  throw new TikTokError('AUTH', 'REFRESH_PERSISTENCE_UNKNOWN', 'Não foi possível confirmar a gravação da rotação; reconecte o canal.');
}
