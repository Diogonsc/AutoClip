import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspace, useWorkspace } from "../auth/WorkspaceProvider";
import { Loader2, Radio } from "lucide-react";
import { useConfirm } from "../components/confirm-provider";
import { SelectField } from "../components/select-field";
import {
  Badge,
  Empty,
  ErrorBox,
  Field,
  Modal,
  Notice,
  PageHeader,
  TableCard,
  Toolbar,
} from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";
import { Checkbox } from "../components/ui/checkbox";
import AccountGroupsModal from "../components/AccountGroupsModal";
import { invokeFunction, unwrap } from "../lib/api";
import {
  CAPTION_MAX,
  channelLocaleLabel,
  COUNTRIES,
  countryName,
  HASHTAGS_MAX,
  LANGUAGES,
  normalizeHashtags,
} from "../lib/channelDefaults";
import { channelStatusLabel, channelTone, formatDateTime } from "../lib/format";
import { useAccountGroupMembers, useAccountGroups, useChannels } from "../lib/hooks";
import { supabase } from "../lib/supabase";
import type { Channel } from "../lib/types";
import Loading from "@/components/loading";

/** Valor-sentinela para "Não definido" (o Select não aceita string vazia como opção). */
const UNSET = "__unset__";
const ALL = "__all__";

interface DefaultsForm {
  language: string;
  country: string;
  default_caption: string;
  default_hashtags: string;
}

function ChannelVpnStatus({
  workspaceId,
  channelId,
}: {
  workspaceId: string;
  channelId: string;
}) {
  const storageKey = `autoclip:corporate-vpn-status:${workspaceId}:${channelId}`;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    try {
      setConnected(window.localStorage.getItem(storageKey) === "connected");
    } catch {
      setConnected(false);
    }
  }, [storageKey]);

  function toggle() {
    const next = !connected;
    setConnected(next);
    try {
      window.localStorage.setItem(
        storageKey,
        next ? "connected" : "disconnected",
      );
    } catch {
      // Mantém o indicador funcional nesta sessão se o armazenamento estiver indisponível.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={connected ? "success" : "neutral"}>
        {connected ? "VPN marcada como ativa" : "Não confirmada"}
      </Badge>
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={toggle}
        aria-label={`${connected ? "Marcar VPN como desconectada" : "Marcar VPN como conectada"} para este canal`}
      >
        {connected ? "Desmarcar" : "Marcar ativa"}
      </Button>
    </div>
  );
}

