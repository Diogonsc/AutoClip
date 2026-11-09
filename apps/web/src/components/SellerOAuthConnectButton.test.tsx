import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SELLER_OAUTH_UI_ENABLED,
  SellerOAuthConnectButton,
} from "./SellerOAuthConnectButton";

describe("SellerOAuthConnectButton", () => {
  it("is neither rendered nor actionable while TikTok Shop is fail-closed", () => {
    expect(SELLER_OAUTH_UI_ENABLED).toBe(false);
    expect(renderToStaticMarkup(<SellerOAuthConnectButton workspaceId="00000000-0000-4000-8000-000000000001" />))
      .toBe("");
  });
});
