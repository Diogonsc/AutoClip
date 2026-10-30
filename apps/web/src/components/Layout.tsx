import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  Bell,
  CalendarDays,
  Clapperboard,
  History,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  ShieldCheck,
  Plus,
  Radio,
  ScrollText,
  FileText,
  Send,
  Settings,
  ShoppingBag,
  Users,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { usePlatformFlags, usePlatformOwner } from "../lib/hooks";
import { useWorkspace } from "../auth/WorkspaceProvider";
import { errorMessage } from "../lib/api";
import { roleLabel } from "../lib/format";
import { cn } from "@/lib/utils";
import { ModeToggle } from "./mode-toggle";
import { SelectField } from "./select-field";
import { ErrorBox, Field, Modal, Notice } from "./ui";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Separator } from "./ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";
import Loading from "./loading";

type NavItem = { to: string; label: string; end?: boolean; icon: typeof Radio };
type NavGroup = { label: string; items: NavItem[] };

// Todo usuário: o fluxo de criador (canais → vídeos → publicar → acompanhar).
const USER_GROUPS: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { to: "/app", label: "Visão geral", end: true, icon: LayoutDashboard },
      { to: "/canais", label: "Canais", icon: Radio },
      { to: "/biblioteca", label: "Biblioteca de vídeos", icon: Library },
    ],
  },
  {
    label: "Publicação",
    items: [
      { to: "/publicacoes", label: "Publicações", icon: Send },
      { to: "/calendario", label: "Agendamentos", icon: CalendarDays },
      { to: "/historico", label: "Histórico e logs", icon: History },
      { to: "/relatorios", label: "Relatório semanal", icon: FileText },
      { to: "/shop", label: "TikTok Shop e afiliados", icon: ShoppingBag },
      { to: "/notificacoes", label: "Notificações", icon: Bell },
    ],
  },
];

// Só quem administra o workspace (OWNER/ADMIN do workspace): equipe, regras de publicação e auditoria.
const WORKSPACE_ADMIN_GROUP: NavGroup = {
  label: "Gestão do workspace",
  items: [
    { to: "/membros", label: "Membros", icon: Users },
    { to: "/configuracoes", label: "Configurações", icon: Settings },
    { to: "/auditoria", label: "Auditoria", icon: ScrollText },
  ],
};

