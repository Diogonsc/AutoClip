# Gate 3.19.3 — Local rollout and recovery rehearsal

## Environment

The repository concurrency harness created a uniquely named disposable Supabase stack and ran its tests against local PostgreSQL 17. It did not target the persistent `tiktok-saas` stack or Cloud. The harness ran the full local migration chain (32 ledger rows in this rehearsal) and pgTAP. It also tested M10-only then M11 claim behavior using synthetic rows.

## Results

- Fresh migration chain and pgTAP: **PASS, 250 assertions**.
- Database lint: **PASS with no blocking errors; one warning line**.
- M10/M11 legacy-expiry transition: **PASS**, but proves a rollout hazard: M10 alone returns `ACQUIRED` for unknown refresh expiry; M11 fails closed.
- Independent-process lease race: **PASS, 10 PostgreSQL clients; one ACQUIRED, nine BUSY**.
- Custom-format `pg_dump`: **PASS**, nonempty backup created from disposable DB.
- Restore attempt 1 into another database in the same cluster: **FAIL / incompatible target**. `pg_restore` reported that pg_cron can only be created in the database configured by `cron.database_name`; the disposable stack config points to `postgres`.
- Restore attempt 2 into `postgres` in a separate disposable Supabase cluster: **FAIL** during `--clean`; `pg_restore` could not drop inherited constraint `realtime.messages_2026_11_05_pkey`. The target database contains Supabase-managed objects whose ownership/inheritance is not safely handled by a blanket clean restore. The runner stopped and removed only its uniquely identified disposable stacks.

Thus backup file creation was tested, but restoration was **not validated**. A valid next rehearsal needs a target-specific selective restore/ownership plan or a database-level backup/restore method appropriate to Supabase-managed objects. Do not run blanket `pg_restore --clean` against a live or staging target. Do not treat these failed attempts as successful recovery evidence.

## Rollout order and interruption rules

1. Require a separately approved isolated staging environment and verified backup/restore there.
2. Inventory and stop/drain all old token writers, including workers and Edge Functions; verify no old instance remains. Old code has a direct-update path that bypasses token-version CAS.
3. Apply M10 then M11 with all token workers paused; do not permit a gap with workers running because M10 alone admits unknown-expiry legacy records.
4. Deploy compatible backend/Edge Function code, validate RPC signatures and authorization, then resume workers.
5. Deploy compatible frontend after backend compatibility checks. Keep an explicit maintenance/abort path if clients are incompatible.
6. Run synthetic staging checks and observe before any real OAuth authorization (requires separate approval).

## Rollback

Schema rollback is not assumed safe. After any successful provider refresh, old refresh tokens may already be invalid; restoring database credentials can make a connection unrecoverable. Prefer stopping workers and rolling forward. For ambiguous refresh outcomes, require reauthorization rather than retrying the old token. Production/staging backup recovery remains unproven until a separate-cluster restore succeeds.