function DefaultsModal({
  channel,
  onClose,
  onSaved,
}: {
  channel: Channel;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<DefaultsForm>({
    language: channel.language ?? "",
    country: channel.country ?? "",
    default_caption: channel.default_caption ?? "",
    default_hashtags: channel.default_hashtags ?? "",
  });
  const [localError, setLocalError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const hashtags = normalizeHashtags(form.default_hashtags);
      if (hashtags.length > HASHTAGS_MAX)
        throw new Error(
          `As hashtags podem ter no máximo ${HASHTAGS_MAX} caracteres.`,
        );
      if (form.default_caption.length > CAPTION_MAX)
        throw new Error(
          `A legenda pode ter no máximo ${CAPTION_MAX} caracteres.`,
        );
      unwrap(
        await supabase
          .from("channels")
          .update({
            language: form.language || null,
            country: form.country || null,
            default_caption: form.default_caption,
            default_hashtags: hashtags,
          })
          .eq("id", channel.id),
      );
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) =>
      setLocalError(
        e instanceof Error ? e.message : "Não foi possível salvar.",
      ),
  });

  return (
    <Modal
      title={`Padrões do canal — ${channel.display_name}`}
      onClose={onClose}
      wide
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setLocalError(null);
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Idioma" hint="Só para organizar a lista.">
            <SelectField
              value={form.language || UNSET}
              onValueChange={(v) =>
                setForm({ ...form, language: v === UNSET ? "" : v })
              }
              options={[
                { value: UNSET, label: "Não definido" },
                ...LANGUAGES.map((l) => ({
                  value: l.code,
                  label: `${l.name} (${l.code})`,
                })),
              ]}
            />
          </Field>
          <Field
            label="País"
            hint="Só para organizar a lista; não muda como a publicação é feita."
          >
            <SelectField
              value={form.country || UNSET}
              onValueChange={(v) =>
                setForm({ ...form, country: v === UNSET ? "" : v })
              }
              options={[
                { value: UNSET, label: "Não definido" },
                ...COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
              ]}
            />
          </Field>
        </div>
        <Field
          label="Legenda padrão"
          hint="Pré-preenchida em novas publicações deste canal; você pode editar antes de agendar."
        >
          <Textarea
            value={form.default_caption}
            onChange={(e) =>
              setForm({ ...form, default_caption: e.target.value })
            }
            maxLength={CAPTION_MAX}
            placeholder="Ex.: Boa noite."
          />
          <span className="text-xs font-normal text-muted-foreground">
            {form.default_caption.length}/{CAPTION_MAX}
          </span>
        </Field>
        <Field
          label="Hashtags padrão"
          hint="Separe por espaço ou vírgula. O # é opcional: ajustamos o formato ao salvar."
        >
          <Input
            value={form.default_hashtags}
            onChange={(e) =>
              setForm({ ...form, default_hashtags: e.target.value })
            }
            maxLength={HASHTAGS_MAX}
            placeholder="fé, motivação, paz"
          />
        </Field>
        {localError && <ErrorBox error={new Error(localError)} />}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RenameModal({
  channel,
  busy,
  onClose,
  onSave,
}: {
  channel: Channel;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(channel.display_name);

  return (
    <Modal title="Renomear canal" onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const next = value.trim();
          if (next && next !== channel.display_name) onSave(next);
          else onClose();
        }}
      >
        <Field label="Novo nome do canal">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={120}
            required
            autoFocus
          />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || !value.trim()}>
            Salvar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const RESULT_MESSAGE: Record<
  string,
  { tone: "success" | "warning" | "danger"; text: string }
> = {
  connected: { tone: "success", text: "Canal conectado ao TikTok." },
  denied: {
    tone: "warning",
    text: "A autorização foi negada no TikTok. Nada foi alterado.",
  },
  invalid_state: {
    tone: "danger",
    text: "O link de autorização expirou ou já foi usado. Inicie a conexão novamente.",
  },
  missing_scope: {
    tone: "warning",
    text: "Nem todas as permissões necessárias foram concedidas. Conecte de novo e mantenha todas marcadas.",
  },
  account_mismatch: {
    tone: "danger",
    text: "Esta é outra conta do TikTok. Para trocar de conta, desconecte o canal antes.",
  },
  duplicate: {
    tone: "danger",
    text: "Essa conta do TikTok já está conectada a outro canal.",
  },
  error: {
    tone: "danger",
    text: "Não foi possível concluir a conexão com o TikTok. Tente novamente.",
  },
};

export default function ChannelsPage() {
  const ws = useCurrentWorkspace();
  const { canEdit, canAdmin } = useWorkspace();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const channels = useChannels(ws.id);
  const groups = useAccountGroups(ws.id);
  const groupMembers = useAccountGroupMembers(ws.id);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Channel | null>(null);
  const [renaming, setRenaming] = useState<Channel | null>(null);
  const [countryFilter, setCountryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupFilter, setGroupFilter] = useState("");
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const result = params.get("tiktok");

  // Depois do retorno do OAuth, recarrega a lista (o backend mudou o estado do canal).
  useEffect(() => {
    if (result) void qc.invalidateQueries({ queryKey: ["channels", ws.id] });
  }, [result, qc, ws.id]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["channels", ws.id] });

  const add = useMutation({
    mutationFn: async (display_name: string) =>
      unwrap(
        await supabase
          .from("channels")
          .insert({ workspace_id: ws.id, display_name }),
      ),
    onSuccess: () => {
      setName("");
      return refresh();
    },
  });

  const rename = useMutation({
    mutationFn: async ({
      id,
      display_name,
    }: {
      id: string;
      display_name: string;
    }) =>
      unwrap(
        await supabase.from("channels").update({ display_name }).eq("id", id),
      ),
    onSuccess: () => {
      setRenaming(null);
      return refresh();
    },
  });

  const connect = useMutation({
    mutationFn: async ({ channelId }: { channelId: string }) => {
      const r = await invokeFunction<{ url: string }>(
        supabase,
        "tiktok-channel",
        { action: "connect", channel_id: channelId },
      );
      window.location.assign(r.url); // vai para a tela de autorização do TikTok
    },
  });

  const disconnect = useMutation({
    mutationFn: async (channel_id: string) =>
      invokeFunction(supabase, "tiktok-channel", {
        action: "disconnect",
        channel_id,
      }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await supabase.from("channels").delete().eq("id", id)),
    onSuccess: refresh,
  });

  const visibleChannels = (channels.data ?? []).filter((channel) => {
    const needle = search.trim().toLocaleLowerCase("pt-BR");
    return (
      (!countryFilter || channel.country === countryFilter) &&
      (!groupFilter || (groupMembers.data ?? []).some((member) => member.group_id === groupFilter && member.channel_id === channel.id)) &&
      (!statusFilter || channel.connection_status === statusFilter) &&
      (!needle ||
        channel.display_name.toLocaleLowerCase("pt-BR").includes(needle) ||
        (channel.provider_user_id ?? "").toLocaleLowerCase("pt-BR").includes(needle))
    );
  });

  const toggleSelected = (id: string, checked: boolean) =>
    setSelectedIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((value) => value !== id),
    );

  return (
    <>
      <PageHeader
        title="Canais TikTok"
        subtitle="Contas de destino das publicações."
      />

      {result && RESULT_MESSAGE[result] && (
        <Notice tone={RESULT_MESSAGE[result].tone}>
          {RESULT_MESSAGE[result].text}{" "}
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="ml-1 align-middle"
            onClick={() => setParams({}, { replace: true })}
          >
            Fechar
          </Button>
        </Notice>
      )}
      <Notice tone="info">
        Cadastrar um canal não o autoriza a publicar: use{" "}
        <strong>Conectar</strong> para autorizar o acesso na conta do TikTok.
        Até lá, o canal fica em “Aguardando autorização” e as publicações dele
        serão bloqueadas.
      </Notice>
      <Notice tone="neutral">
        O status da VPN é independente por canal e apenas informativo. Conecte a
        VPN pelo cliente corporativo no dispositivo; o AutoClipe não coleta
        credenciais nem verifica ou altera a conexão. As publicações continuam
        usando o fluxo oficial do TikTok.
      </Notice>

      {canEdit && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add.mutate(name.trim());
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do canal (ex.: @meucanal)"
            maxLength={120}
            aria-label="Nome do canal"
            className="w-full sm:w-80"
          />
          <Button type="submit" disabled={add.isPending || !name.trim()}>
            Adicionar canal
          </Button>
        </form>
      )}

      <Toolbar>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nome ou ID do TikTok…"
          aria-label="Buscar canais"
          className="w-full sm:w-72"
        />
        <SelectField
          aria-label="Filtrar por conexão"
          className="w-full sm:w-52"
          value={statusFilter || ALL}
          onValueChange={(value) => setStatusFilter(value === ALL ? "" : value)}
          options={[
            { value: ALL, label: "Todos os estados" },
            ...Object.entries(channelStatusLabel).map(([value, label]) => ({ value, label })),
          ]}
        />
        <SelectField
          aria-label="Filtrar por grupo"
          className="w-full sm:w-52"
          value={groupFilter || ALL}
          onValueChange={(value) => setGroupFilter(value === ALL ? "" : value)}
          options={[{ value: ALL, label: "Todos os grupos" }, ...(groups.data ?? []).map((group) => ({ value: group.id, label: group.name }))]}
        />
      {(channels.data ?? []).some((c) => c.country) && (
        <>
          <SelectField
            aria-label="Filtrar por país"
            className="w-full sm:w-56"
            value={countryFilter || ALL}
            onValueChange={(v) => setCountryFilter(v === ALL ? "" : v)}
            options={[
              { value: ALL, label: "Todos os países" },
              ...[
                ...new Set(
                  (channels.data ?? [])
                    .map((c) => c.country)
                    .filter((c): c is string => !!c),
                ),
              ].map((code) => ({ value: code, label: countryName(code) })),
            ]}
          />
        </>
      )}
      </Toolbar>

      {canEdit && <div className="flex justify-end"><Button type="button" variant="outline" onClick={() => setGroupsOpen(true)}>Organizar grupos</Button></div>}

      {selectedIds.length > 0 && (
        <Notice tone="info">
          {selectedIds.length} conta(s) selecionada(s). A seleção facilita a revisão em listas grandes; ações que alteram conexão continuam individuais para respeitar o OAuth oficial do TikTok.
          <Button type="button" variant="outline" size="xs" className="ml-2" onClick={() => setSelectedIds([])}>Limpar seleção</Button>
        </Notice>
      )}

      <ErrorBox
        error={
          add.error ??
          rename.error ??
          remove.error ??
          connect.error ??
          disconnect.error ??
          channels.error
        }
      />

      {channels.isLoading ? (
        <Loading />
      ) : (channels.data ?? []).length === 0 ? (
        <Empty title="Nenhum canal cadastrado" icon={Radio}>
          Adicione o primeiro canal acima.
        </Empty>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Selecionar canais filtrados"
                    checked={visibleChannels.length > 0 && visibleChannels.every((channel) => selectedIds.includes(channel.id))}
                    onCheckedChange={(checked) => setSelectedIds(checked ? visibleChannels.map((channel) => channel.id) : [])}
                  />
                </TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Idioma / país</TableHead>
                <TableHead>VPN corporativa</TableHead>
                <TableHead>ID no TikTok</TableHead>
                <TableHead>Autorizado em</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleChannels.map((c) => {
                const isConnecting =
                  connect.isPending && connect.variables?.channelId === c.id;
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Checkbox
                        aria-label={`Selecionar ${c.display_name}`}
                        checked={selectedIds.includes(c.id)}
                        onCheckedChange={(checked) => toggleSelected(c.id, checked === true)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {c.display_name}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <Badge tone={channelTone(c.connection_status)}>
                        {channelStatusLabel[c.connection_status]}
                      </Badge>
                      {c.last_error_message && (
                        <div className="mt-1 max-w-xs text-xs text-muted-foreground">
                          {c.last_error_message}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {channelLocaleLabel(c) || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ChannelVpnStatus workspaceId={ws.id} channelId={c.id} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.provider_user_id ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(c.authorized_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {canEdit && (
                          <Button
                            size="sm"
                            aria-label={`${c.connection_status === "CONNECTED" ? "Reconectar" : "Conectar"} ${c.display_name}`}
                            aria-busy={isConnecting}
                            disabled={connect.isPending}
                            onClick={() => connect.mutate({ channelId: c.id })}
                          >
                            {isConnecting && (
                              <Loader2
                                className="animate-spin"
                                aria-hidden="true"
                              />
                            )}
                            {isConnecting
                              ? "Conectando…"
                              : c.connection_status === "CONNECTED"
                                ? "Reconectar"
                                : "Conectar"}
                          </Button>
                        )}
                        {canAdmin &&
                          c.connection_status !== "PENDING_AUTH" &&
                          c.connection_status !== "REVOKED" && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={disconnect.isPending}
                              onClick={async () => {
                                if (
                                  await confirm({
                                    title: `Desconectar "${c.display_name}"?`,
                                    description:
                                      "Publicações pendentes deste canal serão bloqueadas.",
                                    confirmLabel: "Desconectar",
                                    destructive: true,
                                  })
                                )
                                  disconnect.mutate(c.id);
                              }}
                            >
                              Desconectar
                            </Button>
                          )}
                        {canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditing(c)}
                          >
                            Padrões
                          </Button>
                        )}
                        {canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRenaming(c)}
                          >
                            Renomear
                          </Button>
                        )}
                        {canAdmin && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: `Excluir o canal "${c.display_name}"?`,
                                  description:
                                    "As publicações deste canal e seus registros associados também serão excluídos. Esta ação não pode ser desfeita.",
                                  confirmLabel: "Excluir",
                                  destructive: true,
                                })
                              )
                                remove.mutate(c.id);
                            }}
                          >
                            Excluir
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableCard>
      )}

      {editing && (
        <DefaultsModal
          channel={editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      {renaming && (
        <RenameModal
          channel={renaming}
          busy={rename.isPending}
          onClose={() => setRenaming(null)}
          onSave={(display_name) =>
            rename.mutate({ id: renaming.id, display_name })
          }
        />
      )}
      {groupsOpen && <AccountGroupsModal groups={groups.data ?? []} members={groupMembers.data ?? []} channels={channels.data ?? []} selectedChannelIds={selectedIds} onClose={() => setGroupsOpen(false)} />}
    </>
  );
}
