# AutoClipe — decisão local GO/NO-GO para auditoria metadata-only

**Estado: NO-GO para conexão Cloud até aprovação administrativa específica.** Este Marco B.1 prepara o pacote e não autoriza a execução. Nenhum contato Cloud foi feito.

## Escopo

Project Ref lógico: `djrwfvcxgpyknmizqumn`. A auditoria disponível é PostgreSQL metadata-only: catálogos visíveis e, se concedido, somente `version` do migration ledger. Dados operacionais, pessoais, OAuth, Storage, jobs, quotas, schedules, Auth administrativa, Edge Functions e Vercel permanecem fora ou não verificados.

Não implantar `inventory_summary()`, schema `autoclip_audit`, SECURITY DEFINER, broker, grants a tabelas de negócio ou mudanças globais em PUBLIC.

## Critérios GO

- Aprovação explícita por arquivo, SHA-256 e operação; operador, janela e método de autenticação nomeados.
- Alvo confirmado pelo canal oficial com direct host `db.djrwfvcxgpyknmizqumn.supabase.co:5432`, database `postgres`, certificado TLS/hostname verificado, identidade e `pg_stat_ssl.ssl=true`; sem pooler.
- Role ausente antes da criação; senha criada separadamente com prompt interativo e armazenada em secret manager aprovado.
- Grants limitados a CONNECT e, quando compatível, USAGE + SELECT(version) do ledger.
- Verificação fail-closed passa em todas as condições, sem memberships, ownership, grants inesperados, acesso a funções, escrita, grant option, defaults, ACL incerta ou TEMP além da exceção pública aprovada.
- Saída sem segredo; relatório local protegido.
- Marco C recebe autorização separada.

## Critérios NO-GO / parada

- Host, Project Ref, usuário, database ou TLS divergente/ambíguo.
- Hash diferente ou script fora da allowlist aprovada.
- Role preexistente, marcador incorreto, privilégio efetivo inesperado, grant não listado.
- TEMP direto/herdado por outra role, grant option, ownership, inconsistência.
- Ledger incompatível/inacessível deve ser `NOT VERIFIED`, sem ampliar grants.
- Erro, timeout, sessão interrompida ou resultado parcial.
- Pedido para executar migration, leitura de negócio, Storage, Auth, Edge Function, Vercel ou função da aplicação.

## Destino e credenciais

O Project Ref textual e `_guard.psql` não provam o destino. Usar endpoint oficial direto, `verify-full`, validar hostname/certificado fora da sessão e conferir user/database/SSL. Poolers recusados. A ferramenta fixa o host para o ref, porta 5432, role dedicada e rejeita query parameters.

Gerar senha forte em gerenciador aprovado. Definir via `\\password autoclip_cloud_auditor` interativo, sem senha em SQL, argumentos, histórico ou logs. Nunca usar service_role; não compartilhar com worker/frontend. Passfile efêmero: diretório 0700, arquivo 0600. Interrupção abrupta pode deixar arquivo; limpeza deve olhar apenas o prefixo da ferramenta sem ler/mostrar o conteúdo.

## Execução administrativa futura

1. Criar role via `00_create_role.sql`; transação isolada.
2. Definir senha em operação separada autorizada.
3. Conceder grants com `01_grant_minimum_permissions.sql` em transação distinta.
4. Executar `02_verify_metadata_readonly.sql`; qualquer bloqueio aborta a auditoria.
5. Parar. Marco C exige autorização nova.
6. Em emergência, `03_emergency_revoke_metadata_role.sql` define NOLOGIN/expiração, revoga grants nomeados e termina sessões autenticadas pela role.
7. `04_remove_metadata_role.sql` remove somente depois da emergência, sem CASCADE; qualquer dependência aborta.

## TEMP residual

Risco residual **ALTO**: se o servidor concede TEMP a PUBLIC, a credencial pode criar objetos temporários em uma sessão fora do programa. A ferramenta permite somente origem comprovada em PUBLIC com opt-in exato; suas consultas são READ ONLY. Não revogar TEMP globalmente.

## Evidência local e limites

Testes automatizados da ferramenta e teste PostgreSQL local isolado verificam role/grants, leitura do ledger e metadados, negações de escrita/DDL/dados sensíveis, TEMP, privilégios inesperados e revogação. PostgreSQL local não prova configuração Cloud, ACL, TLS Cloud, recursos administrativos nem aplicação remota. Esta documentação não equivale a autorização.

**Decisão:** apto a solicitar aprovação administrativa, mas NO-GO para execução Cloud. Aprovação para criar a role não autoriza Marco C.

## Marco B.2-A — decisão atual

### GO para solicitar autorização

- SQLs e guard existem e foram revisados localmente.
- Seis SHA-256 recalculados correspondem exatamente aos hashes de referência do Marco B.1.
- Suíte da ferramenta reexecutada: 17 aprovados, 0 falhas, 0 skips.
- Harness Supabase local isolado reexecutado em PostgreSQL 17.6: `LOCAL_METADATA_ONLY_ROLE_TESTS_PASSED`; ledger/11 consultas de catálogos, 14 classes negativas, TEMP, grants e revogação testados. Ver `CLOUD_B2A_ADMIN_APPROVAL_HANDOFF.md`.
- A revogação emergencial e a remoção sem CASCADE estão separadas e testadas localmente.
- O risco TEMP residual alto está explicitado.

