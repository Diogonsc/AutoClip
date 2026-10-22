// Criptografia dos tokens OAuth: AES-256-GCM via WebCrypto (funciona em Deno e Node).
// Formato: "v1:<iv base64>:<ciphertext+tag base64>".
// O AAD (aqui, o id do canal) amarra o texto cifrado ao seu contexto: copiar o valor de
// uma linha para outra faz a decifragem falhar.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function b64decode(text: string): Uint8Array {
  let bin: string;
  try {
    // Aceita base64 padrão e url-safe, com ou sem padding.
    const norm = text.trim().replace(/-/g, '+').replace(/_/g, '/');
    bin = atob(norm + '='.repeat((4 - (norm.length % 4)) % 4));
  } catch {
    throw new Error('Valor base64 inválido');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A chave (TOKEN_ENCRYPTION_KEY) precisa ter exatamente 32 bytes em base64. */
export async function importKey(base64Key: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = b64decode(base64Key);
  } catch {
    throw new Error('TOKEN_ENCRYPTION_KEY inválida: não é base64');
  }
  if (raw.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY inválida: precisa ter 32 bytes (gere com: openssl rand -base64 32)');
  }
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptToken(key: CryptoKey, plaintext: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: encoder.encode(aad) as BufferSource },
      key,
      encoder.encode(plaintext) as BufferSource,
    ),
  );
  return `v1:${b64encode(iv)}:${b64encode(ct)}`;
}

export async function decryptToken(key: CryptoKey, payload: string, aad: string): Promise<string> {
  const parts = payload.split(':');
  if (parts.length !== 3 || parts[0] !== 'v1' || !parts[1] || !parts[2]) {
    throw new Error('Formato de token cifrado inválido');
  }
  try {
    const pt = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: b64decode(parts[1]) as BufferSource,
        additionalData: encoder.encode(aad) as BufferSource,
      },
      key,
      b64decode(parts[2]) as BufferSource,
    );
    return decoder.decode(pt);
  } catch {
    // Mensagem genérica de propósito: não vaza detalhes do erro criptográfico.
    throw new Error('Falha ao decifrar o token (chave ou contexto incorretos)');
  }
}

/** Comparação em tempo constante (segredo do worker). */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
