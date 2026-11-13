import { useState } from "react";
import { Button } from "./ui/button";
import { invokeFunction } from "../lib/api";
import { supabase } from "../lib/supabase";

// Deliberately duplicated as a compile-time client guard. The backend guard in
// tiktok-shop-availability.ts is authoritative and must be enabled separately.
export const SELLER_OAUTH_UI_ENABLED = false;
const SELLER_AUTHORIZE_ORIGIN = "https://services.tiktokshop.com";

/** Rejects a compromised/proxied Function response before browser navigation. */
export function isAllowedSellerAuthorizationUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.origin === SELLER_AUTHORIZE_ORIGIN && url.pathname === "/open/authorize";
  } catch {
    return false;
  }
}

type SellerOAuthConnectButtonProps = {
  workspaceId: string;
  canManageWorkspace?: boolean;
};

export function SellerOAuthConnectButton({
  workspaceId,
  canManageWorkspace = false,
}: SellerOAuthConnectButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A caller cannot turn on the UI with a prop while the compiled feature is
  // disabled. Backend enforcement remains authoritative in all cases.
  if (!SELLER_OAUTH_UI_ENABLED || !canManageWorkspace) return null;

  async function connect() {
    setLoading(true);
    setError(null);
    try {
      const result = await invokeFunction<{ authorization_url?: unknown }>(
        supabase,
        "tiktok-shop-seller-start",
        { workspace_id: workspaceId },
      );
      if (!isAllowedSellerAuthorizationUrl(result.authorization_url)) {
        throw new Error("Não foi possível iniciar a conexão Seller.");
      }
      window.location.assign(result.authorization_url);
    } catch {
      setError("Não foi possível iniciar a conexão Seller. Tente novamente.");
      setLoading(false);
    }
  }

  return <div>
    <Button type="button" onClick={() => void connect()} disabled={loading} aria-describedby={error ? "seller-oauth-error" : undefined}>
      {loading ? "Conectando…" : "Conectar loja TikTok Shop"}
    </Button>
    {error ? <p id="seller-oauth-error" role="alert">{error}</p> : null}
  </div>;
}
