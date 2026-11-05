# Gate 3.19.5 — TikTok Shop functional isolation

**Status:** LOCAL IMPLEMENTATION PREPARED — REMOTE AVAILABILITY NOT VERIFIED
**Prepared:** 2026-11-04
**Scope:** initial launch with TikTok Login Kit and Content Posting API; TikTok Shop remains unavailable.

## Executive decision

The local code now has a fail-closed Shop boundary across the browser, Edge Function handlers, the shared publication worker, database migration, and first-launch function allowlist. Existing Shop job rows are preserved and excluded from normal publication/polling claims. Login Kit code paths are not controlled by the Shop availability constant.

**Local implementation: PARTIAL GO.** Relevant checks passed, but the pgTAP database assertions for the new migration were not executed in a disposable database during this run. **Remote/staging/production Shop isolation: NOT VERIFIED / NO-GO to claim disabled.** No remote service was accessed and migration `20261104000001` was not applied remotely. Excluding functions from a future deployment does not disable an older deployed copy.

## Surface inventory and disposition

| Surface | Local evidence | Classification and disposition |
|---|---|---|
| App route and navigation | `apps/web/src/App.tsx`, `components/Layout.tsx` | Shop route/menu removed from active navigation; direct route falls through to the app's existing redirect. |
| Publication form and data hooks | `components/PublicationForm.tsx`, `lib/hooks.ts` | Shop fields, writes, and active Shop queries removed. Login Kit publication form remains. |
| Shop landing claims and page | `pages/LandingPage.tsx`, `pages/TikTokShopPage.tsx` | Shop claims removed; page is a static unavailable notice with no active client calls. |
| Shop Edge Functions | `supabase/functions/tiktok-shop/index.ts`, `tiktok-shop-oauth-callback/index.ts`, `tiktok-shop-publish/index.ts` | Each handler returns generic 404 `feature_unavailable` before parsing request data, database access, token refresh, or outbound API calls. |
| Shared publication worker | `_shared/worker.ts`, `publication-worker/index.ts` | Shop is false by default. Shop jobs are blocked before side effects when encountered; Login Kit work remains on the normal path. Migration also excludes Shop jobs from claims so they remain queued/preserved. |
| Shop OAuth/token helpers | `_shared/tiktok-shop-oauth.ts`, `_shared/tiktok-shop-tokens.ts` | Retained as isolated future code; not reachable through guarded Shop endpoints. No Login Kit OAuth rotation contract changed. |
| Database/RPC/storage surface | `20261104000001_disable_tiktok_shop_for_initial_launch.sql` | Local migration preserves existing rows, blocks new/changed Shop metadata, excludes Shop jobs from claim RPCs, and revokes client/service-role access to Shop tables/RPCs. Not applied remotely. It contains no destructive data deletion. |
| Shop schema in earlier migrations | `supabase/migrations/20261103000001`–`20261103000011` | Retained because shared publication/OAuth structures and Login Kit migrations have dependencies; removing them by name would risk breaking shared functionality. Shop availability is closed separately by the new migration and code guards. |
| Deployment automation | `deploy/edge-functions-first-launch.txt`, `deploy/EDGE_FUNCTIONS_FIRST_LAUNCH.md` | Explicit nine-function allowlist excludes all three Shop functions. No `.github/workflows` deployment workflow was found. There is no repository deploy-all script to update. |

### First-launch Edge Function allowlist

`admin-users`, `client-approval`, `media-cleanup`, `media-serve`, `media-validate`, `publication-worker`, `tiktok-channel`, `tiktok-oauth-callback`, `video-worker-api`.

Excluded: `tiktok-shop`, `tiktok-shop-oauth-callback`, `tiktok-shop-publish`. Deployment must name functions individually; do not use wildcard, `--all`, or deploy-all commands.

## Security properties and boundaries

- Central policy is hard-coded disabled (`TIKTOK_SHOP_ENABLED = false`); absence of client/request/database configuration cannot enable it.
- Direct Shop Edge Function requests are rejected before parsing credentials or performing I/O.
- Worker-level default is disabled. A Shop job that reaches the worker is preserved, marked blocked, and its publish-attempt accounting is refunded; Shop polling does not call status/token providers. At database level, the migration excludes Shop jobs from claims, preserving their rows without consumption.
- The database migration protects direct database/API paths after it is applied. This is a local migration file, not proof of a remote control.
- Shared Login Kit access-token refresh logic does not read the Shop flag and retained its rotation tests.
- No real TikTok API call, account authorization, publication, or remote service operation was performed.
- A previously deployed Shop Edge Function may remain callable until the guarded code is deployed and the remote database controls are applied. Remote inventory and post-deployment verification remain required.

