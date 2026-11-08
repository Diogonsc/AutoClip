# Procedimento da credencial PostgreSQL de auditoria AutoClip

**Procedimento vigente: metadata-only, preparação local sem autorização para conectar.** Este documento substitui a proposta anterior de agregação operacional por `inventory_summary()`.

## Alvo e finalidade

- Project Ref: `djrwfvcxgpyknmizqumn`, projeto Cloud principal do AutoClip.
- Database PostgreSQL: `postgres`.
- Role proposta: `autoclip_cloud_auditor`.
- Local: `tiktok-saas`, usado somente em teste isolado.
- Finalidade: leitura de catálogo PostgreSQL e, condicionalmente, valores da coluna `supabase_migrations.schema_migrations.version`.

Não haverá leitura de tabelas de negócio, Auth, OAuth, Storage, mídias, jobs, agendas individuais, quotas ou conteúdo. Não será instalada função SECURITY DEFINER, schema `autoclip_audit`, projeção, broker, ou concessão de EXECUTE. Informações que dependam de acesso maior são `NOT VERIFIED`.

## Identidade mínima

`LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, limite de uma conexão e validade máxima inicial de 14 dias. Defaults: transação read-only, timeouts curtos e `search_path` vazio. Sem memberships, ownership, DDL, DML, grant option, default privileges, sequences ou rotinas de negócio.

Grants propostos: CONNECT em database `postgres`; somente quando o ledger tiver formato canônico (`schema_migrations` regular/particionada e `version text`), USAGE em `supabase_migrations` e SELECT apenas na coluna `version`. Se estiver ausente/incompatível, essa permissão é omitida e ledger fica `NOT VERIFIED`.

O password não é versionado nem colocado em argumento/histórico. Após aprovação separada, gerar forte no password manager e definir em prompt interativo psql. Nunca usar `service_role`, credencial administrativa ou variável `VITE_*` como credencial auditora. Não compartilhar com worker.

## TEMP

O banco pode conceder TEMP a PUBLIC. A ferramenta bloqueia por padrão e só permite quando ACL efetiva comprovar origem PUBLIC exclusivamente, sem grant direto, membership, grant option, owner ou inconsistência, e houver `--allow-public-temp-project-ref djrwfvcxgpyknmizqumn`. **Risco residual alto:** o titular ainda pode abrir outra sessão e criar TEMP fora das transações READ ONLY do auditor. Nenhuma alteração de ACL global de PUBLIC é proposta.

## Arquivos e hashes

Use a tabela atual em [`CLOUD_METADATA_ONLY_AUDIT_SCOPE.md`](CLOUD_METADATA_ONLY_AUDIT_SCOPE.md), que contém os hashes e o texto integral dos scripts. A sequência futura contém role creation (`00`), grants mínimos (`01`), verificação read-only (`02`) e revogação separada (`03`). `_guard.psql` é incluído; não substitui aprovação nem prova o host.

Os arquivos históricos top-level `00_create_inventory_projection.sql`, `02_grant_minimum_permissions.sql`, `03_verify_readonly_permissions.sql`, `04_negative_security_tests.sql` e `05_revoke_and_drop_role.sql` não são aprovados por este procedimento. O antigo 00 cria `inventory_summary()` SECURITY DEFINER, motivo pelo qual fica excluído. `04` é exclusivamente local.

## Auditoria futura

Uma autorização específica Marco C deverá seguir verificação independente do alvo e utilizar somente:

```bash
node scripts/cloud-audit/readonly-audit.mjs \
  --audit-scope metadata-only \
  --execute-read-only --i-confirm-read-only-credential \
  --target-project-ref djrwfvcxgpyknmizqumn \
  --allow-public-temp-project-ref djrwfvcxgpyknmizqumn \
  --json /private/path/audit.json
```

O URL dedicado é injetado localmente por secret manager, não escrito no comando. O utilitário valida host/ref/TLS, exact role, privileges e expiração antes de consultas. Cada query é SELECT estático allowlisted em `BEGIN READ ONLY`; erro de privilégio, ausência ou incompatibilidade nunca aciona fallback administrativo.

## Autorizações distintas

1. Criação role por arquivo/hash específico.
2. Grants por arquivo/hash específico.
3. Verificação read-only por autorização própria.
4. Auditoria Marco C por autorização específica posterior.
5. Revogação role por autorização própria.

Atualmente nenhuma etapa remota está autorizada. Nenhuma conexão Cloud ocorreu. Consultar [`CLOUD_READONLY_CREDENTIAL_APPROVAL_PACKAGE.md`](CLOUD_READONLY_CREDENTIAL_APPROVAL_PACKAGE.md) e [`CLOUD_CONTROLLED_EXECUTION_RUNBOOK.md`](CLOUD_CONTROLLED_EXECUTION_RUNBOOK.md) para o pacote vigente.
