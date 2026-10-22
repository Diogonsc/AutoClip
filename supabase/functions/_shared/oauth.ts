// Callback do OAuth do TikTok: valida o state, troca o code e grava a conexão.
import { encryptToken } from './crypto.ts';
import type { TikTokApi, TikTokConfig } from './tiktok.ts';
import type { ChannelStatus } from './types.ts';

export type OAuthResult =
  | 'connected'
  | 'denied'
  | 'invalid_state'
  | 'missing_scope'
  | 'account_mismatch'
  | 'duplicate'
  | 'error';

export interface OAuthDeps {
  tiktok: Pick<TikTokApi, 'exchangeCode'>;
  cfg: TikTokConfig;
  redirectUri: string;
  key: CryptoKey;
  now: () => Date;
  consumeState(state: string): Promise<{ workspace_id: string; channel_id: string; required_scopes: string[] } | null>;
  getChannel(channelId: string): Promise<{ id: string; provider_user_id: string | null } | null>;
  saveConnection(a: {
    channelId: string;
    openId: string;
    scopes: string[];
    encAccess: string;
    encRefresh: string | null;
    accessExp: Date;
    refreshExp: Date | null;
  }): Promise<'ok' | 'duplicate'>;
  markChannel(channelId: string, status: ChannelStatus, code: string | null, message: string | null): Promise<void>;
  log?: (msg: string, data?: unknown) => void;
}

export async function handleOAuthCallback(
  params: { code?: string | null; state?: string | null; error?: string | null; scopes?: string | null },
  d: OAuthDeps,
): Promise<OAuthResult> {
  if (!params.state) return 'invalid_state';

  // Uso único: o state é removido mesmo quando o usuário nega o acesso.
  const st = await d.consumeState(params.state);
  if (!st) return 'invalid_state';

  if (params.error) return 'denied';
  if (!params.code) return 'error';

  const channel = await d.getChannel(st.channel_id);
  if (!channel) return 'error';

  let tokens;
  try {
    tokens = await d.tiktok.exchangeCode(d.cfg, params.code, d.redirectUri);
  } catch (e) {
    d.log?.('oauth.exchange_failed', e instanceof Error ? e.message : String(e));
    return 'error';
  }

  // Escopos efetivamente concedidos (o usuário pode desmarcar alguns na tela do TikTok).
  const missing = st.required_scopes.filter((s) => !tokens.scopes.includes(s));
  if (missing.length > 0) {
    await d.markChannel(
      channel.id,
      'PERMISSION_BLOCKED',
      'SCOPE_MISSING',
      `Permissões não concedidas no TikTok: ${missing.join(', ')}.`,
    );
    return 'missing_scope';
  }

  // Reconectar só é permitido com a mesma conta TikTok (evita trocar o destino sem perceber).
  if (channel.provider_user_id && channel.provider_user_id !== tokens.openId) {
    return 'account_mismatch';
  }

  const stamp = d.now().getTime();
  const saved = await d.saveConnection({
    channelId: channel.id,
    openId: tokens.openId,
    scopes: tokens.scopes,
    encAccess: await encryptToken(d.key, tokens.accessToken, channel.id),
    encRefresh: tokens.refreshToken ? await encryptToken(d.key, tokens.refreshToken, channel.id) : null,
    accessExp: new Date(stamp + tokens.expiresIn * 1000),
    refreshExp: tokens.refreshExpiresIn !== null ? new Date(stamp + tokens.refreshExpiresIn * 1000) : null,
  });
  return saved === 'duplicate' ? 'duplicate' : 'connected';
}
