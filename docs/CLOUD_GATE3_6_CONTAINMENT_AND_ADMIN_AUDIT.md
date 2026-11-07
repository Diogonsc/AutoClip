# Gate 3.6 — contenção da role e auditoria administrativa controlada

> **Nota de versão:** o conteúdo original deste documento registra o estado de preparação dos Gates 3.6–3.9 e é preservado como histórico. A seção “Encerramento Gate 3.11” ao final substitui os estados operacionais antigos. A contenção foi depois executada pelo proprietário; remoção e auditoria Cloud completa continuam pendentes.

**Estado histórico no Gate 3.6:** preparação local, sem conexão ou consulta Cloud naquele gate.

## Parecer sobre a role existente

O Gate 3 terminou com `ROLLBACK`, o que impede concluir que os grants daquele script foram aplicados. Isso **não** remove a role criada no Gate 1, não apaga a senha definida no Gate 2 e não elimina privilégios herdados de `PUBLIC`. O diagnóstico anterior mostrou privilégios públicos sobre objetos de `net`/pg_net, inclusive relações e rotinas; portanto, a role pode conservar capacidade operacional caso `LOGIN` esteja ativo e a credencial ainda seja válida. Estado atual de LOGIN, validade, memberships, dependências, grants e sessões não foi consultado nesta etapa.

Recomendação operacional: autorizar primeiro um diagnóstico read-only do estado e, dada a superfície reportada, considerar em autorização separada a desativação de novos logins e a terminação das sessões da role. Isso não muda `PUBLIC` nem revoga ACLs de extensões; impede autenticações futuras e encerra sessões observadas, se o operador possuir permissão. Não executar automaticamente.

## Scripts preparados

**Mapeamento de guard:** `00_role_containment_diagnostic.sql` usa `\ir _guard.psql`, que resolve para o arquivo irmão `scripts/cloud-audit/admin-readonly/_guard.psql` (SHA-256 `9a326bf4cda77395c9ea7cbb65aadb55fb6a7e72b4c6ed394df40280331cad9f`). O arquivo legado `scripts/cloud-audit/sql/_guard.psql` tem SHA-256 `d3a55368c841eeabea364155e27c7799cb6f3d50042bc867aecaff12607b4347` e é usado por outra sequência; não é incluído pelo diagnóstico de contenção.

| Arquivo | Natureza | Efeito |
|---|---|---|
| `scripts/cloud-audit/admin-readonly/00_role_containment_diagnostic.sql` | Read-only | Informa atributos, validade, defaults, membership nas duas direções, dependências compartilhadas e sessões sem SQL, IP ou `application_name`. |
| `scripts/cloud-audit/admin-readonly/10_catalog_inventory.sql` | Read-only | Consulta catálogos para schemas, relações/colunas/ACL, constraints, índices, triggers, RLS/policies, funções sem corpo, membership, dependências de extensão e metadados estruturais de `cron`, `net` e `storage`. Lê apenas valores `version` do ledger quando compatível e sem RLS/FORCE RLS. |
| `scripts/cloud-audit/admin-readonly/20_removal_preflight.sql` | Read-only | Verifica pré-condições, dependências e memberships em ambas as direções antes de eventual remoção separadamente autorizada. |
| `scripts/cloud-audit/admin-readonly/30_disable_role_and_terminate_sessions.sql` | **Mutável, não autorizado** | Altera somente `autoclip_cloud_auditor` para NOLOGIN/expirada; após commit tenta terminar sessões cujo `usename` autenticado corresponde à role. Não revoga grants nem altera PUBLIC. |
| `scripts/cloud-audit/admin-readonly/31_disable_role_nologin.sql` | **Mutável, não autorizado** | Proposta NOLOGIN separada; valida identidade, estado, membership/dependências/sessões, altera somente `rolcanlogin` e verifica o estado persistido. Não termina sessões. |
| `scripts/cloud-audit/admin-readonly/README.md` | Procedimento | Limites, comando futuro e tratamento de falhas. |
| `scripts/cloud-audit/admin-readonly/admin-readonly.test.mjs` | Testes locais estáticos | Verifica guard, escopo, privilégios cobertos e ausência de escrita nos scripts read-only. |

