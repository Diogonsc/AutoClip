import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentWorkspace } from '../auth/WorkspaceProvider';
import { Empty, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { unwrap } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { AppNotification } from '../lib/types';

export default function NotificationsPage() {
  const ws = useCurrentWorkspace();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ['notifications', ws.id],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('notifications')
          .select('*')
          .eq('workspace_id', ws.id)
          .order('created_at', { ascending: false })
          .limit(100),
      ) as unknown as AppNotification[],
  });

  const markRead = useMutation({
    mutationFn: async (id: string | null) => {
      const q = supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('workspace_id', ws.id).is('read_at', null);
      return unwrap(await (id ? q.eq('id', id) : q));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', ws.id] }),
  });

  const unread = (list.data ?? []).filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader
        title="Notificações"
        subtitle={unread > 0 ? `${unread} não lida(s)` : 'Tudo em dia'}
        actions={
          unread > 0 && (
            <button className="btn" disabled={markRead.isPending} onClick={() => markRead.mutate(null)}>
              Marcar todas como lidas
            </button>
          )
        }
      />
      <ErrorBox error={list.error ?? markRead.error} />

      {list.isLoading ? (
        <Spinner />
      ) : (list.data ?? []).length === 0 ? (
        <Empty title="Sem notificações" />
      ) : (
        <div className="grid">
          {list.data!.map((n) => (
            <article key={n.id} className="card" style={{ opacity: n.read_at ? 0.65 : 1 }}>
              <div className="actions" style={{ justifyContent: 'space-between' }}>
                <strong>{n.title}</strong>
                <span className="muted">{formatDateTime(n.created_at)}</span>
              </div>
              {n.body && <p style={{ margin: '.4rem 0 0' }}>{n.body}</p>}
              {!n.read_at && (
                <button className="btn small" style={{ marginTop: '.6rem' }} onClick={() => markRead.mutate(n.id)}>
                  Marcar como lida
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
