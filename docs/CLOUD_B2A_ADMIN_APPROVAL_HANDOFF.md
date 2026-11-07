# AutoClipe — handoff administrativo Cloud B.2-A

**Status:** preparação local; nenhuma conexão Cloud ou operação remota foi executada.

## Alvo confirmado e campos pendentes

- Project Ref: `djrwfvcxgpyknmizqumn` (projeto principal único do AutoClipe).
- Database: `postgres`.
- Role temporária: `autoclip_cloud_auditor`.
- Operador responsável: **PENDENTE**.
- Ferramenta e host de execução: **PENDENTE**.
- Método de autenticação administrativa: **PENDENTE**; deverá ser oficial e aprovado, sem senha em URL/argv/histórico.
- Host e porta confirmados pelo proprietário no painel oficial: **PENDENTE** (endpoint esperado pelo cliente auditador: `db.djrwfvcxgpyknmizqumn.supabase.co:5432`; não é confirmação independente do destino).
- Janela, data e fuso horário: **PENDENTE**.
- Autorização por arquivo/hash e aceite expresso do risco TEMP: **PENDENTE**.

## Escopo a aprovar

Execução futura, em ações separadas, dos arquivos `00_create_role.sql`, definição interativa de senha mediante autorização própria, `01_grant_minimum_permissions.sql` e `02_verify_metadata_readonly.sql`. A execução para após a verificação. O auditor metadata-only lê catálogos visíveis e, somente se compatível e concedido, a coluna `version` do ledger. Ele não lê linhas de negócio, Auth, Storage, jobs, quotas ou dados de workspace. Marco C exige autorização independente.

## SQLs e hashes SHA-256 atuais

| Arquivo | SHA-256 | Finalidade/impacto |
|---|---|---|
| `scripts/cloud-audit/sql/_guard.psql` | `d3a55368c841eeabea364155e27c7799cb6f3d50042bc867aecaff12607b4347` | Guard de parâmetros/ref/database real e allowlist do nome de role; não autentica nem prova o servidor. |
| `scripts/cloud-audit/sql/metadata-only/00_create_role.sql` | `74a7a95cb411b93942df6e386358f25f8e157e979fd6e0600bd48586063adbf4` | Cria uma role marcada, login sem poderes administrativos, defaults restritos e validade <=14 dias. |
| `scripts/cloud-audit/sql/metadata-only/01_grant_minimum_permissions.sql` | `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796` | CONNECT; condicionalmente USAGE no schema e SELECT(version) do ledger compatível sem RLS. |
| `scripts/cloud-audit/sql/metadata-only/02_verify_metadata_readonly.sql` | `49d6d2d6a7550f111fa44e762a7474a16dce3071975a65a6c90829c4e53d5637` | Verificação de privilégios em transação READ ONLY, com falha não zero em condição perigosa. |
| `scripts/cloud-audit/sql/metadata-only/03_emergency_revoke_metadata_role.sql` | `ef6a8e0365caafa657fc0e5ccbdc8ee4d250bb6ec92e2220ab5ef2f1c519ac17` | NOLOGIN, expiração, revoga somente grants nomeados e encerra sessões da role; autorização separada. |
| `scripts/cloud-audit/sql/metadata-only/04_remove_metadata_role.sql` | `08da9cff7023f71b3a9205482a4091f0b45dd57f7472729100fece673f1af4bf` | DROP ROLE sem CASCADE após pré-condições; autorização separada. |

Os SQLs completos e byte-exatos estão em [CLOUD_METADATA_ONLY_AUDIT_SCOPE.md](CLOUD_METADATA_ONLY_AUDIT_SCOPE.md). Estes hashes foram recalculados nesta revisão e correspondem aos valores de referência do Marco B.1. Qualquer mudança invalida aprovação anterior.

## Privilégios e riscos residuais

A role proposta é LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, connection limit 1, validade máxima de 14 dias, read-only por default, timeouts limitados e `search_path` vazio. Sem membership, ownership, DDL, escrita persistente, funções de negócio, grants amplos ou acesso a tabelas de negócio.

