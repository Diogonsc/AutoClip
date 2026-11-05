import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { usePlatformOwner } from "./lib/hooks";
import { WorkspaceProvider, useWorkspace } from "./auth/WorkspaceProvider";
import Layout from "./components/Layout";
import { supabaseConfigured } from "./lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import {
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
} from "./pages/AuthPages";
import Loading from "./components/loading";
import LandingPage from "./pages/LandingPage";
import TikTokOAuthCallbackPage from "./pages/TikTokOAuthCallbackPage";

const AuditPage = lazy(() => import("./pages/AuditPage"));
const ClientApprovalPage = lazy(() => import("./pages/ClientApprovalPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const ChannelsPage = lazy(() => import("./pages/ChannelsPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const MediaPage = lazy(() => import("./pages/MediaPage"));
const MembersPage = lazy(() => import("./pages/MembersPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const PublicationsPage = lazy(() => import("./pages/PublicationsPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const UsersAdminPage = lazy(() => import("./pages/UsersAdminPage"));
const BillingPage = lazy(() => import("./pages/BillingPage"));
const BatchesPage = lazy(() => import("./pages/BatchesPage"));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { canAdmin, loading } = useWorkspace();
  if (loading) return <Loading />;
  return canAdmin ? <>{children}</> : <Navigate to="/app" replace />;
}

function RequirePlatformOwner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const owner = usePlatformOwner(user?.id);
  if (loading || owner.isLoading) return <Loading />;
  return owner.data ? <>{children}</> : <Navigate to="/app" replace />;
}

function MissingConfig() {
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Configuração pendente</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="m-0 text-sm text-muted-foreground">
            Defina <code>VITE_SUPABASE_URL</code> e{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> (arquivo <code>.env.local</code>{" "}
            ou variáveis de ambiente na Vercel) e reinicie.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/cadastro" element={<SignupPage />} />
        <Route path="/esqueci-senha" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/tiktok/callback" element={<TikTokOAuthCallbackPage />} />
        <Route path="/aprovar/:token" element={<ClientApprovalPage />} />

        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="app" element={<DashboardPage />} />
          <Route path="canais" element={<ChannelsPage />} />
          <Route path="biblioteca" element={<MediaPage />} />
          <Route path="publicacoes" element={<PublicationsPage />} />
          <Route path="lotes" element={<BatchesPage />} />
          <Route path="calendario" element={<CalendarPage />} />
          <Route path="historico" element={<HistoryPage />} />
          <Route path="relatorios" element={<ReportsPage />} />
          <Route path="notificacoes" element={<NotificationsPage />} />
          <Route path="plano" element={<BillingPage />} />
          <Route
            path="membros"
            element={
              <RequireAdmin>
                <MembersPage />
              </RequireAdmin>
            }
          />
          <Route
            path="configuracoes"
            element={
              <RequireAdmin>
                <SettingsPage />
              </RequireAdmin>
            }
          />
          <Route
            path="owner/usuarios"
            element={
              <RequirePlatformOwner>
                <UsersAdminPage />
              </RequirePlatformOwner>
            }
          />
          <Route
            path="auditoria"
            element={
              <RequireAdmin>
                <AuditPage />
              </RequireAdmin>
            }
          />
        </Route>

        {!supabaseConfigured && <Route path="app/*" element={<MissingConfig />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </AuthProvider>
  );
}
