import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { WorkspaceProvider, useWorkspace } from './auth/WorkspaceProvider';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import { supabaseConfigured } from './lib/supabase';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from './pages/AuthPages';
import AuditPage from './pages/AuditPage';
import CalendarPage from './pages/CalendarPage';
import ChannelsPage from './pages/ChannelsPage';
import DashboardPage from './pages/DashboardPage';
import HistoryPage from './pages/HistoryPage';
import MediaPage from './pages/MediaPage';
import MembersPage from './pages/MembersPage';
import NotificationsPage from './pages/NotificationsPage';
import PublicationsPage from './pages/PublicationsPage';
import SettingsPage from './pages/SettingsPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { canAdmin, loading } = useWorkspace();
  if (loading) return <Spinner />;
  return canAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

function MissingConfig() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Configuração pendente</h1>
        <p>
          Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (arquivo{' '}
          <code>.env.local</code> ou variáveis de ambiente na Vercel) e reinicie.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  if (!supabaseConfigured) return <MissingConfig />;

  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/cadastro" element={<SignupPage />} />
        <Route path="/esqueci-senha" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="canais" element={<ChannelsPage />} />
          <Route path="biblioteca" element={<MediaPage />} />
          <Route path="publicacoes" element={<PublicationsPage />} />
          <Route path="calendario" element={<CalendarPage />} />
          <Route path="historico" element={<HistoryPage />} />
          <Route path="notificacoes" element={<NotificationsPage />} />
          <Route path="membros" element={<MembersPage />} />
          <Route path="configuracoes" element={<SettingsPage />} />
          <Route
            path="auditoria"
            element={
              <RequireAdmin>
                <AuditPage />
              </RequireAdmin>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
