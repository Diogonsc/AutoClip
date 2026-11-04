# Revisão SQL de segurança — escopo metadata-only (Marco B.1)

**Decisão:** revisão restrita preparada; aguarda aprovação administrativa Cloud. Nenhuma conexão remota ou SQL remoto foi executado.

## Decisão de arquitetura

`inventory_summary()` não faz parte do caminho metadata-only. A ferramenta `readonly-audit.mjs` não contém query para chamá-la, não calcula hash de sua definição e não exige schema `autoclip_audit`. Não será criada função `SECURITY DEFINER`, projeção agregada ou broker. Os dados operacionais que demandariam leitura privilegiada permanecem fora do escopo e são relatados como NOT VERIFIED.

O arquivo histórico `scripts/cloud-audit/sql/00_create_inventory_projection.sql` ainda contém implementação de função `SECURITY DEFINER` com owner proposto `postgres` e, portanto, tem capacidade potencial de contornar RLS. Não foi removido para preservar o histórico, mas está explicitamente proibido para Marco B.1 e não aparece na nova sequência aprovada. Não se recomenda implantação: a auditoria catalog-only não precisa desse privilégio e não justifica o risco.

## Queries efetivas e superfície

As queries ativas estão no objeto exportado `auditQueries` do script. Todas são `SELECT` estático a `pg_catalog`, `information_schema` não usado para dados de negócio e, condicionalmente, uma leitura de `supabase_migrations.schema_migrations.version`. `runPsql` compara a string inteira com a allowlist e envolve cada query em `BEGIN READ ONLY; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='3s'; ... COMMIT;`. Não há query de negócio, chamada RPC ou SQL arbitrário. O alvo exige `--audit-scope metadata-only`, ref fixa, host Supabase direto e TLS `verify-full`.

Metadados coletados: versão/identidade do servidor, schemas, relações, colunas sem expressão default, constraints, índices, RLS/policies, propriedades de routines sem corpo, triggers, ACLs (relação, coluna, schema, routine, database, default ACL), e ledger de migrations se autorizado. Policies/constraints/index definitions podem revelar lógica de schema; o relatório é privado. O script não exporta linhas de clientes.

## Revisão dos scripts administrativos

Os bytes e hashes atuais constam em `CLOUD_METADATA_ONLY_AUDIT_SCOPE.md`, junto do SQL integral. Os arquivos são:

| Arquivo | Operação | Risco / análise |
|---|---|---|
| `sql/_guard.psql` | valida psql local/cloud, ref, banco, role | sem efeito persistente; texto de ref não prova host nem autorização |
| `sql/metadata-only/00_create_role.sql` | transação cria LOGIN/NOINHERIT sem flags, defaults defensivos, comment marker | CREATEROLE/admin; senha ausente; expiração <=14d; preexistência aborta |
| `sql/metadata-only/01_grant_minimum_permissions.sql` | transação GRANT CONNECT e ledger condicionado | CONNECT em database escolhido pelo guard; USAGE+SELECT só versão text; sem SELECT tabela inteira |
| `sql/metadata-only/02_verify_metadata_readonly.sql` | BEGIN READ ONLY e catálogos de privilégios | sem mutação; resultado de verificação deve ser classificado, não assumir sucesso de todo catálogo |
| `sql/metadata-only/03_emergency_revoke_metadata_role.sql` | marcador, NOLOGIN/expiração, REVOKE de grants nomeados e encerra sessões autenticadas pela role | emergência separada; commit do bloqueio ocorre antes da terminação; não confia em `application_name` |
| `sql/metadata-only/04_remove_metadata_role.sql` | verifica precondições/dependências e `DROP ROLE` sem CASCADE | remoção definitiva separada; falha fechada se dependências ou sessões persistirem |

Todos usam guard comum. CREATE role e GRANT rodam em transações distintas; o procedimento completo não é atômico. Uma falha em grants não reverte uma role criada/commitada. Não há CREATE OR REPLACE, DROP CASCADE, alteração de owners, policy, função, Storage ou objeto de negócio. A revogação não apaga projeção/schema nem objetos preexistentes.

## Role e grants

Role exata `autoclip_cloud_auditor`: LOGIN, NOINHERIT, flags administrativas false, limite de uma conexão, validade <=14 dias, default read-only, timeouts e search_path vazio. Não possui membership ou ownership. Senha definida apenas por prompt interativo depois de aprovação; nunca em arquivo, argumento ou log.

Grants: CONNECT em `postgres`; schema USAGE e coluna SELECT(version) apenas se a tabela canonical existir como r/p e coluna for text. Nenhum acesso bruto a tabelas de negócio, `auth.users`, tokens OAuth, Storage, sequências ou funções da aplicação. No Cloud, `PUBLIC` executável custom será bloqueio, não motivo para alterar ACL global.

