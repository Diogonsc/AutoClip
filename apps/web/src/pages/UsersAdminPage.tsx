import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Users } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import {
  ErrorBox,
  Empty,
  PageHeader,
  TableCard,
  Field,
  Modal,
} from "../components/ui";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { Label } from "../components/ui/label";
import { useConfirm } from "../components/confirm-provider";
import { errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { supabase } from "../lib/supabase";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import Loading from "@/components/loading";

type ManagedUser = {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
  last_sign_in_at: string | null;
  is_active: boolean;
  billing_started_at: string;
  is_platform_owner: boolean;
};
type UserForm = {
  id?: string;
  display_name: string;
  email: string;
  billing_started_at: string;
  original_email?: string;
};

async function callAdmin<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: Record<string, unknown>,
  query = "",
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(
    `admin-users${query}`,
    { method, ...(body ? { body } : {}) },
  );
  if (error) {
    const response = (error as { context?: Response }).context;
    const payload = (await response?.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(payload?.message ?? error.message);
  }
  return data as T;
}

function formatDate(date: string) {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function UsersAdminPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<UserForm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const perPage = 50;
  const users = useQuery({
    queryKey: ["platform-users", page],
    queryFn: () =>
      callAdmin<{ users: ManagedUser[]; total: number | null }>(
        "GET",
        undefined,
        `?page=${page}&per_page=${perPage}`,
      ),
  });
  const reload = () => qc.invalidateQueries({ queryKey: ["platform-users"] });
  const flags = useQuery({
    queryKey: ["platform-flags-admin"],
    queryFn: () =>
      callAdmin<{ flags: { tiktok_audited?: boolean } }>("GET", undefined, "?flags"),
  });
  const setAudited = useMutation({
    mutationFn: (value: boolean) =>
      callAdmin("PATCH", { flags: { tiktok_audited: value } }),
    onSuccess: async () => {
      setActionError(null);
      await flags.refetch();
      await qc.invalidateQueries({ queryKey: ["platform-flags"] });
    },
    onError: setActionError,
  });

  const save = useMutation({
    mutationFn: async (entry: UserForm) => {
      const body: Record<string, unknown> = {
        display_name: entry.display_name.trim(),
        billing_started_at: entry.billing_started_at,
      };
      if (!entry.id) {
        body.email = entry.email.trim();
        return callAdmin("POST", body);
      }
      // Só envia o e-mail quando mudou, para não disparar uma troca de e-mail desnecessária.
      if (entry.email.trim().toLowerCase() !== entry.original_email) body.email = entry.email.trim();
      body.user_id = entry.id;
      return callAdmin("PATCH", body);
    },
    onSuccess: async (_data, entry) => {
      setActionError(null);
      setForm(null);
      setNotice(
        entry.id
          ? "Dados do usuário atualizados."
          : "Convite enviado por e-mail.",
      );
      await reload();
    },
    onError: setActionError,
  });
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      callAdmin("PATCH", { user_id: id, is_active: active }),
    onSuccess: async () => {
      setActionError(null);
      await reload();
    },
    onError: setActionError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => callAdmin("DELETE", { user_id: id }),
    onSuccess: async () => {
      setActionError(null);
      setNotice(
        "Usuário e workspaces próprios excluídos. Workspaces compartilhados foram mantidos com outro owner.",
      );
      await reload();
    },
    onError: setActionError,
  });
  const filtered = useMemo(() => {
    const value = search.trim().toLocaleLowerCase("pt-BR");
    return (users.data?.users ?? []).filter(
      (u) =>
        !value ||
        `${u.display_name} ${u.email}`
          .toLocaleLowerCase("pt-BR")
          .includes(value),
    );
  }, [users.data?.users, search]);
  const totalPages = Math.max(1, Math.ceil((users.data?.total ?? 0) / perPage));

  return (
    <>
      <PageHeader
        title="Usuários da plataforma"
        subtitle="Gerencie contas, acesso e a data inicial de cobrança de cada cliente."
        actions={
          <Button
            onClick={() => {
              setActionError(null);
              setForm({
                display_name: "",
                email: "",
                billing_started_at: today(),
              });
            }}
          >
            <Plus /> Novo usuário
          </Button>
        }
      />
      <p className="m-0 text-sm text-muted-foreground">
        A data de início da cobrança é apenas controle administrativo; não
        processa pagamentos.
      </p>
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="grid gap-1">
          <strong className="text-sm">App aprovado pelo TikTok para posts públicos</strong>
          <span className="text-xs text-muted-foreground">
            Ligue somente depois que a auditoria do TikTok for aprovada. Desligado, todos
            os usuários veem o aviso de modo teste (posts diretos ficam privados).
          </span>
        </div>
        <Label className="font-normal">
          <Switch
            checked={Boolean(flags.data?.flags.tiktok_audited)}
            disabled={flags.isLoading || setAudited.isPending}
            onCheckedChange={(next) => setAudited.mutate(next === true)}
          />
          <span>{flags.data?.flags.tiktok_audited ? "Aprovado" : "Em teste"}</span>
        </Label>
      </div>
      {notice && (
        <div className="flex items-center justify-between rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm">
          <span>{notice}</span>
          <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
            Fechar
          </Button>
        </div>
      )}
      <ErrorBox error={actionError ?? users.error} />
      <div className="relative max-w-sm">
        <Search
          aria-hidden="true"
          className="absolute top-2 left-2.5 size-4 text-muted-foreground"
        />
        <Input
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar nesta página por nome ou e-mail"
          aria-label="Buscar usuários"
        />
      </div>
      {users.isLoading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <Empty title="Nenhum usuário encontrado" icon={Users} />
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead>Início da cobrança</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <div className="grid">
                      <strong>
                        {entry.display_name || "Sem nome"}
                        {entry.is_platform_owner ? " · Owner" : ""}
                      </strong>
                      <span className="text-xs text-muted-foreground">
                        {entry.email}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{formatDateTime(entry.created_at)}</TableCell>
                  <TableCell>
                    {formatDate(entry.billing_started_at)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        entry.is_active
                          ? "border-success/30 bg-success/10 text-success"
                          : "border-destructive/30 bg-destructive/10 text-destructive"
                      }
                    >
                      {entry.is_active ? "Ativo" : "Desativado"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setActionError(null);
                          setForm({
                            id: entry.id,
                            display_name: entry.display_name,
                            email: entry.email,
                            billing_started_at: entry.billing_started_at,
                            original_email: entry.email.toLowerCase(),
                          });
                        }}
                      >
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          entry.id === user?.id ||
                          (entry.is_platform_owner && !entry.is_active)
                        }
                        onClick={() =>
                          setActive.mutate({
                            id: entry.id,
                            active: !entry.is_active,
                          })
                        }
                      >
                        {entry.is_active ? "Desativar" : "Ativar"}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={entry.id === user?.id}
                        onClick={async () => {
                          if (
                            await confirm({
                              title: "Excluir usuário definitivamente?",
                              description: `A conta ${entry.email}, seus workspaces próprios e seus dados serão apagados. Workspaces em que esta pessoa é apenas membro permanecem com outro owner.`,
                              confirmLabel: "Excluir usuário",
                              destructive: true,
                            })
                          )
                            remove.mutate(entry.id);
                        }}
                      >
                        Excluir
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
      {!users.isLoading && (users.data?.total ?? 0) > perPage && (
        <div className="flex items-center justify-between text-sm">
          <span>
            Página {page} de {totalPages} · {users.data?.total} usuários
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
      {form && (
        <Modal
          title={form.id ? "Editar usuário" : "Cadastrar usuário"}
          description={
            form.id
              ? "Altere os dados de acesso e cobrança."
              : "O usuário receberá um convite para definir a própria senha."
          }
          onClose={() => setForm(null)}
        >
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate(form);
            }}
          >
            <Field label="Nome">
              <Input
                autoFocus
                required
                maxLength={80}
                value={form.display_name}
                onChange={(e) =>
                  setForm({ ...form, display_name: e.target.value })
                }
              />
            </Field>
            <Field label="E-mail">
              <Input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field
              label="Início da cobrança"
              hint="Data administrativa usada como referência; não há cobrança automática."
            >
              <Input
                type="date"
                required
                value={form.billing_started_at}
                onChange={(e) =>
                  setForm({ ...form, billing_started_at: e.target.value })
                }
              />
            </Field>
            <ErrorBox error={actionError ? errorMessage(actionError) : null} />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setForm(null)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
