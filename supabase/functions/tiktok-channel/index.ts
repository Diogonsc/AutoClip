// Ações do front sobre um canal TikTok: connect | creator_info | disconnect.
// O JWT do usuário é repassado às RPCs: quem decide a permissão é o banco (assert_channel_access).
import { envOptional } from "../_shared/env.ts";
import { corsHeaders, json, parseOrigins } from "../_shared/http.ts";
import { handleChannel } from "../_shared/handlers.ts";
import { buildContext, log, rpcAsUser } from "../_shared/runtime.ts";

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};

Deno.serve(async (req) => {
  // CORS primeiro e sem depender de nenhum secret: assim o navegador sempre vê a resposta real
  // (inclusive erros de configuração) em vez de um "bloqueado por CORS" enganoso.
  const cors = corsHeaders(
    req.headers.get("origin"),
    parseOrigins(envOptional("WEB_URL")),
  );
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });

  try {
    const c = await buildContext();
    return await handleChannel(req, {
      origins: parseOrigins(c.webUrl),
      cfg: c.cfg,
      redirectUri: c.redirectUri,
      baseScopes: ["user.info.basic"],
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
    log("channel.fatal", { error: e instanceof Error ? e.message : String(e) });
    return json(
      {
        error: "server_misconfigured",
        message:
          "O servidor não está configurado corretamente. Tente novamente mais tarde.",
      },
      500,
      cors,
    );
  }
});
