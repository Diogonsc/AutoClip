const encoder = new TextEncoder();
const API_HOST = "https://open-api.tiktokglobalshop.com";
const API_HOSTS = new Set(["open-api.tiktokglobalshop.com"]);

export type ShopApiErrorCode = "unauthorized" | "forbidden" | "rate_limited" | "signature" | "cancelled" | "timeout" | "network" | "unexpected_response";
export class ShopApiError extends Error { constructor(public readonly code: ShopApiErrorCode) { super("TikTok Shop request failed"); } }
export type SellerShop = { shop_id: string; shop_cipher: string; name?: string; region?: string; seller_type?: string };
export type SearchProductsResult = { products: Record<string, unknown>[]; next_page_token?: string; total_count?: number };
type Config = { appKey: string; appSecret: string; accessToken: string; baseUrl?: string; fetchImpl?: typeof fetch; now?: () => number };

export function sellerAuthorizeUrl(authUrl: string, serviceId: string, state: string, redirectUri?: string): string {
  const url = new URL(authUrl);
  if (url.protocol !== "https:" || !serviceId || !state) throw new Error("Seller OAuth configuration is invalid");
  if (redirectUri && new URL(redirectUri).protocol !== "https:") throw new Error("Seller OAuth redirect is invalid");
  url.searchParams.set("service_id", serviceId); url.searchParams.set("state", state);
  if (redirectUri) url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}
export function normalizeSellerShop(value: unknown): SellerShop | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const shop_id = typeof row.id === "string" ? row.id : typeof row.shop_id === "string" ? row.shop_id : "";
  const shop_cipher = typeof row.cipher === "string" ? row.cipher : typeof row.shop_cipher === "string" ? row.shop_cipher : "";
  if (!/^\d{10,}$/.test(shop_id) || !shop_cipher) return null;
  return { shop_id, shop_cipher, ...(typeof row.name === "string" ? { name: row.name } : {}), ...(typeof row.region === "string" ? { region: row.region } : {}), ...(typeof row.seller_type === "string" ? { seller_type: row.seller_type } : {}) };
}
export function validPageSize(value: unknown, max = 100): number { const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`page_size must be an integer between 1 and ${max}`); return n; }
export function validProductId(value: unknown): string { if (typeof value !== "string" || !/^\d{10,}$/.test(value)) throw new Error("product_id is invalid"); return value; }
export function validatedApiHost(value?: string): string { const u = new URL(value || API_HOST); if (u.protocol !== "https:" || u.username || u.password || u.pathname !== "/" || !API_HOSTS.has(u.hostname)) throw new Error("TikTok Shop API host is not allowed"); return u.origin; }
export async function signSellerRequest(secret: string, path: string, params: Record<string,string>, body: string): Promise<string> {
  const pairs = Object.entries(params).filter(([key]) => key !== "sign" && key !== "access_token").sort(([a], [b]) => a.localeCompare(b));
  const plain = `${secret}${path}${pairs.map(([k,v]) => `${k}${v}`).join("")}${body}${secret}`;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(plain))), b => b.toString(16).padStart(2, "0")).join("");
}

export class TikTokShopSellerClient {
  private readonly host: string; private readonly fetchImpl: typeof fetch; private readonly now: () => number;
  constructor(private readonly config: Config) { this.host = validatedApiHost(config.baseUrl); this.fetchImpl = config.fetchImpl ?? fetch; this.now = config.now ?? Date.now; }
  async authorizedShops(signal?: AbortSignal): Promise<SellerShop[]> { const data = await this.request("GET", "/authorization/202309/shops", {}, "", signal); if (!Array.isArray(data.shops)) throw new ShopApiError("unexpected_response"); return data.shops.map(normalizeSellerShop).filter((x): x is SellerShop => !!x); }
  async searchProducts(input: { shopCipher: string; pageSize?: number; pageToken?: string; filters?: Record<string,unknown>; signal?: AbortSignal }): Promise<SearchProductsResult> {
    if (!input.shopCipher) throw new Error("shop_cipher is required"); const body = JSON.stringify(input.filters ?? {});
    const data = await this.request("POST", "/product/202502/products/search", { shop_cipher: input.shopCipher, page_size: String(validPageSize(input.pageSize ?? 20)), ...(input.pageToken ? { page_token: input.pageToken } : {}) }, body, input.signal);
    if (!Array.isArray(data.products)) throw new ShopApiError("unexpected_response");
    return { products: data.products.filter((x): x is Record<string,unknown> => !!x && typeof x === "object"), ...(typeof data.next_page_token === "string" ? { next_page_token: data.next_page_token } : {}), ...(typeof data.total_count === "number" ? { total_count: data.total_count } : {}) };
  }
  async *searchProductPages(input: { shopCipher: string; pageSize?: number; filters?: Record<string,unknown>; maxPages?: number; signal?: AbortSignal }): AsyncGenerator<SearchProductsResult> {
    const max = Number(input.maxPages ?? 100); if (!Number.isInteger(max) || max < 1 || max > 100) throw new Error("maxPages must be between 1 and 100");
    let token: string | undefined; const seen = new Set<string>();
    for (let page = 0; page < max; page++) { const result = await this.searchProducts({ ...input, pageToken: token }); yield result; token = result.next_page_token; if (!token || seen.has(token)) return; seen.add(token); }
  }
  async getProduct(productId: unknown, shopCipher: string): Promise<never> { validProductId(productId); if (!shopCipher) throw new Error("shop_cipher is required"); throw new Error("Get Product endpoint is not confirmed for this application"); }
  private async request(method: "GET" | "POST", path: string, extra: Record<string,string>, body: string, signal?: AbortSignal): Promise<Record<string,any>> {
    if (signal?.aborted) throw new ShopApiError("cancelled"); const params = { app_key: this.config.appKey, timestamp: String(Math.floor(this.now() / 1000)), ...extra }; const url = new URL(path, this.host);
    for (const [key, value] of Object.entries({ ...params, sign: await signSellerRequest(this.config.appSecret, path, params, body) })) url.searchParams.set(key, value);
    let response: Response; try { response = await this.fetchImpl(url, { method, signal, headers: { accept: "application/json", "content-type": "application/json", "x-tts-access-token": this.config.accessToken }, ...(method === "POST" ? { body } : {}) }); } catch (error) { if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw new ShopApiError("cancelled"); throw new ShopApiError("network"); }
    if (response.status === 401) throw new ShopApiError("unauthorized"); if (response.status === 403) throw new ShopApiError("forbidden"); if (response.status === 429) throw new ShopApiError("rate_limited");
    const payload = await response.json().catch(() => null) as { code?: unknown; message?: unknown; data?: unknown } | null;
    if (!response.ok || payload?.code !== 0 || !payload.data || typeof payload.data !== "object") { const m = String(payload?.message ?? "").toLowerCase(); throw new ShopApiError(m.includes("sign") ? "signature" : m.includes("permission") ? "forbidden" : m.includes("auth") ? "unauthorized" : "unexpected_response"); }
    return payload.data as Record<string,any>;
  }
}
