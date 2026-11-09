import { hashSellerState } from './tiktok-shop-seller-oauth.ts';
import type { SharedTikTokOAuthProvider } from './tiktok-shared-oauth-router.ts';

export type SharedOAuthStateLookup = { found: boolean; failed: boolean };

export type SharedOAuthStateDatabase = {
  contentState(state: string): Promise<SharedOAuthStateLookup>;
  sellerState(stateHash: string): Promise<SharedOAuthStateLookup>;
};

/**
 * Classifies an opaque callback state from records created server-side before
 * redirecting to TikTok. Ambiguity is rejected rather than resolved by order.
 */
export async function classifySharedTikTokOAuthState(
  state: string,
  database: SharedOAuthStateDatabase,
): Promise<SharedTikTokOAuthProvider | 'unknown' | 'ambiguous'> {
  const sellerHash = await hashSellerState(state);
  const [content, seller] = await Promise.all([
    database.contentState(state),
    database.sellerState(sellerHash),
  ]);
  if (content.failed || seller.failed) throw new Error('oauth state lookup failed');
  if (content.found && seller.found) return 'ambiguous';
  if (content.found) return 'content_posting';
  if (seller.found) return 'seller';
  return 'unknown';
}
