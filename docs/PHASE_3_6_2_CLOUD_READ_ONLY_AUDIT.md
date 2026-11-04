# Fase 3.6.2 — Cloud read-only audit status

## Marco B.0 — metadata-only credential preparation

**Status: MARCO B RESTRITO PREPARADO — AGUARDANDO AUTORIZAÇÃO CLOUD.**

Target project ref is `djrwfvcxgpyknmizqumn`, the owner's confirmed sole Cloud project. Local Supabase project `tiktok-saas` is used only for tests. No Cloud connection, SQL, DDL, grants, role, migration, Storage, Edge Function, or secret operation was performed.

The prior proposal to install a `SECURITY DEFINER` aggregate has been removed from the active auditor. The supported invocation now requires `--audit-scope metadata-only`. The tool does not require `inventory_summary()` or `autoclip_audit`; it reads PostgreSQL catalog metadata and may read only the migration `version` column when the schema/table/column/type are compatible and permission is explicitly present. It does not query business rows, media/storage objects, personal data, jobs, schedules, quotas, OAuth tokens, Auth administration, Edge Functions management APIs, or Vercel.

Proposed grants are CONNECT on database `postgres`, and conditional schema USAGE plus SELECT(version) on the canonical migration ledger. The ledger grant is omitted if missing/incompatible or if row-level security is enabled/forced; no completeness claim is made for a protected ledger. No table-wide business reads, custom EXECUTE, DDL, DML, membership, default privileges, or PUBLIC ACL changes are proposed. The audit marks inaccessible or out-of-scope evidence NOT VERIFIED.

The preflight still blocks dangerous privileges and custom callable application routines. The explicit TEMP exception remains accepted only when the source is exclusively PUBLIC, no direct/membership grant or grant option exists, the ACL matches effective privilege, and the exact project opt-in is supplied. Residual risk HIGH: the credential holder can create TEMP outside the tool's read-only transactions. No global TEMP revocation is proposed.

## Local evidence for this Marco

`node scripts/cloud-audit/test-readonly-role-local.mjs` passed against a disposable local PostgreSQL 17.6 database. It created a temporary test identity, ran metadata catalog queries, read a synthetic migration version through only the version column and rejected business-table SELECT, persistent INSERT, DDL, custom routine EXECUTE, grant option and direct TEMP. It accepted only the PUBLIC TEMP source with exact opt-in. Fixture role and database were removed.

`node --test scripts/cloud-audit/readonly-audit.test.mjs` is the unit suite for explicit scope, target host/ref, TEMP ACL provenance, preflight, static SELECT allowlist, transaction wrapper, local manifest and approval hashes. Current result after final execution is recorded in the turn report. These tests do not verify Cloud.

## Reexecução local deste Marco

- Ferramenta: 16/16 testes, 0 falhas, 0 skips.
- PostgreSQL local 17.6: role descartável, catalog inventory, ledger version-only e caso sem ledger aprovados.
- Negativos: business/Auth/OAuth SELECT, INSERT, DDL, função custom, GRANT OPTION, TEMP direto, USAGE de schema empresarial, ownership, membership, default ACL e large-object read/ownership bloqueados.
- `git diff --check`: aprovado.
- Nenhuma conexão Cloud foi feita.

## Files and approvals

See:

- [`CLOUD_METADATA_ONLY_AUDIT_SCOPE.md`](CLOUD_METADATA_ONLY_AUDIT_SCOPE.md) — precise scope, current hashes and exact candidate SQL content.
- [`CLOUD_READONLY_CREDENTIAL_APPROVAL_PACKAGE.md`](CLOUD_READONLY_CREDENTIAL_APPROVAL_PACKAGE.md) — privilege rationale and separate approval gates.
- [`CLOUD_CONTROLLED_EXECUTION_RUNBOOK.md`](CLOUD_CONTROLLED_EXECUTION_RUNBOOK.md) — future operator steps and stop conditions.
- [`CLOUD_SQL_FINAL_SECURITY_REVIEW.md`](CLOUD_SQL_FINAL_SECURITY_REVIEW.md) — SQL review decision.
- [`CLOUD_SECURITY_GAP_ANALYSIS.md`](CLOUD_SECURITY_GAP_ANALYSIS.md) — residual gaps and pilot gates.

The old `00_create_inventory_projection.sql` and top-level full-scope grants/verifier remain excluded from this Marco; their historical hashes are not authorization. Marco B requires fresh approval by exact file hash. Marco C audit and revocation each require separate authorization.

## Audit outcomes

| Source | State |
|---|---|
| Repository migration files | Locally enumerated: 29 |
| Local Supabase migration ledger | Prior local state reported 29; this Marco's fixture separately used one synthetic version |
| Cloud migration ledger/schema/RLS/grants | NOT VERIFIED; no Cloud connection |
| Cloud Storage/media/jobs/quotas | NOT VERIFIED and excluded from metadata-only scope |
| Cloud Edge Functions/Auth/Vercel | NOT VERIFIED; requires separate official read-only access |

This phase has prepared a least-privilege path; it has not completed a Cloud audit and does not authorize pilot activation.

## Marco B.1 — hardening local concluído, Cloud continua pendente

Preparação metadata-only: consultas estáticas allowlisted em transações READ ONLY, validação do Project Ref/host/user/database, TLS verify-full e sem fallback administrativo. Os SQLs foram separados em criação, grants, verificação fail-closed, revogação emergencial e remoção definitiva sem CASCADE. Não há SECURITY DEFINER nem projeção de agregados. O verificador rejeita privilégios perigosos com erro não zero. Consulte `CLOUD_METADATA_ONLY_FINAL_GO_NO_GO.md` e `CLOUD_METADATA_ONLY_AUDIT_SCOPE.md`. Nenhuma conexão ou alteração Cloud ocorreu.

### Marco B.1 final local regression (after hardening)

- Tool unit tests: 16 passed, 0 failed, 0 skipped.
- Role harness: local Supabase PostgreSQL 17.6 only; actual TCP login as the audit fixture, metadata catalog allowlist, migration version-only, ledger with RLS enabled, incompatible ledger and absent ledger; 14 negative privilege/data cases; fail-closed verifier; emergency session termination; dependency-protected no-CASCADE removal; disposable role/database cleanup.
- `git diff --check`: executed after final edits.
- Cloud connections and remote operations: 0.

The exact current SQL bytes/hashes and full approval text live in `CLOUD_METADATA_ONLY_AUDIT_SCOPE.md`.

## Gate 3.11 — encerramento documental posterior

O estado histórico acima descreve a preparação metadata-only e não deve ser lido como auditoria Cloud abrangente concluída. Após os Gates 3.6–3.10, o proprietário confirmou a contenção da role temporária por diagnóstico read-only independente (`can_login=false`; role ainda presente). Consulte [relatório final Cloud](CLOUD_SECURITY_AUDIT_FINAL_REPORT.md), [checklist de encerramento](CLOUD_SECURITY_CLOSURE_CHECKLIST.md) e [prontidão de homologação](INTEGRATED_HOMOLOGATION_READINESS.md) para evidências, limitações e pendências. Nenhuma conexão Cloud foi feita durante o Gate 3.11; Auth, Storage, RLS, ACLs completas, Edge Functions, Vercel e dados operacionais continuam não verificados ou pendentes conforme a matriz de evidências.
