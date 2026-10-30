// Callback OAuth do Creator Affiliate. Troca o code no servidor e cifra os tokens.
import { encryptToken, importKey } from "../_shared/crypto.ts";
import { env, envOptional } from "../_shared/env.ts";
import { json, parseOrigins, redirect } from "../_shared/http.ts";
import { serviceClient } from "../_shared/runtime.ts";

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

function finish(result: string) {
  const web = parseOrigins(envOptional("WEB_URL"))[0];
  return web ? redirect(`${web}/shop?shop=${encodeURIComponent(result)}`) : new Response("Conexão TikTok Shop processada. Você pode fechar esta janela.", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const query = new URL(req.url).searchParams;
  const state = query.get("state");
  const code = query.get("code");
  if (!state || !code || query.get("error")) return finish("denied");
  try {
    const sb = serviceClient();
    const consumed = await sb.rpc("consume_tiktok_shop_oauth_state", { p_state: state });
    const value = consumed.data as { connection_id?: string } | null;
    if (consumed.error || !value?.connection_id) return finish("invalid_state");
    const tokenUrl = new URL("https://auth.tiktok-shops.com/api/v2/token/get");
    tokenUrl.searchParams.set("app_key", env("TIKTOK_SHOP_APP_KEY"));
    tokenUrl.searchParams.set("app_secret", env("TIKTOK_SHOP_APP_SECRET"));
    tokenUrl.searchParams.set("auth_code", code);
    tokenUrl.searchParams.set("grant_type", "authorized_code");
    const response = await fetch(tokenUrl, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => null) as { code?: number; message?: string; data?: Record<string, unknown> } | null;
    const data = payload?.data;
    const access = typeof data?.access_token === "string" ? data.access_token : "";
    const refresh = typeof data?.refresh_token === "string" ? data.refresh_token : "";
    const userType = Number(data?.user_type);
    if (!response.ok || payload?.code !== 0 || !access || userType !== 1) {
      const { error: saveError } = await sb.from("tiktok_shop_connections").update({ connection_status: "ERROR", last_error_code: String(payload?.code ?? response.status), last_error_message: "A autorização do criador não foi aceita pelo TikTok Shop." }).eq("id", value.connection_id);
      if (saveError) throw new Error("Não foi possível registrar a falha de autorização TikTok Shop.");
      return finish("error");
    }
    const key = await importKey(env("TOKEN_ENCRYPTION_KEY"));
    const exp = typeof data?.access_token_expire_in === "number" ? new Date(data.access_token_expire_in * 1000).toISOString() : null;
    const refreshExp = typeof data?.refresh_token_expire_in === "number" ? new Date(data.refresh_token_expire_in * 1000).toISOString() : null;
    const scopes = Array.isArray(data?.granted_scopes) ? data.granted_scopes.filter((v): v is string => typeof v === "string") : [];
    const { data: saved, error: saveError } = await sb.from("tiktok_shop_connections").update({
      creator_id: typeof data?.open_id === "string" ? data.open_id : null,
      encrypted_access_token: await encryptToken(key, access, value.connection_id),
      encrypted_refresh_token: refresh ? await encryptToken(key, refresh, value.connection_id) : null,
      access_token_expires_at: exp, refresh_token_expires_at: refreshExp, granted_scopes: scopes,
      connection_status: "CONNECTED", last_error_code: null, last_error_message: null,
    }).eq("id", value.connection_id).select("id").maybeSingle();
    if (saveError || !saved) throw new Error("Não foi possível salvar a autorização TikTok Shop.");
    return finish("connected");
  } catch {
    // Não incluir o erro bruto: ele pode conter parâmetros da URL OAuth.
    console.log(JSON.stringify({ msg: "shop.callback_error" }));
    return finish("error");
  }
});
