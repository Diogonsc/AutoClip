// Leitura de variáveis de ambiente das Edge Functions (Deno).
// SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY são injetadas pelo Supabase;
// as demais são secrets (supabase secrets set ...).
declare const Deno: { env: { get(name: string): string | undefined } };

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
}

export function envOptional(name: string): string | undefined {
  return Deno.env.get(name) || undefined;
}

export function tiktokConfig() {
  return { clientKey: env('TIKTOK_CLIENT_KEY'), clientSecret: env('TIKTOK_CLIENT_SECRET') };
}