### SHA-256 dos artefatos preparados

| Arquivo | SHA-256 | Classificação |
|---|---|---|
| `scripts/cloud-audit/admin-readonly/_guard.psql` | `9a326bf4cda77395c9ea7cbb65aadb55fb6a7e72b4c6ed394df40280331cad9f` | Guard de preflight; não altera banco. |
| `scripts/cloud-audit/admin-readonly/00_role_containment_diagnostic.sql` | `86eb075d1a3f6be08ed704e2518b352d6cf9320449321c2eab3658533788044c` | Read-only. |
| `scripts/cloud-audit/admin-readonly/10_catalog_inventory.sql` | `2ba9bb842f1ecd50f1f1bbc40c6ee3227533b00922ad996e2e39119f5b813fd9` | Read-only; inclui exclusivamente `version` do ledger sob gate. |
| `scripts/cloud-audit/admin-readonly/20_removal_preflight.sql` | `3b7c98186c525869717190fd837bb92237b167c55a61732a3fa509da540ba802` | Read-only. |
| `scripts/cloud-audit/admin-readonly/30_disable_role_and_terminate_sessions.sql` | `60c26431c343ddad94daf58c6bac87f4fd6c6ee8790fd3ecea6131db667bc529` | **Mutável; autorização independente obrigatória.** |
| `scripts/cloud-audit/admin-readonly/31_disable_role_nologin.sql` | `335997ae505ebb3d2f58d63ccddb03fcb5488ba18ae94933cbc0fe0278700707` | **Hash corrigido no Gate 3.10.2; o hash anterior `ca814bf5e968f0212fef1af5c0b61dba765be62579af02e967b953115a404550` está substituído e não deve ser executado. Mutável, não autorizado.** |
| `scripts/cloud-audit/admin-readonly/README.md` | `772330d5935920a68eb9414be47a2d61883e1e17fb78c2815dbd590624ccb9c6` | Procedimento; traps, validação JSON e resumo sanitizado corrigidos. |
| `scripts/cloud-audit/admin-readonly/admin-readonly.test.mjs` | `c2ef8a881754d18d0a4e9b1e2174fcf8eed041880b79443f90c4b80aaf521fb8` | Testes estáticos locais. |
| `scripts/cloud-audit/admin-readonly/shell-command.test.mjs` | `a9b09cc23a4a457217c6363937ec491d838935ce5aa5eceddb95d4fe21251410` | Testes de shell com mocks; nenhuma conexão. |
| `scripts/cloud-audit/test-admin-readonly-local.mjs` | `b7fd8bd5cb0567dedde1b724263d8059a7ae13b3645e26144c8506a00b4f5a2a` | Harness PostgreSQL local isolado; não é script Cloud. |

**Atualização Gate 3.7:** o guard agora possui SHA-256 `9a326bf4cda77395c9ea7cbb65aadb55fb6a7e72b4c6ed394df40280331cad9f`; o teste estático possui `c834106fa2bc966380aedaad288ad37422d46e66dee89adbb996f6d67d02d20b`; e o harness local possui `cb3b04eccd580f8e3a28a808618f43bc00b9eb00feb10081f85ad8b991fe35f2`. A revisão Gate 3.7 descobriu que o `psql` disponível ignora argumento numérico em `\\quit`; guard e script de contenção passaram a causar erro SQL sob `ON_ERROR_STOP`, garantindo status não zero. A ramificação local foi testada somente em database descartável/socket Unix. As versões anteriores desses hashes estão substituídas e não devem ser usadas para execução.

