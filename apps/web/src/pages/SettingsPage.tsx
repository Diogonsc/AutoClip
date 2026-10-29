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

  if (settings.isLoading) return <Loading />;
  const mode: PublishMode = settings.data?.publish_mode ?? "INBOX";
  const auto = settings.data?.auto_publish_enabled ?? false;

  return (
    <>
      <PageHeader title="Configurações" subtitle={ws.name} />
      <ErrorBox
        error={
          settings.error ??
          saveGeneral.error ??
          toggleAuto.error ??
          setMode.error
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
