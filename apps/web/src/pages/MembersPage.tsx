import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { useCurrentWorkspace, useWorkspace } from '../auth/WorkspaceProvider';
import { Empty, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { toError, unwrap } from '../lib/api';
import { formatDateTime, roleLabel } from '../lib/format';
import { useProfiles } from '../lib/hooks';
import { supabase } from '../lib/supabase';
import type { Member, Role } from '../lib/types';

const ROLES: Role[] = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'];

export default function MembersPage() {
  const ws = useCurrentWorkspace();
  const { user } = useAuth();
  const { canAdmin, isOwner, refresh } = useWorkspace();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('EDITOR');

  const members = useQuery({
    queryKey: ['members', ws.id],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('workspace_members')
          .select('*')
          .eq('workspace_id', ws.id)
          .order('created_at', { ascending: true }),
      ) as unknown as Member[],
  });
  const profiles = useProfiles((members.data ?? []).map((m) => m.user_id));

  const reload = () => qc.invalidateQueries({ queryKey: ['members', ws.id] });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('add_member_by_email', {
        p_workspace: ws.id,
        p_email: email.trim(),
        p_role: role,
      });
      if (error) throw toError(error);
    },
    onSuccess: () => {
      setEmail('');
      return reload();
    },
  });

  const changeRole = useMutation({
    mutationFn: async ({ user_id, role }: { user_id: string; role: Role }) =>
      unwrap(await supabase.from('workspace_members').update({ role }).eq('workspace_id', ws.id).eq('user_id', user_id)),
    onSuccess: reload,
  });

  const removeMember = useMutation({
    mutationFn: async (user_id: string) =>
      unwrap(await supabase.from('workspace_members').delete().eq('workspace_id', ws.id).eq('user_id', user_id)),
    onSuccess: async (_d, user_id) => {
      await reload();
      if (user_id === user?.id) await refresh();
    },
  });

  // ADMIN não mexe em OWNER (a RLS também impede).
  const canManage = (m: Member) => isOwner || (canAdmin && m.role !== 'OWNER');
  const assignable = isOwner ? ROLES : ROLES.filter((r) => r !== 'OWNER');

  return (
    <>
      <PageHeader title="Membros" subtitle="Quem tem acesso a este workspace." />

      {canAdmin && (
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <input
            type="email"
            placeholder="E-mail de um usuário já cadastrado"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            aria-label="E-mail"
            style={{ minWidth: 280 }}
          />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Papel">
            {assignable.map((r) => (
              <option key={r} value={r}>
                {roleLabel[r]}
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={add.isPending}>
            Adicionar
          </button>
        </form>
      )}

      <ErrorBox error={members.error ?? add.error ?? changeRole.error ?? removeMember.error} />

      {members.isLoading ? (
        <Spinner />
      ) : (members.data ?? []).length === 0 ? (
        <Empty title="Sem membros" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Papel</th>
                <th>Desde</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.data!.map((m) => {
                const isMe = m.user_id === user?.id;
                return (
                  <tr key={m.user_id}>
                    <td>
                      {profiles.data?.[m.user_id] ?? '—'} {isMe && <span className="muted">(você)</span>}
                    </td>
                    <td>
                      {canManage(m) ? (
                        <select
                          value={m.role}
                          style={{ width: 'auto' }}
                          onChange={(e) => changeRole.mutate({ user_id: m.user_id, role: e.target.value as Role })}
                          aria-label={`Papel de ${profiles.data?.[m.user_id] ?? 'membro'}`}
                        >
                          {(isOwner ? ROLES : ROLES.filter((r) => r !== 'OWNER')).map((r) => (
                            <option key={r} value={r}>
                              {roleLabel[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        roleLabel[m.role]
                      )}
                    </td>
                    <td className="muted">{formatDateTime(m.created_at)}</td>
                    <td className="row-actions">
                      {(canManage(m) || isMe) && (
                        <button
                          className="btn small danger"
                          onClick={() => {
                            const msg = isMe ? 'Sair deste workspace?' : 'Remover este membro?';
                            if (window.confirm(msg)) removeMember.mutate(m.user_id);
                          }}
                        >
                          {isMe ? 'Sair' : 'Remover'}
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
    </>
  );
}
