import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useConfirm } from "./confirm-provider";
import { useCurrentWorkspace, useWorkspace } from "../auth/WorkspaceProvider";
import { ErrorBox, Field, Modal, Notice, TableCard } from "./ui";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { SelectField } from "./select-field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { formatDateTime, publicationStatusLabel } from "../lib/format";
import { unwrap } from "../lib/api";
import { allTimezones, browserTimezone, resolveLocalDateTime, utcToZonedInput } from "../lib/time";
import { buildReschedulePreview, orderRescheduleJobs } from "../lib/batchReschedule";
import { supabase } from "../lib/supabase";
import type { PublicationBatchSummary, PublicationJob } from "../lib/types";
import type { BatchDraftItem } from "./BatchScheduler";
import Loading from "@/components/loading";

const editable = new Set(["DRAFT", "SCHEDULED", "READY", "RETRY_WAIT", "BLOCKED_APPROVAL", "BLOCKED_PERMISSION", "BLOCKED_REAUTH"]);
const reschedulable = new Set(["SCHEDULED", "READY", "RETRY_WAIT"]);
const intervalPresets = [5, 15, 30, 60, 120];

export default function PublicationBatchDetails({ batch, onClose, onRepeat }: {
  batch: PublicationBatchSummary;
  onClose: () => void;
  onRepeat: (items: BatchDraftItem[]) => void;
}) {
  const ws = useCurrentWorkspace();
  const { canEdit } = useWorkspace();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [startLocal, setStartLocal] = useState("");
  const [timezone, setTimezone] = useState(browserTimezone());
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [ambiguousOccurrence, setAmbiguousOccurrence] = useState<number | null>(null);
  const [rescheduleResult, setRescheduleResult] = useState<string | null>(null);
  const [cancelResult, setCancelResult] = useState<string | null>(null);
  const rows = useQuery({
    queryKey: ["batch-items", ws.id, batch.id],
    queryFn: async () => unwrap(await supabase.from("publication_jobs").select("*")
      .eq("workspace_id", ws.id).eq("batch_id", batch.id).order("scheduled_at", { ascending: true, nullsFirst: false }).order("created_at").order("id")) as unknown as PublicationJob[],
  });
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["publication-batches", ws.id] }),
    qc.invalidateQueries({ queryKey: ["batch-items", ws.id, batch.id] }),
    qc.invalidateQueries({ queryKey: ["jobs", ws.id] }),
  ]);
  const cancel = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("cancel_publication_batch_items", { p_workspace: ws.id, p_job_ids: selected, p_idempotency_key: crypto.randomUUID() });
      if (error) throw error;
      return data as { cancelled: number };
    }, onSuccess: async (data) => { setCancelResult(`${data.cancelled} publicação(ões) canceladas.`); await refresh(); },
  });
  const chosen = orderRescheduleJobs((rows.data ?? []).filter((row) => selected.includes(row.id)));
  const eligible = chosen.length > 0 && chosen.every((row) => editable.has(row.status));
  const canReschedule = chosen.length > 0 && chosen.length <= 500 && chosen.every((row) => reschedulable.has(row.status));
  const preview = useMemo(() => buildReschedulePreview(chosen, startLocal, timezone, intervalMinutes, ambiguousOccurrence), [chosen, startLocal, timezone, intervalMinutes, ambiguousOccurrence]);
  const resolution = startLocal ? resolveLocalDateTime(startLocal, timezone) : null;
  const previewValid = preview.length > 0 && preview.every((item) => item.errors.length === 0 && item.scheduledAt !== null);
  const conflictQuery = useQuery({
    queryKey: ["batch-reschedule-conflicts", ws.id, preview.map((item) => `${item.job.id}:${item.scheduledAt}`).join("|")],
    enabled: rescheduleOpen && previewValid,
    queryFn: async () => {
      const times = preview.map((item) => item.scheduledAt!).map((value) => new Date(value).getTime());
      const min = new Date(Math.min(...times)).toISOString(); const max = new Date(Math.max(...times)).toISOString();
      const channelIds = [...new Set(preview.map((item) => item.job.channel_id))];
      const { data, error } = await supabase.from("publication_jobs").select("id,channel_id,media_asset_id,scheduled_at")
        .eq("workspace_id", ws.id).in("channel_id", channelIds).in("status", ["DRAFT", "SCHEDULED", "READY", "RETRY_WAIT", "PROCESSING", "PUBLISHED", "SENT_TO_INBOX", "UNKNOWN", "BLOCKED_APPROVAL", "BLOCKED_PERMISSION", "BLOCKED_REAUTH"])
        .gte("scheduled_at", min).lte("scheduled_at", max).limit(2001);
      if (error) throw error;
      return { rows: data ?? [], truncated: (data?.length ?? 0) > 2000 };
    },
  });
  const selectedIds = new Set(chosen.map((row) => row.id));
  const conflicts = preview.map((item) => conflictQuery.data?.rows.some((other) => !selectedIds.has(other.id) && other.channel_id === item.job.channel_id && other.media_asset_id === item.job.media_asset_id && other.scheduled_at === item.scheduledAt) ?? false);
  const hasConflict = conflicts.some(Boolean);
  const reschedule = useMutation({
    mutationFn: async () => {
      if (!previewValid || hasConflict || conflictQuery.isError || conflictQuery.isPending) throw new Error("Resolva os problemas da prévia antes de confirmar.");
      const { data, error } = await supabase.rpc("reschedule_publication_batch_items", {
        p_workspace: ws.id,
        p_items: preview.map((item) => ({ job_id: item.job.id, original_scheduled_at: item.job.scheduled_at, scheduled_at: item.scheduledAt, timezone })),
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
      return data as { rescheduled: number };
    }, onSuccess: async (data) => { setRescheduleResult(`${data.rescheduled} publicação(ões) reagendadas.`); setRescheduleOpen(false); setSelected([]); await refresh(); },
  });
  const repeatItems: BatchDraftItem[] = (rows.data ?? []).map((row) => ({
    channelId: row.channel_id,
    mediaIds: row.media_asset_ids?.length ? [...row.media_asset_ids] : [row.media_asset_id],
    postType: row.post_type ?? "VIDEO",
    caption: row.caption,
    privacyLevel: row.privacy_level,
    allowComment: row.allow_comment,
    allowDuet: row.allow_duet,
    allowStitch: row.allow_stitch,
    brandContent: row.brand_content,
    brandOrganic: row.brand_organic,
    musicRightsConfirmed: row.music_rights_confirmed,
  }));

  return <Modal title={`Lote ${batch.id.slice(0, 8)}`} onClose={onClose} wide>
    <ErrorBox error={rows.error ?? cancel.error ?? reschedule.error} />
    {rescheduleResult && <Notice tone="success">{rescheduleResult}</Notice>}
    {cancelResult && <Notice tone="success">{cancelResult}</Notice>}
    <Notice tone="info">{batch.total} itens · {batch.completed} finalizados · {batch.awaiting} aguardando ação. UNKNOWN não é sucesso.</Notice>
    {rows.isLoading ? <Loading /> : <>
      <div className="mb-3 flex justify-end">
        <Button variant="outline" disabled={!canEdit || repeatItems.length === 0} onClick={() => onRepeat(repeatItems)}>Repetir lote</Button>
      </div>
      {rows.data?.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Este lote não possui itens disponíveis para repetição.</p> : <TableCard>
        <Table>
          <TableHeader><TableRow><TableHead /><TableHead>Quando</TableHead><TableHead>Conta</TableHead><TableHead>Mídia</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader>
          <TableBody>{(rows.data ?? []).map((row) => <TableRow key={row.id}>
            <TableCell><Checkbox disabled={!editable.has(row.status)} checked={selected.includes(row.id)} onCheckedChange={(value) => setSelected((current) => value ? [...new Set([...current, row.id])] : current.filter((id) => id !== row.id))} /></TableCell>
            <TableCell>{formatDateTime(row.scheduled_at, row.timezone)}</TableCell>
            <TableCell>{row.channel_id.slice(0, 8)}</TableCell>
            <TableCell>{row.post_type === "PHOTO" ? `Carrossel (${row.media_asset_ids?.length ?? 0})` : row.media_asset_id.slice(0, 8)}</TableCell>
            <TableCell>{publicationStatusLabel[row.status]}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </TableCard>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{selected.length} selecionada(s)</span>
        {canEdit && <Button variant="outline" disabled={!canReschedule || reschedule.isPending} onClick={() => { setStartLocal(""); setAmbiguousOccurrence(null); setRescheduleOpen(true); }}>Reagendar selecionadas</Button>}
        {canEdit && <Button variant="destructive" disabled={!eligible || cancel.isPending} onClick={async () => { if (await confirm({ title: "Cancelar itens selecionados?", description: "Itens em processamento não podem ser cancelados. Reservas elegíveis serão liberadas.", confirmLabel: "Cancelar", destructive: true })) cancel.mutate(); }}>Cancelar selecionadas</Button>}
      </div>
      {selected.length > 0 && !eligible && <p className="mt-2 text-sm text-warning">Remova itens em estado irreversível para continuar.</p>}
      {selected.length > 500 && <p className="mt-2 text-sm text-warning">A operação aceita no máximo 500 publicações por vez.</p>}
    </>}
    {rescheduleOpen && <Modal title="Prévia do reagendamento" description="A alteração será validada novamente e aplicada integralmente em uma transação." onClose={() => setRescheduleOpen(false)} wide>
      <div className="space-y-4">
        <Notice tone="info">{chosen.length} item(ns) selecionados. A ordem usa data original, data de criação e ID. O intervalo permitido é de 1 a 1440 minutos; a quota não muda.</Notice>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nova data e horário inicial"><Input type="datetime-local" value={startLocal} onChange={(event) => { setStartLocal(event.target.value); setAmbiguousOccurrence(null); }} required /></Field>
          <Field label="Fuso horário"><SelectField value={timezone} onValueChange={setTimezone} options={[...new Set(["UTC", ...allTimezones()])].map((value) => ({ value, label: value }))} /></Field>
          <Field label="Intervalo entre publicações (minutos)" hint="Personalizado: de 1 a 1440 minutos."><Input type="number" min={1} max={1440} step={1} value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))} /></Field>
          <div className="flex flex-wrap items-end gap-2 pb-1">{intervalPresets.map((minutes) => <Button key={minutes} type="button" size="sm" variant={intervalMinutes === minutes ? "default" : "outline"} onClick={() => setIntervalMinutes(minutes)}>{minutes} min</Button>)}</div>
        </div>
        {resolution?.kind === "ambiguous" && <Field label="Este horário ocorre duas vezes. Escolha a ocorrência"><SelectField value={ambiguousOccurrence === null ? "" : String(ambiguousOccurrence)} onValueChange={(value) => setAmbiguousOccurrence(Number(value))} options={[{ value: "", label: "Escolha uma ocorrência" }, ...resolution.candidates.map((candidate, index) => ({ value: String(index), label: `${index === 0 ? "Primeira" : "Segunda"} ocorrência — ${candidate.toISOString()}` }))]} /></Field>}
        {resolution?.kind === "nonexistent" && <Notice tone="danger">Este horário não existe no fuso selecionado por causa da mudança de horário de verão.</Notice>}
        <TableCard><Table><TableHeader><TableRow><TableHead>Conta</TableHead><TableHead>Mídia</TableHead><TableHead>Status</TableHead><TableHead>Original</TableHead><TableHead>Novo horário</TableHead><TableHead>Validação</TableHead></TableRow></TableHeader><TableBody>
          {preview.map((item, index) => <TableRow key={item.job.id}><TableCell>{item.job.channel_id.slice(0, 8)}</TableCell><TableCell>{item.job.post_type === "PHOTO" ? `Carrossel (${item.job.media_asset_ids?.length ?? 0})` : item.job.media_asset_id.slice(0, 8)}</TableCell><TableCell>{publicationStatusLabel[item.job.status]}</TableCell><TableCell>{formatDateTime(item.job.scheduled_at, item.job.timezone)}</TableCell><TableCell>{item.scheduledAt ? `${utcToZonedInput(item.scheduledAt, timezone).replace("T", " ")} (${timezone})` : "—"}</TableCell><TableCell>{item.errors.map((error) => <div key={error} className="text-xs text-destructive">{error}</div>)}{conflicts[index] && <div className="text-xs text-destructive">Já existe publicação equivalente neste horário.</div>}{conflictQuery.data?.truncated && <div className="text-xs text-warning">Não foi possível verificar todos os conflitos existentes; reduza o intervalo/data ou tente novamente.</div>}{!item.errors.length && !conflicts[index] && !conflictQuery.data?.truncated && <span className="text-xs text-success">Sem conflito encontrado</span>}</TableCell></TableRow>)}
        </TableBody></Table></TableCard>
        <ErrorBox error={conflictQuery.error} />
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setRescheduleOpen(false)}>Voltar</Button><Button type="button" disabled={!canEdit || !canReschedule || !previewValid || hasConflict || conflictQuery.isPending || conflictQuery.isError || conflictQuery.data?.truncated || reschedule.isPending} onClick={async () => { if (await confirm({ title: "Confirmar reagendamento?", description: `${chosen.length} publicações serão atualizadas atomicamente. Nenhuma quota será reservada novamente.`, confirmLabel: "Confirmar reagendamento" })) reschedule.mutate(); }}>{reschedule.isPending ? "Reagendando…" : "Confirmar reagendamento"}</Button></div>
      </div>
    </Modal>}
  </Modal>;
}
