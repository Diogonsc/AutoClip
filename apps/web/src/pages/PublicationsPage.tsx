import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspace, useWorkspace } from "../auth/WorkspaceProvider";
import JobDetail from "../components/JobDetail";
import PublicationForm from "../components/PublicationForm";
import { Send } from "lucide-react";
import { useConfirm } from "../components/confirm-provider";
import { SelectField } from "../components/select-field";
import {
  Badge,
  Empty,
  ErrorBox,
  Notice,
  PageHeader,
  TableCard,
  Toolbar,
} from "../components/ui";
import { unwrap } from "../lib/api";
import {
  EDITABLE_STATUSES,
  formatDateTime,
  publicationStatusLabel,
  publicationTone,
} from "../lib/format";
import { useChannels, useJobsPage, useMedia, useSettings } from "../lib/hooks";
import { supabase } from "../lib/supabase";
import type { PublicationJob, PublicationStatus } from "../lib/types";
import { Button } from "../components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import Loading from "@/components/loading";

export default function PublicationsPage() {
  const ws = useCurrentWorkspace();
  const { canEdit } = useWorkspace();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const pageSize = 50;
  const [page, setPage] = useState(0);
  const jobs = useJobsPage(ws.id, page, pageSize);
  const channels = useChannels(ws.id);
  const media = useMedia(ws.id);
  const settings = useSettings(ws.id);

  const [filter, setFilter] = useState<"" | PublicationStatus>("");
  const [formJob, setFormJob] = useState<PublicationJob | "new" | null>(null);
  const [detail, setDetail] = useState<PublicationJob | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["jobs", ws.id] });

  const cancel = useMutation({
    mutationFn: async (id: string) =>
      unwrap(
        await supabase
          .from("publication_jobs")
          .update({ status: "CANCELLED" })
          .eq("id", id),
      ),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await supabase.from("publication_jobs").delete().eq("id", id)),
    onSuccess: refresh,
  });

  const channelOf = (id: string) => channels.data?.find((c) => c.id === id);
  const mediaOf = (id: string) => media.data?.find((m) => m.id === id);
  const list = (jobs.data?.rows ?? []).filter(
    (j) => !filter || j.status === filter,
  );
  const hasScheduled = (jobs.data?.rows ?? []).some(
    (j) => j.status === "SCHEDULED",
  );
  const totalPages = Math.ceil((jobs.data?.total ?? 0) / pageSize);

  return (
    <>
      <PageHeader
        title="Publicações"
        subtitle="Prepare, agende e acompanhe os vídeos."
        actions={
          canEdit && (
            <Button onClick={() => setFormJob("new")}>Nova publicação</Button>
          )
        }
      />

      {settings.data && !settings.data.auto_publish_enabled && hasScheduled && (
        <Notice tone="info">
          A publicação automática está desligada: as publicações agendadas
          permanecem salvas e <strong>não serão enviadas</strong> ao TikTok.
        </Notice>
      )}
      <ErrorBox error={jobs.error ?? cancel.error ?? remove.error} />

      <Toolbar>
        <SelectField
          aria-label="Filtrar por estado"
          className="w-full sm:w-64"
          value={filter || "all"}
          onValueChange={(value) => {
            setFilter(value === "all" ? "" : (value as PublicationStatus));
            setPage(0);
          }}
          options={[
            { value: "all", label: "Todos os estados" },
            ...(Object.keys(publicationStatusLabel) as PublicationStatus[]).map(
              (st) => ({ value: st, label: publicationStatusLabel[st] }),
            ),
          ]}
        />
      </Toolbar>

      {jobs.isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty title="Nenhuma publicação" icon={Send}>
          {canEdit ? "Clique em “Nova publicação” para começar." : undefined}
        </Empty>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Vídeo</TableHead>
                <TableHead>Legenda</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((j) => {
                const editable =
                  canEdit && EDITABLE_STATUSES.includes(j.status);
                return (
                  <TableRow key={j.id}>
                    <TableCell>
                      {formatDateTime(j.scheduled_at, j.timezone)}
                    </TableCell>
                    <TableCell>
                      {channelOf(j.channel_id)?.display_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      {mediaOf(j.media_asset_id)?.original_filename ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {j.caption ? j.caption.slice(0, 40) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge tone={publicationTone(j.status)}>
                        {publicationStatusLabel[j.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDetail(j)}
                        >
                          Detalhes
                        </Button>
                        {editable && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setFormJob(j)}
                          >
                            Editar
                          </Button>
                        )}
                        {editable && j.status !== "DRAFT" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: "Cancelar esta publicação?",
                                  description:
                                    "Ela deixa de ser enviada ao TikTok no horário agendado.",
                                  confirmLabel: "Cancelar publicação",
                                  cancelLabel: "Voltar",
                                  destructive: true,
                                })
                              )
                                cancel.mutate(j.id);
                            }}
                          >
                            Cancelar
                          </Button>
                        )}
                        {canEdit &&
                          (j.status === "DRAFT" ||
                            j.status === "CANCELLED") && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={async () => {
                                if (
                                  await confirm({
                                    title: "Excluir definitivamente?",
                                    description:
                                      "Esta ação não pode ser desfeita.",
                                    confirmLabel: "Excluir",
                                    destructive: true,
                                  })
                                )
                                  remove.mutate(j.id);
                              }}
                            >
                              Excluir
                            </Button>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableCard>
      )}
      {!jobs.isLoading && (jobs.data?.total ?? 0) > pageSize && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            Página {page + 1} de {totalPages} · {jobs.data?.total} publicações
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((current) => current - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}

      {formJob && (
        <PublicationForm
          job={formJob === "new" ? undefined : formJob}
          onClose={() => setFormJob(null)}
        />
      )}
      {detail && (
        <JobDetail
          job={detail}
          channel={channelOf(detail.channel_id)}
          media={mediaOf(detail.media_asset_id)}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}
