# Supabase Cloud security gaps — metadata-only preparation

**Target:** `djrwfvcxgpyknmizqumn` (sole primary project confirmed by the owner). **Historical state at Marco B.0:** no Cloud connection or remote SQL was performed; all remote controls listed there remained unverified.

> **Atualização Gate 3.11:** diagnóstico read-only independente posterior confirma `autoclip_cloud_auditor` com `can_login=false`. Isso contém novos logins diretos, mas não altera ACLs `PUBLIC`, não remove a role e não conclui a auditoria Cloud. Estado atual, evidências e riscos estão em [`CLOUD_SECURITY_AUDIT_FINAL_REPORT.md`](CLOUD_SECURITY_AUDIT_FINAL_REPORT.md) e [`CLOUD_SECURITY_CLOSURE_CHECKLIST.md`](CLOUD_SECURITY_CLOSURE_CHECKLIST.md). As notas abaixo permanecem como histórico dos gates anteriores.

## Scope decision

Marco B.0 deliberately excludes a `SECURITY DEFINER` inventory projection. It does not create `autoclip_audit`, `inventory_summary()`, a broker, or broad table grants. The read-only role is proposed to inspect PostgreSQL catalog metadata and optionally one text column (`supabase_migrations.schema_migrations.version`). Application records, Storage contents, jobs, quota, Auth data, OAuth tokens and user-level schedules are out of scope and remain `NOT VERIFIED`.

The old `scripts/cloud-audit/sql/00_create_inventory_projection.sql` remains an historical candidate only; it is **not approved** and must not be executed under this scope. No prior projection SQL hash authorizes the new metadata-only sequence.

## Gaps and residual risk

| Severity | Gap / risk | Evidence status | Control / next step |
|---|---|---|---|
| HIGH | Database-wide TEMP may be inherited from PUBLIC; the credential holder can create temporary objects in a separate session. | Proven in local PostgreSQL fixture; Cloud ACL not verified. | Accept only explicit project-bound opt-in if ACL proves exclusively PUBLIC; do not revoke PUBLIC globally. `READ ONLY` wrapper protects the tool's statements, not arbitrary credential use. |
| HIGH | Actual Cloud role, membership, ownership, ACLs, callable functions and schema visibility are unknown. | NOT VERIFIED | Run preflight only after explicit creation and verification approvals. Any unexpected grant, membership, ownership or custom EXECUTE aborts. |
| HIGH | Cloud migration ledger and schema may diverge from local 29 migration files. | NOT VERIFIED | Read only `version` column if its object type/name/type is exact; otherwise report NOT VERIFIED. Never broaden access. |
| HIGH | Existing public/custom EXECUTE grants may make a custom routine callable by the proposed role. | Local fixture tested; Cloud unknown. | Preflight fails closed if any custom application routine is executable through direct, PUBLIC or membership privilege. Do not alter PUBLIC to make audit pass. |
| MEDIUM | Catalogs/`information_schema` metadata visibility may be partial by PostgreSQL version/managed-role behavior. | Local PG 17.6 tested; Cloud version unknown | Catalog query errors/empty visibility are not proof of absence; mark each unavailable section NOT VERIFIED. |
| MEDIUM | `default_transaction_read_only=on` can be changed by the session user. | PostgreSQL behavior, locally modeled | Defense in depth only; no write grants and every tool query is static/allowlisted in explicit `BEGIN READ ONLY`. Do not describe as absolute immutability. |
| MEDIUM | Ledger schema/table may not exist or have expected shape. | Cloud unknown | Grant script conditionally grants only CONNECT if absent/incompatible; audit omits ledger and records NOT VERIFIED. |
| MEDIUM | Administrative APIs for Storage/Auth/Functions/Vercel are not covered by PostgreSQL identity. | Known scope limitation | Obtain separate official read-only access and authorization or retain as NOT VERIFIED. |
| LOW | Catalog metadata exposes schema, column, object and routine names/security settings. | Inherent in selected scope | Keep report files private (0600), redact before sharing, no row data or function source. |

## Marco B.0 local test result (historical)

