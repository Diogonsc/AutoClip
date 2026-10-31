import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspace, useWorkspace } from "../auth/WorkspaceProvider";
import { useConfirm } from "../components/confirm-provider";
import { SelectField } from "../components/select-field";
import { ErrorBox, Field, Notice, PageHeader } from "../components/ui";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { unwrap } from "../lib/api";
import { useSettings } from "../lib/hooks";
import { allTimezones } from "../lib/time";
import { supabase } from "../lib/supabase";
import type { PublishMode } from "../lib/types";
import Loading from "@/components/loading";

export default function SettingsPage() {
  const ws = useCurrentWorkspace();
  const { canAdmin, isOwner, refresh } = useWorkspace();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const settings = useSettings(ws.id);
  const tzList = useMemo(() => allTimezones(), []);

  const [name, setName] = useState(ws.name);
  const [tz, setTz] = useState("America/Sao_Paulo");

  useEffect(() => {
    if (settings.data) setTz(settings.data.default_timezone);
  }, [settings.data]);

  const saveGeneral = useMutation({
    mutationFn: async () => {
      unwrap(
        await supabase
          .from("workspaces")
          .update({ name: name.trim() })
          .eq("id", ws.id),
      );
      unwrap(
        await supabase
          .from("workspace_settings")
          .update({ default_timezone: tz })
          .eq("workspace_id", ws.id),
      );
    },
    onSuccess: async () => {
      await refresh();
      await qc.invalidateQueries({ queryKey: ["settings", ws.id] });
    },
  });

  const toggleAuto = useMutation({
    mutationFn: async (enabled: boolean) =>
      unwrap(
        await supabase
          .from("workspace_settings")
          .update({ auto_publish_enabled: enabled })
          .eq("workspace_id", ws.id),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", ws.id] }),
  });

  const setMode = useMutation({
    mutationFn: async (mode: PublishMode) =>
      unwrap(
        await supabase
          .from("workspace_settings")
          .update({ publish_mode: mode })
          .eq("workspace_id", ws.id),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", ws.id] }),
  });

  const saveMediaRetention = useMutation({
    mutationFn: async (values: {
      auto_delete_media_enabled: boolean;
      auto_delete_media_dry_run: boolean;
      auto_delete_media_grace_hours?: number;
      auto_delete_media_batch_size?: number;
    }) =>
      unwrap(
        await supabase
          .from("workspace_settings")
          .update(values)
          .eq("workspace_id", ws.id),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", ws.id] }),
  });

  if (settings.isLoading) return <Loading />;
  const mode: PublishMode = settings.data?.publish_mode ?? "INBOX";
  const auto = settings.data?.auto_publish_enabled ?? false;
  const mediaAutoDelete = settings.data?.auto_delete_media_enabled ?? false;
  const mediaDryRun = settings.data?.auto_delete_media_dry_run ?? true;
  const mediaGraceHours = settings.data?.auto_delete_media_grace_hours ?? 24;
  const mediaBatchSize = settings.data?.auto_delete_media_batch_size ?? 10;

  return (
    <>
      <PageHeader title="Configurações" subtitle={ws.name} />
      <ErrorBox
        error={
          settings.error ??
          saveGeneral.error ??
          toggleAuto.error ??
          setMode.error ??
          saveMediaRetention.error
        }
      />

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Geral</CardTitle>
            <CardDescription>Nome e fuso horário do workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                saveGeneral.mutate();
              }}
            >
              <Field label="Nome do workspace">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  required
                  disabled={!canAdmin}
                />
              </Field>
              <Field label="Fuso horário padrão">
                <SelectField
                  value={tz}
                  onValueChange={setTz}
                  disabled={!canAdmin}
                  options={(tzList.includes(tz) ? tzList : [tz, ...tzList]).map(
                    (z) => ({ value: z, label: z }),
                  )}
                />
              </Field>
              {canAdmin ? (
                <div className="flex items-center gap-3">
                  <Button
                    type="submit"
                    disabled={saveGeneral.isPending || !name.trim()}
                  >
                    Salvar
                  </Button>
                  {saveGeneral.isSuccess && (
                    <span className="text-sm text-success">Salvo.</span>
                  )}
                </div>
              ) : (
                <p className="m-0 text-sm text-muted-foreground">
                  Somente administradores podem alterar estas opções.
                </p>
              )}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Retenção de mídia</CardTitle>
            <CardDescription>
              Arquivos publicados só podem ser limpos após a confirmação do TikTok, sem agendamentos ou reconciliações pendentes e após 24 horas de segurança.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Notice tone={mediaAutoDelete ? (mediaDryRun ? "info" : "warning") : "neutral"}>
              {!mediaAutoDelete
                ? "Limpeza automática desativada: nenhum arquivo será removido pelo AutoClip."
                : mediaDryRun
                  ? "Simulação ativa: o sistema registra os candidatos, mas não remove objetos do Storage."
                  : "Exclusão automática ativa. Use somente após homologar a simulação."}
            </Notice>
            <Label className="font-normal">
              <Switch
                checked={mediaAutoDelete}
                disabled={!isOwner || saveMediaRetention.isPending}
                onCheckedChange={(next) =>
                  saveMediaRetention.mutate({
                    auto_delete_media_enabled: next,
                    auto_delete_media_dry_run: mediaDryRun,
                  })
                }
              />
              <span>Executar limpeza automática</span>
            </Label>
            <Label className="font-normal">
              <Switch
                checked={mediaDryRun}
                disabled={!isOwner || saveMediaRetention.isPending}
                onCheckedChange={(next) =>
                  saveMediaRetention.mutate({
                    auto_delete_media_enabled: mediaAutoDelete,
                    auto_delete_media_dry_run: next,
                  })
                }
              />
              <span>Modo de simulação (recomendado)</span>
            </Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Período de segurança (horas)">
                <Input
                  type="number"
                  min={1}
                  max={720}
                  defaultValue={mediaGraceHours}
                  disabled={!isOwner || saveMediaRetention.isPending}
                  onBlur={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isInteger(next) && next >= 1 && next <= 720 && next !== mediaGraceHours)
                      saveMediaRetention.mutate({ auto_delete_media_enabled: mediaAutoDelete, auto_delete_media_dry_run: mediaDryRun, auto_delete_media_grace_hours: next });
                  }}
                />
              </Field>
              <Field label="Arquivos por workspace/lote">
                <Input
                  type="number"
                  min={1}
                  max={50}
                  defaultValue={mediaBatchSize}
                  disabled={!isOwner || saveMediaRetention.isPending}
                  onBlur={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isInteger(next) && next >= 1 && next <= 50 && next !== mediaBatchSize)
                      saveMediaRetention.mutate({ auto_delete_media_enabled: mediaAutoDelete, auto_delete_media_dry_run: mediaDryRun, auto_delete_media_batch_size: next });
                  }}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Modo de publicação</CardTitle>
            <CardDescription>
              Ao trocar o modo, reconecte os canais para autorizar as permissões
              do novo modo. Somente o proprietário pode alterar.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Notice tone="info">
              {mode === "INBOX"
                ? "Rascunho no TikTok: o vídeo é enviado para a caixa de entrada do aplicativo TikTok e você conclui a postagem por lá. Não exige auditoria do app."
                : "Publicação direta: o vídeo é postado automaticamente. Apps TikTok ainda não auditados só conseguem postar como “Somente eu”."}
            </Notice>
            <SelectField
              aria-label="Modo de publicação"
              value={mode}
              disabled={!isOwner || setMode.isPending}
              onValueChange={async (next) => {
                if (next === mode) return;
                if (
                  await confirm({
                    title: "Alterar o modo de publicação?",
                    description: "Os canais precisarão ser reconectados.",
                    confirmLabel: "Alterar modo",
                  })
                )
                  setMode.mutate(next as PublishMode);
              }}
              options={[
                { value: "INBOX", label: "Enviar como rascunho (INBOX)" },
                { value: "DIRECT", label: "Publicar direto (DIRECT)" },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Publicação automática</CardTitle>
            <CardDescription>
              Mantenha desligada até que o aplicativo TikTok, os escopos e o
              fluxo de consentimento estejam validados. Somente o proprietário
              pode alterar.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Notice tone={auto ? "warning" : "info"}>
              {auto
                ? "Ligada: o processador pode enviar publicações agendadas ao TikTok. Cada envio ainda é bloqueado se faltar autorização, permissão ou confirmação."
                : "Desligada: os agendamentos ficam salvos, mas nenhuma publicação é enviada ao TikTok."}
            </Notice>
            <Label className="font-normal">
              <Switch
                checked={auto}
                disabled={!isOwner || toggleAuto.isPending}
                onCheckedChange={async (next) => {
                  if (
                    await confirm({
                      title: next
                        ? "Ligar a publicação automática?"
                        : "Desligar a publicação automática?",
                      description: next
                        ? "O processador poderá enviar as publicações agendadas deste workspace ao TikTok."
                        : "Os agendamentos continuam salvos, mas nada será enviado ao TikTok.",
                      confirmLabel: next ? "Ligar" : "Desligar",
                      destructive: !next,
                    })
                  )
                    toggleAuto.mutate(next);
                }}
              />
              <span>
                {auto
                  ? "Publicação automática ligada"
                  : "Publicação automática desligada"}
              </span>
            </Label>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
