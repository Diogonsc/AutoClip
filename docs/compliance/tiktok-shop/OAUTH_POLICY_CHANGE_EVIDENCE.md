# TikTok OAuth Policy Change — Evidence Record

**Review date:** 2026-11-02
**Evidence source:** communication received by the project owner from TikTok for Developers; the original email, message ID, receipt date, and applicable developer product/app cohort were not available for independent verification in this repository review.

## Project-provided change notice

The project owner reports that the notice states an effective date of **December 1, 2026** and the following Login Kit token rules:

- Access token validity: 2 hours.
- Refresh token validity: 180 days.
- Each successful refresh returns a new refresh token.
- The previous refresh token is invalidated immediately.
- The application must persist the latest token and allow users to reauthorize after expiration/invalidation.

This is recorded as **project-provided evidence**, not independent confirmation. It does not establish that the same rules apply to TikTok Shop creator, seller, or partner authorization flows.

## Public documentation cross-check

On 2026-11-02, the public [Get a User Access Token](https://developers.tiktok.com/docs/en/oauth-get-a-user-access-token) page described a v2 form-encoded token endpoint and the 2-hour / 180-day / rotate-and-invalidate behavior. The public [User Access Token Management](https://developers.tiktok.com/docs/en/oauth-user-access-token-management) page was observed to contain older 24-hour / 365-day values. This is a conflict between official public pages; neither the December 1 effective date nor the affected app cohort was independently confirmed. See [Gate 3.19.3 contract review](../../GATE_3_19_3_CONTRACT_RESOLUTION.md).

For Shop, the accessible [Creator authorization guide](https://partner.tiktokshop.com/docv2/page/678e3a362dccb8030ea6f98c) documents GET token exchange/refresh endpoints with credentials in query parameters. It does not establish the exact Shop TTLs, mandatory refresh-token rotation/invalidation, or applicability of the Login Kit change. Shop tokens and authorization identities must not be treated as interchangeable with Login Kit tokens; see [TikTok Shop developer types](https://partner.tiktokshop.com/docv2/page/tts-developer-types).

## Local implementation mapping

| Requirement | Local evidence | Status / limitation |
|---|---|---|
| Login Kit token exchange and refresh endpoint | `supabase/functions/_shared/tiktok.ts` uses the documented v2 token endpoint with form-encoded parameters | Implemented in local source; deployed code not verified |
| Require complete token response | Parser/tests reject missing refresh token or expiry | Local tests only; provider behavior not exercised |
| Encrypt token persistence | `supabase/functions/_shared/crypto.ts`, connection-specific AAD; `supabase/functions/_shared/tokens.ts` | Implemented locally; runtime key provisioning/rotation and Cloud persistence not verified |
| Concurrent refresh protection | M10 lease/attempt/version CAS and M11 unknown-expiry guard | Local-only, not confirmed deployed |
| M10 integrity | `supabase/migrations/20261103000010_tiktok_refresh_rotation_leases.sql`; SHA-256 `9b14ae363efd4e47d1579fdf0a3c8ebc5a157df03f935c6c1a79c85d15a38845` | Hash verified in Gate 3.19.3; migration deployment not verified |
| M11 integrity | `supabase/migrations/20261103000011_oauth_refresh_legacy_state_guard.sql`; SHA-256 `61aaeedcd4082bedfc91b86797ae801128524543882fbc7c23c11f535633659f` | Hash verified in Gate 3.19.3; migration deployment not verified |
| Stale worker fencing | Tests prove new CAS attempts reject stale completion; Gate 3.19.3 reproduced old direct-writer bypass | Deployment blocker: old writers must be drained; no Cloud instance inventory verified |
| Ambiguous refresh outcome | Local code avoids blindly reusing old refresh token and requires reauthorization when outcome cannot be reconciled | Local/mock evidence only; no provider fault behavior validated |
| User reauthorization | Local status and callback flows can mark/handle reauthorization | Deployed UI/Edge behavior and support workflow not verified |
| TikTok Shop token rotation contract | Shop token handler requires new refresh data and persists through CAS RPC | Local assumption/testing only; official Shop TTL/rotation contract remains unconfirmed |
| Credential-bearing Shop URLs | Local helper pins approved HTTPS origin/path and rejects redirects | Synthetic test only; runtime proxy/APM/query-string logging not checked |

## Rollout implications

1. Do not apply M10/M11 or enable new workers based solely on this notice. Confirm the applicable product contract and reconcile Cloud schema first.
2. Gate 3.19.3 local tests showed M10 alone returns `ACQUIRED` for an unknown legacy refresh-token expiry; M11 changes this to `REAUTH_REQUIRED`. Keep token writers paused across both migrations.
3. The prior worker direct-update path can bypass CAS. Drain all old worker/Edge Function instances before rollout and do not allow old and new token-writing code to overlap.
4. After a possible successful provider refresh with a lost response, the old token may already be invalid. Do not assume automatic recovery; require reauthorization or a provider-supported recovery path.
5. Do not restore older database token snapshots over a newer generation without a reviewed recovery plan.

## Evidence limitations

No original email was attached or hashed in the repository. No real TikTok or TikTok Shop OAuth request was made. M10/M11 are local migrations; current Cloud deployment is not verified. Unit and database mocks do not prove provider semantics. The latest Gate 3.19.3 backup restore rehearsal failed, so this record does not claim tested disaster recovery. Shop remains a separate unresolved contract.
