import { isUuid, json } from './http.ts';
import { tikTokShopUnavailableResponse } from './tiktok-shop-availability.ts';
import { handleSellerOAuthStartRequest } from './tiktok-shop-seller-http.ts';
import type { SellerOAuthPersistence } from './tiktok-shop-seller-flow.ts';

export type SellerOAuthStartHandlerDependencies = {
  enabled: boolean;
  validateToken(token: string): Promise<boolean>;
  persistenceForUser(token: string): SellerOAuthPersistence;
  serviceId(): string;
};

function bearerToken(value: string | null): string | null {
  const match = value?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}

/**
 * HTTP-domain handler for the authenticated Seller start endpoint. The only
 * browser-controlled identifier is an UUID; the database derives membership.
 */
export async function handleSellerOAuthStart(
  request: Request,
  dependencies: SellerOAuthStartHandlerDependencies,
): Promise<Response> {
  if (!dependencies.enabled) return tikTokShopUnavailableResponse();
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const token = bearerToken(request.headers.get('authorization'));
  if (!token || !(await dependencies.validateToken(token))) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => null) as { workspace_id?: unknown } | null;
  if (!isUuid(body?.workspace_id)) return json({ error: 'invalid_request' }, 400);

  return handleSellerOAuthStartRequest(request, body.workspace_id, {
    enabled: true,
    serviceId: dependencies.serviceId(),
    persistence: dependencies.persistenceForUser(token),
  });
}