O script existente `03_emergency_revoke_metadata_role.sql` também desativa a role, mas vai além: revoga CONNECT direto e grants diretos no ledger antes de encerrar sessões. O novo script de contenção é uma proposta mais estreita, apenas NOLOGIN/expiração e encerramento de sessões. Não executar um deles como substituto do outro sem aprovação exata. O script `04_remove_metadata_role.sql` usa `DROP ROLE` sem `CASCADE`, o que faz PostgreSQL abortar se dependências persistirem. Seu precheck original só seleciona memberships em que a role é membro; o novo preflight verifica ambas as direções. Mesmo sem o preflight, `DROP ROLE` sem CASCADE não remove dependências implicitamente, mas a execução pode falhar e exigir inspeção.

### Falha parcial da contenção

`ALTER ROLE ... NOLOGIN VALID UNTIL 'epoch'` é commitado antes da tentativa de terminar sessões. Se `pg_terminate_backend` retornar falso ou houver desconexão depois do commit, novos logins ficam bloqueados, mas sessões abertas podem continuar. A saída não deve ser interpretada como contenção completa. Interromper, executar um diagnóstico read-only autorizado e pedir autorização específica para recuperação; não repetir a ação automaticamente.

## Escopo da auditoria administrativa

As consultas read-only abrangem catálogos, não conteúdo de tabelas operacionais. O inventário lista ACLs de relações e sequências incluindo privilégios expostos pelo PostgreSQL 17, inclusive `MAINTAIN`; ACLs de databases, schemas, colunas, funções, tipos e large objects; memberships em ambas as direções; RLS e policies; propriedades `SECURITY DEFINER`, `proconfig`/search_path e grants de EXECUTE; dependências de extensões; e estrutura dos schemas `cron`, `net` e `storage`. Corpos de funções não são selecionados nem executados.

O único dado não-catalogado permitido é `version` no ledger `supabase_migrations.schema_migrations`, após verificar forma da relação, tipo text e RLS/FORCE RLS desligados. Se falhar qualquer condição, a seção é `NOT VERIFIED` e nenhuma linha do ledger é lida.

Não são consultadas linhas de `cron.job`, `cron.job_run_details`, `net.http_request_queue`, `net._http_response`, `storage.buckets`, `storage.objects`, tabelas do AutoClipe, jobs, quotas, reservas, Auth, tokens ou agendas individuais. Metadados de bucket/filas por linha são dados operacionais e requerem autorização/especificação separada. Não há acesso a arquivos Storage nem URLs assinadas.

Expressões de policies, definições de constraints/índices/triggers e nomes internos podem ser sensíveis como informação de implementação. As saídas devem permanecer em arquivo local mode 0600, ser revisadas e minimizadas antes de compartilhamento.

## Guard e execução pessoal futura

O guard verifica aprovação explícita, Project Ref, database, role, `current_user`/`session_user` `postgres`, database efetivo, `application_name` fixo e TLS ativo observado por `pg_stat_ssl`. O cliente libpq deve, adicionalmente, exigir `sslmode=verify-full` e o CA oficial: a consulta SQL prova que SSL está ativo, não que a cadeia/hostname foi validada. Não trocar endpoint, pooler ou modo TLS diante de erro.

O comando de diagnóstico pessoal com validação JSON, handlers de sinal e remoção de saída parcial está mantido no [README operacional do pacote](../scripts/cloud-audit/admin-readonly/README.md). Use somente esse comando revisado; este documento não mantém uma cópia divergente. Ele solicita senha interativamente, usa conninfo Direct com `sslmode=verify-full`, CA absoluto e `ON_ERROR_STOP=1`. Cada arquivo read-only requer autorização e execução próprias. O comando do diagnóstico não autoriza auditoria de catálogo, desativação ou remoção.

## Gates e autorizações separadas

