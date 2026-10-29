// Proxy de imagens para o TikTok (PULL_FROM_URL). Chegam aqui via rewrite da Vercel (/m/:token) no
// domínio verificado. Autorização = token HMAC de curta duração gerado pelo worker (verify_jwt = false).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleMediaServe } from '../_shared/media-serve.ts';
import { env } from '../_shared/env.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((req) =>
  handleMediaServe(req, {
    secret: env('MEDIA_PROXY_SECRET'),
    now: () => Date.now(),
    async download(key) {
      const { data, error } = await sb.storage.from('media').download(key);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
  }),
);
