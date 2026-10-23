import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useWorkspace } from "../auth/WorkspaceProvider";
import { errorMessage } from "../lib/api";
import { roleLabel } from "../lib/format";
import { Modal, Spinner } from "./ui";

const NAV = [
  { to: "/", label: "Painel", end: true },
  { to: "/canais", label: "Canais" },
  { to: "/biblioteca", label: "Biblioteca" },
  { to: "/publicacoes", label: "Publicações" },
  { to: "/calendario", label: "Calendário" },
  { to: "/historico", label: "Histórico" },
  { to: "/notificacoes", label: "Notificações" },
  { to: "/membros", label: "Membros" },
  { to: "/configuracoes", label: "Configurações" },
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
        <div className="brand">Painel de Publicações</div>

        <div className="ws-switch">
          <label htmlFor="ws">Workspace</label>
          <select
            id="ws"
            value={current?.id ?? ""}
            onChange={(e) => setCurrentId(e.target.value)}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {role && (
            <small className="muted">Seu papel: {roleLabel[role]}</small>
          )}
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setCreating(true)}
          >
            + Novo workspace
          </button>
        </div>

        <nav onClick={() => setMenuOpen(false)}>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              {n.label}
            </NavLink>
          ))}
          {canAdmin && (
            <NavLink
              to="/auditoria"
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              Auditoria
            </NavLink>
          )}
        </nav>

        <div className="user-box">
          <small className="muted" title={user?.email ?? ""}>
            {user?.email}
          </small>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => void signOut()}
          >
            Sair
          </button>
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
          <button
            type="button"
            className="btn ghost menu-toggle"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={menuOpen}
            aria-controls="app-sidebar"
          >
            ☰
          </button>
          <strong>{current?.name}</strong>
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
            <label className="field">
              <span>Nome</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
                autoFocus
              />
            </label>
            {error && <div className="alert danger">{error}</div>}
            <div className="actions end">
              <button
                type="button"
                className="btn"
                onClick={() => setCreating(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={!name.trim()}
              >
                Criar
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