| Gate | Objetivo | Aprovação requerida | Parada |
|---|---|---|---|
| 0 — escolha e preflight | Confirmar endpoint, operador, janela, TLS e escopo do script | Projeto, host/porta, operador, janela, CA e arquivo/hash | Host/certificado/guard divergente. |
| 1 — estado role | Executar `00_role_containment_diagnostic.sql` | Consulta read-only e saída local protegida | Role ausente, marker inesperado, membership/grant/dependência inexplicada ou sessão presente. |
| 2 — decisão de contenção | Decidir se desativa logins/termina sessões | Aprovação específica do `30_disable_role_and_terminate_sessions.sql` e hash | Qualquer condição inesperada; sem repetição automática. |
| 3 — auditoria de catálogos | Executar `10_catalog_inventory.sql` | Escopo de catálogos, ledger e retenção de saída | Timeout, incompatibilidade, RLS inesperada, falha parcial; marcar não verificado. |
| 4 — análise | Comparar evidências e separar catálogo de dados operacionais | Aprovação do relatório/compartilhamento | Qualquer pedido de leitura operacional exige novo escopo. |
| 5 — remoção preflight | Executar `20_removal_preflight.sql` | Consulta read-only | Qualquer dependência, membership ou sessão. |
| 6 — remoção definitiva | Executar o script de remoção sem CASCADE, se aprovado | Aprovação específica do arquivo/hash e estado observado | DROP falha: parar e não usar CASCADE. |
| 7 — homologação | Testes integrados do AutoClip | Autorização de ambiente piloto, separada | Auditoria de metadados não libera usuários. |

## Riscos residuais

| Risco | Nível | Situação/mitigação |
|---|---|---|
| Role LOGIN ainda pode herdar PUBLIC | Alto no Gate 3.9; contido para novos logins | Gate 3.9 confirmou `can_login=true` e `TEMP=true`. O diagnóstico independente após a execução Gate 3.10 confirmou `can_login=false`, `active_session_count=0`; a role não foi removida e `TEMP=true` permanece. |
| pg_net público reportado | Alto | Não chamar funções nem consultar filas/respostas. Role não deve ser usada para auditoria. Contenção de login não revoga ACL global de PUBLIC. |
| Sessão já aberta | Alto até verificação | Diagnosticar sessões por `usename`; terminação requer autorização e poder administrativo. `application_name` não identifica sessão com segurança. |
| Dependências na remoção | Médio/alto | Preflight ambos os sentidos e `DROP ROLE` sem CASCADE; qualquer dependência bloqueia. |
| Risco de output | Médio | Arquivos mode 0600; catálogo pode revelar arquitetura, expressões de policies e nomes. |
| Auditoria administrativa | Alto | Conta postgres possui poder amplo. Mitigar com revisão byte/hash, terminal privado, TLS verify-full, transações read-only, queries estáticas/timeouts, saída protegida e encerramento. |
| Metadados operacionais não lidos | Limitação | Buckets, rows de fila/jobs, quotas e agendamentos ficam NOT VERIFIED; requerem autorização separada. |
| Compatibilidade Cloud | Limitação | SQL preparado para PG17, mas não executado nesta etapa nem testado contra catálogo Cloud real. |

## Parada e recuperação

- **TLS/host/autenticação/guard falham:** interromper; não trocar host, pooler, CA ou TLS; preservar erro sem segredos.
- **Diagnóstico parcial ou timeout:** marcar seções faltantes como NÃO VERIFICADAS; não inferir inexistência.
- **Contenção commitada, terminação falha:** não repetir; NOLOGIN permanece, sessões podem continuar; diagnosticar e pedir nova autorização.
- **Remoção preflight tem dependência:** não executar DROP.
- **DROP sem CASCADE falha:** transação abortada; manter role, investigar dependência com leitura autorizada; nunca tentar CASCADE.
- **Qualquer alteração inesperada:** parar e abrir revisão de incidente; não executar rollback/revogação improvisada.

## Estado histórico desta fase (Gate 3.6)

Somente preparação local. Nenhuma conexão Cloud, consulta remota, alteração de role/grant, revogação, remoção, migration, alteração em PUBLIC, Storage, Auth ou RLS foi realizada.

### Gate 3.9.1 — interpretação de sessões

O resultado informado pelo proprietário contém `active_session_count=0`, mas o jq usado no resumo produziu um agrupamento artificial `unknown: 1`: o fallback `// "unknown"` aplicado a um gerador vazio gerou um elemento quando a lista era vazia. O resumo corrigido normaliza com `(.active_sessions // []) | map(...)`; lista vazia permanece vazia. O SQL constrói a lista e a contagem com o mesmo filtro, portanto a evidência apresentada é consistente com zero sessões, não com uma sessão desconhecida.

