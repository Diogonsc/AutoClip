# Gate 3.19.3 — OAuth contract resolution

## Scope and evidence

This review used public documentation and local code only. No Cloud or authenticated TikTok request was made. Public pages were checked on 2026-11-02. Documentation can change; the recorded URLs and this date are the reproducibility boundary.

## Login Kit / Content Posting API

The endpoint-specific [Get a User Access Token](https://developers.tiktok.com/docs/en/oauth-get-a-user-access-token) page documents `POST https://open.tiktokapis.com/v2/oauth/token/` with form-urlencoded parameters, 2-hour access tokens, 180-day refresh tokens, and rotation that invalidates the old refresh token after success. The [User Access Token Management](https://developers.tiktok.com/docs/en/oauth-user-access-token-management) page still describes older 24-hour/365-day periods. This is an official-source conflict. The endpoint-specific page is more directly applicable to the token operation, but the project notice's 2026-12-01 effective date was not independently verified. Keep rollout blocked until TikTok confirms which app/product cohort and effective date apply.

The local shared Login Kit client in `supabase/functions/_shared/tiktok.ts` uses the v2 token endpoint and form encoding. Its parser requires access token, refresh token and expiry data; refresh completion persists rotated credentials conditionally through the database lease/CAS functions. This is local code evidence, not proof that the deployed app or all existing credentials follow the same contract.

Authorization endpoint details are documented by [Login Kit Web](https://developers.tiktok.com/docs/en/login-kit-web?enter_method=left_navigation). The local callback/state implementation must be kept aligned with registered redirect URI and state validation. Revocation/error behavior is covered by [OAuth Error Handling](https://developers.tiktok.com/docs/en/oauth-error-handling?enter_method=left_navigation); `invalid_grant` is not sufficient evidence that a blind retry is safe.

## TikTok Shop

The public [creator authorization guide](https://partner.tiktokshop.com/docv2/page/678e3a362dccb8030ea6f98c) describes creator authorization separately from seller/partner authorization and documents GET token exchange and refresh endpoints under `auth.tiktok-shops.com`, with `app_key`, `app_secret`, grant type and code/refresh token query parameters. The [developer types](https://partner.tiktokshop.com/docv2/page/tts-developer-types) source distinguishes creator, seller and partner identities; their tokens are not interchangeable. [Common parameters](https://partner.tiktokshop.com/docv2/page/common-parameters) describes signing for business API requests; it does not establish token endpoint signing requirements.

Exact Shop access/refresh TTLs, mandatory refresh-token rotation, invalidation timing, and the stated December 2026 change were not confirmed in accessible public sources. Do not import Login Kit rules into Shop. Shop staging remains blocked on authoritative contract confirmation for the app's actual authorization type.

The local Shop code sends the documented GET query shape. Because secrets are contractually placed in the URL by the accessible guide, URL capture by proxies/APM remains a residual risk. `supabase/functions/_shared/tiktok-shop-oauth.ts` pins the HTTPS origin and exact token paths, rejects redirects and non-origin URLs; this reduces redirect exfiltration but does not prove runtime logging configuration is safe. No secret-bearing URL should be logged or persisted.

## Local hardening in this gate

The Shop fetch helper and callback/refresh callers were hardened to reject redirects and non-approved destinations. A synthetic test covers redirect and attacker-host rejection. No API call was made. Test result is reported in `GATE_3_19_3_ADVERSARIAL_TESTS.md`.

## Decision

Login Kit: **DIVERGENT official pages / operational rule not fully resolved**. Shop: **PARTIALLY CONFIRMED; TTL/rotation contract NOT CONFIRMED**. Both are blockers to staging authorization until the applicable contracts are confirmed. Mocks validate local handling only, not provider behavior.
