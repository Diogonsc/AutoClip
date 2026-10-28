import { useState } from 'react';
import { useCurrentWorkspace } from '../auth/WorkspaceProvider';
import JobDetail from '../components/JobDetail';
import { History } from 'lucide-react';
import { SelectField } from '../components/select-field';
import { Badge, Empty, ErrorBox, PageHeader, Spinner, TableCard, Toolbar } from '../components/ui';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { formatDateTime, publicationStatusLabel, publicationTone } from '../lib/format';
import { useChannels, useJobs, useMedia } from '../lib/hooks';
import type { PublicationJob, PublicationStatus } from '../lib/types';

const HISTORY_STATUSES: PublicationStatus[] = [
  'PUBLISHED',
  'SENT_TO_INBOX',
  'FAILED',
  'UNKNOWN',
  'BLOCKED_APPROVAL',
  'BLOCKED_PERMISSION',
  'BLOCKED_REAUTH',
  'RETRY_WAIT',
  'PROCESSING',
  'CANCELLED',
];

export default function HistoryPage() {
  const ws = useCurrentWorkspace();
  const jobs = useJobs(ws.id);
  const channels = useChannels(ws.id);
  const media = useMedia(ws.id);
  const [filter, setFilter] = useState<'' | PublicationStatus>('');
  const [detail, setDetail] = useState<PublicationJob | null>(null);

  const channelOf = (id: string) => channels.data?.find((c) => c.id === id);
  const mediaOf = (id: string) => media.data?.find((m) => m.id === id);

  const list = (jobs.data ?? [])
    .filter((j) => HISTORY_STATUSES.includes(j.status) && (!filter || j.status === filter))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  return (
    <>
      <PageHeader title="Histórico" subtitle="Publicações já processadas, bloqueadas, falhas e canceladas." />
      <ErrorBox error={jobs.error} />

      <Toolbar>
        <SelectField
          aria-label="Filtrar por estado"
          className="w-full sm:w-64"
          value={filter || 'all'}
          onValueChange={(v) => setFilter(v === 'all' ? '' : (v as PublicationStatus))}
          options={[
            { value: 'all', label: 'Todos os estados' },
            ...HISTORY_STATUSES.map((st) => ({ value: st, label: publicationStatusLabel[st] })),
          ]}
        />
      </Toolbar>

      {jobs.isLoading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty title="Nada no histórico ainda" icon={History} />
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Atualizada em</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Vídeo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Tentativas</TableHead>
                <TableHead>Erro</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((j) => (
                <TableRow key={j.id}>
                  <TableCell>{formatDateTime(j.updated_at)}</TableCell>
                  <TableCell>{channelOf(j.channel_id)?.display_name ?? '—'}</TableCell>
                  <TableCell>{mediaOf(j.media_asset_id)?.original_filename ?? '—'}</TableCell>
                  <TableCell>
                    <Badge tone={publicationTone(j.status)}>{publicationStatusLabel[j.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    {j.attempt_count}/{j.max_attempts}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{j.last_error_code ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => setDetail(j)}>
                      Detalhes
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
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
