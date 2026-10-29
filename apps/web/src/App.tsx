import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./lib/supabase";
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
import AuditPage from "./pages/AuditPage";
import CalendarPage from "./pages/CalendarPage";
import ChannelsPage from "./pages/ChannelsPage";
import DashboardPage from "./pages/DashboardPage";
import HistoryPage from "./pages/HistoryPage";
import MediaPage from "./pages/MediaPage";
import MembersPage from "./pages/MembersPage";
import NotificationsPage from "./pages/NotificationsPage";
import PublicationsPage from "./pages/PublicationsPage";
import SettingsPage from "./pages/SettingsPage";
import UsersAdminPage from "./pages/UsersAdminPage";
import Loading from "./components/loading";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { canAdmin, loading } = useWorkspace();
  if (loading) return <Loading />;
  return canAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

function RequirePlatformOwner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const owner = useQuery({
    queryKey: ["platform-owner", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "admin-users?check=owner",
        { method: "GET" },
      );
      if (error) {
        const status = (error as { context?: Response }).context?.status;
        if (status === 403 || status === 401) return false;
        throw error;
      }
      return Boolean(data?.is_owner);
    },
  });
  if (loading || owner.isLoading) return <Loading />;
  if (owner.isError) return <Navigate to="/" replace />;
  return owner.data ? <>{children}</> : <Navigate to="/" replace />;
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

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
