/**
 * Server-side dispatch for the one public TikTok redirect URI.
 *
 * The browser only forwards the opaque OAuth state. The provider is inferred
 * from a server-side lookup of the state that was created before redirecting
 * to TikTok; query parameters are deliberately not used for routing.
 */
export type SharedTikTokOAuthProvider = 'content_posting' | 'seller';

export type SharedTikTokOAuthParams = {
  state: string | null;
  code: string | null;
  error: string | null;
  scopes: string | null;
};

export type SharedTikTokOAuthRouterDependencies = {
  classifyState(state: string): Promise<SharedTikTokOAuthProvider | 'unknown' | 'ambiguous'>;
  handleContentPosting(request: Request): Promise<Response>;
  handleSeller(request: Request, params: SharedTikTokOAuthParams, signal: AbortSignal): Promise<Response>;
  invalidState(request: Request): Response;
  unavailable(request: Request): Response;
  methodNotAllowed(request: Request): Response;
};

function stringParam(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Read only a clone so the selected handler receives the original body. */
export async function readSharedTikTokOAuthParams(request: Request): Promise<SharedTikTokOAuthParams | null> {
  if (request.method === 'GET') {
    const query = new URL(request.url).searchParams;
    return {
      state: stringParam(query.get('state')),
      code: stringParam(query.get('code')),
      error: stringParam(query.get('error')),
      scopes: stringParam(query.get('scopes')),
    };
  }

  if (request.method !== 'POST') return null;
  const body = await request.clone().json().catch(() => null) as Record<string, unknown> | null;
  return {
    state: stringParam(body?.state),
    code: stringParam(body?.code),
    error: stringParam(body?.error),
    scopes: stringParam(body?.scopes),
  };
}

/**
 * Dispatches only a state that was proven to belong to exactly one provider.
 * Unknown and ambiguous values never reach either provider's state consumer.
 */
export async function routeSharedTikTokOAuthCallback(
  request: Request,
  dependencies: SharedTikTokOAuthRouterDependencies,
): Promise<Response> {
  const params = await readSharedTikTokOAuthParams(request);
  if (!params) return dependencies.methodNotAllowed(request);
  if (!params.state) return dependencies.invalidState(request);

  let provider: SharedTikTokOAuthProvider | 'unknown' | 'ambiguous';
  try {
    provider = await dependencies.classifyState(params.state);
  } catch {
    // A lookup failure is not evidence that this belongs to Content Posting.
    return dependencies.unavailable(request);
  }

  if (provider === 'content_posting') return dependencies.handleContentPosting(request);
  if (provider === 'seller') return dependencies.handleSeller(request, params, request.signal);
  return dependencies.invalidState(request);
}
