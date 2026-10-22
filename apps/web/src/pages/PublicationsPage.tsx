import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentWorkspace, useWorkspace } from '../auth/WorkspaceProvider';
import JobDetail from '../components/JobDetail';
import PublicationForm from '../components/PublicationForm';
import { Badge, Empty, ErrorBox, Notice, PageHeader, Spinner } from '../components/ui';
import { unwrap } from '../lib/api';
import {
  EDITABLE_STATUSES,
  formatDateTime,
  publicationStatusLabel,
  publicationTone,
} from '../lib/format';
import { useChannels, useJobs, useMedia, useSettings } from '../lib/hooks';
import { supabase } from '../lib/supabase';
import type { PublicationJob, PublicationStatus } from '../lib/types';

export default function PublicationsPage() {
  const ws = useCurrentWorkspace();
  const { canEdit } = useWorkspace();
  const qc = useQueryClient();
  const jobs = useJobs(ws.id);
  const channels = useChannels(ws.id);
  const media = useMedia(ws.id);
  const settings = useSettings(ws.id);

  const [filter, setFilter] = useState<'' | PublicationStatus>('');
  const [formJob, setFormJob] = useState<PublicationJob | 'new' | null>(null);
  const [detail, setDetail] = useState<PublicationJob | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['jobs', ws.id] });

  const cancel = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await supabase.from('publication_jobs').update({ status: 'CANCELLED' }).eq('id', id)),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('publication_jobs').delete().eq('id', id)),
    onSuccess: refresh,
  });

  const channelOf = (id: string) => channels.data?.find((c) => c.id === id);
  const mediaOf = (id: string) => media.data?.find((m) => m.id === id);
  const list = (jobs.data ?? []).filter((j) => !filter || j.status === filter);
  const hasScheduled = (jobs.data ?? []).some((j) => j.status === 'SCHEDULED');

  return (
    <>
      <PageHeader
        title="Publicações"
        subtitle="Prepare, agende e acompanhe os vídeos."
        actions={
          canEdit && (
            <button className="btn primary" onClick={() => setFormJob('new')}>
              Nova publicação
            </button>
          )
        }
      />

      {settings.data && !settings.data.auto_publish_enabled && hasScheduled && (
        <Notice tone="info">
          A publicação automática está desligada: as publicações agendadas permanecem salvas e <strong>não serão enviadas</strong> ao
          TikTok.
        </Notice>
      )}
      <ErrorBox error={jobs.error ?? cancel.error ?? remove.error} />

      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value as '' | PublicationStatus)} aria-label="Filtrar por estado">
          <option value="">Todos os estados</option>
          {(Object.keys(publicationStatusLabel) as PublicationStatus[]).map((s) => (
            <option key={s} value={s}>
              {publicationStatusLabel[s]}
            </option>
          ))}
        </select>
      </div>

      {jobs.isLoading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty title="Nenhuma publicação">{canEdit ? 'Clique em “Nova publicação” para começar.' : undefined}</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Canal</th>
                <th>Vídeo</th>
                <th>Legenda</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((j) => {
                const editable = canEdit && EDITABLE_STATUSES.includes(j.status);
                return (
                  <tr key={j.id}>
                    <td>{formatDateTime(j.scheduled_at, j.timezone)}</td>
                    <td>{channelOf(j.channel_id)?.display_name ?? '—'}</td>
                    <td>{mediaOf(j.media_asset_id)?.original_filename ?? '—'}</td>
                    <td className="muted">{j.caption ? j.caption.slice(0, 40) : '—'}</td>
                    <td>
                      <Badge tone={publicationTone(j.status)}>{publicationStatusLabel[j.status]}</Badge>
                    </td>
                    <td className="row-actions">
                      <button className="btn small" onClick={() => setDetail(j)}>
                        Detalhes
                      </button>{' '}
                      {editable && (
                        <button className="btn small" onClick={() => setFormJob(j)}>
                          Editar
                        </button>
                      )}{' '}
                      {editable && j.status !== 'DRAFT' && (
                        <button
                          className="btn small"
                          onClick={() => {
                            if (window.confirm('Cancelar esta publicação?')) cancel.mutate(j.id);
                          }}
                        >
                          Cancelar
                        </button>
                      )}{' '}
                      {canEdit && (j.status === 'DRAFT' || j.status === 'CANCELLED') && (
                        <button
                          className="btn small danger"
                          onClick={() => {
                            if (window.confirm('Excluir definitivamente?')) remove.mutate(j.id);
                          }}
                        >
                          Excluir
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {formJob && (
        <PublicationForm job={formJob === 'new' ? undefined : formJob} onClose={() => setFormJob(null)} />
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
