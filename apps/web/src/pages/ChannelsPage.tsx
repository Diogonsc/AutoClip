import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentWorkspace, useWorkspace } from '../auth/WorkspaceProvider';
import { Badge, Empty, ErrorBox, Notice, PageHeader, Spinner } from '../components/ui';
import { invokeFunction, unwrap } from '../lib/api';
import { channelStatusLabel, channelTone, formatDateTime } from '../lib/format';
import { useChannels } from '../lib/hooks';
import { supabase } from '../lib/supabase';

const RESULT_MESSAGE: Record<string, { tone: 'success' | 'warning' | 'danger'; text: string }> = {
  connected: { tone: 'success', text: 'Canal conectado ao TikTok.' },
  denied: { tone: 'warning', text: 'A autorização foi negada no TikTok. Nada foi alterado.' },
  invalid_state: { tone: 'danger', text: 'O link de autorização expirou ou já foi usado. Inicie a conexão novamente.' },
  missing_scope: { tone: 'warning', text: 'Nem todas as permissões necessárias foram concedidas. Conecte de novo e mantenha todas marcadas.' },
  account_mismatch: { tone: 'danger', text: 'Esta é outra conta do TikTok. Para trocar de conta, desconecte o canal antes.' },
  duplicate: { tone: 'danger', text: 'Essa conta do TikTok já está conectada a outro canal.' },
  error: { tone: 'danger', text: 'Não foi possível concluir a conexão com o TikTok. Tente novamente.' },
};

export default function ChannelsPage() {
  const ws = useCurrentWorkspace();
  const { canEdit, canAdmin } = useWorkspace();
  const qc = useQueryClient();
  const channels = useChannels(ws.id);
  const [name, setName] = useState('');
  const [params, setParams] = useSearchParams();
  const result = params.get('tiktok');

  // Depois do retorno do OAuth, recarrega a lista (o backend mudou o estado do canal).
  useEffect(() => {
    if (result) void qc.invalidateQueries({ queryKey: ['channels', ws.id] });
  }, [result, qc, ws.id]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['channels', ws.id] });

  const add = useMutation({
    mutationFn: async (display_name: string) =>
      unwrap(await supabase.from('channels').insert({ workspace_id: ws.id, display_name })),
    onSuccess: () => {
      setName('');
      return refresh();
    },
  });

  const rename = useMutation({
    mutationFn: async ({ id, display_name }: { id: string; display_name: string }) =>
      unwrap(await supabase.from('channels').update({ display_name }).eq('id', id)),
    onSuccess: refresh,
  });

  const connect = useMutation({
    mutationFn: async (channel_id: string) => {
      const r = await invokeFunction<{ url: string }>(supabase, 'tiktok-channel', { action: 'connect', channel_id });
      window.location.assign(r.url); // vai para a tela de autorização do TikTok
    },
  });

  const disconnect = useMutation({
    mutationFn: async (channel_id: string) =>
      invokeFunction(supabase, 'tiktok-channel', { action: 'disconnect', channel_id }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('channels').delete().eq('id', id)),
    onSuccess: refresh,
  });

  return (
    <>
      <PageHeader title="Canais TikTok" subtitle="Contas de destino das publicações." />

      {result && RESULT_MESSAGE[result] && (
        <Notice tone={RESULT_MESSAGE[result].tone}>
          {RESULT_MESSAGE[result].text}{' '}
          <button className="btn small" onClick={() => setParams({}, { replace: true })}>
            Fechar
          </button>
        </Notice>
      )}
      <Notice tone="info">
        Cadastrar um canal não o autoriza a publicar: use <strong>Conectar</strong> para autorizar o acesso na conta do TikTok. Até lá, o
        canal fica em “Aguardando autorização” e as publicações dele serão bloqueadas.
      </Notice>

      {canEdit && (
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add.mutate(name.trim());
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do canal (ex.: @meucanal)"
            maxLength={120}
            aria-label="Nome do canal"
          />
          <button className="btn primary" disabled={add.isPending || !name.trim()}>
            Adicionar canal
          </button>
        </form>
      )}

      <ErrorBox error={add.error ?? rename.error ?? remove.error ?? connect.error ?? disconnect.error ?? channels.error} />

      {channels.isLoading ? (
        <Spinner />
      ) : (channels.data ?? []).length === 0 ? (
        <Empty title="Nenhum canal cadastrado">Adicione o primeiro canal acima.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Canal</th>
                <th>Estado</th>
                <th>ID no TikTok</th>
                <th>Autorizado em</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {channels.data!.map((c) => (
                <tr key={c.id}>
                  <td>{c.display_name}</td>
                  <td>
                    <Badge tone={channelTone(c.connection_status)}>{channelStatusLabel[c.connection_status]}</Badge>
                    {c.last_error_message && <div className="muted">{c.last_error_message}</div>}
                  </td>
                  <td className="muted">{c.provider_user_id ?? '—'}</td>
                  <td className="muted">{formatDateTime(c.authorized_at)}</td>
                  <td className="row-actions">
                    {canEdit && (
                      <button className="btn small primary" disabled={connect.isPending} onClick={() => connect.mutate(c.id)}>
                        {c.connection_status === 'CONNECTED' ? 'Reconectar' : 'Conectar'}
                      </button>
                    )}{' '}
                    {canAdmin && c.connection_status !== 'PENDING_AUTH' && c.connection_status !== 'REVOKED' && (
                      <button
                        className="btn small"
                        disabled={disconnect.isPending}
                        onClick={() => {
                          if (window.confirm(`Desconectar "${c.display_name}" do TikTok? Publicações pendentes deste canal serão bloqueadas.`))
                            disconnect.mutate(c.id);
                        }}
                      >
                        Desconectar
                      </button>
                    )}{' '}
                    {canEdit && (
                      <button
                        className="btn small"
                        onClick={() => {
                          const next = window.prompt('Novo nome do canal', c.display_name)?.trim();
                          if (next && next !== c.display_name) rename.mutate({ id: c.id, display_name: next });
                        }}
                      >
                        Renomear
                      </button>
                    )}{' '}
                    {canAdmin && (
                      <button
                        className="btn small danger"
                        onClick={() => {
                          if (window.confirm(`Excluir o canal "${c.display_name}"?`)) remove.mutate(c.id);
                        }}
                      >
                        Excluir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
