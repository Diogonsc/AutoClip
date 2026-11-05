# Gate 3.19.3 — M10/M11 compatibility

## Integrity

| Migration | File | SHA-256 | Result |
|---|---|---|---|
| M10 | `supabase/migrations/20261103000010_tiktok_refresh_rotation_leases.sql` | `9b14ae363efd4e47d1579fdf0a3c8ebc5a157df03f935c6c1a79c85d15a38845` | MATCH |
| M11 | `supabase/migrations/20261103000011_oauth_refresh_legacy_state_guard.sql` | `61aaeedcd4082bedfc91b86797ae801128524543882fbc7c23c11f535633659f` | MATCH |

## Compatibility findings

M10 adds version, refresh state, attempt id and start timestamp to Login Kit and Shop connection records, plus acquire/complete/fail RPCs. Completion and failure require the expected connection, workspace where applicable, token version, in-flight state and attempt id. Token writes update access token, refresh token, expirations and version together. SQL uses database time for leases. M11 replaces the acquisition-function definitions so unknown refresh-token expiration requires reauthorization rather than assuming validity.

The disposable PostgreSQL 17 rehearsal demonstrated that M10 alone can acquire a legacy row with NULL refresh expiry (`ACQUIRED`). Applying M11's function makes the same fixture return `REAUTH_REQUIRED`, records `REFRESH_EXPIRY_UNKNOWN`, and invents no expiry. No worker should be enabled between M10 and M11.

| Code | Schema | Assessment |
|---|---|---|
| Old | Old | Historical behavior; not re-certified here |
| Old | M10 | Unsafe coexistence: old direct token UPDATE bypasses version fencing |
| Old | M10+M11 | Still unsafe: direct UPDATE remains possible |
| New | Old | Incompatible: required columns/RPCs absent |
| New | M10 | Incomplete safety for unknown expiries |
| New | M10+M11 | Expected target pairing; local tests pass, Cloud not verified |

The old-writer race was reproduced against a disposable database: a legacy `service_role` direct update can overwrite a newer token generation without advancing `token_version`. This is not fixed by M10/M11 alone. Drain/stop every old worker and Edge Function instance before schema rollout and keep them stopped until compatible code is deployed. If old writers cannot be conclusively drained, **NO-GO**.

## Rollback and recovery limits

M10/M11 are additive/stateful, but code rollback to an old writer is unsafe after token rotation. Do not restore old credential snapshots over a newer generation: provider-side refresh-token invalidation is outside the database transaction. Prefer roll-forward or reauthorization after an ambiguous refresh. A backup restore rehearsal was attempted; see `GATE_3_19_3_LOCAL_ROLLOUT_REHEARSAL.md` for the pg_cron limitation.

## Evidence boundary

This rehearsal establishes behavior only for local PostgreSQL 17 and synthetic fixtures. It does not establish the Cloud schema, permissions, worker drain, lock duration, or provider token behavior.
