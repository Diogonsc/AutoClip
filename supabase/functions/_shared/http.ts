// Utilitários HTTP das Edge Functions (puros: testáveis no Node).

/** Lista de origens permitidas a partir de WEB_URL (separadas por vírgula, sem barra final). */
export function parseOrigins(value: string | undefined | null): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/** CORS restrito: só ecoa a origem se estiver na lista (nunca "*"). */
export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** Destino do redirecionamento do callback OAuth: primeira origem de WEB_URL + resultado. */
export function callbackRedirectUrl(webUrl: string | undefined, result: string): string | null {
  const base = parseOrigins(webUrl)[0];
  if (!base) return null;
  return `${base}/canais?tiktok=${encodeURIComponent(result)}`;
}
