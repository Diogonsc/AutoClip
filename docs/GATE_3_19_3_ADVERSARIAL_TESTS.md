# Gate 3.19.3 — Adversarial test record

## Executed in this gate

| Scenario | Evidence/result |
|---|---|
| Migration chain on disposable PostgreSQL 17 | PASS; 250 pgTAP assertions |
| M10-only unknown refresh expiry | Reproduced fail-open (`ACQUIRED`) on synthetic legacy row |
| M11 unknown-expiry guard | PASS; `REAUTH_REQUIRED`, `REFRESH_EXPIRY_UNKNOWN`, no invented expiry |
| Two independent lease claimants | PASS; one acquires, the other cannot reuse the old token |
| Stale completion after rotation | PASS; old attempt cannot write over newer fenced generation |
| Ten independent PostgreSQL clients | PASS; one `ACQUIRED`, nine `BUSY` |
| Legacy direct writer after newer generation | Reproduced unsafe overwrite via direct UPDATE; confirms old writers must be drained |
| Shop OAuth endpoint redirect/host restriction | PASS in synthetic fetch test; redirects rejected, unapproved host rejected |
| Shop OAuth token handling suite | PASS; tests include rotation and ambiguous failure handling |
| Restore into another DB of same cluster | FAIL due pg_cron database restriction; restore unvalidated |

The harness command was `node scripts/test_gate_316_rpc_concurrency.mjs`. Its migration, concurrency, and RPC assertions 1–70 passed before the restore assertion failed; therefore the harness process as a whole exited nonzero. The test stack is generated under a unique temporary project id and stopped by that runner; restore used a second unique disposable Supabase stack. The `pg_dump` file was generated locally. No real tokens or remote API calls were used. The separate Playwright disposable runner passed 20/20 tests (desktop and mobile variants).

## Coverage limits

Ten independent PostgreSQL clients were demonstrated; this is not ten independent worker hosts. HTTP outcomes are mocked. The current run did not fully fault-inject every crash boundary (after provider acceptance, during persistence, or at commit), clock skew, concurrent reconnect/disconnect, malformed provider response, nor restore to a separate pg_cron-compatible cluster. Those remain unverified. Do not infer provider-side exactly-once refresh semantics from mocks.

## Important rollout counterexample

The old worker's direct token UPDATE does not participate in the new version/attempt CAS. A stale old worker can overwrite the latest row. The rollout must prevent old and new token-writing code from overlapping. This is a compatibility/deployment blocker, not a claim that current Cloud has been altered.
