/**
 * Hard deny for the initial Login Kit + Content Posting launch.
 * Re-enable only with a reviewed code change after separate homologation and
 * explicit owner authorization; no request, database row, or client config can
 * change this decision.
 */
export const TIKTOK_SHOP_ENABLED = false;

export function isTikTokShopEnabled(): boolean {
  return TIKTOK_SHOP_ENABLED;
}

export function tikTokShopUnavailableResponse(headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('content-type', 'application/json; charset=utf-8');
  responseHeaders.set('cache-control', 'no-store');
  return new Response(JSON.stringify({ error: 'feature_unavailable' }), {
    status: 404,
    headers: responseHeaders,
  });
}
