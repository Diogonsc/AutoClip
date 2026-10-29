// Worker de publicação. Disparado a cada minuto por pg_cron -> pg_net (ver README).
// Autenticação: segredo compartilhado no header x-worker-secret (verify_jwt = false).
import { env, envOptional } from '../_shared/env.ts';
import { handleWorker } from '../_shared/handlers.ts';
import { buildContext, log } from '../_shared/runtime.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };
declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void } | undefined;

const LEASE_NAME = 'publication-worker';
const LEASE_TTL_SECONDS = 300; // margem para uma execução longa; renovado enquanto o worker está ativo
const BUDGET_MS = 90_000; // não inicia novos envios depois disso

Deno.serve(async (req) => {
  try {
    const c = await buildContext();
    return await handleWorker(req, {
      secret: env('WORKER_SECRET'),
      workerDeps: {
        db: c.db,
        tiktok: c.tiktok,
        ensureToken: c.ensureToken,
        now: c.now,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        log,
        storage: {
          async download(key) {
            const { data, error } = await c.sb.storage.from('media').download(key);
            if (error || !data) throw new Error(`storage.download: ${error?.message ?? 'arquivo vazio'}`);
            return new Uint8Array(await data.arrayBuffer());
          },
          verifiedHost: envOptional('TIKTOK_VERIFIED_MEDIA_HOST'),
          async signedUrl(key, expiresInSeconds) {
            const { data, error } = await c.sb.storage.from('media').createSignedUrl(key, expiresInSeconds);
            if (error || !data?.signedUrl) throw new Error(`storage.signedUrl: ${error?.message ?? 'URL vazia'}`);
            return data.signedUrl;
          },
        },
      },
      acquireLease: async (holder) => {
        const r = await c.sb.rpc('acquire_worker_lease', { p_name: LEASE_NAME, p_holder: holder, p_ttl_seconds: LEASE_TTL_SECONDS });
        if (r.error) throw new Error(`acquire_worker_lease: ${r.error.message}`);
        return r.data === true;
      },
      releaseLease: async (holder) => {
        const r = await c.sb.rpc('release_worker_lease', { p_name: LEASE_NAME, p_holder: holder });
        if (r.error) throw new Error(`release_worker_lease: ${r.error.message}`);
      },
      renewLease: async (holder) => {
        const r = await c.sb.rpc('acquire_worker_lease', {
          p_name: LEASE_NAME,
          p_holder: holder,
          p_ttl_seconds: LEASE_TTL_SECONDS,
        });
        if (r.error) throw new Error(`renew_worker_lease: ${r.error.message}`);
        return r.data === true;
      },
      leaseTtlSeconds: LEASE_TTL_SECONDS,
      // Responde 202 na hora (o pg_net não espera) e continua o trabalho em segundo plano.
      background: typeof EdgeRuntime !== 'undefined' ? (work) => EdgeRuntime.waitUntil(work) : undefined,
      newId: () => crypto.randomUUID(),
      budgetMs: BUDGET_MS,
      log,
    });
  } catch (e) {
    log('worker.fatal', { error: e instanceof Error ? e.message : String(e) });
    return new Response(JSON.stringify({ error: 'internal' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
