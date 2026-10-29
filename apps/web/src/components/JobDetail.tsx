import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspace, useWorkspace } from "../auth/WorkspaceProvider";
import { supabase } from "../lib/supabase";
import { unwrap } from "../lib/api";
import {
  formatDateTime,
  publicationStatusLabel,
  publicationTone,
} from "../lib/format";
import type {
  Channel,
  MediaAsset,
  PublicationAttempt,
  PublicationEvent,
  PublicationJob,
} from "../lib/types";
import { useConfirm } from "./confirm-provider";
import { Badge, ErrorBox, Modal, Notice } from "./ui";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import Loading from "./loading";

export default function JobDetail({
  job,
  channel,
  media,
  onClose,
}: {
  job: PublicationJob;
  channel?: Channel;
  media?: MediaAsset;
  onClose: () => void;
}) {
  const ws = useCurrentWorkspace();
  const { canEdit } = useWorkspace();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const resolve = useMutation({
    mutationFn: async (outcome: "PUBLISHED" | "NOT_PUBLISHED") =>
      unwrap(
        await supabase.rpc("resolve_unknown_job", {
          p_job: job.id,
          p_outcome: outcome,
        }),
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["jobs", ws.id] });
      onClose();
    },
  });

  const events = useQuery({
    queryKey: ["job-events", job.id],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("publication_events")
          .select("*")
          .eq("publication_job_id", job.id)
          .order("created_at", { ascending: true }),
      ) as unknown as PublicationEvent[],
  });

  const attempts = useQuery({
    queryKey: ["job-attempts", job.id],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("publication_attempts")
          .select("*")
          .eq("publication_job_id", job.id)
          .order("attempt_number", { ascending: true }),
      ) as unknown as PublicationAttempt[],
  });

  return (
    <Modal title="Detalhes da publicação" onClose={onClose} wide>
      <dl className="m-0 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted-foreground">Estado</dt>
        <dd className="m-0">
          <Badge tone={publicationTone(job.status)}>
            {publicationStatusLabel[job.status]}
          </Badge>
        </dd>
        <dt className="text-muted-foreground">Canal</dt>
        <dd className="m-0">{channel?.display_name ?? "—"}</dd>
        <dt className="text-muted-foreground">Vídeo</dt>
        <dd className="m-0">{media?.original_filename ?? "—"}</dd>
        <dt className="text-muted-foreground">Legenda</dt>
        <dd className="m-0 break-words whitespace-pre-wrap">
          {job.caption || "—"}
        </dd>
        <dt className="text-muted-foreground">Agendada para</dt>
        <dd className="m-0">
          {formatDateTime(job.scheduled_at, job.timezone)} ({job.timezone})
        </dd>
        <dt className="text-muted-foreground">Tentativas</dt>
        <dd className="m-0">
          {job.attempt_count} de {job.max_attempts}
        </dd>
        <dt className="text-muted-foreground">ID remoto</dt>
        <dd className="m-0 break-all">{job.remote_publish_id ?? "—"}</dd>
        {job.last_error_code && (
          <>
            <dt className="text-muted-foreground">Último erro</dt>
            <dd className="m-0">
              <code>{job.last_error_code}</code> {job.last_error_message}
            </dd>
          </>
        )}
      </dl>

      {job.status === "UNKNOWN" && (
        <Notice tone="warning">
          <p className="m-0">
            O resultado desta publicação não pôde ser confirmado. Ela não será
            reenviada automaticamente, para evitar duplicidade; é preciso
            conferir o estado no TikTok antes de agir.
          </p>
          {canEdit && (
            <>
              <p className="mt-2 mb-2">
                Depois de conferir no TikTok, informe o que aconteceu:
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={resolve.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: "O vídeo já foi publicado?",
                        description:
                          "Confirme que o vídeo JÁ FOI publicado/enviado ao TikTok.",
                        confirmLabel: "Sim, foi publicado",
                      })
                    )
                      resolve.mutate("PUBLISHED");
                  }}
                >
                  O vídeo foi publicado
                </Button>
                <Button
                  variant="outline"
                  disabled={resolve.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: "Reenviar o vídeo?",
                        description:
                          "Confirme que o vídeo NÃO está no TikTok. A publicação será reagendada para agora e enviada de novo.",
                        confirmLabel: "Reenviar",
                        destructive: true,
                      })
                    )
                      resolve.mutate("NOT_PUBLISHED");
                  }}
                >
                  Não foi publicado — reenviar
                </Button>
              </div>
              <div className="mt-2">
                <ErrorBox error={resolve.error} />
              </div>
            </>
          )}
        </Notice>
      )}

      <Separator />

      <section className="grid gap-2">
        <h2 className="m-0 font-heading text-base font-medium">Tentativas</h2>
        {attempts.isLoading ? (
          <Loading />
        ) : (attempts.data ?? []).length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">
            Nenhuma tentativa registrada.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-0 p-0">
            {attempts.data!.map((a) => (
              <li
                key={a.id}
                className="grid gap-0.5 border-b py-2 text-sm last:border-b-0 sm:grid-cols-[11rem_1fr] sm:gap-3"
              >
                <time className="text-xs text-muted-foreground sm:pt-0.5">
                  {formatDateTime(a.started_at)}
                </time>
                <span>
                  #{a.attempt_number} — {a.result ?? "em andamento"}
                  {a.error_code ? ` (${a.error_code})` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-2">
        <h2 className="m-0 font-heading text-base font-medium">Eventos</h2>
        {events.isLoading ? (
          <Loading />
        ) : (events.data ?? []).length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">Sem eventos.</p>
        ) : (
          <ul className="m-0 grid list-none gap-0 p-0">
            {events.data!.map((ev) => {
              const p = ev.event_payload as {
                from?: string | null;
                to?: string;
              };
              const text =
                ev.event_type === "STATUS_CHANGED"
                  ? `${p.from ? statusText(p.from) + " → " : "Criada como "}${statusText(p.to)}`
                  : ev.event_type;
              return (
                <li
                  key={ev.id}
                  className="grid gap-0.5 border-b py-2 text-sm last:border-b-0 sm:grid-cols-[11rem_1fr] sm:gap-3"
                >
                  <time className="text-xs text-muted-foreground sm:pt-0.5">
                    {formatDateTime(ev.created_at)}
                  </time>
                  <span>{text}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Modal>
  );
}

function statusText(s: string | undefined): string {
  if (!s) return "—";
  return publicationStatusLabel[s as keyof typeof publicationStatusLabel] ?? s;
}