### Gate 3.10 — contenção NOLOGIN preparada

`31_disable_role_nologin.sql` requer a role marcada e com estado compatível com Gate 3.9, privilégios administrativos desligados, limite de conexão e expiração observados, somente a membership conhecida `postgres` membro da auditora (ADMIN true, INHERIT/SET false), nenhuma membership concedendo outra role à auditora, nenhuma dependência compartilhada e nenhuma sessão ativa. Ele bloqueia qualquer divergência, aplica somente `ALTER ROLE ... NOLOGIN` dentro da transação, e faz verificação read-only independente após o commit. Não altera a validade, grants ou sessões. Em falha pós-commit, NOLOGIN pode estar aplicado: parar e reconciliar com o diagnóstico, sem repetição automática.

Os testes locais verificaram marcador divergente, atributo CREATEDB inesperado, validade e limite de conexão divergentes, membership adicional, dependência ACL, estado ausente após remoção, estado compatível, repetição idempotente, falha SQL injetada após ALTER (rollback antes de COMMIT), falha pós-COMMIT, falha da verificação persistida e que apenas `rolcanlogin` mudou. No PostgreSQL local 17.6, o harness autenticou uma conexão TCP real como role fixture e confirmou que a sessão observada em `pg_stat_activity` bloqueia a operação antes de ALTER. Depois, cancelou somente a consulta e confirmou o fechamento da conexão. O guard rejeitou um socket local sem TLS como sessão Cloud; falha de autenticação foi coberta por `psql` mockado. Um sinal foi testado no wrapper shell com `psql` mockado, não durante uma sessão PostgreSQL real nem durante uma mutação SQL em andamento.

### Gate 3.10.1 — revisão e teste da sessão ativa

O Gate 3.10.1 havia revisado o script com uma leitura bloqueante de `pg_authid`; a execução manual no Cloud provou que o usuário Supabase `postgres` não tem SELECT nesse catálogo. No Gate 3.10.2, esse acesso direto foi removido. SHA-256 atual de `31_disable_role_nologin.sql`: `335997ae505ebb3d2f58d63ccddb03fcb5488ba18ae94933cbc0fe0278700707`; o hash anterior está substituído e não autorizado. Os hashes do diagnóstico e guard administrativo permanecem, respectivamente, `86eb075d1a3f6be08ed704e2518b352d6cf9320449321c2eab3658533788044c` e `9a326bf4cda77395c9ea7cbb65aadb55fb6a7e72b4c6ed394df40280331cad9f`.

O harness isolado autenticou uma sessão real da role fixture por TCP no PostgreSQL local 17.6. Com a sessão presente, a contenção retornou erro e LOGIN permaneceu habilitado: o precheck bloqueou antes da mutação. A consulta de sessões usa `pg_stat_activity.usename`, exclui o PID da sessão administrativa e não seleciona IP nem texto de consulta. `NOLOGIN` impede novas autenticações após o commit, mas não encerra sessões estabelecidas. Existe uma janela concorrente entre a leitura de `pg_stat_activity` e o commit: outra sessão pode autenticar enquanto LOGIN ainda está habilitado. A checagem pós-commit pode detectar uma sessão visível e reportar falha, mas não desfaz o commit nem encerra a sessão. Em caso ambíguo, parar e reconciliar com diagnóstico read-only autorizado; não repetir a mutação automaticamente.

O script não tenta bloquear a linha de role via `pg_authid`: o erro Cloud demonstrou que essa leitura é proibida, embora o usuário possa gerenciar a role por `ALTER ROLE`. Os atributos e a identidade são lidos pela view `pg_roles`, que não expõe o verifier de senha. As chamadas `shobj_description(...,'pg_authid')` leem o comentário da role por função de catálogo, e `pg_shdepend` é consultado como catálogo de dependências; nenhuma delas é `SELECT FROM pg_authid`. Como não há lock de linha disponível para essa sessão Cloud, uma alteração administrativa concorrente entre precheck e DDL continua sendo risco residual; os checks pré e pós-DDL reduzem, mas não eliminam, essa corrida. A operação futura deve ocorrer em janela sem outras alterações administrativas de roles.

