import type { SellerTokens } from './tiktok-shop-seller-oauth.ts';
import { decryptSellerCredential, encryptSellerCredential, SELLER_CREDENTIAL_KEY_VERSION } from './tiktok-shop-seller-crypto.ts';

export type SellerRefreshLease = { state: 'ACQUIRED' | 'BUSY' | 'REAUTH_REQUIRED'; workspaceId?: string; sellerOpenId?: string; credentialVersion?: number; fencingToken?: number };
export type SellerRefreshStore = {
  acquire(connectionId: string, workerId: string): Promise<SellerRefreshLease>;
  read(connectionId: string, workerId: string, fencingToken: number): Promise<{ workspaceId: string; sellerOpenId: string; refreshCiphertext: string; credentialVersion: number }>;
  complete(input: { connectionId: string; workerId: string; fencingToken: number; credentialVersion: number; accessCiphertext: string; refreshCiphertext: string; accessExpiresAt: string; refreshExpiresAt: string }): Promise<boolean>;
  fail(input: { connectionId: string; workerId: string; fencingToken: number; credentialVersion: number; reason: string }): Promise<void>;
};
export class SellerRefreshError extends Error { constructor(public readonly code: 'busy' | 'reauth_required' | 'failed') { super('Seller credential refresh failed'); } }

export async function refreshSellerCredentials(input: {
  enabled: boolean; connectionId: string; workspaceId: string; accessExpiresAt: string; encryptionKey: CryptoKey;
  store: SellerRefreshStore; refresh(refreshToken: string, signal?: AbortSignal): Promise<SellerTokens>; workerId?: () => string; now?: () => number; marginMs?: number; signal?: AbortSignal;
}): Promise<'fresh' | 'refreshed'> {
  if (!input.enabled) throw new SellerRefreshError('reauth_required');
  const now = input.now ?? Date.now;
  if (Date.parse(input.accessExpiresAt) > now() + (input.marginMs ?? 60_000)) return 'fresh';
  const workerId = (input.workerId ?? (() => crypto.randomUUID()))();
  const lease = await input.store.acquire(input.connectionId, workerId);
  if (lease.state === 'BUSY') throw new SellerRefreshError('busy');
  if (lease.state !== 'ACQUIRED' || !lease.workspaceId || !lease.sellerOpenId || !Number.isInteger(lease.credentialVersion) || !Number.isInteger(lease.fencingToken)) throw new SellerRefreshError('reauth_required');
  if (lease.workspaceId !== input.workspaceId) throw new SellerRefreshError('reauth_required');
  try {
    const stored = await input.store.read(input.connectionId, workerId, lease.fencingToken);
    if (stored.workspaceId !== input.workspaceId || stored.sellerOpenId !== lease.sellerOpenId || stored.credentialVersion !== lease.credentialVersion) throw new Error('refresh context mismatch');
    const refreshToken = await decryptSellerCredential(input.encryptionKey, stored.refreshCiphertext, { workspaceId: stored.workspaceId, connectionId: input.connectionId, kind: 'refresh', keyVersion: SELLER_CREDENTIAL_KEY_VERSION });
    const tokens = await input.refresh(refreshToken, input.signal);
    if (tokens.openId !== stored.sellerOpenId) throw new Error('seller identity mismatch');
    const accessCiphertext = await encryptSellerCredential(input.encryptionKey, tokens.accessToken, { workspaceId: stored.workspaceId, connectionId: input.connectionId, kind: 'access', keyVersion: SELLER_CREDENTIAL_KEY_VERSION });
    const refreshCiphertext = await encryptSellerCredential(input.encryptionKey, tokens.refreshToken, { workspaceId: stored.workspaceId, connectionId: input.connectionId, kind: 'refresh', keyVersion: SELLER_CREDENTIAL_KEY_VERSION });
    const saved = await input.store.complete({ connectionId: input.connectionId, workerId, fencingToken: lease.fencingToken, credentialVersion: lease.credentialVersion, accessCiphertext, refreshCiphertext, accessExpiresAt: tokens.accessExpiresAt, refreshExpiresAt: tokens.refreshExpiresAt });
    if (!saved) throw new Error('fencing lost');
    return 'refreshed';
  } catch {
    await input.store.fail({ connectionId: input.connectionId, workerId, fencingToken: lease.fencingToken, credentialVersion: lease.credentialVersion, reason: 'REFRESH_OUTCOME_UNKNOWN' }).catch(() => undefined);
    throw new SellerRefreshError('failed');
  }
}
