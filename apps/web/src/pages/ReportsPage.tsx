import { useMemo } from 'react';
import { BarChart3, Download, FileText } from 'lucide-react';
import { useCurrentWorkspace } from '../auth/WorkspaceProvider';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { ErrorBox, PageHeader } from '../components/ui';
import { useChannels, useMedia } from '../lib/hooks';
import { supabase } from '../lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { toError } from '../lib/api';
import { formatDateTime, publicationStatusLabel } from '../lib/format';
import type { PublicationJob } from '../lib/types';
import Loading from '../components/loading';

export default function ReportsPage() {
  const ws = useCurrentWorkspace();
  const channels = useChannels(ws.id);
  const media = useMedia(ws.id);
  const jobs = useQuery({ queryKey: ['report-jobs', ws.id], queryFn: async () => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from('publication_jobs').select('*').eq('workspace_id', ws.id).gte('created_at', since).order('created_at', { ascending: false }).limit(2000);
    if (error) throw toError(error);
    return (data ?? []) as unknown as PublicationJob[];
  }});
  const rows = jobs.data ?? [];
  const stats = useMemo(() => ({ total: rows.length, published: rows.filter((j) => ['PUBLISHED','SENT_TO_INBOX'].includes(j.status)).length, failed: rows.filter((j) => ['FAILED','UNKNOWN','BLOCKED_APPROVAL','BLOCKED_PERMISSION','BLOCKED_REAUTH'].includes(j.status)).length, scheduled: rows.filter((j) => ['SCHEDULED','READY','RETRY_WAIT'].includes(j.status)).length }), [rows]);
  const channelName = (id: string) => channels.data?.find((c) => c.id === id)?.display_name ?? 'Canal removido';
  const mediaName = (id: string) => media.data?.find((m) => m.id === id)?.original_filename ?? 'Mídia removida';
  const printReport = () => window.print();
  return <div className="grid gap-5 report-page">
    <PageHeader title="Relatório semanal" subtitle="Indicadores de operação dos últimos 7 dias, baseados no histórico registrado no AutoClip." actions={<Button onClick={printReport}><Download className="mr-2 size-4" />Exportar PDF / Imprimir</Button>} />
    <ErrorBox error={jobs.error ?? channels.error ?? media.error} />
    {jobs.isLoading ? <Loading /> : <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[['Publicações criadas', stats.total], ['Concluídas / enviadas ao inbox', stats.published], ['Falhas ou bloqueios', stats.failed], ['Agendadas / aguardando', stats.scheduled]].map(([label, value]) => <Card key={String(label)}><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader><CardContent><p className="m-0 text-3xl font-semibold">{value}</p></CardContent></Card>)}
      </div>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="size-5" />Detalhamento por publicação</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full min-w-[680px] border-collapse text-sm"><thead><tr className="border-b text-left"><th className="p-2">Criada em</th><th className="p-2">Canal</th><th className="p-2">Vídeo</th><th className="p-2">Status</th><th className="p-2">Tentativas</th><th className="p-2">Último erro</th></tr></thead><tbody>{rows.map((j) => <tr key={j.id} className="border-b last:border-0"><td className="p-2">{formatDateTime(j.created_at)}</td><td className="p-2">{channelName(j.channel_id)}</td><td className="p-2">{mediaName(j.media_asset_id)}</td><td className="p-2">{publicationStatusLabel[j.status] ?? j.status}</td><td className="p-2">{j.attempt_count}/{j.max_attempts}</td><td className="p-2">{j.last_error_code ?? '—'}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma publicação criada nos últimos 7 dias.</p>}</CardContent></Card>
      <p className="text-xs text-muted-foreground print:block">Gerado em {new Date().toLocaleString('pt-BR')}. Os dados refletem o histórico disponível no workspace; não representam métricas de visualizações, curtidas ou alcance fornecidas pelo TikTok.</p>
    </>}
    <style>{`@media print { body { background: white !important; color: black !important; } .report-page button, aside, nav { display: none !important; } .report-page { padding: 0 !important; } .report-page * { break-inside: avoid; } }`}</style>
  </div>;
}
