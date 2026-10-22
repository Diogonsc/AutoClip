import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentWorkspace, useWorkspace } from '../auth/WorkspaceProvider';
import { ErrorBox, Field, Notice, PageHeader, Spinner } from '../components/ui';
import { unwrap } from '../lib/api';
import { useSettings } from '../lib/hooks';
import { allTimezones } from '../lib/time';
import { supabase } from '../lib/supabase';
import type { PublishMode } from '../lib/types';

export default function SettingsPage() {
  const ws = useCurrentWorkspace();
  const { canAdmin, isOwner, refresh } = useWorkspace();
  const qc = useQueryClient();
  const settings = useSettings(ws.id);
  const tzList = useMemo(() => allTimezones(), []);

  const [name, setName] = useState(ws.name);
  const [tz, setTz] = useState('America/Sao_Paulo');

  useEffect(() => {
    if (settings.data) setTz(settings.data.default_timezone);
  }, [settings.data]);

  const saveGeneral = useMutation({
    mutationFn: async () => {
      unwrap(await supabase.from('workspaces').update({ name: name.trim() }).eq('id', ws.id));
      unwrap(await supabase.from('workspace_settings').update({ default_timezone: tz }).eq('workspace_id', ws.id));
    },
    onSuccess: async () => {
      await refresh();
      await qc.invalidateQueries({ queryKey: ['settings', ws.id] });
    },
  });

  const toggleAuto = useMutation({
    mutationFn: async (enabled: boolean) =>
      unwrap(await supabase.from('workspace_settings').update({ auto_publish_enabled: enabled }).eq('workspace_id', ws.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', ws.id] }),
  });

  const setMode = useMutation({
    mutationFn: async (mode: PublishMode) =>
      unwrap(await supabase.from('workspace_settings').update({ publish_mode: mode }).eq('workspace_id', ws.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', ws.id] }),
  });

  if (settings.isLoading) return <Spinner />;
  const mode: PublishMode = settings.data?.publish_mode ?? 'INBOX';
  const auto = settings.data?.auto_publish_enabled ?? false;

  return (
    <>
      <PageHeader title="Configurações" subtitle={ws.name} />
      <ErrorBox error={settings.error ?? saveGeneral.error ?? toggleAuto.error ?? setMode.error} />

      <section className="card" style={{ marginBottom: '1rem', maxWidth: 560 }}>
        <h2>Geral</h2>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            saveGeneral.mutate();
          }}
        >
          <Field label="Nome do workspace">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required disabled={!canAdmin} />
          </Field>
          <Field label="Fuso horário padrão">
            <select value={tz} onChange={(e) => setTz(e.target.value)} disabled={!canAdmin}>
              {(tzList.includes(tz) ? tzList : [tz, ...tzList]).map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </Field>
          {canAdmin ? (
            <div className="actions">
              <button className="btn primary" disabled={saveGeneral.isPending || !name.trim()}>
                Salvar
              </button>
              {saveGeneral.isSuccess && <span className="muted">Salvo.</span>}
            </div>
          ) : (
            <p className="muted">Somente administradores podem alterar estas opções.</p>
          )}
        </form>
      </section>

      <section className="card" style={{ marginBottom: '1rem', maxWidth: 560 }}>
        <h2>Modo de publicação</h2>
        <Notice tone="info">
          {mode === 'INBOX'
            ? 'Rascunho no TikTok: o vídeo é enviado para a caixa de entrada do aplicativo TikTok e você conclui a postagem por lá. Não exige auditoria do app.'
            : 'Publicação direta: o vídeo é postado automaticamente. Apps TikTok ainda não auditados só conseguem postar como “Somente eu”.'}
        </Notice>
        <p className="muted">
          Ao trocar o modo, reconecte os canais para autorizar as permissões do novo modo. Somente o proprietário pode alterar.
        </p>
        <select
          value={mode}
          disabled={!isOwner || setMode.isPending}
          onChange={(e) => {
            if (window.confirm('Alterar o modo de publicação? Os canais precisarão ser reconectados.')) setMode.mutate(e.target.value as PublishMode);
          }}
          aria-label="Modo de publicação"
        >
          <option value="INBOX">Enviar como rascunho (INBOX)</option>
          <option value="DIRECT">Publicar direto (DIRECT)</option>
        </select>
      </section>

      <section className="card" style={{ maxWidth: 560 }}>
        <h2>Publicação automática</h2>
        <Notice tone={auto ? 'warning' : 'info'}>
          {auto
            ? 'Ligada: o processador pode enviar publicações agendadas ao TikTok. Cada envio ainda é bloqueado se faltar autorização, permissão ou confirmação.'
            : 'Desligada: os agendamentos ficam salvos, mas nenhuma publicação é enviada ao TikTok.'}
        </Notice>
        <p className="muted">
          Mantenha desligada até que o aplicativo TikTok, os escopos e o fluxo de consentimento estejam validados. Somente o proprietário
          pode alterar.
        </p>
        <button
          className={auto ? 'btn' : 'btn primary'}
          disabled={!isOwner || toggleAuto.isPending}
          onClick={() => {
            const next = !auto;
            const msg = next
              ? 'Ligar a publicação automática para este workspace?'
              : 'Desligar a publicação automática?';
            if (window.confirm(msg)) toggleAuto.mutate(next);
          }}
        >
          {auto ? 'Desligar publicação automática' : 'Ligar publicação automática'}
        </button>
      </section>
    </>
  );
}
