// Pipeline interno de Shoppable Video: recebe um job já autorizado pelo worker,
// envia o arquivo ao TikTok Shop e publica com a âncora do produto afiliado.
import { decryptToken, encryptToken, importKey, timingSafeEqual } from "../_shared/crypto.ts";
import { env } from "../_shared/env.ts";
import { json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/runtime.ts";

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };
const encoder = new TextEncoder();

async function sign(path: string, params: Record<string, string>, body = "") {
  const secret = env("TIKTOK_SHOP_APP_SECRET");
  const values = Object.entries(params).filter(([k]) => k !== "sign").sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}${v}`).join("");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hash = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${secret}${path}${values}${body}${secret}`)));
  return [...hash].map((v) => v.toString(16).padStart(2, "0")).join("");
}

async function token(connection: Record<string, unknown>, connectionId: string) {
  const key = await importKey(env("TOKEN_ENCRYPTION_KEY"));
  if (typeof connection.encrypted_access_token !== "string") throw new Error("Conexão TikTok Shop sem token.");
  const expires = typeof connection.access_token_expires_at === "string" ? Date.parse(connection.access_token_expires_at) : 0;
  if (expires > Date.now() + 60_000) return decryptToken(key, connection.encrypted_access_token, connectionId);
  if (typeof connection.encrypted_refresh_token !== "string") throw new Error("Autorize novamente o TikTok Shop.");
  const u = new URL("https://auth.tiktok-shops.com/api/v2/token/refresh");
  u.search = new URLSearchParams({ app_key: env("TIKTOK_SHOP_APP_KEY"), app_secret: env("TIKTOK_SHOP_APP_SECRET"), refresh_token: await decryptToken(key, connection.encrypted_refresh_token, connectionId), grant_type: "refresh_token" }).toString();
  const res = await fetch(u); const payload = await res.json().catch(() => null) as { code?: number; data?: Record<string, unknown>; message?: string } | null;
  const data = payload?.data; const access = typeof data?.access_token === "string" ? data.access_token : "";
  if (!res.ok || payload?.code !== 0 || !access) throw new Error(payload?.message ?? "Falha ao renovar token TikTok Shop.");
  const { data: updated, error: updateError } = await serviceClient().from("tiktok_shop_connections")
    .update({ encrypted_access_token: await encryptToken(key, access, connectionId), encrypted_refresh_token: typeof data?.refresh_token === "string" ? await encryptToken(key, data.refresh_token, connectionId) : connection.encrypted_refresh_token, access_token_expires_at: typeof data?.access_token_expire_in === "number" ? new Date(data.access_token_expire_in * 1000).toISOString() : null })
    .eq("id", connectionId)
    .select("id")
    .maybeSingle();
  if (updateError || !updated) throw new Error("Não foi possível salvar a renovação do token TikTok Shop.");
  return access;
}

async function request(path: string, access: string, method: "GET" | "POST", body?: string, form?: FormData) {
  const params = { app_key: env("TIKTOK_SHOP_APP_KEY"), timestamp: String(Math.floor(Date.now() / 1000)) };
  const url = new URL(`https://open-api.tiktokglobalshop.com${path}`);
  url.search = new URLSearchParams({ ...params, sign: await sign(path, params, form ? "" : body ?? "") }).toString();
  const res = await fetch(url, { method, headers: { "x-tts-access-token": access, ...(form ? {} : { "Content-Type": "application/json" }) }, body: form ?? body });
  const payload = await res.json().catch(() => null) as { code?: number; message?: string; data?: Record<string, unknown> } | null;
  if (!res.ok || payload?.code !== 0 || !payload.data) throw new Error(payload?.message ?? `TikTok Shop HTTP ${res.status}`);
  return payload.data;
}

