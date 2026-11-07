# AutoClipe — pacote de aprovação Cloud metadata-only

**Estado: preparação local; aguardando autorização administrativa Cloud.** Nenhuma conexão, SQL remoto, role, grant ou deploy Cloud foi executado.

## Alvo e escopo

Project Ref `djrwfvcxgpyknmizqumn`, projeto principal único do AutoClip. Supabase local `tiktok-saas` é usado apenas para testes. A role temporária audita catálogos visíveis e, se compatível, a coluna `version` do ledger. Não acessa dados de negócio, Auth, OAuth, Storage, mídia, jobs, lotes, agendamentos ou quotas. Edge Functions e Vercel não são verificadas por esta credencial.

Role `autoclip_cloud_auditor`: LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS; CONNECTION LIMIT 1; expiração máxima de 14 dias; defaults `default_transaction_read_only=on`, statement 20s, lock 3s, idle 30s, search_path vazio. Grants: CONNECT em postgres e, se ledger compatível, USAGE em supabase_migrations + SELECT apenas em `version`. Sem grants em negócio, EXECUTE, DDL, escrita persistente, ownership, membership ou alteração de PUBLIC.

## Gate 3.1 — hash substituído e estado atual

O SQL `01_grant_minimum_permissions.sql` foi endurecido localmente para verificar privilégios efetivos, membership, ownership, ACLs/default ACLs, routines, sequences, large objects e conexões a outros bancos antes de conceder qualquer privilégio. A falha aborta com ROLLBACK. Hash atual candidato: `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`. Hash anterior `4db6b51292a8b1a2311979fcd92acba130c4aa34cc9aeaac4be211968ff463c6` está **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. O novo hash também não possui aprovação Cloud. O teste local demonstrou que incompatibilidades fazem o Gate 3 abortar antes do GRANT; o harness fixture isolado permite exceções explícitas somente para bancos locais de plataforma, que não existem na branch Cloud.

## TEMP — risco residual ALTO

Exceção somente após prova de ACL exclusivamente via PUBLIC e opt-in preso ao project ref exato. Grant direto, membership, grant option, ownership ou ACL incerta bloqueiam. Ainda é possível criar objetos temporários fora da ferramenta em outra sessão; READ ONLY do auditor não é uma impossibilidade absoluta de escrita temporária. PUBLIC não será alterado.

## SQLs e hashes atuais

| Arquivo | SHA-256 |
|---|---|
| `scripts/cloud-audit/sql/_guard.psql` | `d3a55368c841eeabea364155e27c7799cb6f3d50042bc867aecaff12607b4347` |
| `scripts/cloud-audit/sql/metadata-only/00_create_role.sql` | `74a7a95cb411b93942df6e386358f25f8e157e979fd6e0600bd48586063adbf4` |
| `scripts/cloud-audit/sql/metadata-only/01_grant_minimum_permissions.sql` | `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796` |
| `scripts/cloud-audit/sql/metadata-only/02_verify_metadata_readonly.sql` | `49d6d2d6a7550f111fa44e762a7474a16dce3071975a65a6c90829c4e53d5637` |
| `scripts/cloud-audit/sql/metadata-only/03_emergency_revoke_metadata_role.sql` | `ef6a8e0365caafa657fc0e5ccbdc8ee4d250bb6ec92e2220ab5ef2f1c519ac17` |
| `scripts/cloud-audit/sql/metadata-only/04_remove_metadata_role.sql` | `08da9cff7023f71b3a9205482a4091f0b45dd57f7472729100fece673f1af4bf` |

SQL byte-exato em `CLOUD_METADATA_ONLY_AUDIT_SCOPE.md`; hash alterado invalida aprovação. Scripts 03/04 são revogação/remoção separadas.

## Destino e segredo

Endpoint esperado: `db.djrwfvcxgpyknmizqumn.supabase.co:5432`, database `postgres`, role dedicada, conexão direta sem pooler, TLS verify-full. A referência informada não prova host; operador deve verificar endpoint/certificado por canal oficial e checar `pg_stat_ssl.ssl=true`. A ferramenta força verificação TLS, remove parâmetros libpq ambiente e rejeita parâmetros de URL.

Gerar segredo em gerenciador aprovado; definir após criação aprovada via prompt interativo `\password autoclip_cloud_auditor`. Nunca em SQL, argv, histórico, VITE, frontend, worker ou logs. O auditor usa passfile temporário 0600 em diretório 0700 e limpa em saída normal; SIGKILL/queda pode deixar resíduo. Não reutilizar service_role. Revogar e limpar após a auditoria.

## Sequência futura e parada

1. Aprovação do Project Ref, operador, janela, autenticação, hashes e operações.
2. Confirmar destino e ausência da role; sem pooler, TLS hostname validado.
3. Executar guard + criação 00; parar e definir senha apenas com autorização específica.
4. Executar grants 01; parar.
5. Verificação 02; qualquer discrepância/erro/saída parcial = NO-GO.
6. Marco C requer autorização separada.
7. Revogação emergencial 03 e remoção 04 têm autorizações distintas.

Ciclo não é atomicamente reversível. Em falha pós-criação, parar. Emergência define NOLOGIN/expiração, revoga grants nomeados e encerra sessões autenticadas da role. Remoção não usa CASCADE/DROP OWNED; falha se houver dependências. Não afeta objetos externos criados por terceiros.

