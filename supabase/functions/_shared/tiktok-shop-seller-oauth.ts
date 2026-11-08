const TOKEN_ORIGIN = "https://auth.tiktok-shops.com";
const TOKEN_PATHS = new Set(["/api/v2/token/get", "/api/v2/token/refresh"]);
export type SellerTokens = { accessToken:string; refreshToken:string; accessExpiresAt:string; refreshExpiresAt:string; openId:string; sellerName?:string; region?:string; scopes:string[] };
export class SellerOAuthError extends Error { constructor(public readonly code:"cancelled"|"network"|"rejected"|"invalid_response"|"insufficient_scope") { super("TikTok Shop Seller OAuth failed"); } }
export function createSellerState():string { return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""); }
export function hashSellerState(state:string):Promise<string> { return crypto.subtle.digest("SHA-256",new TextEncoder().encode(state)).then(b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("")); }
export function redactSellerSecrets(value:string):string { return value.replace(/(app_secret|access_token|refresh_token)=([^&\s]+)/gi,"$1=[REDACTED]"); }
export async function sellerTokenRequest(kind:"exchange"|"refresh", input:{appKey:string;appSecret:string;value:string;requiredScopes?:string[];signal?:AbortSignal}, fetchImpl:typeof fetch=fetch, now:()=>number=Date.now):Promise<SellerTokens> {
  const url=new URL(kind==="exchange"?"/api/v2/token/get":"/api/v2/token/refresh",TOKEN_ORIGIN); url.searchParams.set("app_key",input.appKey);url.searchParams.set("app_secret",input.appSecret);url.searchParams.set(kind==="exchange"?"auth_code":"refresh_token",input.value);url.searchParams.set("grant_type",kind==="exchange"?"authorized_code":"refresh_token");
  let response:Response;try { response=await fetchImpl(url,{signal:input.signal,redirect:"error"}); } catch(e) { if(input.signal?.aborted||(e instanceof DOMException&&e.name==="AbortError"))throw new SellerOAuthError("cancelled");throw new SellerOAuthError("network"); }
  const payload=await response.json().catch(()=>null) as {code?:unknown;data?:Record<string,unknown>}|null; const d=payload?.data;
  if(!response.ok||payload?.code!==0||!d)throw new SellerOAuthError("rejected");
  const access=typeof d.access_token==="string"?d.access_token:"", refresh=typeof d.refresh_token==="string"?d.refresh_token:"";const a=typeof d.access_token_expire_in==="number"?d.access_token_expire_in:0,r=typeof d.refresh_token_expire_in==="number"?d.refresh_token_expire_in:0;const scopes=Array.isArray(d.granted_scopes)?d.granted_scopes.filter((x):x is string=>typeof x==="string"):[];
  if(!access||!refresh||!a||!r||d.user_type!==0||typeof d.open_id!=="string")throw new SellerOAuthError("invalid_response");if((input.requiredScopes??[]).some(s=>!scopes.includes(s)))throw new SellerOAuthError("insufficient_scope");
  return {accessToken:access,refreshToken:refresh,accessExpiresAt:new Date(now()+a*1000).toISOString(),refreshExpiresAt:new Date(now()+r*1000).toISOString(),openId:d.open_id,sellerName:typeof d.seller_name==="string"?d.seller_name:undefined,region:typeof d.seller_base_region==="string"?d.seller_base_region:undefined,scopes};
}