## TEMP

O preflight lê ACL database e compara com privilégio efetivo. Aceita TEMP somente se PUBLIC=true, direct=false, membership=false, grant option=false, database owner=false e opt-in exato. Todas as outras origens falham. **Risco residual alto:** a senha ainda permite TEMP em sessão não controlada pela ferramenta; `default_transaction_read_only` pode ser mudado pelo titular. A ferramenta protege suas próprias consultas read-only; não afirma que a role é absolutamente sem escrita. Nenhuma revogação de PUBLIC é proposta.

## Testes locais do Marco B.1

Em PostgreSQL local 17.6, a verificação read-only confirmou o estado da role, TEMP herdado somente de PUBLIC, grants, memberships, defaults, funções executáveis, objetos persistentes, sequences e large objects. Testes negativos também verificaram concessão de leitura e ownership de large object. A ferramenta passou 16/16 testes e o harness descartável confirmou o acesso version-only e ausência de SELECT bruto na tabela de migrations. Nenhum resultado comprova o estado Cloud.

## Limitações e decisão

Catálogos podem ocultar metadados ou divergir por versão gerenciada. Erro/ausência é `NOT VERIFIED`. Migrations, schema e ACL Cloud continuam desconhecidos. Ledger é opcional: se objeto/tipo/grant falhar, omitido. Management API de Edge Functions/Auth/Vercel não é coberta pela role PostgreSQL. Nenhum dado remoto foi verificado.

**Conclusão:** a variante metadata-only é apta para solicitar aprovação por hashes individuais. Isso não é aprovação para executar; criação de role, grants, verificação, auditoria Marco C e revogação requerem autorizações distintas. Ver checklist e hashes em `CLOUD_METADATA_ONLY_AUDIT_SCOPE.md`.

## Marco B.1 — atualização de hardening

A projeção SECURITY DEFINER foi retirada do escopo metadata-only. O verificador SQL agora aborta com erro não zero em qualquer check não aprovado e inclui verificação do marcador da role. A revogação de sessões não usa application_name, que é falsificável; limita a ação ao usename autenticado da role. Emergência (03) e remoção definitiva sem CASCADE (04) são scripts separados e exigem autorização independente. Consulte `CLOUD_METADATA_ONLY_AUDIT_SCOPE.md` para bytes integrais e hashes atuais. TEMP exclusivamente via PUBLIC continua risco residual ALTO. Nenhum SQL Cloud foi executado.


### Atualização Gate 3.1

Hash anterior `4db6b51292a8b1a2311979fcd92acba130c4aa34cc9aeaac4be211968ff463c6` de `01_grant_minimum_permissions.sql`: **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. Hash candidato `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`, sujeito a revisão/aprovação específica. A validação agora falha antes de grants diante de privilégios inesperados; o harness local comprovou bloqueios para ACLs diretas/PUBLIC, membership, ownership, sequences, funções, default ACLs, large objects e falha transacional. Sem autorização/conexão Cloud.


## Gate 3.1 — resultado local

O SQL 01 contém uma allowlist efetiva antes de qualquer GRANT: atributos e expiração exatos, sessão defaults, memberships, ownership, CONNECT a bancos não alvo, ACLs efetivas de database/schema/relação/coluna/sequence/routine/type/large object/foreign server, grant options e default ACLs. Exceção local para `postgres`, `_supabase` e `storage_vectors` está condicionada ao guard do harness; Cloud não recebe essa exceção. USAGE de tipo customizado só bloqueia quando existe ACL explícita; o default PostgreSQL de USAGE para PUBLIC, sozinho, não concede leitura de dados.

Prova local final: 18/18 testes Node, 0 falhas/0 skips; harness PG local 17.6 `LOCAL_METADATA_ONLY_ROLE_TESTS_PASSED`, 11 bloqueios antes de grants, rollback verificado após falha introduzida depois do GRANT, TEMP exclusivamente PUBLIC aceito na fixture e TEMP direto rejeitado. O checker falha com código não zero. As falhas intermediárias foram corrigidas antes da execução final. Não houve conexão Cloud.

Limitações: ACL remota ainda desconhecida; se a role puder conectar por PUBLIC a qualquer banco Cloud fora de `postgres`, o Gate 3 abortará. A transação SERIALIZABLE estreita, mas não elimina totalmente uma corrida com mudanças administrativas externas de ACL. TEMP fora do auditor permanece risco ALTO. Hash atual do SQL 01 é candidato sem aprovação: `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`; hash anterior está substituído e não autorizado.


O candidato anterior do Gate 3.1, hash `f19ab0675df9434413799baf8c7d1c2349280d5a85aa230c638b900c9ec6c386`, também está **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. O hash candidato vigente é `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`; esta revisão não autoriza sua execução remota.
