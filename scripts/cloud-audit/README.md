# Cloud audit utility — PostgreSQL metadata-only

The utility does not connect by default and never loads `.env` files.

## Local manifest

```bash
node scripts/cloud-audit/readonly-audit.mjs --local-manifest
```

This enumerates repository migrations/functions only; it does not report Cloud state.

## Remote execution — separate approvals required

Only `--audit-scope metadata-only` is supported. A later Marco C authorization is required after a separate approved role-creation/verification Marco B. The dedicated PostgreSQL credential must be read-only by grants and expire within 14 days; do not use `service_role`, an admin database credential, the worker credential, or frontend variables.

```bash
node scripts/cloud-audit/readonly-audit.mjs \
  --audit-scope metadata-only \
  --execute-read-only --i-confirm-read-only-credential \
  --target-project-ref djrwfvcxgpyknmizqumn \
  --allow-public-temp-project-ref djrwfvcxgpyknmizqumn \
  --json /private/path/audit.json \
  --markdown /private/path/audit.md
```

Inject `AUTOCLIP_CLOUD_AUDIT_DATABASE_URL` through an approved local secret manager; do not put the value in command history. The tool requires host `db.<ref>.supabase.co`, verified TLS, explicit target ref and both confirmation flags. It validates the live role before inventory, runs only static allowlisted SELECTs, each inside explicit `BEGIN READ ONLY` with statement/lock/connect timeouts, and writes reports mode 0600. It will not retry with a privileged identity.

## Scope and limitations

Catalog inventory: server version, schemas, relations/columns, constraints, indexes, triggers, RLS policies, grants/ACLs, and routine security properties without function bodies. The migration ledger query reads only `version` and runs only if catalog shape and role privilege checks pass. Missing/blocked/incompatible sections are `NOT VERIFIED`, not “absent”.

No business rows, media/storage objects, personal data, OAuth tokens, job/schedule/quota rows, business RPCs, Edge Function management API, Auth admin or Vercel API are queried. No `inventory_summary()`, SECURITY DEFINER function, `autoclip_audit` schema, broker, or direct business table grants are needed. Full/operational inventory is intentionally unsupported in this scope.

TEMP may be inherited from PUBLIC. The tool refuses it unless the exact project-bound opt-in is given and ACL provenance proves PUBLIC-only (no direct/membership grant, grant option, owner, or mismatch). This residual is HIGH: an account holder can create temporary objects outside the tool's own read-only transactions. Do not revoke TEMP globally.

## Local evidence (Marco B.0)

The current local run passed 16/16 unit tests and the disposable metadata-role integration against Supabase PostgreSQL 17.6. It checked exact ledger column access, catalog queries, absent-ledger behavior, public-only TEMP opt-in, and denied business/Auth/OAuth reads, writes, DDL, custom routine execution, grants, membership, ownership, and large-object access/ownership. No Cloud operation occurred.

## Administration files

Only the scripts in `sql/metadata-only/` are proposed for this Marco B, individually by hash. `sql/00_create_inventory_projection.sql` is historical, creates SECURITY DEFINER code, and is expressly excluded. The old top-level 02/03/04/05 do not belong to this scope; 04 is local-only. Exact candidate SQL, hashes, grants, stop conditions and approvals are in `docs/CLOUD_METADATA_ONLY_AUDIT_SCOPE.md` and `docs/CLOUD_READONLY_CREDENTIAL_APPROVAL_PACKAGE.md`.

## Local checks

```bash
node --test scripts/cloud-audit/readonly-audit.test.mjs
node scripts/cloud-audit/test-readonly-role-local.mjs
```

The role integration test uses a disposable isolated database in local Supabase and synthetic fixtures. It does not establish Cloud connectivity or authorization.

## Marco B.1 — revisão local

A auditoria remota continua bloqueada até autorização específica. O único escopo preparado é `metadata-only`; execute somente após aprovações separadas e alvo confirmado por canal oficial. Consultas estáticas são executadas em `BEGIN READ ONLY`; preflight falha fechado. TEMP herdado exclusivamente de PUBLIC requer opt-in preso ao Project Ref e continua risco residual ALTO fora da ferramenta. Não há fallback para service_role nem leitura de negócio. Scripts/hash atuais e instruções estão em `docs/CLOUD_METADATA_ONLY_AUDIT_SCOPE.md`, `docs/CLOUD_READONLY_CREDENTIAL_APPROVAL_PACKAGE.md` e `docs/CLOUD_CONTROLLED_EXECUTION_RUNBOOK.md`.

The migration-version grant is omitted for an RLS-protected or incompatible ledger. Revocation is split into emergency NOLOGIN/revoke and definitive no-CASCADE removal; each has a separate authorization/hash.
# Gate 3 blocker diagnosis (read-only)

`sql/diagnose_pregrant_blockers.sql` is separate from every grant script. It
uses only PostgreSQL catalogs and native privilege-check/catalog functions,
requires `cloud_project_ref` and `audit_role`, insists on the expected project
ref and `postgres` database, verifies the role exists, starts `BEGIN READ ONLY`
with bounded timeouts, and returns catalog evidence for the Gate 3 blocker
families. Missing/invalid psql guards raise a division-by-zero error under
`ON_ERROR_STOP` so they exit nonzero.

The diagnostic has been tested only against the local Supabase PostgreSQL 17.6
container. It has not been run against Cloud. It does not read table rows from
business/Auth/Storage schemas and does not invoke application routines. Its
output can still disclose operational object names and ACL metadata; protect
the output file. See [`CLOUD_GATE3_PREGRANT_DIAGNOSTIC.md`](../../docs/CLOUD_GATE3_PREGRANT_DIAGNOSTIC.md)
for the command prepared for owner execution. That command is not authorization
to run it; a separate explicit authorization is required.

Local diagnostic fixture test:

```bash
node scripts/cloud-audit/test-pregrant-diagnostic-local.mjs
```
