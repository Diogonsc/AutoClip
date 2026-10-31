// Limpeza de mídia privada. Só aceita o segredo interno do worker e só remove
// objetos que o banco já travou e considerou elegíveis. Por padrão os settings
// de cada workspace mantêm dry-run ligado e a limpeza desativada.
import { env } from "../_shared/env.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { buildContext, log } from "../_shared/runtime.ts";

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};

interface Candidate {
  media_asset_id: string;
  workspace_id: string;
  storage_key: string;
  file_size_bytes: number;
  dry_run: boolean;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const given = req.headers.get("x-worker-secret") ?? "";
  const expected = env("WORKER_SECRET");
  if (!timingSafeEqual(given, expected)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const lock = crypto.randomUUID();
  try {
    const c = await buildContext();
    const request = (await req.json().catch(() => ({}))) as { batch_size?: unknown };
    // O banco aplica também o limite configurado por workspace; este é só o teto global da execução.
    const requested = typeof request.batch_size === "number" ? Math.floor(request.batch_size) : 50;
    const batchSize = Math.min(Math.max(requested, 1), 50);
    const { data, error } = await c.sb.rpc("claim_media_cleanup_candidates", {
      p_limit: batchSize,
      p_lock: lock,
    });
    if (error) throw new Error(`claim_media_cleanup_candidates: ${error.message}`);

    let dryRuns = 0;
    let deleted = 0;
    let failed = 0;
    for (const candidate of (data ?? []) as Candidate[]) {
      if (candidate.dry_run) {
        const { error: completeError } = await c.sb.rpc("complete_media_cleanup", {
          p_media: candidate.media_asset_id,
          p_lock: lock,
          p_deleted: false,
          p_dry_run: true,
          p_error: null,
        });
        if (completeError) throw new Error(`complete_media_cleanup dry-run: ${completeError.message}`);
        dryRuns++;
        continue;
      }

      const { error: storageError } = await c.sb.storage.from("media").remove([candidate.storage_key]);
      const { error: completeError } = await c.sb.rpc("complete_media_cleanup", {
        p_media: candidate.media_asset_id,
        p_lock: lock,
        p_deleted: !storageError,
        p_dry_run: false,
        p_error: storageError?.message ?? null,
      });
      if (completeError) throw new Error(`complete_media_cleanup: ${completeError.message}`);
      if (storageError) {
        failed++;
        log("media-cleanup.storage_failed", { media: candidate.media_asset_id, workspace: candidate.workspace_id });
      } else {
        deleted++;
      }
    }
    return Response.json({ ok: true, candidates: (data ?? []).length, dry_runs: dryRuns, deleted, failed });
  } catch (error) {
    log("media-cleanup.fatal", { error: error instanceof Error ? error.message : String(error) });
    return Response.json({ error: "internal" }, { status: 500 });
  }
});