Última execução: 16/16 testes unitários aprovados; o teste integrado de role no Supabase local 17.6 passou, incluindo negação de leitura e ownership de large object. O relatório JSON do teste registra `cloudConnection: false`. Esses dados não verificam as ACLs nem o ledger Cloud.

## Least-privilege design

Proposed identity `autoclip_cloud_auditor` has LOGIN/NOINHERIT, no admin flags, no memberships, one connection and <=14-day expiry. It receives CONNECT on `postgres`. Only if the canonical migration ledger is a regular/partitioned table with `version text` and RLS/FORCE RLS disabled does it receive USAGE on `supabase_migrations` and `SELECT(version)`. No business table SELECT, no application schema USAGE, no routine EXECUTE, no sequence access, no default ACL changes, no DDL/DML, no grant option, and no table-wide grant.

The preflight checks exact role identity, target ref/host/TLS at the client, read-only transaction, role settings/expiry, admin attributes, membership, ownership, schema/database creation, all effective persistent reads/writes, sequences, grant options including column ACLs, custom routine execution, and TEMP provenance. If information cannot be established, it fails closed or reports the audit section as NOT VERIFIED. It never switches identity or calls a SECURITY DEFINER projection.

## Marco B.2-A — atualização local

Na revisão final, os seis hashes SQL do pacote foram recalculados e todos correspondem aos hashes do Marco B.1. A suíte `readonly-audit.test.mjs` passou em 17/17, sem skips; o harness local PostgreSQL 17.6 concluiu `LOCAL_METADATA_ONLY_ROLE_TESTS_PASSED`, verificando ledger presente, incompatível, com RLS e ausente; 11 consultas de metadados; 14 classes de negação; TEMP exclusivamente PUBLIC; revogação de sessão e remoção sem CASCADE. Esses resultados são somente locais. Operador, host/porta conferidos no painel, método administrativo e janela seguem pendentes; não ocorreu conexão Cloud.

## Separate review of admin SQL

Marco B.1 files are `_guard.psql`, metadata-only 00 (create), 01 (minimal grants), 02 (fail-closed verification), 03 (emergency revocation), and 04 (definitive no-CASCADE removal). Each operation requires separate authorization. Historical projection and full-scope SQL files remain excluded. Current hashes and exact SQL are in `CLOUD_METADATA_ONLY_AUDIT_SCOPE.md`; recompute before approval. No SQL was executed remotely.

## Pilot gate

Do not use the worker or pilot Cloud integration based on this metadata audit. Before pilot, separately verify migration history, RLS/grants, Storage access, worker HMAC deployment, secrets, backups, jobs/media consistency, Edge Function deployed code and TikTok external certification. `UNKNOWN` and `SENT_TO_INBOX` remain unconfirmed publication states. No deployment is authorized here.

## Gate 3.12 — inventory and next evidence

Gate 3.12 adds a local component inventory and a fixed, catalog-only PostgreSQL audit package. The scope, limitations, risk prioritization, local/Cloud comparison procedure and integrated-homologation plan are in [component inventory](GATE_3_12_COMPONENT_INVENTORY.md), [risk matrix](GATE_3_12_SECURITY_RISK_MATRIX.md), [local/Cloud comparison](GATE_3_12_LOCAL_VS_CLOUD_COMPARISON.md) and [homologation plan](GATE_3_12_INTEGRATED_HOMOLOGATION_PLAN.md). These are local preparation artifacts: the component wrapper was not run against Cloud, so no Cloud finding is closed by this update. The auditor role remains historically confirmed NOLOGIN and excluded from use; no role/grant/RLS changes are authorized here.

## Marco B.1 — escopo mínimo e fail-closed

A auditoria proposta não usa SECURITY DEFINER, projection schema, dados de negócio, Storage, Auth ou dados operacionais. Verificação de role/ACL passou a falhar com código não zero quando um privilégio está fora da allowlist. O marcador de proveniência é validado. A terminação de sessões usa a identidade autenticada da role, não `application_name`. TEMP via PUBLIC é exceção explícita com risco residual ALTO; privilégios diretos, membership, grant option ou ownership bloqueiam. A criação e os grants não são ciclo atomicamente reversível e qualquer falha parcial exige parada e avaliação humana. Nenhuma conexão Cloud ocorreu.


