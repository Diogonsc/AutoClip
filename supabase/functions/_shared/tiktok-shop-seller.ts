/**
 * Seller-only TikTok Shop transport. This module intentionally does not enable
 * the Shop feature: callers still pass through the server availability gate.
 * Credentials never cross the browser boundary.
 */
const encoder = new TextEncoder();

export type ShopApiErrorCode = 'unauthorized' | 'forbidden' | 'rate_limited' | 'network' | 'unexpected_response';
export class ShopApiError extends Error {
  constructor(public readonly code: ShopApiErrorCode, message = 'TikTok Shop request failed') { super(message); }
}

export type SellerShop = { shop_id: string; shop_cipher: string; region?: string; [key: string]: unknown };
export type SearchProductsResult = { products: Record<string, unknown>[]; next_page_token?: string; total_count?: number };

export function sellerAuthorizeUrl(authUrl: string, serviceId: string, state: string, redirectUri?: string): string {
  const url = new URL(authUrl);
  if (url.protocol !== 'https:' || !serviceId || !state) throw new Error('Seller OAuth configuration is invalid');
  url.searchParams.set('service_id', serviceId);
  url.searchParams.set('state', state);
  if (redirectUri) url.searchParams.set('redirect_uri', redirectUri);
  return url.toString();
}

export function validPageSize(value: unknown, max = 100): number {
  const size = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(size) || size < 1 || size > max) throw new Error(`page_size must be an integer between 1 and ${max}`);
  return size;
}

export async function signSellerRequest(secret: string, path: string, params: Record<string, string>, body: string): Promise<string> {
  if (!secret || !path.startsWith('/')) throw new Error('TikTok Shop signing input is invalid');
  const values = Object.entries(params).filter(([key]) => key !== 'sign').sort(([a], [b]) => a.localeCompare(b));
  const plain = `${secret}${path}${values.map(([key, value]) => `${key}${value}`).join('')}${body}${secret}`;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(plain)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

type SellerClientConfig = { appKey: string; appSecret: string; accessToken: string; baseUrl?: string; fetchImpl?: typeof fetch };
export class TikTokShopSellerClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly config: SellerClientConfig) {
    this.baseUrl = config.baseUrl ?? 'https://open-api.tiktokglobalshop.com';
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async authorizedShops(): Promise<SellerShop[]> {
    const data = await this.request('GET', '/authorization/202309/shops');
    const shops = data.shops;
    if (!Array.isArray(shops)) throw new ShopApiError('unexpected_response');
    return shops.filter((shop): shop is SellerShop => !!shop && typeof shop === 'object' && typeof (shop as SellerShop).shop_id === 'string' && typeof (shop as SellerShop).shop_cipher === 'string');
  }

  async searchProducts(input: { shopCipher: string; pageSize?: number; pageToken?: string; filters?: Record<string, unknown> }): Promise<SearchProductsResult> {
    if (!input.shopCipher) throw new Error('shop_cipher is required');
    const body = JSON.stringify(input.filters ?? {});
    const data = await this.request('POST', '/product/202502/products/search', { shop_cipher: input.shopCipher, page_size: String(validPageSize(input.pageSize ?? 20)), ...(input.pageToken ? { page_token: input.pageToken } : {}) }, body);
    if (!Array.isArray(data.products)) throw new ShopApiError('unexpected_response');
    return { products: data.products.filter((product): product is Record<string, unknown> => !!product && typeof product === 'object'), next_page_token: typeof data.next_page_token === 'string' ? data.next_page_token : undefined, total_count: typeof data.total_count === 'number' ? data.total_count : undefined };
  }

  /** The account-specific Get Product version/path must be supplied after SDK confirmation. */
  async getProduct(productPath: string, shopCipher: string): Promise<Record<string, unknown>> {
    if (!/^\/product\/20\d{4}\/products\//.test(productPath) || !shopCipher) throw new Error('Get Product endpoint is not confirmed');
    return this.request('GET', productPath, { shop_cipher: shopCipher });
  }

  private async request(method: 'GET' | 'POST', path: string, extra: Record<string, string> = {}, body = ''): Promise<Record<string, any>> {
    const params = { app_key: this.config.appKey, timestamp: String(Math.floor(Date.now() / 1000)), ...extra };
    const sign = await signSellerRequest(this.config.appSecret, path, params, body);
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries({ ...params, sign })) url.searchParams.set(key, value);
    let response: Response;
    try { response = await this.fetchImpl(url, { method, headers: { accept: 'application/json', 'content-type': 'application/json', 'x-tts-access-token': this.config.accessToken }, ...(method === 'POST' ? { body } : {}) }); }
    catch { throw new ShopApiError('network'); }
    if (response.status === 401) throw new ShopApiError('unauthorized');
    if (response.status === 403) throw new ShopApiError('forbidden');
    if (response.status === 429) throw new ShopApiError('rate_limited');
    const payload = await response.json().catch(() => null) as { code?: unknown; data?: unknown } | null;
    if (!response.ok || payload?.code !== 0 || !payload.data || typeof payload.data !== 'object') throw new ShopApiError('unexpected_response');
    return payload.data as Record<string, any>;
  }
}
