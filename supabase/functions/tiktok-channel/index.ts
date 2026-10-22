// Ações do front sobre um canal TikTok: connect | creator_info | disconnect.
// O JWT do usuário é repassado às RPCs: quem decide a permissão é o banco (assert_channel_access).
import { parseOrigins } from '../_shared/http.ts';
import { handleChannel } from '../_shared/handlers.ts';
import { buildContext, log, rpcAsUser } from '../_shared/runtime.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve(async (req) => {
  try {
    const c = await buildContext();
    return await handleChannel(req, {
      origins: parseOrigins(c.webUrl),
      cfg: c.cfg,
      redirectUri: c.redirectUri,
      baseScopes: ['user.info.basic'],
      rpcAsUser,
      ensureToken: c.ensureToken,
      tiktok: c.tiktok,
      db: {
        getChannel: c.db.getChannel,
        saveCreatorInfo: c.db.saveCreatorInfo,
        disconnectChannel: c.channelDb.disconnectChannel,
      },
      log,
    });
  } catch (e) {
    log('channel.fatal', { error: e instanceof Error ? e.message : String(e) });
    return new Response(JSON.stringify({ error: 'internal' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
