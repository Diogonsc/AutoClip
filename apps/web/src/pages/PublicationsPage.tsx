import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspace, useWorkspace } from "../auth/WorkspaceProvider";
import JobDetail from "../components/JobDetail";
import PublicationForm from "../components/PublicationForm";
import {
  Badge,
  Empty,
  ErrorBox,
  Notice,
  PageHeader,
  Spinner,
} from "../components/ui";
import { unwrap } from "../lib/api";
import {
  EDITABLE_STATUSES,
  formatDateTime,
  publicationStatusLabel,
  publicationTone,
} from "../lib/format";
import { useChannels, useJobs, useMedia, useSettings } from "../lib/hooks";
import { supabase } from "../lib/supabase";
import type { PublicationJob, PublicationStatus } from "../lib/types";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

export default function PublicationsPage() {
  const ws = useCurrentWorkspace();
  const { canEdit } = useWorkspace();
  const qc = useQueryClient();
  const jobs = useJobs(ws.id);
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
  const list = (jobs.data ?? []).filter((j) => !filter || j.status === filter);
  const hasScheduled = (jobs.data ?? []).some((j) => j.status === "SCHEDULED");

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

      <div className="toolbar">
        <Select
          value={filter || "all"}
          onValueChange={(value) =>
            setFilter(
              value === "all" ? "" : ((value ?? "") as "" | PublicationStatus),
            )
          }
        >
          <SelectTrigger
            aria-label="Filtrar por estado"
            className="w-full sm:w-56"
          >
            <SelectValue placeholder="Todos os estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os estados</SelectItem>
            {(Object.keys(publicationStatusLabel) as PublicationStatus[]).map(
              (s) => (
                <SelectItem key={s} value={s}>
                  {publicationStatusLabel[s]}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      {jobs.isLoading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty title="Nenhuma publicação">
          {canEdit ? "Clique em “Nova publicação” para começar." : undefined}
        </Empty>
      ) : (
        <div className="table-wrap">
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
                    <TableCell className="row-actions">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDetail(j)}
                      >
                        Detalhes
                      </Button>{" "}
                      {editable && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setFormJob(j)}
                        >
                          Editar
                        </Button>
                      )}{" "}
                      {editable && j.status !== "DRAFT" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (window.confirm("Cancelar esta publicação?"))
                              cancel.mutate(j.id);
                          }}
                        >
                          Cancelar
                        </Button>
                      )}{" "}
                      {canEdit &&
                        (j.status === "DRAFT" || j.status === "CANCELLED") && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              if (window.confirm("Excluir definitivamente?"))
                                remove.mutate(j.id);
                            }}
                          >
                            Excluir
                          </Button>
                        )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