O harness também comparou os atributos da role, memberships, dependências, ACL e estado RLS antes/depois, testou erros antes e depois do commit e o caminho em que a role já está NOLOGIN. Foi acrescentada uma role de operador local sem SUPERUSER e sem SELECT em `pg_authid`, com CREATEROLE e ADMIN OPTION sobre a role fixture. Essa identidade autenticada por TCP bloqueou uma sessão fixture ativa antes do ALTER e, sem sessão ativa, concluiu a alteração local. Isso não comprova ausência de configuração externa que use a role nem elimina concorrência com sessões administrativas no Cloud. Os testes foram feitos em PostgreSQL local 17.6; a semântica no Cloud 17.11 não foi exercitada nesta etapa.

### Evidência CA revisada no Gate 3.8.1

O arquivo local `prod-ca-2021.crt` pertence ao usuário atual e está em modo `0644`, sem escrita por grupo ou outros usuários. OpenSSL o reconhece como certificado PEM `Supabase Root 2021 CA`, válido até 2031-04-26; fingerprint SHA-256: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`. O conteúdo foi comparado byte a byte com a cópia local fornecida pelo proprietário; sua origem no painel oficial é informação do proprietário.

## Encerramento Gate 3.11 — contenção confirmada, auditoria ampla pendente

O proprietário executou `31_disable_role_nologin.sql` pelo wrapper e informou conclusão da verificação pós-COMMIT. O diagnóstico independente `/home/diogo-nascimento/autoclip-admin-readonly.oMuxIr` confirma: role presente e marcada, `can_login=false`, validade `2026-11-15T00:43:58+00:00`, CONNECTION LIMIT 1, privilégios administrativos false, CONNECT/TEMP true, nenhuma membership efetiva na role auditora, zero sessões e dependências compartilhadas vazias. A aresta `postgres` membro da role auditora (ADMIN true; INHERIT/SET false) permanece. O relatório bruto fica fora do repositório.

O Gate 3.3 diagnosticou 45 ocorrências, incluindo ACLs de relações e rotinas em `pg_net`; isso não comprova exploração nem acessibilidade efetiva de cada objeto, mas mantém revisão de ACLs como prioridade. NOLOGIN não revoga grants, não modifica `PUBLIC`, não encerra sessões e não remove a senha/role. Ver [relatório final](CLOUD_SECURITY_AUDIT_FINAL_REPORT.md), [checklist Cloud](CLOUD_SECURITY_CLOSURE_CHECKLIST.md) e [prontidão integrada](INTEGRATED_HOMOLOGATION_READINESS.md).

Gate 3.11 não fez conexão Cloud nem executou SQL. A remoção da role requer autorização própria, reconfirmação de sessões/dependências e tratamento explícito da membership antes de `DROP ROLE` sem CASCADE. A janela de corrida entre validação e ALTER continua risco operacional, pois a sessão Cloud não podia bloquear `pg_authid`.
# Gate 3.12 — continuação do histórico

O encerramento documental da contenção histórica permanece no [relatório Gate 3.11](CLOUD_SECURITY_AUDIT_FINAL_REPORT.md). A inspeção local por componente, os scripts catalog-only e as pendências para homologação são mantidos em [inventário Gate 3.12](GATE_3_12_COMPONENT_INVENTORY.md), [matriz de riscos](GATE_3_12_SECURITY_RISK_MATRIX.md), [comparação local/Cloud](GATE_3_12_LOCAL_VS_CLOUD_COMPARISON.md) e [plano integrado](GATE_3_12_INTEGRATED_HOMOLOGATION_PLAN.md). Nenhuma nova conexão Cloud foi feita neste Gate.

