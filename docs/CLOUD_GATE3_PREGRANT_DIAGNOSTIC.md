# Diagnóstico read-only do bloqueio do Gate 3

## Escopo e estado

Projeto Cloud esperado: `djrwfvcxgpyknmizqumn` (somente identificação; ainda não verificado por esta ferramenta). Role: `autoclip_cloud_auditor`. O arquivo de grants `scripts/cloud-audit/sql/metadata-only/01_grant_minimum_permissions.sql` foi preservado sem alterações; hash confirmado: `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`.

O diagnóstico separado em `scripts/cloud-audit/sql/diagnose_pregrant_blockers.sql` lê apenas `pg_catalog`/catálogos de ACL e identidade. Não lê linhas de negócio nem conteúdo de Auth/Storage, não invoca rotinas da aplicação e não altera objetos. Usa `BEGIN READ ONLY`, timeouts e exige Project Ref e nome da role. Guards incompatíveis ou role ausente abortam com `SELECT 1/0` sob `ON_ERROR_STOP`, para resultar em código de saída não zero (não usa `\quit 3`, cujo argumento é ignorado pelo psql instalado).

Hash SHA-256 do diagnóstico: `e0e440d63620dbb93734bb16fb725afa6ca74291b321ebe931e9ec254ee40567`.

## De onde vêm as categorias do bloqueio

O precheck do Gate 3.1 calcula violações antes de qualquer `GRANT`. O erro relatado informa as categorias, mas não identifica por si só os objetos. A leitura do SQL local permite localizar as condições que ativam cada classe:

| Categoria reportada | Condição efetiva examinada pelo Gate 3 | Evidência remota necessária |
|---|---|---|
| application routine EXECUTE | Existe rotina não sistêmica executável efetivamente pela role, levando em conta EXECUTE e USAGE do schema. | Nome/schema/assinatura, ACL, owner, `prokind`, `prosecdef`, origem efetiva. |
| privilege on a non-target database | CONNECT, CREATE ou TEMP efetivo em database conectável diferente do database atual. ACLs PostgreSQL comuns de PUBLIC CONNECT/TEMP podem causar este bloqueio. | Database, privilégio, ACL, grant direto/PUBLIC/membership/ownership. |
| role membership/delegation | A role é membro de outra role ou outra role é membro dela, conforme `pg_auth_members`; opções admin/inherit/set também são mostradas. | Roles envolvidas e flags de membership. |
| unapproved relation read/write privilege | SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER em relations; privilégios por coluna são incluídos, com apenas `version` do ledger compatível como allowlist. | Schema/relation/coluna, tipo, ACL e origem provável. |
| unapproved schema USAGE/CREATE | CREATE efetivo em schema ou USAGE fora do escopo public/ledger compatível. | Schema, owner, ACL e privilégio efetivo. |
| unapproved sequence privilege | SELECT/USAGE/UPDATE efetivo em sequence não sistêmica. | Schema/sequence, ACL e origem provável. |

O Gate 3 também bloqueia atributos administrativos, ownership, grants com grant option, default ACLs, acesso a large objects, foreign servers, tipos customizados e privilégios inesperados de CREATE/TEMP. O diagnóstico inclui evidência para essas classes quando visível pelos catálogos.

**Os objetos reais que causaram o ROLLBACK continuam desconhecidos.** Apenas uma execução posterior, pessoal e expressamente autorizada do diagnóstico poderá identificá-los. A saída local de teste não representa estado Cloud.

## Execução pessoal preparada (não executar sem autorização separada)

Na raiz do repositório, o proprietário pode salvar o resultado localmente com permissões restritas. O comando fixa host, porta, database, usuário e CA; `-W` pede a senha interativamente. Não é um comando de grants.

```bash
umask 077
OUTPUT_FILE="$(mktemp "$HOME/autoclip-gate3-diagnostic.XXXXXX")"
chmod 600 "$OUTPUT_FILE"
env -u PGSERVICE -u PGSERVICEFILE -u PGHOSTADDR -u PGHOST -u PGPORT \
  -u PGDATABASE -u PGUSER -u PGPASSWORD -u PGPASSFILE -u PGSSLMODE \
  -u PGSSLROOTCERT -u PGSSLCERT -u PGSSLKEY -u PGOPTIONS -u PGCONNECT_TIMEOUT \
  psql -X -W --csv -v ON_ERROR_STOP=1 \
    -v cloud_project_ref=djrwfvcxgpyknmizqumn \
    -v audit_role=autoclip_cloud_auditor \
    -h db.djrwfvcxgpyknmizqumn.supabase.co -p 5432 -U postgres \
    -d "dbname=postgres sslmode=verify-full sslrootcert=prod-ca-2021.crt connect_timeout=10 application_name=autoclip_gate3_diagnostic" \
    -f scripts/cloud-audit/sql/diagnose_pregrant_blockers.sql > "$OUTPUT_FILE"
printf 'Relatório local: %s\n' "$OUTPUT_FILE"
```

O Project Ref no SQL não prova a identidade do servidor. A conexão acima exige o endpoint Direct autorizado e `verify-full`; não trocar por pooler nem reduzir TLS diante de falha. Revise o CSV localmente, não o publique sem redação: nomes de schemas, rotinas e ACLs são metadados operacionais sensíveis. Remova o relatório ao fim conforme o procedimento do proprietário.

## Limitações

- Sem conexão Cloud: ledger, ACLs, objetos e estados reais não verificados.
- Metadados podem estar ocultos por permissões/catálogos; falta de linha não prova inexistência.
- `TEMP` herdado exclusivamente de PUBLIC continua risco residual ALTO; a consulta mostra origem e não o trata como aprovação de segurança.
- Catálogos de ACL mostram grants; atribuição efetiva por memberships profundas pode aparecer como `EFFECTIVE SOURCE UNATTRIBUTED` quando não for possível provar a origem.
- O diagnóstico é fotografia pontual e não protege contra alterações administrativas concorrentes antes/depois de seu instante de leitura.
- O resultado não autoriza Gate 3, Gate 4, Marco C nem qualquer mudança remota.

## Evidência local desta revisão

- `node --test scripts/cloud-audit/readonly-audit.test.mjs`: 19 aprovados, 0 falhas, 0 skips.
- `node scripts/cloud-audit/test-readonly-role-local.mjs`: aprovado no Supabase local PostgreSQL 17.6; 30 classes negativas relatadas pelo harness, incluindo bloqueio fail-closed antes dos grants, TEMP direto, memberships, ownership, default ACL, large objects, RLS/ledger incompatível e remoção sem CASCADE.
- `node scripts/cloud-audit/test-pregrant-diagnostic-local.mjs`: aprovado em fixtures locais; reportou as 7 categorias configuradas, incluindo privilégios diretos, membership, database não-alvo, rotina, sequence e TEMP direto/PUBLIC; não encontrou o sentinel de conteúdo de fixture na saída.
- `git diff --check`: aprovado.
- Conexões Cloud e SQL remoto nesta revisão: zero.
