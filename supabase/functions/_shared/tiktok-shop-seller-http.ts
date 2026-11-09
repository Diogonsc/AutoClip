import {
  completeSellerOAuthCallback,
  startSellerOAuth,
  type SellerOAuthCallbackDependencies,
  type SellerOAuthStartDependencies,
} from './tiktok-shop-seller-flow.ts';

export async function handleSellerOAuthStartRequest(
  request: Request,
  workspaceId: string | null,
  dependencies: SellerOAuthStartDependencies,
): Promise<Response> {
  if (request.method !== 'POST' || !workspaceId) {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }
  try {
    const result = await startSellerOAuth(workspaceId, dependencies);
    return Response.json({ authorization_url: result.authorizationUrl });
  } catch {
    return Response.json({ error: 'seller_oauth_unavailable' }, { status: 404 });
  }
}

/**
 * Not registered with Deno.serve in this phase: the existing public redirect URI
 * is shared with Content Posting and requires a reviewed routing decision first.
 */
export async function handleSellerOAuthCallbackRequest(
  request: Request,
  dependencies: SellerOAuthCallbackDependencies,
): Promise<Response> {
  if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  const query = new URL(request.url).searchParams;
  try {
    await completeSellerOAuthCallback({
      state: query.get('state'),
      code: query.get('code'),
      error: query.get('error'),
    }, dependencies, request.signal);
    return Response.json({ status: 'connected' });
  } catch {
    return Response.json({ error: 'seller_oauth_failed' }, { status: 400 });
  }
}
