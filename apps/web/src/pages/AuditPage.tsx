import { useQuery } from '@tanstack/react-query';
import { useCurrentWorkspace } from '../auth/WorkspaceProvider';
import { Empty, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { unwrap } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useProfiles } from '../lib/hooks';
import { supabase } from '../lib/supabase';
import type { AuditLog } from '../lib/types';

const ACTION: Record<string, string> = { INSERT: 'Criou', UPDATE: 'Alterou', DELETE: 'Excluiu' };
const ENTITY: Record<string, string> = {
  channels: 'canal',
  media_assets: 'vídeo',
  publication_jobs: 'publicação',
  workspace_members: 'membro',
  workspace_settings: 'configurações',
};

export default function AuditPage() {
  const ws = useCurrentWorkspace();
  const logs = useQuery({
    queryKey: ['audit', ws.id],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('audit_logs')
          .select('*')
          .eq('workspace_id', ws.id)
          .order('created_at', { ascending: false })
          .limit(200),
      ) as unknown as AuditLog[],
  });
  const profiles = useProfiles((logs.data ?? []).map((l) => l.actor_user_id).filter((x): x is string => Boolean(x)));

  return (
    <>
      <PageHeader title="Auditoria" subtitle="Últimas 200 operações registradas neste workspace." />
      <ErrorBox error={logs.error} />
      {logs.isLoading ? (
        <Spinner />
      ) : (logs.data ?? []).length === 0 ? (
        <Empty title="Nenhum registro" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>Ação</th>
                <th>Campos alterados</th>
              </tr>
            </thead>
            <tbody>
              {logs.data!.map((l) => {
                const changed = (l.metadata as { changed?: string[] }).changed;
                return (
                  <tr key={l.id}>
                    <td>{formatDateTime(l.created_at)}</td>
                    <td>{l.actor_user_id ? (profiles.data?.[l.actor_user_id] ?? '—') : 'Sistema'}</td>
                    <td>
                      {ACTION[l.action] ?? l.action} {ENTITY[l.entity_type] ?? l.entity_type}
                    </td>
                    <td className="muted">{changed?.join(', ') ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
