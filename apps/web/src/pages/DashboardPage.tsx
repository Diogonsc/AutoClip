import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useCurrentWorkspace } from '../auth/WorkspaceProvider';
import { Badge, Empty, ErrorBox, Notice, PageHeader, Spinner } from '../components/ui';
import { unwrap } from '../lib/api';
import {
  BLOCKED_STATUSES,
  PROBLEM_CHANNEL_STATUSES,
  formatDateTime,
  publicationStatusLabel,
  publicationTone,
} from '../lib/format';
import { useChannels, useJobs, useSettings } from '../lib/hooks';
import { supabase } from '../lib/supabase';
import type { PublicationEvent } from '../lib/types';

export default function DashboardPage() {
  const ws = useCurrentWorkspace();
  const channels = useChannels(ws.id);
  const jobs = useJobs(ws.id);
  const settings = useSettings(ws.id);
  const events = useQuery({
    queryKey: ['recent-events', ws.id],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('publication_events')
          .select('*')
          .eq('workspace_id', ws.id)
          .order('created_at', { ascending: false })
          .limit(8),
      ) as unknown as PublicationEvent[],
  });

  if (channels.isLoading || jobs.isLoading) return <Spinner />;

  const ch = channels.data ?? [];
  const jb = jobs.data ?? [];
  const connected = ch.filter((c) => c.connection_status === 'CONNECTED').length;
  const problemChannels = ch.filter((c) => PROBLEM_CHANNEL_STATUSES.includes(c.connection_status));
  const scheduled = jb.filter((j) => j.status === 'SCHEDULED' || j.status === 'READY').length;
  const published = jb.filter((j) => j.status === 'PUBLISHED').length;
  const failed = jb.filter((j) => j.status === 'FAILED').length;
  const blocked = jb.filter((j) => BLOCKED_STATUSES.includes(j.status)).length;
  const unknown = jb.filter((j) => j.status === 'UNKNOWN').length;
  const now = Date.now();
  const upcoming = jb
    .filter((j) => (j.status === 'SCHEDULED' || j.status === 'READY') && j.scheduled_at && new Date(j.scheduled_at).getTime() >= now - 60_000)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())
    .slice(0, 5);
  const channelName = (id: string) => ch.find((c) => c.id === id)?.display_name ?? '—';

  const stats = [
    { n: ch.length, l: 'Canais cadastrados' },
    { n: connected, l: 'Canais conectados' },
    { n: problemChannels.length, l: 'Canais com problema' },
    { n: scheduled, l: 'Agendadas' },
    { n: published, l: 'Publicadas' },
    { n: failed, l: 'Com falha' },
    { n: blocked, l: 'Bloqueadas' },
    { n: unknown, l: 'Resultado desconhecido' },
  ];

  return (
    <>
      <PageHeader title="Painel" subtitle={ws.name} />
      <ErrorBox error={channels.error ?? jobs.error} />

      {settings.data && !settings.data.auto_publish_enabled && (
        <Notice tone="info">
          A publicação automática está <strong>desligada</strong> neste workspace: os agendamentos ficam salvos, mas nada é enviado ao
          TikTok. A ativação depende da integração oficial validada (Configurações).
        </Notice>
      )}
      {problemChannels.length > 0 && (
        <Notice tone="warning">
          {problemChannels.length} canal(is) precisam de atenção: {problemChannels.map((c) => c.display_name).join(', ')}.{' '}
          <Link to="/canais">Ver canais</Link>
        </Notice>
      )}
      {unknown > 0 && (
        <Notice tone="warning">
          {unknown} publicação(ões) com resultado desconhecido aguardam conferência. <Link to="/historico">Ver histórico</Link>
        </Notice>
      )}

      <div className="grid cols-4" style={{ marginBottom: '1.25rem' }}>
        {stats.map((s) => (
          <div className="card stat" key={s.l}>
            <div className="n">{s.n}</div>
            <div className="l">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="grid cols-2">
        <section className="card">
          <h2>Próximas publicações</h2>
          {upcoming.length === 0 ? (
            <Empty title="Nada agendado">
              Crie uma publicação em <Link to="/publicacoes">Publicações</Link>.
            </Empty>
          ) : (
            <ul className="timeline">
              {upcoming.map((j) => (
                <li key={j.id}>
                  <time>{formatDateTime(j.scheduled_at, j.timezone)}</time>
                  <span>
                    {channelName(j.channel_id)} — {j.caption ? j.caption.slice(0, 50) : 'sem legenda'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Atividade recente</h2>
          {events.isLoading ? (
            <Spinner />
          ) : (events.data ?? []).length === 0 ? (
            <Empty title="Sem atividade ainda" />
          ) : (
            <ul className="timeline">
              {events.data!.map((ev) => {
                const p = ev.event_payload as { to?: keyof typeof publicationStatusLabel };
                return (
                  <li key={ev.id}>
                    <time>{formatDateTime(ev.created_at)}</time>
                    <span>
                      {ev.event_type === 'STATUS_CHANGED' && p.to ? (
                        <Badge tone={publicationTone(p.to)}>{publicationStatusLabel[p.to] ?? p.to}</Badge>
                      ) : (
                        ev.event_type
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
