// TikTok Shop token rotation is separate from Login Kit, but its workers share
// the same durable single-attempt / fencing rules.
import { decryptToken, encryptToken } from './crypto.ts';
import { fetchShopOAuth } from './tiktok-shop-oauth.ts';
import type { SbClient } from './supabase-db.ts';

type ShopConnection = Record<string, unknown>;
const text = (v: unknown) => typeof v === 'string' ? v : '';
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export async function freshShopToken(
  sb: SbClient,
  connection: ShopConnection,
  connectionId: string,
  key: CryptoKey,
  env: (name: string) => string,
  now: () => number = Date.now,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const expiry = typeof connection.access_token_expires_at === 'string' ? Date.parse(connection.access_token_expires_at) : 0;
  if (expiry > now() + 60_000 && text(connection.encrypted_access_token)) {
    return decryptToken(key, text(connection.encrypted_access_token), connectionId);
  }
  const attempt = crypto.randomUUID();
  const claimResult = await sb.rpc('acquire_tiktok_shop_token_refresh', { p_connection: connectionId, p_attempt: attempt });
  if (claimResult.error) throw new Error('Não foi possível adquirir a renovação da loja.');
  const claim = claimResult.data as { state?: string; token_version?: number; connection?: ShopConnection } | null;
  if (claim?.state === 'BUSY') {
    const deadline = now() + 2_000;
    while (now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const current = await sb.from('tiktok_shop_connections').select('encrypted_access_token,access_token_expires_at,token_version,refresh_state').eq('id', connectionId).maybeSingle();
      if (current.error) break;
      if (current.data && Number(current.data.token_version) > Number(connection.token_version ?? 0) && current.data.refresh_state === 'READY' &&
        Date.parse(current.data.access_token_expires_at ?? '') > now() + 60_000) {
        return decryptToken(key, current.data.encrypted_access_token, connectionId);
      }
    }
    throw new Error('A renovação desta loja já está em andamento.');
  }
  if (claim?.state !== 'ACQUIRED' || !claim.connection || typeof claim.token_version !== 'number') {
    throw new Error('A conexão da loja exige reautorização.');
  }
  const current = claim.connection;
  const version = claim.token_version;
  try {
    if (current.workspace_id !== connection.workspace_id || current.id !== connectionId || !text(current.encrypted_refresh_token)) {
      throw new Error('refresh context invalid');
    }
    const refresh = await decryptToken(key, text(current.encrypted_refresh_token), connectionId);
    const url = new URL('https://auth.tiktok-shops.com/api/v2/token/refresh');
    url.search = new URLSearchParams({ app_key: env('TIKTOK_SHOP_APP_KEY'), app_secret: env('TIKTOK_SHOP_APP_SECRET'), refresh_token: refresh, grant_type: 'refresh_token' }).toString();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30_000);
    let response: Response;
    try { response = await fetchShopOAuth(url, { signal: abort.signal }, fetchImpl); }
    finally { clearTimeout(timer); }
    const payload = await response.json().catch(() => null) as { code?: number; data?: Record<string, unknown> } | null;
    const data = payload?.data;
    const access = text(data?.access_token);
    const rotated = text(data?.refresh_token);
    const accessSeconds = data?.access_token_expire_in;
    const refreshSeconds = data?.refresh_token_expire_in;
    if (!response.ok || payload?.code !== 0 || !access || !rotated || !positive(accessSeconds) || !positive(refreshSeconds)) {
      throw new Error('refresh response incomplete or rejected');
    }
    const result = await sb.rpc('complete_tiktok_shop_token_refresh', {
      p_connection: connectionId, p_attempt: attempt, p_token_version: version,
      p_enc_access: await encryptToken(key, access, connectionId),
      p_enc_refresh: await encryptToken(key, rotated, connectionId),
      p_access_exp: new Date(now() + accessSeconds * 1000).toISOString(),
      p_refresh_exp: new Date(now() + refreshSeconds * 1000).toISOString(),
    });
    if (result.error || result.data !== true) throw new Error('rotation persistence ambiguous');
    return access;
  } catch {
    let persisted: { data: Record<string, unknown> | null; error: { message: string } | null } = { data: null, error: null };
    try {
      persisted = await sb.from('tiktok_shop_connections')
        .select('encrypted_access_token,access_token_expires_at,token_version,refresh_state')
        .eq('id', connectionId).maybeSingle();
    } catch { /* ambiguous read: keep conservative reauthorization path */ }
    const persistedExpiry = text(persisted.data?.access_token_expires_at);
    const persistedAccess = text(persisted.data?.encrypted_access_token);
    if (!persisted.error && persisted.data && Number(persisted.data.token_version) > version && persisted.data.refresh_state === 'READY' &&
      persistedAccess && Date.parse(persistedExpiry) > now() + 60_000) {
      return decryptToken(key, persistedAccess, connectionId);
    }
    try { await sb.rpc('fail_tiktok_shop_token_refresh', { p_connection: connectionId, p_attempt: attempt, p_token_version: version }); }
    catch { /* lease timeout will conservatively require reauthorization */ }
    throw new Error('A renovação TikTok Shop teve resultado indeterminado; reconecte a loja.');
  }
}
