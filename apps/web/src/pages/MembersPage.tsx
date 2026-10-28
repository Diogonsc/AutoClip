import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { useCurrentWorkspace, useWorkspace } from "../auth/WorkspaceProvider";
import { Users } from "lucide-react";
import { useConfirm } from "../components/confirm-provider";
import { SelectField } from "../components/select-field";
import { Empty, ErrorBox, PageHeader, Spinner, TableCard } from "../components/ui";
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
import { toError, unwrap } from "../lib/api";
import { formatDateTime, roleLabel } from "../lib/format";
import { useProfiles } from "../lib/hooks";
import { supabase } from "../lib/supabase";
import type { Member, Role } from "../lib/types";

const ROLES: Role[] = ["OWNER", "ADMIN", "EDITOR", "VIEWER"];

export default function MembersPage() {
  const ws = useCurrentWorkspace();
  const { user } = useAuth();
  const { canAdmin, isOwner, refresh } = useWorkspace();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("EDITOR");

  const members = useQuery({
    queryKey: ["members", ws.id],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("workspace_members")
          .select("*")
          .eq("workspace_id", ws.id)
          .order("created_at", { ascending: true }),
      ) as unknown as Member[],
  });
  const profiles = useProfiles((members.data ?? []).map((m) => m.user_id));

  const reload = () => qc.invalidateQueries({ queryKey: ["members", ws.id] });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("add_member_by_email", {
        p_workspace: ws.id,
        p_email: email.trim(),
        p_role: role,
      });
      if (error) throw toError(error);
    },
    onSuccess: () => {
      setEmail("");
      return reload();
    },
  });

  const changeRole = useMutation({
    mutationFn: async ({ user_id, role }: { user_id: string; role: Role }) =>
      unwrap(
        await supabase
          .from("workspace_members")
          .update({ role })
          .eq("workspace_id", ws.id)
          .eq("user_id", user_id),
      ),
    onSuccess: reload,
  });

  const removeMember = useMutation({
    mutationFn: async (user_id: string) =>
      unwrap(
        await supabase
          .from("workspace_members")
          .delete()
          .eq("workspace_id", ws.id)
          .eq("user_id", user_id),
      ),
    onSuccess: async (_d, user_id) => {
      await reload();
      if (user_id === user?.id) await refresh();
    },
  });

  // ADMIN não mexe em OWNER (a RLS também impede).
  const canManage = (m: Member) => isOwner || (canAdmin && m.role !== "OWNER");
  const assignable = isOwner ? ROLES : ROLES.filter((r) => r !== "OWNER");

  return (
    <>
      <PageHeader
        title="Membros"
        subtitle="Quem tem acesso a este workspace."
      />

      {canAdmin && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Input
            type="email"
            placeholder="E-mail de um usuário já cadastrado"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            aria-label="E-mail"
            className="w-full sm:w-80"
          />
          <SelectField
            aria-label="Papel"
            className="w-full sm:w-48"
            value={role}
            onValueChange={(v) => setRole(v as Role)}
            options={assignable.map((r) => ({ value: r, label: roleLabel[r] }))}
          />
          <Button type="submit" disabled={add.isPending}>
            Adicionar
          </Button>
        </form>
      )}

      <ErrorBox
        error={
          members.error ?? add.error ?? changeRole.error ?? removeMember.error
        }
      />

      {members.isLoading ? (
        <Spinner />
      ) : (members.data ?? []).length === 0 ? (
        <Empty title="Sem membros" icon={Users} />
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Desde</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data!.map((m) => {
                const isMe = m.user_id === user?.id;
                const name = profiles.data?.[m.user_id] ?? "—";
                return (
                  <TableRow key={m.user_id}>
                    <TableCell className="font-medium">
                      {name}{" "}
                      {isMe && (
                        <span className="font-normal text-muted-foreground">
                          (você)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canManage(m) ? (
                        <SelectField
                          aria-label={`Papel de ${profiles.data?.[m.user_id] ?? "membro"}`}
                          className="w-44"
                          value={m.role}
                          onValueChange={(next) =>
                            changeRole.mutate({
                              user_id: m.user_id,
                              role: next as Role,
                            })
                          }
                          options={assignable.map((r) => ({
                            value: r,
                            label: roleLabel[r],
                          }))}
                        />
                      ) : (
                        roleLabel[m.role]
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(m.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {(canManage(m) || isMe) && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={async () => {
                            if (
                              await confirm({
                                title: isMe
                                  ? "Sair deste workspace?"
                                  : "Remover este membro?",
                                description: isMe
                                  ? "Você perderá o acesso a este workspace."
                                  : `${name} perderá o acesso a este workspace.`,
                                confirmLabel: isMe ? "Sair" : "Remover",
                                destructive: true,
                              })
                            )
                              removeMember.mutate(m.user_id);
                          }}
                        >
                          {isMe ? "Sair" : "Remover"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </>
  );
}
