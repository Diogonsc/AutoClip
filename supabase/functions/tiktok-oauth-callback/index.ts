// Callback do OAuth do TikTok (redirect_uri). O navegador chega aqui sem JWT (verify_jwt = false):
// a segurança vem do `state` de uso único, criado por create_oauth_state e consumido aqui.
import { handleCallback } from '../_shared/handlers.ts';
import { buildContext, log } from '../_shared/runtime.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve(async (req) => {
  try {
    const c = await buildContext();
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const r = await c.sb.rpc(fn, args);
      if (r.error) throw new Error(`${fn}: ${r.error.message}`);
      return r.data;
    };

    return await handleCallback(req, {
      webUrl: c.webUrl,
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
        getChannel: (id) => c.db.getChannel(id),
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
        markChannel: (id, status, code, message) => c.store.setChannelStatus(id, status, code, message),
      },
    });
  } catch (e) {
    log('callback.fatal', { error: e instanceof Error ? e.message : String(e) });
    return new Response('Não foi possível concluir a conexão. Feche esta janela e tente novamente.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
});
