// Entrada autenticada do TikTok Shop. A autorização e os tokens do Shop são
// independentes do Login Kit usado para publicar conteúdo no TikTok.
import { env, envOptional } from "../_shared/env.ts";
import { corsHeaders, isUuid, json, parseOrigins } from "../_shared/http.ts";
import { rpcAsUser, serviceClient } from "../_shared/runtime.ts";
import { decryptToken, encryptToken, importKey } from "../_shared/crypto.ts";

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

function creatorAuthorizeUrl(state: string) {
  const base = envOptional("TIKTOK_SHOP_CREATOR_AUTH_URL") ?? "https://shop.tiktok.com/alliance/creator/auth";
  const url = new URL(base);
  url.searchParams.set("app_key", env("TIKTOK_SHOP_APP_KEY"));
  url.searchParams.set("state", state);
  return url.toString();
}

const encoder = new TextEncoder();
const asText = (value: unknown) => typeof value === "string" ? value : value == null ? "" : String(value);

async function signature(path: string, params: Record<string, string>, body: string) {
  const pairs = Object.entries(params).filter(([key]) => key !== "sign").sort(([a], [b]) => a.localeCompare(b));
  const plain = `${env("TIKTOK_SHOP_APP_SECRET")}${path}${pairs.map(([key, value]) => `${key}${value}`).join("")}${body}${env("TIKTOK_SHOP_APP_SECRET")}`;
  const key = await crypto.subtle.importKey("raw", encoder.encode(env("TIKTOK_SHOP_APP_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(plain)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function shopRequest(path: string, token: string) {
  const params: Record<string, string> = { app_key: env("TIKTOK_SHOP_APP_KEY"), timestamp: String(Math.floor(Date.now() / 1000)), page_size: "100" };
  params.sign = await signature(path, params, "");
  const url = new URL(`https://open-api.tiktokglobalshop.com${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { "x-tts-access-token": token, Accept: "application/json" } });
  const payload = await response.json().catch(() => null) as { code?: number; message?: string; data?: Record<string, unknown> } | null;
  if (!response.ok || payload?.code !== 0 || !payload.data) throw new Error(payload?.message || `TikTok Shop respondeu HTTP ${response.status}`);
  return payload.data;
}

async function freshToken(connection: Record<string, unknown>, connectionId: string) {
  const key = await importKey(env("TOKEN_ENCRYPTION_KEY"));
  const expiresAt = typeof connection.access_token_expires_at === "string" ? Date.parse(connection.access_token_expires_at) : 0;
  if (expiresAt > Date.now() + 60_000 && typeof connection.encrypted_access_token === "string") return decryptToken(key, connection.encrypted_access_token, connectionId);
  if (typeof connection.encrypted_refresh_token !== "string") throw new Error("A autorização do TikTok Shop expirou. Reconecte o canal.");
  const refreshUrl = new URL("https://auth.tiktok-shops.com/api/v2/token/refresh");
  refreshUrl.searchParams.set("app_key", env("TIKTOK_SHOP_APP_KEY"));
  refreshUrl.searchParams.set("app_secret", env("TIKTOK_SHOP_APP_SECRET"));
  refreshUrl.searchParams.set("refresh_token", await decryptToken(key, connection.encrypted_refresh_token, connectionId));
  refreshUrl.searchParams.set("grant_type", "refresh_token");
  const response = await fetch(refreshUrl);
  const payload = await response.json().catch(() => null) as { code?: number; message?: string; data?: Record<string, unknown> } | null;
  const data = payload?.data;
  const access = typeof data?.access_token === "string" ? data.access_token : "";
  if (!response.ok || payload?.code !== 0 || !access) throw new Error(payload?.message || "Não foi possível renovar a autorização TikTok Shop.");
  const { data: updated, error: updateError } = await serviceClient().from("tiktok_shop_connections").update({
    encrypted_access_token: await encryptToken(key, access, connectionId),
    encrypted_refresh_token: typeof data?.refresh_token === "string" ? await encryptToken(key, data.refresh_token, connectionId) : connection.encrypted_refresh_token,
    access_token_expires_at: typeof data?.access_token_expire_in === "number" ? new Date(data.access_token_expire_in * 1000).toISOString() : null,
    refresh_token_expires_at: typeof data?.refresh_token_expire_in === "number" ? new Date(data.refresh_token_expire_in * 1000).toISOString() : null,
  }).eq("id", connectionId).select("id").maybeSingle();
  if (updateError || !updated) throw new Error("Não foi possível salvar a renovação do token TikTok Shop.");
  return access;
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"), parseOrigins(envOptional("WEB_URL")));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
  const authorization = req.headers.get("authorization");
  if (!authorization) return json({ error: "unauthorized" }, 401, cors);
  const body = await req.json().catch(() => null) as { action?: unknown; channel_id?: unknown; connection_id?: unknown } | null;
  try {
    if (body?.action === "authorize" && isUuid(body.channel_id)) {
      const created = await rpcAsUser(authorization, "create_tiktok_shop_connection", { p_channel: body.channel_id });
      if (created.error || !isUuid(created.data)) return json({ error: "forbidden", message: "Não foi possível preparar a conexão TikTok Shop." }, 403, cors);
      const state = await rpcAsUser(authorization, "create_tiktok_shop_oauth_state", { p_connection: created.data });
      if (state.error || typeof state.data !== "string") return json({ error: "internal" }, 500, cors);
      return json({ url: creatorAuthorizeUrl(state.data) }, 200, cors);
    }
    if (body?.action === "sync" && isUuid(body.connection_id)) {
      const access = await rpcAsUser(authorization, "assert_tiktok_shop_access", { p_connection: body.connection_id, p_level: "edit" });
      if (access.error) return json({ error: "forbidden", message: "Você não tem acesso a esta conexão." }, 403, cors);
      const sb = serviceClient();
      const { data: connection, error } = await sb.from("tiktok_shop_connections").select("*").eq("id", body.connection_id).maybeSingle();
      if (error || !connection) return json({ error: "not_found" }, 404, cors);
      if (connection.connection_status !== "CONNECTED") return json({ error: "reauth_required", message: "Autorize a conta de criador no TikTok Shop antes de sincronizar." }, 409, cors);
      const run = await sb.from("tiktok_shop_sync_runs").insert({ workspace_id: connection.workspace_id, connection_id: body.connection_id, kind: "PRODUCTS", status: "RUNNING" }).select("id").single();
      if (run.error || !run.data?.id) throw new Error("Não foi possível registrar o início da sincronização.");
      try {
        const data = await shopRequest("/affiliate_creator/202509/shop_products", await freshToken(connection, body.connection_id));
        const rows = [data.products, data.shop_products, data.product_list].find(Array.isArray) as Record<string, unknown>[] | undefined ?? [];
        const mapped = rows.map((product) => ({
          workspace_id: connection.workspace_id, connection_id: body.connection_id,
          external_product_id: asText(product.product_id || product.id), title: asText(product.title || product.product_name || "Produto TikTok Shop"),
          description: typeof product.description === "string" ? product.description : null,
          image_url: typeof product.image_url === "string" ? product.image_url : null,
          detail_url: typeof product.detail_link === "string" ? product.detail_link : null,
          promotion_url: typeof product.promotion_link === "string" ? product.promotion_link : null,
          currency: typeof product.currency === "string" ? product.currency : null,
          price: Number(product.price || product.sale_price) || null,
          commission_rate: Number(product.commission_rate) || null,
          commission_amount: Number(product.commission_amount) || null,
          availability: typeof product.status === "string" ? product.status : null, raw: product, synced_at: new Date().toISOString(),
        })).filter((product) => product.external_product_id);
        if (mapped.length) {
          const { error: productsError } = await sb.from("tiktok_shop_products").upsert(mapped, { onConflict: "connection_id,external_product_id" });
          if (productsError) throw new Error("Não foi possível salvar os produtos sincronizados.");
        }
        const { error: connectionUpdateError } = await sb.from("tiktok_shop_connections").update({ last_synced_at: new Date().toISOString(), last_error_code: null, last_error_message: null }).eq("id", body.connection_id);
        if (connectionUpdateError) throw new Error("Não foi possível concluir a sincronização da conexão.");
        const { error: runUpdateError } = await sb.from("tiktok_shop_sync_runs").update({ status: "SUCCEEDED", result: { products: mapped.length }, finished_at: new Date().toISOString() }).eq("id", run.data.id);
        if (runUpdateError) throw new Error("Não foi possível registrar o resultado da sincronização.");
        return json({ message: `${mapped.length} produto(s) sincronizado(s).` }, 200, cors);
      } catch (syncError) {
        const message = syncError instanceof Error ? syncError.message : "Falha na sincronização.";
        await sb.from("tiktok_shop_connections").update({ last_error_message: message.slice(0, 500), last_error_code: "SHOP_SYNC_FAILED" }).eq("id", body.connection_id);
        await sb.from("tiktok_shop_sync_runs").update({ status: "FAILED", error_message: message.slice(0, 500), finished_at: new Date().toISOString() }).eq("id", run.data.id);
        return json({ error: "sync_failed", message: "Não foi possível sincronizar o catálogo TikTok Shop." }, 502, cors);
      }
    }
    return json({ error: "invalid_request" }, 400, cors);
  } catch {
    // Nunca registrar erros brutos de chamadas OAuth: bibliotecas ou proxies podem
    // incluir a URL de refresh, que contém credenciais exigidas pela API do TikTok Shop.
    console.log(JSON.stringify({ msg: "shop.unexpected", action: body?.action ?? "unknown" }));
    return json({ error: "internal", message: "Não foi possível concluir a operação." }, 500, cors);
  }
});
