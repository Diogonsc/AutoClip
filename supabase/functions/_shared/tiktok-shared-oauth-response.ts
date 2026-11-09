import { json, parseOrigins, redirect } from './http.ts';

/**
 * Produces a browser-safe Seller callback result. No provider payload or
 * callback input is reflected in either the redirect or the response body.
 */
export function sellerOAuthCallbackResponse(
  request: Request,
  headers: Record<string, string>,
  webUrl: string | undefined,
  result: 'connected' | 'error',
): Response {
  if (request.method !== 'GET') return json({ result, provider: 'seller' }, 200, headers);

  const base = parseOrigins(webUrl)[0];
  if (!base) {
    return new Response(
      result === 'connected'
        ? 'Conexão TikTok Shop processada. Você pode voltar ao aplicativo.'
        : 'Não foi possível concluir a conexão TikTok Shop. Volte ao aplicativo e tente novamente.',
      { status: 200, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } },
    );
  }
  const destination = new URL('/canais', base);
  destination.searchParams.set('tiktok_shop', result);
  const response = redirect(destination.toString());
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}
