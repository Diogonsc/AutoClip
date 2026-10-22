import { useState } from 'react';
import { useCurrentWorkspace } from '../auth/WorkspaceProvider';
import JobDetail from '../components/JobDetail';
import { Badge, Empty, ErrorBox, PageHeader, Spinner } from '../components/ui';
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

      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value as '' | PublicationStatus)} aria-label="Filtrar por estado">
          <option value="">Todos os estados</option>
          {HISTORY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {publicationStatusLabel[s]}
            </option>
          ))}
        </select>
      </div>

      {jobs.isLoading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty title="Nada no histórico ainda" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Atualizada em</th>
                <th>Canal</th>
                <th>Vídeo</th>
                <th>Estado</th>
                <th>Tentativas</th>
                <th>Erro</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((j) => (
                <tr key={j.id}>
                  <td>{formatDateTime(j.updated_at)}</td>
                  <td>{channelOf(j.channel_id)?.display_name ?? '—'}</td>
                  <td>{mediaOf(j.media_asset_id)?.original_filename ?? '—'}</td>
                  <td>
                    <Badge tone={publicationTone(j.status)}>{publicationStatusLabel[j.status]}</Badge>
                  </td>
                  <td>
                    {j.attempt_count}/{j.max_attempts}
                  </td>
                  <td className="muted">{j.last_error_code ?? '—'}</td>
                  <td className="row-actions">
                    <button className="btn small" onClick={() => setDetail(j)}>
                      Detalhes
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
