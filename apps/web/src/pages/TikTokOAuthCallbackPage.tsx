import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { invokeFunction } from "../lib/api";
import { supabase, supabaseConfigured } from "../lib/supabase";

const CALLBACK_RESULTS = new Set([
  "connected",
  "denied",
  "invalid_state",
  "missing_scope",
  "account_mismatch",
  "duplicate",
  "error",
]);

export function readTikTokCallbackParams(search: string) {
  const params = new URLSearchParams(search);
  return {
    code: params.get("code"),
    state: params.get("state"),
    error: params.get("error"),
    scopes: params.get("scopes"),
  };
}

function safeResult(value: unknown): string {
  return typeof value === "string" && CALLBACK_RESULTS.has(value)
    ? value
    : "error";
}

export default function TikTokOAuthCallbackPage() {
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const callback = readTikTokCallbackParams(window.location.search);
    // Remove code/state from the address bar and history before sending the POST.
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.hash}`,
    );

    if (!callback.code && !callback.state && !callback.error) {
      navigate("/canais?tiktok=invalid_state", { replace: true });
      return;
    }

    if (!supabaseConfigured) {
      navigate("/canais?tiktok=error", { replace: true });
      return;
    }

    void invokeFunction<{ result?: unknown }>(
      supabase,
      "tiktok-oauth-callback",
      callback,
    )
      .then(({ result }) => {
        navigate(`/canais?tiktok=${encodeURIComponent(safeResult(result))}`, {
          replace: true,
        });
      })
      .catch(() => {
        // The error body may contain provider details; only show a fixed result.
        navigate("/canais?tiktok=error", { replace: true });
      });
  }, [navigate]);

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Conectando ao TikTok</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="status" aria-live="polite" className="m-0 text-sm text-muted-foreground">
            Validando a autorização. Você voltará à página de Canais em instantes.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
