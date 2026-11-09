import {
  createSellerState,
  hashSellerState,
  sellerRowAuthorizeUrl,
  type SellerTokens,
} from './tiktok-shop-seller-oauth.ts';
import {
  SELLER_CREDENTIAL_KEY_VERSION,
  encryptSellerCredential,
  type SellerCredentialContext,
} from './tiktok-shop-seller-crypto.ts';

export type SellerOAuthClaim = {
  id: string;
  workspaceId: string;
  connectionId?: string | null;
};

export type SellerOAuthPersistence = {
  createState(workspaceId: string, stateHash: string): Promise<void>;
  claimState(stateHash: string): Promise<SellerOAuthClaim>;
  failState(stateId: string): Promise<void>;
  completeAuthorization(input: {
    stateId: string;
    workspaceId: string;
    connectionId: string;
    openId: string;
    sellerName?: string;
    region?: string;
    scopes: string[];
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
    accessExpiresAt: string;
    refreshExpiresAt: string;
    keyVersion: number;
  }): Promise<void>;
};

export type SellerOAuthStartDependencies = {
  enabled: boolean;
  serviceId: string;
  persistence: SellerOAuthPersistence;
  state?: () => string;
};

export type SellerOAuthCallbackDependencies = {
  enabled: boolean;
  persistence: SellerOAuthPersistence;
  exchangeCode(code: string, signal?: AbortSignal): Promise<SellerTokens>;
  encryptionKey: CryptoKey;
  connectionId?: () => string;
};

export class SellerOAuthFlowError extends Error {
  constructor(public readonly code: 'feature_unavailable' | 'invalid_request' | 'authorization_denied' | 'authorization_failed') {
    super('TikTok Shop Seller authorization could not be completed');
  }
}

function requireEnabled(enabled: boolean): void {
  if (!enabled) throw new SellerOAuthFlowError('feature_unavailable');
}

function uuid(): string {
  return crypto.randomUUID();
}

function credentialContext(workspaceId: string, connectionId: string, kind: 'access' | 'refresh'): SellerCredentialContext {
  return { workspaceId, connectionId, kind, keyVersion: SELLER_CREDENTIAL_KEY_VERSION };
}

/**
 * The authenticated Edge Function adapter must call the user-scoped state RPC.
 * The database derives the actor from auth.uid(); no caller-supplied user id is trusted.
 */
export async function startSellerOAuth(
  workspaceId: string,
  dependencies: SellerOAuthStartDependencies,
): Promise<{ authorizationUrl: string; state: string }> {
  requireEnabled(dependencies.enabled);
  if (!workspaceId || !dependencies.serviceId) throw new SellerOAuthFlowError('invalid_request');

  const state = (dependencies.state ?? createSellerState)();
  if (!state) throw new SellerOAuthFlowError('invalid_request');
  await dependencies.persistence.createState(workspaceId, await hashSellerState(state));

  return { authorizationUrl: sellerRowAuthorizeUrl(dependencies.serviceId, state), state };
}

/** Local callback domain handler. It contains no HTTP route and never logs secrets. */
export async function completeSellerOAuthCallback(
  query: { state?: string | null; code?: string | null; error?: string | null },
  dependencies: SellerOAuthCallbackDependencies,
  signal?: AbortSignal,
): Promise<{ connectionId: string }> {
  requireEnabled(dependencies.enabled);
  if (!query.state) throw new SellerOAuthFlowError('invalid_request');

  const claimed = await dependencies.persistence.claimState(await hashSellerState(query.state));
  if (query.error || !query.code) {
    await dependencies.persistence.failState(claimed.id);
    throw new SellerOAuthFlowError('authorization_denied');
  }

  try {
    const tokens = await dependencies.exchangeCode(query.code, signal);
    const connectionId = claimed.connectionId ?? (dependencies.connectionId ?? uuid)();
    const encryptedAccessToken = await encryptSellerCredential(
      dependencies.encryptionKey,
      tokens.accessToken,
      credentialContext(claimed.workspaceId, connectionId, 'access'),
    );
    const encryptedRefreshToken = await encryptSellerCredential(
      dependencies.encryptionKey,
      tokens.refreshToken,
      credentialContext(claimed.workspaceId, connectionId, 'refresh'),
    );

    await dependencies.persistence.completeAuthorization({
      stateId: claimed.id,
      workspaceId: claimed.workspaceId,
      connectionId,
      openId: tokens.openId,
      sellerName: tokens.sellerName,
      region: tokens.region,
      scopes: tokens.scopes,
      encryptedAccessToken,
      encryptedRefreshToken,
      accessExpiresAt: tokens.accessExpiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
      keyVersion: SELLER_CREDENTIAL_KEY_VERSION,
    });
    return { connectionId };
  } catch {
    // State stays terminal after a remote or persistence failure; it is never replayable.
    await dependencies.persistence.failState(claimed.id).catch(() => undefined);
    throw new SellerOAuthFlowError('authorization_failed');
  }
}
