import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { useCurrentWorkspace, useWorkspace } from "../auth/WorkspaceProvider";
import { ErrorBox, Field, Modal, Notice } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { supabase } from "../lib/supabase";
import { unwrap } from "../lib/api";
import type { AccountGroup, AccountGroupMember, Channel } from "../lib/types";

export default function AccountGroupsModal({ groups, members, channels, selectedChannelIds, onClose }: {
  groups: AccountGroup[]; members: AccountGroupMember[]; channels: Channel[]; selectedChannelIds: string[]; onClose: () => void;
}) {
  const ws = useCurrentWorkspace();
  const { user } = useAuth();
  const { canEdit } = useWorkspace();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [activeId, setActiveId] = useState(groups[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["account-groups", ws.id] }),
    qc.invalidateQueries({ queryKey: ["account-group-members", ws.id] }),
  ]);
  const active = groups.find((group) => group.id === activeId);
  const activeMemberIds = useMemo(() => new Set(members.filter((member) => member.group_id === activeId).map((member) => member.channel_id)), [members, activeId]);
  const create = useMutation({
    mutationFn: async () => unwrap(await supabase.from("account_groups").insert({ workspace_id: ws.id, name: name.trim(), description: description.trim() || null, color, created_by: user!.id })),
    onSuccess: async () => { setName(""); setDescription(""); await refresh(); },
  });
  const save = useMutation({
    mutationFn: async () => { if (!active) return; return unwrap(await supabase.from("account_groups").update({ name: name.trim() || active.name, description: description.trim() || null, color }).eq("id", active.id)); },
    onSuccess: refresh,
  });
  const removeGroup = useMutation({ mutationFn: async (id: string) => unwrap(await supabase.from("account_groups").delete().eq("id", id)), onSuccess: async () => { setActiveId(""); await refresh(); } });
  const addSelected = useMutation({
    mutationFn: async () => {
      if (!activeId || !selectedChannelIds.length) throw new Error("Selecione contas na lista antes de adicioná-las.");
      return unwrap(await supabase.from("account_group_members").upsert(selectedChannelIds.map((channel_id) => ({ workspace_id: ws.id, group_id: activeId, channel_id })), { onConflict: "group_id,channel_id", ignoreDuplicates: true }));
    }, onSuccess: refresh,
  });
  const removeMember = useMutation({ mutationFn: async (channelId: string) => unwrap(await supabase.from("account_group_members").delete().eq("group_id", activeId).eq("channel_id", channelId)), onSuccess: refresh });

  return <Modal title="Organizar grupos de contas" onClose={onClose} wide>
    <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
      <section className="space-y-2">
        <p className="text-sm font-medium">Grupos do workspace</p>
        {groups.length === 0 && <p className="text-sm text-muted-foreground">Crie o primeiro grupo abaixo.</p>}
        {groups.map((group) => <button key={group.id} type="button" onClick={() => { setActiveId(group.id); setName(group.name); setDescription(group.description ?? ""); setColor(group.color); }} className={`flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm ${activeId === group.id ? "border-primary" : ""}`}>
          <span className="flex min-w-0 items-center gap-2"><i className="size-3 rounded-full" style={{ backgroundColor: group.color }} /><span className="truncate">{group.name}</span></span>
          <span className="text-muted-foreground">{members.filter((member) => member.group_id === group.id).length}</span>
        </button>)}
      </section>
      <section className="space-y-4">
        <ErrorBox error={error ?? create.error ?? save.error ?? removeGroup.error ?? addSelected.error ?? removeMember.error} />
        {canEdit && <form className="grid gap-3 rounded border p-3" onSubmit={(event) => { event.preventDefault(); setError(null); if (!name.trim()) return setError("Informe um nome para o grupo."); if (active) save.mutate(); else create.mutate(); }}>
          <Field label={active ? "Editar grupo" : "Novo grupo"}><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Ex.: Contas principais" /></Field>
          <Field label="Descrição (opcional)"><Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} /></Field>
          <Field label="Cor"><Input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-10 w-16 p-1" /></Field>
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={create.isPending || save.isPending}>{active ? "Salvar grupo" : "Criar grupo"}</Button>{active && <Button type="button" variant="outline" onClick={() => { setActiveId(""); setName(""); setDescription(""); setColor("#6366f1"); }}>Novo grupo</Button>}{active && <Button type="button" variant="destructive" disabled={removeGroup.isPending} onClick={() => removeGroup.mutate(active.id)}>Excluir grupo</Button>}</div>
        </form>}
        {active && <>
          <Notice tone="info">{selectedChannelIds.length} conta(s) selecionada(s) na lista. Adicionar ao grupo não altera conexões OAuth.</Notice>
          {canEdit && <Button type="button" disabled={!selectedChannelIds.length || addSelected.isPending} onClick={() => addSelected.mutate()}>Adicionar selecionadas a “{active.name}”</Button>}
          <div className="rounded border"><div className="border-b px-3 py-2 text-sm font-medium">Contas em {active.name}</div>{[...activeMemberIds].length === 0 ? <p className="p-3 text-sm text-muted-foreground">Nenhuma conta neste grupo.</p> : [...activeMemberIds].map((channelId) => <div key={channelId} className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm last:border-b-0"><span>{channels.find((channel) => channel.id === channelId)?.display_name ?? "Conta removida"}</span>{canEdit && <Button type="button" variant="outline" size="xs" onClick={() => removeMember.mutate(channelId)}>Remover</Button>}</div>)}</div>
        </>}
      </section>
    </div>
  </Modal>;
}
