// Seller OAuth start is intentionally separate from Creator Affiliate and
// Content Posting. It accepts only a user JWT plus an authorized workspace.
import { env, envOptional } from '../_shared/env.ts';
import { corsHeaders, parseOrigins } from '../_shared/http.ts';
import { rpcAsUser, serviceClient } from '../_shared/runtime.ts';
import { isTikTokShopEnabled } from '../_shared/tiktok-shop-availability.ts';
import { createSellerOAuthPersistence, type SellerOAuthRpcClient } from '../_shared/tiktok-shop-seller-persistence.ts';
import { handleSellerOAuthStart } from '../_shared/tiktok-shop-seller-start-handler.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'), parseOrigins(envOptional('WEB_URL')));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const response = await handleSellerOAuthStart(req, {
    enabled: isTikTokShopEnabled(),
    validateToken: async (token) => {
      // Verify expiry/signature before the user-scoped database RPC. The
      // returned identity is never accepted as workspace authority.
      const verified = await serviceClient().auth.getUser(token);
      return !verified.error && Boolean(verified.data.user);
    },
    persistenceForUser: (token) => {
      const userRpc: SellerOAuthRpcClient = {
        rpc: <T>(name: string, arguments_: Record<string, unknown>) =>
          rpcAsUser(`Bearer ${token}`, name, arguments_) as unknown as Promise<{
            data: T | null;
            error: { message?: string } | null;
          }>,
      };
      return createSellerOAuthPersistence(userRpc, userRpc);
    },
    serviceId: () => env('TIKTOK_SHOP_SELLER_SERVICE_ID'),
  });

  const resultHeaders = new Headers(response.headers);
  for (const [name, value] of Object.entries(headers)) resultHeaders.set(name, value);
  resultHeaders.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, headers: resultHeaders });
});