### Atualização Gate 3.1

Hash anterior `4db6b51292a8b1a2311979fcd92acba130c4aa34cc9aeaac4be211968ff463c6` de `01_grant_minimum_permissions.sql`: **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. Hash candidato `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`, sujeito a revisão/aprovação específica. A validação agora falha antes de grants diante de privilégios inesperados; o harness local comprovou bloqueios para ACLs diretas/PUBLIC, membership, ownership, sequences, funções, default ACLs, large objects e falha transacional. Sem autorização/conexão Cloud.


## Gate 3.1 — atualização de precheck

O grant script foi substituído por uma variante de falha fechada que examina privilégios efetivos pré-existentes antes de `GRANT`, inclusive privilégios herdados via PUBLIC/membership, ownership, default ACLs, rotinas, objetos e CONNECT cross-database. Resultado desconhecido causa ROLLBACK e erro não zero. O harness local comprovou negações antes de qualquer grant e rollback após erro posterior ao primeiro grant. Apenas ACL default de USAGE em tipos customizados sem ACL explícita é tratada como default PostgreSQL não ampliador de leitura.

O hash anterior `4db6b51292a8b1a2311979fcd92acba130c4aa34cc9aeaac4be211968ff463c6` foi **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. Novo hash candidato `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`. Evidências locais finais: 18 testes Node aprovados; integração PostgreSQL local 17.6 aprovada; zero skips. A revisão não verifica ACL Cloud. Se CONNECT a bancos Cloud fora do alvo vier de PUBLIC, a execução será bloqueada e deverá voltar para decisão de escopo, sem revogar PUBLIC globalmente.


O candidato anterior do Gate 3.1, hash `f19ab0675df9434413799baf8c7d1c2349280d5a85aa230c638b900c9ec6c386`, também está **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. O hash candidato vigente é `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`; esta revisão não autoriza sua execução remota.

## Atualização Gate 3.13 — resultados de catálogo

O proprietário executou manualmente os nove componentes read-only. A evidência está resumida, com hashes e limites, em [GATE_3_13_CLOUD_RECONCILIATION_REPORT.md](GATE_3_13_CLOUD_RECONCILIATION_REPORT.md). Ledger: 21 versões presentes localmente e no Cloud por ID; oito migrations locais posteriores ausentes no ledger. O schema observado não contém objetos/colunas de grupos/lotes/validação dessas migrations. O bucket observado é privado, somente MIME de vídeo e sem `media-quarantine`.

ACL pública foi observada em `net` (USAGE, rotinas HTTP EXECUTE e privilégios amplos em relações/sequence, incluindo MAINTAIN); `change_workspace_plan` e `resolve_unknown_job` são SECURITY DEFINER com EXECUTE para `authenticated`. São riscos confirmados no plano de ACL/propriedades, mas exploração e equivalência dos corpos Cloud não foram demonstradas. O pacote não leu dados operacionais, corpos de funções, cron rows/commands ou secrets. Estes achados são prioridade alta e mantêm NO-GO para homologação real até revisão e decisão em gates separados; nenhuma correção remota está autorizada.

### Atualização Gate 3.14 — triagem local sem alteração Cloud

A análise detalhada de dependências `pg_net`, autorização/efeitos locais das duas RPCs privilegiadas e rollout das oito migrations locais está em [GATE_3_14_SECURITY_TRIAGE_AND_REMEDIATION_PLAN.md](GATE_3_14_SECURITY_TRIAGE_AND_REMEDIATION_PLAN.md). A ACL de `net` é uma configuração Cloud observada; SSRF, exposição por PostgREST, exfiltração e interferência em filas permanecem cenários potenciais não testados. Os corpos implantados das RPCs, os cron jobs ativos, o schema exposure, os secrets e a autorização runtime continuam não verificados. O teste local novo passou 21 assertions pgTAP com usuários/workspaces sintéticos, sem provar o comportamento do Cloud. Não foram alterados código de produção, migrations, grants, policies ou roles.