// Só o dono do SaaS (platform_owners).
const PLATFORM_GROUP: NavGroup = {
  label: "Administração",
  items: [
    {
      to: "/owner/usuarios",
      label: "Usuários da plataforma",
      icon: ShieldCheck,
    },
  ],
};

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm no-underline transition-colors outline-none hover:bg-sidebar-accent hover:no-underline focus-visible:ring-3 focus-visible:ring-sidebar-ring/50 [&_svg]:size-4 [&_svg]:shrink-0",
    isActive
      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground [&_svg]:text-primary"
      : "text-sidebar-foreground",
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth();
  const { workspaces, current, setCurrentId, role, canAdmin } = useWorkspace();
  const isPlatformOwner = usePlatformOwner(user?.id);
  const groups = [
    ...USER_GROUPS,
    ...(canAdmin ? [WORKSPACE_ADMIN_GROUP] : []),
    ...(isPlatformOwner.data ? [PLATFORM_GROUP] : []),
  ];
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="flex items-center gap-3 px-4 pt-5 pb-4">
        <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Clapperboard className="size-5" aria-hidden="true" />
        </span>
        <span className="grid leading-tight">
          <strong className="font-heading text-base">AutoClip</strong>
          <small className="text-xs text-muted-foreground">workspace</small>
        </span>
      </div>

      <div className="grid gap-1.5 px-4 pb-4">
        <span className="text-xs font-medium text-muted-foreground">
          Workspace ativo
        </span>
        <SelectField
          aria-label="Workspace"
          value={current?.id ?? ""}
          onValueChange={setCurrentId}
          options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
          placeholder="Selecione um workspace"
        />
        {role && (
          <small className="text-xs text-muted-foreground">
            Seu papel: {roleLabel[role]}
          </small>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-start text-muted-foreground"
          onClick={() => setCreating(true)}
        >
          <Plus aria-hidden="true" /> Novo workspace
        </Button>
      </div>

      <Separator className="bg-sidebar-border" />

      <nav
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4"
        onClick={onNavigate}
      >
        {groups.map((group) => (
          <div className="grid gap-0.5" key={group.label}>
            <span className="px-3 pb-1 text-xs font-medium text-muted-foreground">
              {group.label}
            </span>
            {group.items.map(({ to, label, end, icon: Icon }) => (
              <NavLink key={to} to={to} end={end} className={navLinkClass}>
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <Separator className="bg-sidebar-border" />

      <div className="flex items-center gap-3 p-4">
        <Avatar aria-hidden="true">
          <AvatarFallback>
            {(user?.email?.[0] ?? "U").toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="grid min-w-0 flex-1 leading-tight">
          <strong
            className="truncate text-sm font-medium"
            title={user?.email ?? ""}
          >
            {user?.email}
          </strong>
          <small className="text-xs text-muted-foreground">
            {isPlatformOwner.data
              ? "Owner da plataforma"
              : role
                ? roleLabel[role]
                : "Membro"}
          </small>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Sair"
          title="Sair"
          onClick={() => void signOut()}
        >
          <LogOut aria-hidden="true" />
        </Button>
      </div>

      {creating && <NewWorkspaceModal onClose={() => setCreating(false)} />}
    </>
  );
}

function NewWorkspaceModal({ onClose }: { onClose: () => void }) {
  const { createWorkspace } = useWorkspace();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createWorkspace(name.trim());
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal title="Novo workspace" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Nome">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            autoFocus
          />
        </Field>
        <ErrorBox error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!name.trim()}>
            Criar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TestModeBanner() {
  const flags = usePlatformFlags();
  if (!flags.data || flags.data.tiktok_audited) return null;
  return (
    <Notice tone="warning">
      <strong>Modo de teste do TikTok.</strong> Enquanto o AutoClip aguarda a
      aprovação do TikTok, as publicações diretas ficam visíveis apenas para
      você (privadas). Quando a aprovação sair, este aviso desaparece.
    </Notice>
  );
}

export default function Layout() {
  const { current, loading } = useWorkspace();
  const platformFlags = usePlatformFlags();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[16rem_minmax(0,1fr)]">
      <aside
        id="app-sidebar"
        className="sticky top-0 hidden h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex"
      >
        <SidebarBody />
      </aside>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left">
          <SheetTitle>Menu</SheetTitle>
          <SheetDescription>Navegação principal do AutoClip</SheetDescription>
          <SidebarBody onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-8">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
            aria-controls="app-sidebar"
          >
            <Menu />
          </Button>
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <span>AutoClip</span>
            <span aria-hidden="true">/</span>
            <strong className="truncate font-medium text-foreground">
              {current?.name}
            </strong>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ModeToggle />
          </div>
        </header>

        <main className="mx-auto flex w-full h-full flex-1 flex-col gap-5 p-4 md:p-8">
          {platformFlags.data?.test_mode !== false && (
            <div
              role="status"
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
            >
              <strong>Modo de teste do TikTok.</strong> O aplicativo ainda não
              está marcado como auditado. Publicações diretas ficam restritas a
              “Somente eu”; use o modo rascunho/INBOX para concluir a publicação
              no TikTok. A cobrança está desativada neste projeto.
            </div>
          )}
          {platformFlags.isError && (
            <div
              role="status"
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
            >
              Não foi possível verificar o estado da auditoria do TikTok. Por
              segurança, considere o aplicativo em modo de teste e não publique
              publicamente.
            </div>
          )}
          {loading ? (
            <Loading />
          ) : current ? (
            <Outlet key={current.id} />
          ) : (
            <Loading label="Nenhum workspace encontrado." />
          )}
        </main>
      </div>
    </div>
  );
}
