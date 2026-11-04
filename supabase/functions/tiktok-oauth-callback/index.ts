// Callback do OAuth do TikTok (redirect_uri). O navegador chega aqui sem JWT (verify_jwt = false):
// a segurança vem do `state` de uso único, criado por create_oauth_state e consumido aqui.
import { handleCallback } from '../_shared/handlers.ts';
import { buildContext, log } from '../_shared/runtime.ts';
import { corsHeaders, json, parseOrigins } from '../_shared/http.ts';
import { envOptional } from '../_shared/env.ts';

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

    return await handleCallback(req, {
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
    });
  } catch {
    log('callback.fatal');
    return json({ error: 'callback_unavailable' }, 500, headers);
  }
});
