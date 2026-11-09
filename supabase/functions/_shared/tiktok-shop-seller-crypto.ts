import { decryptToken, encryptToken, importKey } from './crypto.ts';

export const SELLER_CREDENTIAL_KEY_VERSION = 1;

export type SellerCredentialKind = 'access' | 'refresh';

export type SellerCredentialContext = {
  workspaceId: string;
  connectionId: string;
  kind: SellerCredentialKind;
  keyVersion?: number;
};

export class SellerCredentialError extends Error {
  constructor() {
    super('Seller credentials are unavailable');
  }
}

function requiredIdentifier(value: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new SellerCredentialError();
  return value.toLowerCase();
}

export function sellerCredentialAad(context: SellerCredentialContext): string {
  const version = context.keyVersion ?? SELLER_CREDENTIAL_KEY_VERSION;
  if (!Number.isInteger(version) || version < 1 || version > 32767) throw new SellerCredentialError();
  if (context.kind !== 'access' && context.kind !== 'refresh') throw new SellerCredentialError();
  return [
    'tiktok-shop-seller',
    `v${version}`,
    requiredIdentifier(context.workspaceId),
    requiredIdentifier(context.connectionId),
    context.kind,
  ].join(':');
}

/** Backend-only key import. The generic error intentionally never includes secret material. */
export async function importSellerCredentialKey(secret?: string): Promise<CryptoKey> {
  if (!secret) throw new SellerCredentialError();
  try {
    return await importKey(secret);
  } catch {
    throw new SellerCredentialError();
  }
}

export async function encryptSellerCredential(
  key: CryptoKey,
  plaintext: string,
  context: SellerCredentialContext,
): Promise<string> {
  if (!plaintext) throw new SellerCredentialError();
  return encryptToken(key, plaintext, sellerCredentialAad(context));
}

export async function decryptSellerCredential(
  key: CryptoKey,
  ciphertext: string,
  context: SellerCredentialContext,
): Promise<string> {
  try {
    return await decryptToken(key, ciphertext, sellerCredentialAad(context));
  } catch {
    throw new SellerCredentialError();
  }
}
