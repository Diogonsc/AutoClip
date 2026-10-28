import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useWorkspace } from "../auth/WorkspaceProvider";
import { errorMessage } from "../lib/api";
import { roleLabel } from "../lib/format";
import { ErrorBox, Field, Modal, Spinner } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Bell,
  CalendarDays,
  Clapperboard,
  History,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  Plus,
  Radio,
  ScrollText,
  Settings,
  Send,
  Users,
} from "lucide-react";

const NAV_GROUPS = [
  {
    label: "Workspace",
    items: [
      { to: "/", label: "Visão geral", end: true, icon: LayoutDashboard },
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
      { to: "/notificacoes", label: "Notificações", icon: Bell },
    ],
  },
  {
    label: "Administração",
    items: [
      { to: "/membros", label: "Membros", icon: Users },
      { to: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const {
    workspaces,
    current,
    loading,
    setCurrentId,
    createWorkspace,
    role,
    canAdmin,
  } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createWorkspace(name.trim());
      setName("");
      setCreating(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="shell">
      <aside id="app-sidebar" className={menuOpen ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <span className="brand-mark">
            <Clapperboard aria-hidden="true" />
          </span>
          <span className="brand-copy">
            <strong>AutoClip</strong>
            <small>workspace</small>
          </span>
        </div>

        <div className="ws-switch">
          <span className="sidebar-section-label">Workspace ativo</span>
          <Select
            value={current?.id ?? ""}
            onValueChange={(value) => value && setCurrentId(value)}
          >
            <SelectTrigger aria-label="Workspace" className="w-full">
              <SelectValue placeholder="Selecione um workspace" />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {role && (
            <small className="muted">Seu papel: {roleLabel[role]}</small>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="new-workspace-button"
            onClick={() => setCreating(true)}
          >
            <Plus aria-hidden="true" /> Novo workspace
          </Button>
        </div>

        <nav onClick={() => setMenuOpen(false)}>
          {NAV_GROUPS.map((group, groupIndex) => (
            <div className="nav-group" key={`${group.label}-${groupIndex}`}>
              <span className="sidebar-section-label">{group.label}</span>
              {group.items.map(({ to, label, end, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) => (isActive ? "active" : "")}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
          {canAdmin && (
            <NavLink
              to="/auditoria"
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <ScrollText aria-hidden="true" />
              <span>Auditoria</span>
            </NavLink>
          )}
        </nav>

        <div className="user-box">
          <span className="user-avatar" aria-hidden="true">
            {(user?.email?.[0] ?? "U").toUpperCase()}
          </span>
          <span className="user-details">
            <strong title={user?.email ?? ""}>{user?.email}</strong>
            <small>{role ? roleLabel[role] : "Membro"}</small>
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
      </aside>

      {menuOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Fechar menu"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <div className="main">
        <div className="topbar">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="menu-toggle"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={menuOpen}
            aria-controls="app-sidebar"
          >
            <Menu />
          </Button>
          <div className="topbar-context">
            <span>AutoClip</span>
            <span className="topbar-divider">/</span>
            <strong>{current?.name}</strong>
          </div>
        </div>
        <main className="content">
          {loading ? (
            <Spinner />
          ) : current ? (
            <Outlet key={current.id} />
          ) : (
            <Spinner label="Nenhum workspace encontrado." />
          )}
        </main>
      </div>

      {creating && (
        <Modal title="Novo workspace" onClose={() => setCreating(false)}>
          <form onSubmit={submit} className="form">
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
            <div className="actions end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreating(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={!name.trim()}>
                Criar
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