**TEMP via PUBLIC: risco ALTO residual.** Somente será tolerado se a ACL efetiva provar que a origem é exclusivamente PUBLIC, sem grant direto/herdado, grant option ou ownership, com opt-in ligado ao Project Ref exato. Ainda permite objetos temporários fora da ferramenta; o programa roda consultas em transações READ ONLY, mas isso não elimina o risco fora do programa. Não revogar TEMP globalmente.

Catálogos podem expor nomes e definições internas; relatórios devem ser minimizados e protegidos localmente. O estado real do Cloud, ACL, versão, host e compatibilidade do ledger continuam **NÃO VERIFICADOS**. O Project Ref é o único ambiente Cloud principal, portanto qualquer anomalia é critério de parada.

## Execução futura e pontos de parada

1. Operador autorizado confirma host, porta, database, usuário e certificado/hostname TLS via painel oficial; usar conexão direta, sem pooler, `verify-full`; conferir `current_database`, `current_user` e `pg_stat_ssl.ssl=true`.
2. Comparar os seis hashes imediatamente antes; aprovação identifica cada arquivo/hash e ação. Se algum divergir, parar.
3. Executar apenas guard + `00_create_role.sql`; role preexistente ou incompatibilidade = parar.
4. Mediante autorização separada, definir senha forte interativamente com `\password autoclip_cloud_auditor`; manter no gerenciador local aprovado. Nunca senha em SQL, argv, URL, shell history, log, `VITE_*`, frontend ou worker.
5. Executar apenas `01_grant_minimum_permissions.sql`; qualquer grant ou ledger inesperado = parar.
6. Executar `02_verify_metadata_readonly.sql`; qualquer falha, resultado parcial ou TEMP fora da exceção = parar. Não iniciar Marco C.
7. Após auditoria e aprovação separada: emergência `03`; remoção `04` com aprovação distinta. Não usar DROP CASCADE/DROP OWNED.

Autenticação administrativa para o Marco B.2-B, ferramenta/host, operador, janela e método de armazenamento de segredo são todos PENDENTES; este documento não substitui aprovação explícita.

## Evidências locais desta preparação

- Ferramenta: `node --test scripts/cloud-audit/readonly-audit.test.mjs` — **17 aprovados, 0 falhas, 0 skips**.
- Harness PostgreSQL Supabase local isolado: `LOCAL_METADATA_ONLY_ROLE_TESTS_PASSED`, PostgreSQL 17.6 (server_version_num 170006), leitura do ledger e 11 consultas de metadados, 14 classes de acesso indevido negadas, SQL verifier fail-closed, criação duplicada e marcador incorreto negados, ledger protegido/incompatível/ausente tratado sem grant, revogação de sessão e remoção sem CASCADE verificadas; role/database fixtures removidas pelo harness. O resultado não prova o estado Cloud.
- `git diff --check`: aprovado após as atualizações desta documentação.
- Cloud: **nenhuma conexão, SQL, criação de role, grant, senha, migration ou alteração executada**.

## Autorização ainda necessária

Uma aprovação futura deve indicar: Project Ref; arquivos e hashes aprovados individualmente; ação autorizada (criação, senha e grants separadamente); operador; método oficial de autenticação; origem e confirmação do host; janela/fuso; aceite explícito do risco TEMP; critérios de parada; autoridade e momento para revogação. A aprovação para criar a role não autoriza a auditoria Marco C, e nenhuma autorização aqui concede permissão para deploy ou operação de negócio.


Hash anterior `4db6b51292a8b1a2311979fcd92acba130c4aa34cc9aeaac4be211968ff463c6` de `01_grant_minimum_permissions.sql` está **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**.


O candidato anterior do Gate 3.1, hash `f19ab0675df9434413799baf8c7d1c2349280d5a85aa230c638b900c9ec6c386`, também está **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. O hash candidato vigente é `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`; esta revisão não autoriza sua execução remota.


Atualização posterior: o hash de Gate 3.1 `f19ab0675df9434413799baf8c7d1c2349280d5a85aa230c638b900c9ec6c386` está substituído e não autorizado; hash candidato atual `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796` requer aprovação individual.
