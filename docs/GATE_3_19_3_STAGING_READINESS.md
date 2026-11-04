# Gate 3.19.3 — Staging readiness

| Criterion | Status | Evidence / next action |
|---|---|---|
| Login Kit contract | BLOCKED | Official pages conflict on TTL; applicable effective date/cohort unconfirmed |
| TikTok Shop contract | BLOCKED | Public guide confirms GET token endpoints/query shape; TTL and rotation details unconfirmed |
| M10 integrity | PASS local | SHA-256 recorded in M10/M11 compatibility report |
| M11 integrity | PASS local | SHA-256 recorded in M10/M11 compatibility report |
| M10/M11 rollout | BLOCKED | M10-only accepts unknown expiry; both must apply while workers paused |
| Old writer compatibility | BLOCKED | Direct UPDATE bypass race reproduced; drain every old instance |
| Current code lease/CAS | PASS local with limits | Disposable PostgreSQL tests, 10 clients; no Cloud verification |
| RPC Cloud alignment | BLOCKED | Gate 3.18 snapshot showed `change_workspace_plan` and legacy `resolve_unknown_job` callable by `authenticated`; local hardened migrations do not prove deployed body/signature |
| RLS Cloud alignment | PENDING | Prior snapshot reported RLS enabled on 30/30 tables, but 9 had no explicit policies; metadata is not runtime tenant-isolation proof and was not refreshed |
| Storage policies/deletion | PENDING | Prior metadata showed private `media` bucket and video MIME list; local image/storage hardening is not proven deployed; no runtime tenant-isolation proof; cleanup remains disabled |
| pg_net effective reachability | PENDING / REVIEW REQUIRED | Prior snapshot found 12 `net` routines with PUBLIC EXECUTE; effective invocation also depends on schema USAGE and context, neither is revalidated here |
| Deno check | PASS local (2026-11-04) | Gate 3.19.4 ran Deno 2.9.8 / TypeScript 6.0.3 against five Edge Function entrypoints; zero diagnostics. This proves local type-checking only. |
| Playwright isolated | PASS local | `npm run test:e2e --prefix apps/web`; 20/20 tests on the disposable runner (10 desktop + 10 mobile); not Cloud homologation |
| Backup creation | PASS local | Custom-format `pg_dump` in disposable stack |
| Backup restore | BLOCKED | Owner reports PostgreSQL and Storage backup artifacts with SHA-256 validated. A full isolated Supabase restore remains unproven; earlier synthetic restore attempts failed around `pg_cron` targeting and inherited Realtime objects. |
| Observability/secrets | PENDING | Runtime proxy/APM URL capture and deployed log settings not verified |
| Staging environment | NOT AUTHORIZED | Requires explicit owner approval; no staging operation authorized here |

## Decision

There is **NO-GO to request staging authorization at this point**. Deno entrypoint checking is now resolved locally. Remaining critical blockers include a successful full restore rehearsal in a disposable Supabase environment, verified old-token-writer drain/maintenance controls, Cloud RPC/RLS/Storage reconciliation, applicable provider contracts, and a server-side TikTok Shop disablement plan. This status does not authorize staging or production.

## Gate 3.19.4 addendum — 2026-11-04

- Exact Deno command requested by the gate completed with exit code 0 for `media-validate`, `video-worker-api`, `publication-worker`, `tiktok-channel`, and `tiktok-oauth-callback`.
- Related tests completed: Deno 38/38 and Bun OAuth rotation 12/12. No cloud service was accessed.
- Migration hashes M10/M11 still match the previous local evidence record.
- This gate did not execute or validate a Production restore. Backup artifacts and their verified hashes are reported in the owner-provided gate context; artifact custody was not re-read here.
- M10/M11 include TikTok Shop refresh schema/RPCs. The current frontend, publication worker, and Shop Edge Function sources still contain Shop paths; “inactive in Production” does not prove the release has a complete disable gate.
