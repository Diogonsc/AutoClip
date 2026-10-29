// Token curto e assinado (HMAC-SHA256) para o proxy de mídia: o TikTok precisa buscar as imagens
// (PULL_FROM_URL) em um domínio verificado, e o Storage privado do Supabase não está nele.
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value: string): Uint8Array {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

/** Chaves de objeto aceitas: <pasta>/<pasta>/<arquivo>, sem "..", sem barra inicial. */
export function isSafeStorageKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.length > 0 &&
    key.length <= 300 &&
    /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+){1,3}$/.test(key) &&
    !key.split('/').some((part) => part === '.' || part === '..')
  );
}

export async function signMediaToken(secret: string, key: string, expiresAtMs: number): Promise<string> {
  if (!isSafeStorageKey(key)) throw new Error('storage key inválida');
  const payload = b64url(enc.encode(JSON.stringify({ k: key, e: Math.floor(expiresAtMs / 1000) })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

export type VerifyResult = { ok: true; key: string } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export async function verifyMediaToken(secret: string, token: string, nowMs: number): Promise<VerifyResult> {
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return { ok: false, reason: 'malformed' };
  let valid = false;
  try {
    valid = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), fromB64url(sig), enc.encode(payload));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { k?: unknown; e?: unknown };
    if (!isSafeStorageKey(data.k) || typeof data.e !== 'number') return { ok: false, reason: 'malformed' };
    if (data.e * 1000 < nowMs) return { ok: false, reason: 'expired' };
    return { ok: true, key: data.k };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}