## Evidência local — Marco B.2-A

`node --test scripts/cloud-audit/readonly-audit.test.mjs`: 17 testes aprovados, 0 falhas, 0 skips (reexecutado nesta preparação). `node scripts/cloud-audit/test-readonly-role-local.mjs`: `LOCAL_METADATA_ONLY_ROLE_TESTS_PASSED` em PostgreSQL Supabase local 17.6; ledger presente, RLS, incompatível e ausente; 11 consultas de catálogos; 14 classes sensíveis negadas; grants inesperados, TEMP, revogação da sessão e remoção sem CASCADE exercitados. O JSON confirmou `cloudConnection: false` e remoção da fixture. Isso não prova o ACL ou o host Cloud. A exceção TEMP exclusivamente PUBLIC é risco residual alto. Nenhuma conexão Cloud ocorreu.

## Campos administrativos — todos pendentes

- Operador responsável e identidade administrativa: **PENDENTE**.
- Ferramenta/host de execução: **PENDENTE**.
- Método oficial de autenticação e armazenamento local do segredo: **PENDENTE**.
- Host e porta confirmados pelo proprietário no dashboard Supabase: **PENDENTE** (o host esperado em configuração é `db.djrwfvcxgpyknmizqumn.supabase.co:5432`, não confirmado por conexão).
- Janela e fuso horário: **PENDENTE**.
- Aprovação individual de cada arquivo/hash, inclusive guard: **PENDENTE**.
- Aceite expresso do risco residual TEMP via PUBLIC: **PENDENTE**.

GO para solicitar essas aprovações não é GO para executar. O Marco B.2-B continua bloqueado até que os campos sejam preenchidos e haja autorização específica por operação. Marco C requer autorização separada.

## Marco B.2-B — gates e dados de execução

O operador previsto é Codex no ambiente local do proprietário, mas a identidade operacional final é **PENDENTE**. O cliente disponível é `psql 18.6`; o Supabase local testado usa PostgreSQL 17.6. Host oficial, porta, tipo de conexão, usuário administrativo, CA/TLS efetivo, método de autenticação, janela e fuso estão **PENDENTES**. Não houve verificação de TLS contra Cloud e o host esperado pelo programa não é fonte de verdade.

Execução, se autorizada posteriormente, é dividida em GATE 0 (preflight apenas), GATE 1 (somente 00), GATE 2 (senha interativa separada), GATE 3 (somente 01) e GATE 4 (somente 02); uma autorização nova é necessária após cada saída. Marco C não é incluído. A sequência, parada, recuperação e evidências estão em [CLOUD_B2B_EXECUTION_AUTHORIZATION.md](CLOUD_B2B_EXECUTION_AUTHORIZATION.md). SQLs completos: [CLOUD_METADATA_ONLY_AUDIT_SCOPE.md](CLOUD_METADATA_ONLY_AUDIT_SCOPE.md). Scripts 03 e 04 são revogação/remoção separadas, não autorizadas.

**NO-GO para execução neste momento:** dados de operador/destino/janela e aprovações específicas ainda não foram fornecidos, e o risco TEMP alto precisa de aceite expresso antes de criar role. Nenhuma operação remota está autorizada.

### Evidência final Marco B.1

16/16 testes unitários da ferramenta passaram sem skips. O harness local PostgreSQL 17.6 passou com login TCP real, TEMP exclusivamente PUBLIC, RLS/incompatibilidade/ausência do ledger sem grant, 14 classes de negação, SQL verifier fail-closed, sessão ativa revogada e remoção bloqueada por dependência. Houve falhas intermediárias durante atualização de expectativas e do teste de sessão; foram corrigidas e reexecutadas. Nenhuma conexão Cloud ocorreu.


## Gate 3.1 — execução local revalidada

O hash anterior `4db6b51292a8b1a2311979fcd92acba130c4aa34cc9aeaac4be211968ff463c6` de `01_grant_minimum_permissions.sql` está **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. Candidato local atual: `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`; não aprovado para Cloud. A suíte Node passou em 18/18, zero falhas, zero skips. O harness PostgreSQL local passou em PG 17.6 e comprovou 15 situações pre-GRANT bloqueadas, mais reexecução com grants allowlisted preexistentes e rollback após falha sintética posterior ao primeiro GRANT; 30 cenários negativos registrados no JSON. O teste explícito da branch Cloud estrita bloqueou CONNECT herdado de PUBLIC a bancos fora do alvo. A fixture só permite exceção para quatro bases internas na branch isolada local, e apenas para privilégios herdados compatíveis com a ACL não grantable; essa exceção não existe na execução Cloud. Houve falhas intermediárias no escape do harness, na verificação de transação e na sincronização inicial do bloco SQL/hash da documentação; foram corrigidas e os testes finais foram repetidos.

Precheck e grants ficam na mesma transação `SERIALIZABLE`, mas isso é uma checagem pontual e não uma garantia permanente contra administradores concorrentes. Após qualquer falha/saída indeterminada: parar e inspecionar manualmente; não repetir nem conceder manualmente. TEMP via PUBLIC continua risco ALTO. Nenhuma conexão Cloud ocorreu.


O candidato anterior do Gate 3.1, hash `f19ab0675df9434413799baf8c7d1c2349280d5a85aa230c638b900c9ec6c386`, também está **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. O hash candidato vigente é `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`; esta revisão não autoriza sua execução remota.
