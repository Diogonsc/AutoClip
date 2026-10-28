import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { errorMessage } from "../lib/api";
import { ErrorBox, Field } from "../components/ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

function AuthShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-wrap">
      <Card className="auth-card w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </div>
  );
}

export function LoginPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Entrar">
      <form onSubmit={submit} className="form">
        <Field label="E-mail">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            autoFocus
          />
        </Field>
        <Field label="Senha">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <ErrorBox error={error} />
        <Button disabled={busy}>{busy ? "Entrando…" : "Entrar"}</Button>
      </form>
      <p className="muted center">
        <Link to="/esqueci-senha">Esqueci minha senha</Link> ·{" "}
        <Link to="/cadastro">Criar conta</Link>
      </p>
    </AuthShell>
  );
}

export function SignupPage() {
  const { user, signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { needsConfirmation: boolean }>(null);
  const [busy, setBusy] = useState(false);

  if (user && !done) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use uma senha com pelo menos 8 caracteres.");
      return;
    }
    setBusy(true);
    try {
      setDone(await signUp(email.trim(), password, name.trim()));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done?.needsConfirmation) {
    return (
      <AuthShell title="Confira seu e-mail">
        <p>
          Enviamos um link de confirmação para <strong>{email}</strong>. Depois
          de confirmar, é só <Link to="/login">entrar</Link>.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Criar conta">
      <form onSubmit={submit} className="form">
        <Field label="Nome">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
            maxLength={80}
            autoFocus
          />
        </Field>
        <Field label="E-mail">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </Field>
        <Field label="Senha" hint="Mínimo de 8 caracteres.">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
        </Field>
        <ErrorBox error={error} />
        <Button disabled={busy}>{busy ? "Criando…" : "Criar conta"}</Button>
      </form>
      <p className="muted center">
        Já tem conta? <Link to="/login">Entrar</Link>
      </p>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Recuperar senha">
      {sent ? (
        <p>
          Se existir uma conta para <strong>{email}</strong>, você receberá um
          link para redefinir a senha.
        </p>
      ) : (
        <form onSubmit={submit} className="form">
          <Field label="E-mail">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <ErrorBox error={error} />
          <Button disabled={busy}>{busy ? "Enviando…" : "Enviar link"}</Button>
        </form>
      )}
      <p className="muted center">
        <Link to="/login">Voltar</Link>
      </p>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { session, loading, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (!session) {
    return (
      <AuthShell title="Link inválido ou expirado">
        <p>
          Peça um novo link em <Link to="/esqueci-senha">Recuperar senha</Link>.
        </p>
      </AuthShell>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use uma senha com pelo menos 8 caracteres.");
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Nova senha">
      <form onSubmit={submit} className="form">
        <Field label="Nova senha">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
            autoFocus
          />
        </Field>
        <ErrorBox error={error} />
        <Button disabled={busy}>{busy ? "Salvando…" : "Salvar senha"}</Button>
      </form>
    </AuthShell>
  );
}
