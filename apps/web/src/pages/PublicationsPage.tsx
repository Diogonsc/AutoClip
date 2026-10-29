import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspace, useWorkspace } from "../auth/WorkspaceProvider";
import JobDetail from "../components/JobDetail";
import PublicationForm from "../components/PublicationForm";
import { Download, FileSpreadsheet, Send, Link2 } from "lucide-react";
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
import { useChannels, useJobsPage, useMedia, usePlatformFlags, useSettings } from "../lib/hooks";
import { supabase } from "../lib/supabase";
import type { PublicationJob, PublicationStatus } from "../lib/types";
import { zonedToUtc } from "../lib/time";
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


function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell.trim()); cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim()); cell = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (quoted) throw new Error("CSV inválido: há uma aspa sem fechamento.");
  row.push(cell.trim());
  if (row.some((v) => v !== "")) rows.push(row);
  return rows;
}

const CSV_TEMPLATE = "canal,video,legenda,data_hora,fuso_horario,direitos_audio_confirmados,privacidade,permitir_comentarios,permitir_dueto,permitir_stitch,conteudo_de_marca,marca_propria\nMeu canal,meu-video.mp4,Minha legenda,2026-11-01T12:00,America/Sao_Paulo,true,SELF_ONLY,true,true,true,false,false\n";

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
  const platformFlags = usePlatformFlags();
  const csvInput = useRef<HTMLInputElement>(null);
  const [csvMessage, setCsvMessage] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);

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

  async function createApprovalLink(jobId: string) {
    setApprovalBusyId(jobId); setApprovalError(null); setApprovalMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("client-approval", { body: { action: "create", publication_job_id: jobId } });
      if (error || data?.error || !data?.url) throw new Error(data?.message ?? "Não foi possível criar o link. Verifique se a Edge Function foi publicada.");
      try { await navigator.clipboard.writeText(data.url); setApprovalMessage("Link de aprovação copiado. Ele expira em 7 dias."); }
      catch { window.prompt("Copie o link de aprovação do cliente:", data.url); setApprovalMessage("Link criado. Copie-o e envie ao cliente."); }
      await refresh();
    } catch (e) { setApprovalError(e instanceof Error ? e.message : "Falha ao criar link de aprovação."); }
    finally { setApprovalBusyId(null); }
  }

  const channelOf = (id: string) => channels.data?.find((c) => c.id === id);
  const mediaOf = (id: string) => media.data?.find((m) => m.id === id);
  const list = (jobs.data?.rows ?? []).filter(
    (j) => !filter || j.status === filter,
  );
  const hasScheduled = (jobs.data?.rows ?? []).some(
    (j) => j.status === "SCHEDULED",
  );
  const totalPages = Math.ceil((jobs.data?.total ?? 0) / pageSize);

  function downloadCsvTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "modelo-agendamento-autoclip.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function importCsv(file: File) {
    setCsvBusy(true); setCsvError(null); setCsvMessage(null);
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2) throw new Error("O CSV precisa ter cabeçalho e pelo menos uma linha.");
      const headers = parsed[0].map((h) => h.toLocaleLowerCase("pt-BR"));
      const required = ["canal", "video", "legenda", "data_hora", "fuso_horario", "direitos_audio_confirmados"];
      const missing = required.filter((h) => !headers.includes(h));
      if (missing.length) throw new Error(`Colunas obrigatórias ausentes: ${missing.join(", ")}. Baixe o modelo CSV para ver o formato.`);
      const index = (name: string) => headers.indexOf(name);
      const value = (row: string[], name: string) => (row[index(name)] ?? "").trim();
      const bool = (v: string, name: string, line: number) => {
        if (["true", "1", "sim", "yes"].includes(v.toLowerCase())) return true;
        if (["false", "0", "não", "nao", "no", ""].includes(v.toLowerCase())) return false;
        throw new Error(`Linha ${line}: ${name} deve ser true/false (ou sim/não).`);
      };
      if (settings.isLoading || channels.isLoading || media.isLoading) throw new Error("Aguarde o carregamento de canais, vídeos e configurações antes de importar.");
      const currentUser = (await supabase.auth.getUser()).data.user;
      if (!currentUser) throw new Error("Sessão expirada. Entre novamente para importar o CSV.");
      const rowsToInsert: Record<string, unknown>[] = [];
      const issues: string[] = [];
      for (let i = 1; i < parsed.length; i += 1) {
        const row = parsed[i]; const line = i + 1;
        try {
          const channelName = value(row, "canal");
          const mediaName = value(row, "video");
          const channel = (channels.data ?? []).find((c) => c.display_name.toLocaleLowerCase("pt-BR") === channelName.toLocaleLowerCase("pt-BR"));
          const asset = (media.data ?? []).find((m) => m.original_filename.toLocaleLowerCase("pt-BR") === mediaName.toLocaleLowerCase("pt-BR") && m.status === "READY");
          if (!channel) throw new Error(`canal “${channelName}” não encontrado pelo nome exato`);
          if (!asset) throw new Error(`vídeo “${mediaName}” não encontrado ou não está pronto`);
          if (channel.connection_status !== "CONNECTED") throw new Error(`canal “${channelName}” não está conectado`);
          if (value(row, "legenda").length > 2200) throw new Error("legenda acima de 2200 caracteres");
          if (!bool(value(row, "direitos_audio_confirmados"), "direitos_audio_confirmados", line)) throw new Error("confirme os direitos do áudio (true) antes de agendar");
          const timezone = value(row, "fuso_horario") || settings.data?.default_timezone || "America/Sao_Paulo";
          const when = value(row, "data_hora");
          if (!when) throw new Error("data_hora é obrigatória");
          const utc = zonedToUtc(when, timezone);
          if (!Number.isFinite(utc.getTime()) || utc.getTime() < Date.now() - 60_000) throw new Error("data_hora inválida ou no passado");
          const direct = settings.data?.publish_mode === "DIRECT";
          const privacy = direct ? value(row, "privacidade") : "";
          if (direct && !privacy) throw new Error("privacidade é obrigatória no modo DIRECT");
          if (direct && !platformFlags.data?.tiktok_audited && privacy !== "SELF_ONLY") throw new Error("app não auditado: use SELF_ONLY no modo DIRECT ou mude para INBOX");
          if (direct && !channel.creator_info) throw new Error(`carregue as opções atuais do TikTok para o canal “${channelName}” antes de importar publicações DIRECT`);
          if (direct && channel.creator_info && !channel.creator_info.privacy_level_options.includes(privacy)) throw new Error(`privacidade ${privacy} não consta nas opções atuais do criador`);
          if (direct && value(row, "conteudo_de_marca").toLowerCase() === "true" && privacy === "SELF_ONLY") throw new Error("conteúdo de marca não pode usar a privacidade SELF_ONLY");
          if (channel.creator_info?.max_video_post_duration_sec != null && asset.duration_seconds != null && asset.duration_seconds > channel.creator_info.max_video_post_duration_sec) throw new Error(`vídeo excede ${channel.creator_info.max_video_post_duration_sec}s`);
          rowsToInsert.push({
            workspace_id: ws.id, created_by: currentUser.id,
            channel_id: channel.id, media_asset_id: asset.id, caption: value(row, "legenda"),
            scheduled_at: utc.toISOString(), timezone, status: "SCHEDULED",
            privacy_level: direct ? privacy : null,
            allow_comment: direct ? bool(value(row, "permitir_comentarios"), "permitir_comentarios", line) : null,
            allow_duet: direct ? bool(value(row, "permitir_dueto"), "permitir_dueto", line) : null,
            allow_stitch: direct ? bool(value(row, "permitir_stitch"), "permitir_stitch", line) : null,
            brand_content: direct ? bool(value(row, "conteudo_de_marca"), "conteudo_de_marca", line) : false,
            brand_organic: direct ? bool(value(row, "marca_propria"), "marca_propria", line) : false,
            music_rights_confirmed: true,
          });
        } catch (err) { issues.push(`Linha ${line}: ${err instanceof Error ? err.message : "dados inválidos"}`); }
      }
      if (issues.length) throw new Error(`Nenhuma linha foi importada. Corrija o CSV:\n${issues.slice(0, 12).join("\n")}${issues.length > 12 ? `\n… e mais ${issues.length - 12} erro(s).` : ""}`);
      if (!rowsToInsert.length) throw new Error("Nenhuma publicação válida encontrada.");
      unwrap(await supabase.from("publication_jobs").insert(rowsToInsert));
      setCsvMessage(`${rowsToInsert.length} publicação(ões) importada(s) e agendada(s).`);
      await qc.invalidateQueries({ queryKey: ["jobs", ws.id] });
    } catch (err) { setCsvError(err instanceof Error ? err.message : "Falha ao importar CSV."); }
    finally { setCsvBusy(false); }
  }

  return (
    <>
      <PageHeader
        title="Publicações"
        subtitle="Prepare, agende e acompanhe os vídeos."
        actions={canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadCsvTemplate}><Download aria-hidden="true" /> Modelo CSV</Button>
            <input ref={csvInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void importCsv(file); }} />
            <Button variant="outline" disabled={csvBusy || channels.isLoading || media.isLoading || settings.isLoading} onClick={() => csvInput.current?.click()}><FileSpreadsheet aria-hidden="true" /> {csvBusy ? "Importando…" : "Importar CSV"}</Button>
            <Button onClick={() => setFormJob("new")}>Nova publicação</Button>
          </div>
        )}
      />

      {settings.data && !settings.data.auto_publish_enabled && hasScheduled && (
        <Notice tone="info">
          A publicação automática está desligada: as publicações agendadas
          permanecem salvas e <strong>não serão enviadas</strong> ao TikTok.
        </Notice>
      )}
      <ErrorBox error={csvError ?? approvalError} />
      {approvalMessage && <Notice tone="success">{approvalMessage}</Notice>}
      {csvMessage && <Notice tone="success">{csvMessage}</Notice>}
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
                        {canEdit && !["PUBLISHED", "SENT_TO_INBOX", "PROCESSING"].includes(j.status) && (
                          <Button variant="outline" size="sm" disabled={approvalBusyId === j.id} onClick={() => void createApprovalLink(j.id)}>
                            <Link2 className="mr-1 size-3.5" />{approvalBusyId === j.id ? "Criando…" : "Link de aprovação"}
                          </Button>
                        )}
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
