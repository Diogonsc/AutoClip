import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SELLER_OAUTH_UI_ENABLED,
  SellerOAuthConnectButton,
  isAllowedSellerAuthorizationUrl,
} from "./SellerOAuthConnectButton";

describe("SellerOAuthConnectButton", () => {
  it("is neither rendered nor actionable while TikTok Shop is fail-closed", () => {
    expect(SELLER_OAUTH_UI_ENABLED).toBe(false);
    expect(renderToStaticMarkup(<SellerOAuthConnectButton workspaceId="00000000-0000-4000-8000-000000000001" />))
      .toBe("");
  });

  it("only permits the configured TikTok Shop Seller authorization URL", () => {
    expect(isAllowedSellerAuthorizationUrl("https://services.tiktokshop.com/open/authorize?service_id=trusted&state=s"))
      .toBe(true);
    expect(isAllowedSellerAuthorizationUrl("https://services.tiktokshop.com.evil.test/open/authorize"))
      .toBe(false);
    expect(isAllowedSellerAuthorizationUrl("https://services.tiktokshop.com/other"))
      .toBe(false);
    expect(isAllowedSellerAuthorizationUrl("javascript:alert(1)"))
      .toBe(false);
  });
});