Deno.serve(async (req) => {
  if (req.method !== "POST" || !timingSafeEqual(req.headers.get("x-worker-secret") ?? "", env("WORKER_SECRET"))) return json({ error: "unauthorized" }, 401);
  const input = await req.json().catch(() => null) as { action?: string; job_id?: string; video_id?: string } | null;
  try {
    const sb = serviceClient();
    if (input?.action === "publish" && input.job_id) {
      const { data: job, error: jobError } = await sb.from("publication_jobs").select("id,workspace_id,channel_id,media_asset_id,caption,shop_product_id,shop_anchor_title,shop_is_ai_generated").eq("id", input.job_id).single();
      if (jobError || !job) throw new Error("Publicação não encontrada.");
      if (!job?.shop_product_id || !job.shop_anchor_title) throw new Error("Publicação sem produto afiliado.");
      const { data: media, error: mediaError } = await sb.from("media_assets").select("id,workspace_id,storage_key,status,mime_type,file_size_bytes").eq("id", job.media_asset_id).eq("workspace_id", job.workspace_id).maybeSingle();
      if (mediaError || !media || media.status !== "READY" || !media.storage_key) throw new Error("Mídia autorizada não está disponível para esta publicação.");
      const { data: product, error: productError } = await sb.from("tiktok_shop_products").select("external_product_id,connection_id,workspace_id").eq("id", job.shop_product_id).eq("workspace_id", job.workspace_id).maybeSingle();
      const { data: connection, error: connectionError } = product ? await sb.from("tiktok_shop_connections").select("*").eq("id", product.connection_id).eq("workspace_id", job.workspace_id).eq("channel_id", job.channel_id).eq("connection_status", "CONNECTED").maybeSingle() : { data: null, error: null };
      if (productError || connectionError || !product || !connection) throw new Error("Produto ou conexão TikTok Shop indisponível para este workspace e canal.");
      const { data: file, error: downloadError } = await sb.storage.from("media").download(media.storage_key);
      if (downloadError || !file) throw new Error("Vídeo autorizado não encontrado no armazenamento.");
      if (file.size > 10 * 1024 * 1024) throw new Error("Vídeos Shop acima de 10 MB exigem upload multipart; reduza o arquivo antes de publicar.");
      const access = await token(connection, connection.id);
      const form = new FormData(); form.append("data", file, "video.mp4");
      const uploaded = await request("/affiliate_creator/202505/videos/video_files", access, "POST", undefined, form);
      const fileId = typeof (uploaded.video_file as Record<string, unknown> | undefined)?.id === "string" ? (uploaded.video_file as Record<string, unknown>).id as string : "";
      if (!fileId) throw new Error("TikTok Shop não retornou file_id.");
      const payload = JSON.stringify({ video_info: { file_id: fileId, title: job.caption, is_ai_generated: job.shop_is_ai_generated === true }, product_link_info: { product_id: product.external_product_id, title: job.shop_anchor_title } });
      const posted = await request("/affiliate_creator/202607/videos", access, "POST", payload);
      const video = posted.video as Record<string, unknown> | undefined; const id = typeof video?.id === "string" ? video.id : typeof posted.video_id === "string" ? posted.video_id : "";
      if (!id) throw new Error("TikTok Shop não retornou video_id.");
      const { data: savedJob, error: saveJobError } = await sb.from("publication_jobs").update({ shop_video_id: id }).eq("id", job.id).eq("workspace_id", job.workspace_id).select("id").maybeSingle();
      if (saveJobError || !savedJob) throw new Error("O vídeo foi publicado, mas não foi possível registrar o identificador da publicação.");
      return json({ video_id: id });
    }
    if (input?.action === "status" && input.video_id) {
      const { data: job, error: jobError } = await sb.from("publication_jobs").select("workspace_id,channel_id,shop_product_id").eq("shop_video_id", input.video_id).maybeSingle();
      if (jobError || !job?.shop_product_id) throw new Error("Publicação Shop não encontrada para o vídeo.");
      const { data: product, error: productError } = await sb.from("tiktok_shop_products").select("connection_id").eq("id", job.shop_product_id).eq("workspace_id", job.workspace_id).maybeSingle();
      const { data: connection, error: connectionError } = product ? await sb.from("tiktok_shop_connections").select("*").eq("id", product.connection_id).eq("workspace_id", job.workspace_id).eq("channel_id", job.channel_id).eq("connection_status", "CONNECTED").maybeSingle() : { data: null, error: null };
      if (productError || connectionError || !connection) throw new Error("Conexão Shop não encontrada para o vídeo.");
      const data = await request(`/affiliate_creator/202509/videos/${encodeURIComponent(input.video_id)}/status`, await token(connection, connection.id), "GET");
      const video = data.video as Record<string, unknown> | undefined;
      return json({ status: typeof video?.status === "string" ? video.status : typeof data.status === "string" ? data.status : "PROCESSING", reason: typeof video?.fail_reason === "string" ? video.fail_reason : undefined });
    }
    return json({ error: "invalid_request" }, 400);
  } catch (error) { return json({ error: "shop_publish_failed", message: error instanceof Error ? error.message : "Falha na publicação Shop." }, 502); }
});
