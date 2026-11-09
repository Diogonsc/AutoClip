// Callback do OAuth do TikTok (redirect_uri). O navegador chega aqui sem JWT (verify_jwt = false):
// a segurança vem do `state` de uso único, criado por create_oauth_state e consumido aqui.
import { handleCallback, type CallbackHandlerDeps } from '../_shared/handlers.ts';
import { buildContext, log } from '../_shared/runtime.ts';
import { corsHeaders, json, parseOrigins } from '../_shared/http.ts';
import { env, envOptional } from '../_shared/env.ts';
import { isTikTokShopEnabled } from '../_shared/tiktok-shop-availability.ts';
import { sellerTokenRequest } from '../_shared/tiktok-shop-seller-oauth.ts';
import { importSellerCredentialKey } from '../_shared/tiktok-shop-seller-crypto.ts';
import { completeSellerOAuthCallback, SELLER_REQUIRED_SCOPES } from '../_shared/tiktok-shop-seller-flow.ts';
import { createSellerOAuthPersistence, type SellerOAuthRpcClient } from '../_shared/tiktok-shop-seller-persistence.ts';
import { routeSharedTikTokOAuthCallback, type SharedTikTokOAuthParams } from '../_shared/tiktok-shared-oauth-router.ts';
import { sellerOAuthCallbackResponse } from '../_shared/tiktok-shared-oauth-response.ts';
import { classifySharedTikTokOAuthState, type SharedOAuthStateDatabase } from '../_shared/tiktok-shared-oauth-classifier.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve(async (req) => {
  const origins = parseOrigins(envOptional('WEB_URL'));
  const headers = corsHeaders(req.headers.get('origin'), origins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  try {
    const c = await buildContext();
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const r = await c.sb.rpc(fn, args);
      if (r.error) throw new Error(`${fn}: ${r.error.message}`);
      return r.data;
    };

    const contentDependencies: CallbackHandlerDeps = {
      webUrl: c.webUrl,
      origins,
      log,
      oauth: {
        tiktok: c.tiktok,
        cfg: c.cfg,
        redirectUri: c.redirectUri,
        key: c.key,
        now: c.now,
        log,
        consumeState: async (state) =>
          (await rpc('consume_oauth_state', { p_state: state })) as {
            workspace_id: string;
            channel_id: string;
            required_scopes: string[];
          } | null,
        getChannel: async (id, workspaceId) => {
          const channel = await c.db.getChannel(id);
          return channel?.workspace_id === workspaceId ? channel : null;
        },
        saveConnection: async (a) =>
          (await rpc('save_tiktok_connection', {
            p_channel: a.channelId,
            p_open_id: a.openId,
            p_scopes: a.scopes,
            p_enc_access: a.encAccess,
            p_enc_refresh: a.encRefresh,
            p_access_exp: a.accessExp.toISOString(),
            p_refresh_exp: a.refreshExp ? a.refreshExp.toISOString() : null,
          })) as 'ok' | 'duplicate',
        markChannel: (id, status, code, message) => c.db.setChannelStatus(id, status, code, message),
      },
    };

    // Keep the already-published Content Posting callback independent from
    // Seller schema/secrets while Shop remains fail-closed.
    if (!isTikTokShopEnabled()) return await handleCallback(req, contentDependencies);

    // The service-role client is confined to this backend adapter. It checks
    // both active state stores before either flow can consume a state.
    const stateDatabase: SharedOAuthStateDatabase = {
      async contentState(state) {
        const result = await c.sb
          .from('oauth_states')
          .select('state')
          .eq('state', state)
          .gt('expires_at', new Date().toISOString())
          .maybeSingle();
        return { found: Boolean(result.data), failed: Boolean(result.error) };
      },
      async sellerState(stateHash) {
        const result = await c.sb
          .from('seller_oauth_states')
          .select('id')
          .eq('state_hash', stateHash)
          .eq('status', 'PENDING')
          .gt('expires_at', new Date().toISOString())
          .maybeSingle();
        return { found: Boolean(result.data), failed: Boolean(result.error) };
      },
    };
    const sellerRpc: SellerOAuthRpcClient = {
      rpc: <T>(name: string, arguments_: Record<string, unknown>) =>
        c.sb.rpc(name, arguments_) as unknown as Promise<{
          data: T | null;
          error: { message?: string } | null;
        }>,
    };

    const invalidState = () => json({ result: 'invalid_state' }, 200, headers);
    const unavailable = () => json({ result: 'error' }, 503, headers);
    const sellerCallback = async (request: Request, params: SharedTikTokOAuthParams, signal: AbortSignal) => {
      try {
        const persistence = createSellerOAuthPersistence(sellerRpc, sellerRpc);
        const encryptionKey = await importSellerCredentialKey(env('TIKTOK_SHOP_SELLER_TOKEN_ENCRYPTION_KEY'));
        await completeSellerOAuthCallback(params, {
          enabled: true,
          persistence,
          encryptionKey,
          exchangeCode: (code, requestSignal) => sellerTokenRequest('exchange', {
            appKey: env('TIKTOK_SHOP_APP_KEY'),
            appSecret: env('TIKTOK_SHOP_APP_SECRET'),
            value: code,
            requiredScopes: [...SELLER_REQUIRED_SCOPES],
            signal: requestSignal,
          }),
        }, signal);
        return sellerOAuthCallbackResponse(request, headers, c.webUrl, 'connected');
      } catch {
        // Never reflect the authorization code, token response or persistence details.
        log('seller.callback_failed');
        // A controlled 200 response lets the web callback distinguish Seller
        // failure from Content Posting without exposing a provider error body.
        return sellerOAuthCallbackResponse(request, headers, c.webUrl, 'error');
      }
    };

    return await routeSharedTikTokOAuthCallback(req, {
      classifyState: (state) => classifySharedTikTokOAuthState(state, stateDatabase),
      handleContentPosting: (request) => handleCallback(request, contentDependencies),
      handleSeller: sellerCallback,
      invalidState,
      unavailable,
      methodNotAllowed: () => json({ error: 'method_not_allowed' }, 405, headers),
    });
  } catch {
    log('callback.fatal');
    return json({ error: 'callback_unavailable' }, 500, headers);
  }
});
