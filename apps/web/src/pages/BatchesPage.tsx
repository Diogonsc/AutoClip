import { useEffect, useMemo, useState } from "react";
import { Download, Search, X } from "lucide-react";
import { useCurrentWorkspace } from "../auth/WorkspaceProvider";
import { Empty, ErrorBox, Field, PageHeader, TableCard, Toolbar } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { SelectField } from "../components/select-field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { formatDateTime, publicationStatusLabel } from "../lib/format";
import { useAccountGroups, useChannels, usePublicationBatchesPage } from "../lib/hooks";
import type { PublicationBatchSummary } from "../lib/types";
import Loading from "@/components/loading";
import PublicationBatchDetails from "../components/PublicationBatchDetails";
import BatchScheduler, { type BatchDraftItem } from "../components/BatchScheduler";

const PAGE_SIZE = 25;
const statusFilters = ["SCHEDULED", "READY", "RETRY_WAIT", "PROCESSING", "PUBLISHED", "FAILED", "CANCELLED", "SENT_TO_INBOX", "UNKNOWN", "BLOCKED_APPROVAL", "BLOCKED_PERMISSION", "BLOCKED_REAUTH"];

export default function BatchesPage() {
  const ws = useCurrentWorkspace();
  const channels = useChannels(ws.id);
  const groups = useAccountGroups(ws.id);
  const [page, setPage] = useState(0);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [batchId, setBatchId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [detail, setDetail] = useState<PublicationBatchSummary | null>(null);
  const [repeatItems, setRepeatItems] = useState<BatchDraftItem[] | null>(null);
  const [repeatDraftKey, setRepeatDraftKey] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchText), 250);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const filters = useMemo(() => ({ search, channelId: channel, status, createdFrom, createdTo, batchId, groupId }), [search, channel, status, createdFrom, createdTo, batchId, groupId]);
  const batches = usePublicationBatchesPage(ws.id, page, PAGE_SIZE, filters);
  const activeFilterCount = [search, channel, status, createdFrom, createdTo, batchId, groupId].filter(Boolean).length;
  const clearFilters = () => { setSearchText(""); setSearch(""); setChannel(""); setStatus(""); setCreatedFrom(""); setCreatedTo(""); setBatchId(""); setGroupId(""); setPage(0); };
  const updateFilter = (update: () => void) => { update(); setPage(0); };
  const exportCsv = (batch: PublicationBatchSummary) => {
    const rows = [
      ["batch_id", "total", "scheduled", "processing", "published", "failed", "cancelled", "unknown", "sent_to_inbox", "awaiting"],
      [batch.id, batch.total, batch.scheduled, batch.processing, batch.published, batch.failed, batch.cancelled, batch.unknown, batch.sent_to_inbox, batch.awaiting],
    ];
    const blob = new Blob([rows.map((row) => row.join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `lote-${batch.id.slice(0, 8)}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  if (batches.isLoading || channels.isLoading || groups.isLoading) return <Loading />;
  const total = batches.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = batches.data?.rows ?? [];

  return <>
    <PageHeader title="Histórico de lotes" subtitle="Filtros e totais são aplicados no PostgreSQL. Progresso conta somente PUBLISHED, FAILED e CANCELLED como estados terminais; UNKNOWN, Inbox e bloqueios aguardam ação." />
    <ErrorBox error={batches.error ?? channels.error ?? groups.error} />
    <div className="mb-4 space-y-3 rounded-lg border p-3">
      <Toolbar>
        <div className="min-w-56 flex-1"><Input value={searchText} onChange={(event) => { setSearchText(event.target.value); setPage(0); }} placeholder="Pesquisar ID ou nome do lote" aria-label="Pesquisar lote" /></div>
        <div className="w-56"><Input value={batchId} onChange={(event) => updateFilter(() => setBatchId(event.target.value))} placeholder="ID exato do lote" aria-label="ID exato do lote" /></div>
        <div className="w-56"><SelectField value={channel || "ALL"} onValueChange={(value) => updateFilter(() => setChannel(value === "ALL" ? "" : value))} options={[{ value: "ALL", label: "Todas as contas" }, ...(channels.data ?? []).map((item) => ({ value: item.id, label: item.display_name }))]} /></div>
        <div className="w-56"><SelectField value={status || "ALL"} onValueChange={(value) => updateFilter(() => setStatus(value === "ALL" ? "" : value))} options={[{ value: "ALL", label: "Todos os status" }, ...statusFilters.map((value) => ({ value, label: publicationStatusLabel[value as keyof typeof publicationStatusLabel] ?? value }))]} /></div>
        <div className="w-56"><SelectField value={groupId || "ALL"} onValueChange={(value) => updateFilter(() => setGroupId(value === "ALL" ? "" : value))} options={[{ value: "ALL", label: "Todos os grupos" }, ...(groups.data ?? []).map((group) => ({ value: group.id, label: group.name }))]} /></div>
      </Toolbar>
      <Toolbar>
        <Field label="Criado a partir de"><Input type="date" value={createdFrom} max={createdTo || undefined} onChange={(event) => updateFilter(() => setCreatedFrom(event.target.value))} /></Field>
        <Field label="Criado até"><Input type="date" value={createdTo} min={createdFrom || undefined} onChange={(event) => updateFilter(() => setCreatedTo(event.target.value))} /></Field>
        <Button type="button" variant="outline" disabled={!activeFilterCount} onClick={clearFilters}><X className="size-4" /> Limpar filtros</Button>
        <span className="text-sm text-muted-foreground">{activeFilterCount} filtro(s) ativo(s)</span>
      </Toolbar>
    </div>
    {batches.isFetching && !batches.isLoading && <p className="text-sm text-muted-foreground" role="status">Atualizando resultados…</p>}
    {rows.length === 0 ? <Empty title="Nenhum lote encontrado" icon={Search}>Altere os filtros ou confirme um novo lote.</Empty> : <TableCard><Table>
      <TableHeader><TableRow><TableHead>Lote</TableHead><TableHead>Criação (UTC)</TableHead><TableHead>Contas</TableHead><TableHead>Itens</TableHead><TableHead>Estados</TableHead><TableHead>Progresso</TableHead><TableHead /></TableRow></TableHeader>
      <TableBody>{rows.map((batch) => {
        const progress = batch.total ? Math.round(batch.completed * 100 / batch.total) : 0;
        return <TableRow key={batch.id}>
          <TableCell>{batch.label ?? batch.id.slice(0, 8)}<div className="text-xs text-muted-foreground">{batch.id.slice(0, 8)}</div></TableCell>
          <TableCell>{formatDateTime(batch.created_at, "UTC")}</TableCell><TableCell>{batch.channels.length}</TableCell><TableCell>{batch.total}</TableCell>
          <TableCell className="text-xs">{batch.scheduled} agendadas · {batch.processing} processando · {batch.published} publicadas · {batch.failed} falhas · {batch.cancelled} canceladas · {batch.unknown} UNKNOWN · {batch.sent_to_inbox} Inbox · {batch.awaiting} aguardando</TableCell>
          <TableCell>{progress}%<div className="text-xs text-muted-foreground">{batch.completed}/{batch.total} terminais</div></TableCell>
          <TableCell><div className="flex gap-1"><Button variant="outline" size="sm" onClick={() => setDetail(batch)}>Detalhes</Button><Button variant="outline" size="sm" aria-label="Exportar resumo CSV" onClick={() => exportCsv(batch)}><Download className="size-3.5" /></Button></div></TableCell>
        </TableRow>;
      })}</TableBody>
    </Table></TableCard>}
    <div className="mt-4 flex justify-between"><span className="text-sm text-muted-foreground">{total} lote(s) · página {total === 0 ? 0 : page + 1} de {total === 0 ? 0 : totalPages}</span><div className="flex gap-2"><Button variant="outline" disabled={page === 0 || batches.isFetching} onClick={() => setPage((value) => value - 1)}>Anterior</Button><Button variant="outline" disabled={page + 1 >= totalPages || batches.isFetching} onClick={() => setPage((value) => value + 1)}>Próxima</Button></div></div>
    {detail && <PublicationBatchDetails batch={detail} onClose={() => setDetail(null)} onRepeat={(items) => { setDetail(null); setRepeatItems(items); setRepeatDraftKey(crypto.randomUUID()); }} />}
    {repeatItems && <BatchScheduler key={repeatDraftKey} initialItems={repeatItems} initialStrategy="SEQUENTIAL" onClose={() => { setRepeatItems(null); setRepeatDraftKey(""); }} />}
  </>;
}
