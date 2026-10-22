// Montagem das dependências reais (Deno + Supabase) compartilhada pelos três endpoints.
// É a única parte da camada de funções que depende do runtime; a lógica fica em handlers.ts.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { importKey } from './crypto.ts';
import { env, envOptional, tiktokConfig } from './env.ts';
import { createChannelDb } from './channel-db.ts';
import { createDb, createTokenStore } from './supabase-db.ts';
import type { SbClient } from './supabase-db.ts';
import { createTikTokApi } from './tiktok.ts';
import { ensureAccessToken } from './tokens.ts';

export const log = (msg: string, data?: unknown) => console.log(JSON.stringify({ msg, data }));

/** Cliente com service_role: nunca sai do servidor. */
export function serviceClient() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Cliente que age COMO o usuário (JWT recebido): as RPCs aplicam o papel dele. */
export function rpcAsUser(authorization: string, fn: string, args: Record<string, unknown>) {
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  return sb.rpc(fn, args) as unknown as Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
}

export async function buildContext() {
  const sb = serviceClient();
  const client = sb as unknown as SbClient;
  const cfg = tiktokConfig();
  const tiktok = createTikTokApi();
  const key = await importKey(env('TOKEN_ENCRYPTION_KEY'));
  const now = () => new Date();
  const db = createDb(client);
  const store = createTokenStore(client);
  const ensureToken = (channelId: string, opts?: { force?: boolean }) =>
    ensureAccessToken({ store, tiktok, cfg, key, now }, channelId, opts);
  return {
    sb,
    client,
    cfg,
    tiktok,
    key,
    now,
    db,
    store,
    ensureToken,
    channelDb: createChannelDb(client),
    redirectUri: env('TIKTOK_REDIRECT_URI'),
    webUrl: envOptional('WEB_URL'),
  };
}
