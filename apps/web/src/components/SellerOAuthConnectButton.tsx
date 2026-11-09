import { useState } from "react";
import { Button } from "./ui/button";
import { invokeFunction } from "../lib/api";
import { supabase } from "../lib/supabase";

// Deliberately duplicated as a compile-time client guard. The backend guard in
// tiktok-shop-availability.ts is authoritative and must be enabled separately.
export const SELLER_OAUTH_UI_ENABLED = false;

type SellerOAuthConnectButtonProps = {
  workspaceId: string;
  enabled?: boolean;
};

export function SellerOAuthConnectButton({
  workspaceId,
  enabled = SELLER_OAUTH_UI_ENABLED,
}: SellerOAuthConnectButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return null;

  async function connect() {
    setLoading(true);
    setError(null);
    try {
      const result = await invokeFunction<{ authorization_url?: unknown }>(
        supabase,
        "tiktok-shop-seller-start",
        { workspace_id: workspaceId },
      );
      if (typeof result.authorization_url !== "string") throw new Error("Não foi possível iniciar a conexão Seller.");
      window.location.assign(result.authorization_url);
    } catch {
      setError("Não foi possível iniciar a conexão Seller. Tente novamente.");
      setLoading(false);
    }
  }

  return <div>
    <Button type="button" onClick={() => void connect()} disabled={loading} aria-describedby={error ? "seller-oauth-error" : undefined}>
      {loading ? "Conectando…" : "Conectar TikTok Shop Seller"}
    </Button>
    {error ? <p id="seller-oauth-error" role="alert">{error}</p> : null}
  </div>;
}
