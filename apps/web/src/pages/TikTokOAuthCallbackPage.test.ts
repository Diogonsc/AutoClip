import { describe, expect, it } from "vitest";
import { readTikTokCallbackParams } from "./TikTokOAuthCallbackPage";

describe("readTikTokCallbackParams", () => {
  it("reads code, state, provider error and scopes without changing the redirect URI", () => {
    expect(readTikTokCallbackParams("?code=code-value&state=state-value&scopes=user.info.basic"))
      .toEqual({ code: "code-value", state: "state-value", error: null, scopes: "user.info.basic" });
    expect(readTikTokCallbackParams("?error=access_denied&state=state-value"))
      .toEqual({ code: null, state: "state-value", error: "access_denied", scopes: null });
  });

  it("returns nulls for a callback without parameters", () => {
    expect(readTikTokCallbackParams("")).toEqual({ code: null, state: null, error: null, scopes: null });
  });
});
