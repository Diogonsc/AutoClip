# Data Retention, Deletion and Recovery Gaps

**Review date:** 2026-11-02
**Evidence scope:** repository source and historical Gate 3.19.3 local disposable test record; no remote configuration or user data accessed.

## Data lifecycle inventory

| Category | Local evidence / lifecycle | Retention evidence | Deletion/recovery gap |
|---|---|---|---|
| Auth/account/workspace | Local schema, auth flows and account deletion path | No approved category-level schedule found | Full deployed Auth/workspace deletion and backup expiry not proven |
| TikTok OAuth credentials | Encrypted token code and token lifecycle migrations/tests | No approved token/audit retention period found | Revocation, deletion, key rotation and Cloud deployment not confirmed |
| Media and derivatives | Media assets, storage path and cleanup logic/tests | Cleanup is configurable; no complete schedule for all states | Physical cleanup remains disabled/unverified; shared references and unknown jobs require staging tests |
| Publication jobs/history | Jobs, status and audit metadata | No comprehensive job/history schedule found | Retention must preserve dispute/security needs without excessive personal data |
| TikTok Shop product/order cache | Local Shop migration includes raw JSON fields | No approved schedule or proven active dataset | Field-level minimization and actual payload contents are unknown; minimize before enabling use |
| Logs and security audit | Runbook and local event structures | Runtime log retention/permissions not checked | Cloud log access, redaction, retention and deletion not verified |
| Backups | Gate 3.19.3 disposable `pg_dump` artifact creation passed | No Cloud backup/PITR, Storage-object, secrets/configuration scope evidence | Restore attempts failed; successful recovery is NOT VERIFIED |

## Deletion workflow controls to prove

- Verify requester identity proportionately and create a minimal case record.
- Identify all affected workspace, account, OAuth credentials, Storage objects, jobs and logs.
- Distinguish disconnect/revoke, AutoClipe account deletion, media cleanup and deletion of content already sent to TikTok.
- Block unsafe media deletion while jobs are pending/unknown or references are shared.
- Use dry-run and synthetic staging evidence before any approved destructive operation.
- Record legal holds, provider-side limitations, backup expiry and completion status.
- Test retry/idempotency and partial failure handling.
- Keep physical cleanup disabled until owner approval and safety criteria are met.

## Backup and recovery status

The Gate 3.19.3 record states that a custom-format backup was created, but restoration did not pass. Reported blockers included `pg_cron` requiring its configured database and a separate-cluster Realtime constraint. This local disposable rehearsal does not establish Cloud backup status, provider PITR, Storage object recovery, secrets/configuration recovery, RPO/RTO, or production restorability. Do not claim tested recovery.

## Required actions

| Priority | Action | Closure evidence |
|---|---|---|
| P0 | Owner/privacy reviewer approves category-purpose-retention schedule, including legal/security exceptions | Versioned approval and documented triggers/periods for each category |
| P0 | Map actual Shop fields and remove/allowlist raw payload data before operational use | Data-flow field inventory, code review and synthetic tests |
| P1 | Verify deletion request channel ownership, monitoring and response workflow | Sanitized synthetic case exercise and completion record |
| P1 | Test account/media deletion with synthetic staging records and shared/pending references | Isolated test report showing safe block/cleanup behavior and audit record |
| P1 | Design target-appropriate restore with required extensions/database and separately scoped Storage/configuration recovery | Successful isolated restore report; separately evidence provider backup/PITR only after authorized verification |
| P1 | Define RPO/RTO and recovery roles before launch | Approved recovery objectives and an exercised runbook |

No deletion, cleanup or recovery operation was executed in this gate.


## Business identity/contact note — 2026-11-02

The owner supplied the MEI identity and contact for candidate documentation: AutoClipe trade name; 56.151.919 DIOGO NASCIMENTO DOS SANTOS, MEI holder; CNPJ 56.151.919/0001-30; Rio de Janeiro/RJ, Brazil; diogos.nascimento@outlook.com. This does not establish a monitored request mailbox, an approved retention schedule, published operator identity, data region, or completed deletion workflow. The public `data-deletion.html` source already contains the supplied email but does not identify the legal operator; it was not changed or remotely verified.
