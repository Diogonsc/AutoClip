import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentWorkspace, useWorkspace } from '../auth/WorkspaceProvider';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import {
  formatDateTime,
  publicationStatusLabel,
  publicationTone,
} from '../lib/format';
import type {
  Channel,
  MediaAsset,
  PublicationAttempt,
  PublicationEvent,
  PublicationJob,
} from '../lib/types';
import { Badge, ErrorBox, Modal, Spinner } from './ui';

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
  const resolve = useMutation({
    mutationFn: async (outcome: 'PUBLISHED' | 'NOT_PUBLISHED') =>
      unwrap(await supabase.rpc('resolve_unknown_job', { p_job: job.id, p_outcome: outcome })),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['jobs', ws.id] });
      onClose();
    },
  });

  const events = useQuery({
    queryKey: ['job-events', job.id],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('publication_events')
          .select('*')
          .eq('publication_job_id', job.id)
          .order('created_at', { ascending: true }),
      ) as unknown as PublicationEvent[],
  });

  const attempts = useQuery({
    queryKey: ['job-attempts', job.id],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('publication_attempts')
          .select('*')
          .eq('publication_job_id', job.id)
          .order('attempt_number', { ascending: true }),
      ) as unknown as PublicationAttempt[],
  });

  return (
    <Modal title="Detalhes da publicação" onClose={onClose} wide>
      <dl className="kv">
        <dt>Estado</dt>
        <dd>
          <Badge tone={publicationTone(job.status)}>{publicationStatusLabel[job.status]}</Badge>
        </dd>
        <dt>Canal</dt>
        <dd>{channel?.display_name ?? '—'}</dd>
        <dt>Vídeo</dt>
        <dd>{media?.original_filename ?? '—'}</dd>
        <dt>Legenda</dt>
        <dd>{job.caption || '—'}</dd>
        <dt>Agendada para</dt>
        <dd>
          {formatDateTime(job.scheduled_at, job.timezone)} ({job.timezone})
        </dd>
        <dt>Tentativas</dt>
        <dd>
          {job.attempt_count} de {job.max_attempts}
        </dd>
        <dt>ID remoto</dt>
        <dd>{job.remote_publish_id ?? '—'}</dd>
        {job.last_error_code && (
          <>
            <dt>Último erro</dt>
            <dd>
              <code>{job.last_error_code}</code> {job.last_error_message}
            </dd>
          </>
        )}
      </dl>

      {job.status === 'UNKNOWN' && (
        <div className="alert warning">
          O resultado desta publicação não pôde ser confirmado. Ela não será reenviada automaticamente, para evitar
          duplicidade; é preciso conferir o estado no TikTok antes de agir.
          {canEdit && (
            <>
              <p style={{ margin: '0.5rem 0' }}>Depois de conferir no TikTok, informe o que aconteceu:</p>
              <div className="actions">
                <button
                  className="btn"
                  disabled={resolve.isPending}
                  onClick={() => {
                    if (window.confirm('Confirmar que o vídeo JÁ FOI publicado/enviado ao TikTok?')) resolve.mutate('PUBLISHED');
                  }}
                >
                  O vídeo foi publicado
                </button>
                <button
                  className="btn"
                  disabled={resolve.isPending}
                  onClick={() => {
                    if (window.confirm('Confirmar que o vídeo NÃO está no TikTok? A publicação será reagendada para agora e enviada de novo.'))
                      resolve.mutate('NOT_PUBLISHED');
                  }}
                >
                  Não foi publicado — reenviar
                </button>
              </div>
              <ErrorBox error={resolve.error} />
            </>
          )}
        </div>
      )}

      <h2>Tentativas</h2>
      {attempts.isLoading ? (
        <Spinner />
      ) : (attempts.data ?? []).length === 0 ? (
        <p className="muted">Nenhuma tentativa registrada.</p>
      ) : (
        <ul className="timeline">
          {attempts.data!.map((a) => (
            <li key={a.id}>
              <time>{formatDateTime(a.started_at)}</time>
              <span>
                #{a.attempt_number} — {a.result ?? 'em andamento'}
                {a.error_code ? ` (${a.error_code})` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: '1rem' }}>Eventos</h2>
      {events.isLoading ? (
        <Spinner />
      ) : (events.data ?? []).length === 0 ? (
        <p className="muted">Sem eventos.</p>
      ) : (
        <ul className="timeline">
          {events.data!.map((ev) => {
            const p = ev.event_payload as { from?: string | null; to?: string };
            const text =
              ev.event_type === 'STATUS_CHANGED'
                ? `${p.from ? statusText(p.from) + ' → ' : 'Criada como '}${statusText(p.to)}`
                : ev.event_type;
            return (
              <li key={ev.id}>
                <time>{formatDateTime(ev.created_at)}</time>
                <span>{text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

function statusText(s: string | undefined): string {
  if (!s) return '—';
  return publicationStatusLabel[s as keyof typeof publicationStatusLabel] ?? s;
}
