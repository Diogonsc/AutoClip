const SHOP_OAUTH_ORIGIN = 'https://auth.tiktok-shops.com';
const SHOP_OAUTH_PATHS = new Set(['/api/v2/token/get', '/api/v2/token/refresh']);

/** Credential-bearing Shop token endpoints are GET/query by the official Creator flow.
 * Pin origin/path and reject redirects so query credentials cannot be forwarded elsewhere.
 */
export async function fetchShopOAuth(
  input: URL,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (input.origin !== SHOP_OAUTH_ORIGIN || !SHOP_OAUTH_PATHS.has(input.pathname) ||
    input.username || input.password || input.hash) {
    throw new Error('TikTok Shop OAuth endpoint rejected by local destination guard.');
  }
  return fetchImpl(input, { ...init, redirect: 'error' });
}