### NO-GO para execução Cloud

Continuam pendentes: operador e ambiente de execução; método administrativo oficial; host e porta copiados pelo proprietário do painel; janela/fuso; aprovação individual de hashes e operações; senha e mecanismo aprovado de armazenamento; aceite expresso do risco TEMP. Não existe autorização para B.2-B ou Marco C nesta execução. Não houve conexão Cloud.

### Critério de parada

Qualquer hash divergente, endpoint diferente do confirmado oficialmente, TLS/certificado/hostname inválido, database/identidade incorretos, role preexistente, incompatibilidade do ledger, ACL inesperada, privilégio fora da allowlist, saída parcial ou falha interrompe o procedimento. Não elevar privilégios nem improvisar SQL para contornar falhas.

## B.2-B — gates independentes

- **GATE 0:** conexão administrativa de preflight com aprovação contendo Project Ref, host/porta copiados do painel, database, operador, janela, autenticação e finalidade. Não autoriza mutação.
- **GATE 1:** aprovação individual do SHA-256 de 00; criação somente.
- **GATE 2:** aprovação separada para definir senha interativamente; segredo não deve ser enviado ao Codex em texto.
- **GATE 3:** aprovação individual do SHA-256 de 01; grants mínimos apenas.
- **GATE 4:** aprovação individual do SHA-256 de 02; verificação read-only e encerramento. Marco C requer outra autorização.

No estado atual, estes campos permanecem pendentes: operador final e ferramenta/host de execução; host e porta confirmados pelo painel Supabase; tipo de conexão; usuário administrativo; método e armazenamento de credencial; cadeia CA/TLS disponível; janela/data/fuso; hashes/ações aprovados individualmente; aceite expresso de TEMP. Portanto, preparação local concluída não é GO para conectar nem executar qualquer gate. Ver ficha completa em `CLOUD_B2B_EXECUTION_AUTHORIZATION.md`.

## Registro de testes Marco B.1 (local)

- Auditor da ferramenta: 16 testes aprovados, 0 falhas, 0 skips.
- Harness de role: PostgreSQL Supabase local 17.6; role autenticada por TCP com fixture exclusiva; catálogo allowlisted e ledger version-only.
- Ledger com RLS/FORCE RLS, schema/tabela ausentes e tipo incompatível: nenhum grant de leitura concedido; resultado não é tratado como completo.
- 14 categorias de privilégios/leituras indevidas negadas; verifier SQL encerra com status não zero para condições proibidas.
- Role preexistente e marcador incorreto rejeitados; sessão real encerrada pela revogação emergencial; remoção definitiva recusada quando havia dependência e concluída após sua limpeza.
- Fixtures da execução removidas. Também foram encontrados artefatos locais de testes anteriores com o prefixo exato do harness; somente após confirmar marcador sintético, ausência de memberships/ownership/grants/sessões, as dez roles órfãs e uma base contendo apenas `auth.users`, `public.business_fixture`, `public.oauth_tokens` foram removidas localmente sem CASCADE. A verificação final encontrou zero roles/database desse conjunto.
- `git diff --check`: aprovado. Nenhum acesso Cloud.

Houve falhas intermediárias nos testes da revisão: uma expectativa unitária ainda listava o script de revogação antigo, outra regex confundia o comentário “sem CASCADE” com o comando SQL, e um teste inicial usava `SET SESSION AUTHORIZATION` sob `supabase_admin`, o que não comprovava revogação pela identidade autenticada. As expectativas foram corrigidas, e o harness passou a fazer login TCP real com segredo aleatório local em passfile temporário. A execução final passou.


### Atualização Gate 3.1

Hash anterior `4db6b51292a8b1a2311979fcd92acba130c4aa34cc9aeaac4be211968ff463c6` de `01_grant_minimum_permissions.sql`: **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. Hash candidato `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`, sujeito a revisão/aprovação específica. A validação agora falha antes de grants diante de privilégios inesperados; o harness local comprovou bloqueios para ACLs diretas/PUBLIC, membership, ownership, sequences, funções, default ACLs, large objects e falha transacional. Sem autorização/conexão Cloud.


## Gate 3.1 — status de revisão local

A variante atual de `01_grant_minimum_permissions.sql` é somente **candidata a revisão**: `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`. O hash anterior `4db6b51292a8b1a2311979fcd92acba130c4aa34cc9aeaac4be211968ff463c6` está **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. Testes finais locais: Node 18/18; harness Supabase PostgreSQL 17.6 passou, incluindo 15 bloqueios pré-GRANT, conexão a bancos não alvo na branch Cloud simulada, e rollback pós-GRANT induzido. Nenhum acesso Cloud ocorreu.

Isso não é autorização para Gate 3. Cloud ACL e memberships continuam não verificadas. Caso a role herde CONNECT via PUBLIC a bancos além de `postgres`, a versão atual falhará fechada. A verificação é pontual; concorrência de alterações administrativas externas ainda é risco. TEMP exclusivamente via PUBLIC continua risco residual ALTO.


O candidato anterior do Gate 3.1, hash `f19ab0675df9434413799baf8c7d1c2349280d5a85aa230c638b900c9ec6c386`, também está **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. O hash candidato vigente é `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`; esta revisão não autoriza sua execução remota.