## Validation performed

| Check | Result | Evidence / limitation |
|---|---|---|
| Deno type check | PASS | Deno 2.9.8 / TypeScript 6.0.3; eight relevant entrypoints checked: media-validate, video-worker-api, publication-worker, tiktok-channel, tiktok-oauth-callback, tiktok-shop, tiktok-shop-oauth-callback, tiktok-shop-publish. |
| Deno worker/availability tests | PASS | 32 passed, 0 failed. |
| Bun worker, availability and token tests | PASS | 48 passed, 0 failed; includes Login Kit rotation and Shop helper tests with synthetic inputs. |
| Frontend Vitest | PASS | 45 passed, 0 failed across five files. |
| Frontend build | PASS | `npm run build` completed TypeScript and Vite build. |
| Disposable Playwright E2E | PASS | JUnit: 22 passed, 0 failed; 11 desktop + 11 mobile. Includes direct `/shop` access, three direct Shop Edge endpoint requests returning 404, Login UI, workspace, media, batch/carousel flows. Uses disposable local stack and synthetic fixtures; not Production evidence. |
| Static isolation tests | PASS | `node --test scripts/test_tiktok_shop_isolation.mjs`: 5 passed, 0 failed. Checks allowlist, guard ordering, frontend reachability, SQL guard patterns, and absence of deploy-all workflow. |
| SQL assertion plan consistency | PASS (static only) | Existing OAuth SQL test plan 18/18 assertions; new Shop SQL test plan 15/15 assertions. This counts source assertions only; pgTAP itself was not run. |
| `git diff --check` | PASS | No whitespace errors reported for tracked diff. |
| New migration pgTAP execution | NOT RUN | No isolated PostgreSQL/pgTAP run was performed; do not treat the migration's database behavior as runtime-tested. |
| Staging/Production deployment and remote inventory | NOT RUN | Explicitly outside scope. |

The E2E runner wrote its normal local artifacts under the existing ignored `apps/web/dist` and `apps/web/test-results` paths. They were not cleaned. The pre-existing worktree changes were preserved; no commit/push was made.

## Files added or updated for this gate

New:

- `supabase/functions/_shared/tiktok-shop-availability.ts`
- `supabase/functions/_tests/tiktok_shop_availability.test.ts`
- `supabase/migrations/20261104000001_disable_tiktok_shop_for_initial_launch.sql`
- `supabase/tests/database/17_tiktok_shop_initial_launch_disabled.test.sql`
- `scripts/test_tiktok_shop_isolation.mjs`
- `deploy/edge-functions-first-launch.txt`
- `deploy/EDGE_FUNCTIONS_FIRST_LAUNCH.md`
- `docs/GATE_3_19_5_TIKTOK_SHOP_ISOLATION.md`

Updated for this isolation work (these files also contain broader pre-existing worktree changes; no claim that their entire diff belongs to this gate):

- `apps/web/src/App.tsx`
- `apps/web/src/components/Layout.tsx`
- `apps/web/src/components/PublicationForm.tsx`
- `apps/web/src/lib/hooks.ts`
- `apps/web/src/pages/LandingPage.tsx`
- `apps/web/src/pages/TikTokShopPage.tsx`
- `apps/web/e2e/tests/smoke.spec.ts`
- `supabase/functions/_shared/types.ts`
- `supabase/functions/_shared/worker.ts`
- `supabase/functions/publication-worker/index.ts`
- `supabase/functions/tiktok-shop/index.ts`
- `supabase/functions/tiktok-shop-oauth-callback/index.ts`
- `supabase/functions/tiktok-shop-publish/index.ts`
- `supabase/functions/_tests/worker.test.ts`
- `supabase/functions/_tests/helpers.ts`
- `supabase/tests/database/16_tiktok_refresh_rotation.test.sql`

## Remaining blockers and next validation

1. Run migration `20261104000001` and pgTAP test `17_tiktok_shop_initial_launch_disabled.test.sql` only in a fresh disposable local Supabase/PostgreSQL project; verify normal Login Kit claims still work and Shop jobs stay unclaimed/preserved.
2. Before any staging/production release, separately authorize and verify the migration plus guarded Edge Functions. Confirm the existing deployed Shop functions cannot be reached; the allowlist by itself is insufficient.
3. Keep TikTok Shop out of the initial release scope until its future homologation, controls review, and explicit owner authorization.

No remote action, commit, push, or publication was performed by this gate.
