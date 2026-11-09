import type { SellerOAuthClaim, SellerOAuthPersistence } from './tiktok-shop-seller-flow.ts';

type RpcResult<T> = { data: T | null; error: { message?: string } | null };

export type SellerOAuthRpcClient = {
  rpc<T>(name: string, arguments_: Record<string, unknown>): Promise<RpcResult<T>>;
};

function persistenceFailure(): never {
  // Database errors can contain SQL details. They never cross this domain boundary.
  throw new Error('Seller OAuth persistence failed');
}

type ClaimedStateRow = {
  id?: unknown;
  workspace_id?: unknown;
  connection_id?: unknown;
};

/**
 * Maps the reviewed RPC contract to the domain port. Use a JWT-scoped client for
 * `createState` and a service-role client for callback methods; never use this
 * adapter from browser code.
 */
export function createSellerOAuthPersistence(
  userClient: SellerOAuthRpcClient,
  backendClient: SellerOAuthRpcClient,
): SellerOAuthPersistence {
  return {
    async createState(workspaceId, stateHash) {
      const result = await userClient.rpc<string>('create_seller_oauth_state', {
        p_workspace: workspaceId,
        p_state_hash: stateHash,
        p_connection: null,
      });
      if (result.error || !result.data) persistenceFailure();
    },

    async claimState(stateHash): Promise<SellerOAuthClaim> {
      const result = await backendClient.rpc<ClaimedStateRow>('claim_seller_oauth_state', { p_state_hash: stateHash });
      const row = result.data;
      if (
        result.error || !row || typeof row.id !== 'string' || typeof row.workspace_id !== 'string'
        || (row.connection_id !== null && row.connection_id !== undefined && typeof row.connection_id !== 'string')
      ) persistenceFailure();
      return { id: row.id, workspaceId: row.workspace_id, connectionId: row.connection_id as string | null | undefined };
    },

    async failState(stateId) {
      const result = await backendClient.rpc<null>('fail_seller_oauth_state', { p_state: stateId });
      if (result.error) persistenceFailure();
    },

    async completeAuthorization(input) {
      const result = await backendClient.rpc<string>('complete_seller_oauth_authorization', {
        p_state: input.stateId,
        p_connection: input.connectionId,
        p_open_id: input.openId,
        p_name: input.sellerName ?? null,
        p_region: input.region ?? null,
        p_scopes: input.scopes,
        p_enc_access: input.encryptedAccessToken,
        p_enc_refresh: input.encryptedRefreshToken,
        p_access_exp: input.accessExpiresAt,
        p_refresh_exp: input.refreshExpiresAt,
        p_key_version: input.keyVersion,
      });
      if (result.error || result.data !== input.connectionId) persistenceFailure();
    },
  };
}
