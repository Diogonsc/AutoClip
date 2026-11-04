# Gate 3.18 — preparação da reconciliação Cloud read-only

## Estado

**Etapa A local concluída. Etapa B não executada.** Nenhuma resolução DNS, conexão, consulta ou operação Cloud foi realizada neste gate. Nenhuma role, grant, policy ou credencial foi alterada. A role `autoclip_cloud_auditor` não foi usada e permanece `NOLOGIN` conforme o diagnóstico histórico do Gate 3.10; não foi revalidada agora.

O trabalho desta etapa foi revisar os documentos e o pacote local, conferir os hashes e executar testes estáticos. A autorização para esta preparação não autoriza a execução dos comandos abaixo.

## Evidências anteriores e limites

- Gate 3.13: nove relatórios locais produzidos manualmente; o ledger observado tinha **21 versões** que também existiam localmente, **oito LOCAL_ONLY**, zero CLOUD_ONLY e zero NOT_VERIFIED no escopo do ledger. A comparação foi por identificador, não por conteúdo SQL. Os relatórios brutos protegidos não foram relidos neste gate; os resultados abaixo vêm da documentação do Gate 3.13.
- Gate 3.14: triagem registrou ACLs históricas de `pg_net`, RPCs `SECURITY DEFINER`, RLS/Storage e Vault com limites de observação. Nenhuma exploração foi demonstrada.
- Gate 3.15: hardening local de planos e resolução de jobs `UNKNOWN`.
- Gate 3.16: teste PostgreSQL multi-sessão, pgTAP, frontend e plano pré-deploy locais.
- Gate 3.17: assinatura antiga de `resolve_unknown_job` substituída localmente por stub fail-closed. A correspondência Cloud e a experiência em PostgREST/cache não foram verificadas.

Esses resultados são snapshots anteriores. A Etapa B deverá produzir relatórios novos; não assumir que o estado Cloud permaneceu igual.

## Pacote revisado

Diretório: `scripts/cloud-audit/component-readonly/`.

- Nove consultas SQL (`00`–`08`), cada uma inclui o guard irmão `_guard.psql` e usa transação `BEGIN READ ONLY`, `statement_timeout`, `lock_timeout` e `COMMIT`.
- Guard verifica Project Ref, host/porta declarados, database, usuário/sessão `postgres`, `application_name` esperado e TLS ativo. A verificação TLS/hostname efetiva depende também do conninfo fixo, `sslmode=verify-full`, CA e fingerprint no wrapper; SQL sozinho não prova a identidade do host.
- Wrapper `run-component-audit.sh` recebe somente um nome fechado de componente; não aceita SQL arbitrário. Fixa Direct host `db.djrwfvcxgpyknmizqumn.supabase.co:5432`, database/usuário `postgres`, valida hashes e fingerprint da CA, usa `psql -X -W`, `ON_ERROR_STOP=1`, `PGPASSFILE=/dev/null`, remove variáveis PG de roteamento/TLS conflitantes, não faz retry, aplica `umask 077`, cria saída local protegida e exige um único objeto JSON para preservar o relatório.
- Os comandos passam variáveis psql explícitas de escopo Cloud; o guard falha se alvo, sessão ou TLS divergirem.
- O pacote não lê linhas de negócio, usuários Auth, objetos Storage, fila/cron operacional, comandos de cron, corpos de função, segredos ou resultados de chamadas HTTP. Erro/ausência de visibilidade deve permanecer `NOT_VERIFIED`.

O modo de conexão usa a senha administrativa em prompt interativo. Nenhuma senha foi solicitada, lida ou impressa. O fingerprint CA e hashes estão fixados no wrapper/documentação; antes de uma futura execução, o proprietário deve confirmar que CA e endpoint continuam aprovados. Nenhum comando do wrapper foi executado.

## SHA-256 local recalculado

Todos os hashes dos nove SQLs e do guard coincidem com os valores fixados no wrapper e documentados no README. Os hashes abaixo são integridade do conteúdo atual; **não são aprovação para Cloud**.

| Arquivo | SHA-256 |
|---|---|
| `_guard.psql` | `3702f145a33ffcb3d16138246b9aec0daf3bd564086e34039859338db66052b1` |
| `00_environment_preflight.sql` | `7f31204f14829d66e576dcc06cf28c955ed37ed19c34975a981c450bec90561e` |
| `01_schema_inventory.sql` | `ad5064b58e34214004ef758b7182442f0bbbd8dd0a5654f751042954c2c5223c` |
| `02_rls_policies.sql` | `1ce0c0445db943a9156efa91b7b79f9cca9e7c426533c566262834401053609a` |
| `03_roles_grants_public.sql` | `d393c7ce849db68d7ba571a12b770433004c86faa604b385c1323bf08d67ec17` |
| `04_security_definer_functions.sql` | `efad352064cdd5256accb649a6b3b1bc00dbe256cfbafc4c54bedee7095cf1b9` |
| `05_storage_metadata.sql` | `dfce37f7f3c0303cb49f4465b32cded6891d750789d952602a6a0868299f5bc1` |
| `06_extensions_pg_net.sql` | `21e4c3555c28caae6521c91354acfaf64633473647727cfad782f5a7c62815fb` |
| `07_jobs_metadata.sql` | `6b91012c752cd8bcdd250e7ddb22388bbd8c171d088330889f6f02c10aa726df` |
| `08_migration_ledger.sql` | `a58508f7612def71af5ad8c9a691c6e0c890b127b6315fa92672075a5752218c` |
| `run-component-audit.sh` | `0bc58b20b9364799ec37faaf1b20920d1d192daaa910f93eaff0d6baccc9db32` |
| `component-readonly.test.mjs` | `d082ae1e509d8e5c6287b74c4f9c0a5496680c80845f415e396882021e1ba269` |
| `test-component-readonly-local.mjs` | `b73cb3ec8503343a0f8d02ebc71be3febfade907465e60d90252f38a6c2c5da3` |
| Migration 09 atual | `b97d3e5b0993d534d3bce689564f1cbd585c5784244004f1a1eea062708d76d0` |

O hash da migration 09 inclui o stub legado fail-closed local. O hash anterior da migration está substituído; as 21 versões observadas historicamente no Cloud não provam se a versão 09 foi aplicada depois nem se o corpo implantado é igual ao arquivo local.

## Migrations locais a reconciliar

O repositório contém 30 arquivos de migration. Com base somente no último ledger Cloud documentado (21 versões), as nove versões locais posteriores a essa captura são candidatas `LOCAL_ONLY` para nova verificação:

1. `20261103000001_account_groups_and_publication_batches.sql`
2. `20261103000002_batch_management_and_carousels.sql`
3. `20261103000003_allow_image_media_uploads.sql`
4. `20261103000004_secure_media_validation_pipeline.sql`
5. `20261103000005_video_validation_and_legacy_revalidation.sql`
6. `20261103000006_video_worker_heartbeat.sql`
7. `20261103000007_video_worker_api_credentials.sql`
8. `20261103000008_gate_video_validation_on_storage_upload.sql`
9. `20261103000009_harden_manual_plan_and_unknown_resolution.sql`

“Candidatas LOCAL_ONLY” significa apenas que essas versões não apareciam no ledger do snapshot anterior. A Etapa B deverá classificar versões novamente. Uma versão MATCH não comprova igualdade de conteúdo SQL nem equivalência integral de schema. Nenhuma migration será aplicada.

## Componentes propostos e justificativa

Todos os componentes são necessários para atualizar a reconciliação completa; cada chamada é separada e produz somente seu próprio relatório.

| Componente | Arquivo/consulta | Por que atualizar | Limite principal |
|---|---|---|---|
| `preflight` | `00_environment_preflight.sql` | Revalidar database/usuário/versão e evidência de TLS da nova execução antes de interpretar relatórios. | A identidade do Project Ref decorre do host/CA fixos e verificação externa do operador; sessão SQL isolada não prova o projeto por si. |
| `schema` | `01_schema_inventory.sql` | Comparar relações, colunas, constraints, índices, triggers e objetos estruturais esperados das migrations 01–09. | Catálogos invisíveis/sem privilégio não significam objeto ausente; não compara corpos SQL. |
| `rls` | `02_rls_policies.sql` | Atualizar RLS e policies afetadas por lotes, validação/quarantine, Storage e tabela de idempotência da RPC. | Metadados não provam isolamento em runtime. |
| `grants` | `03_roles_grants_public.sql` | Revalidar roles/memberships/ACLs/default privileges, `MAINTAIN` quando exposto e estado observável da role auditora. | Só ACL observável; não testa alcance via API nem deve ser usado para alterar nada. |
| `routines` | `04_security_definer_functions.sql` | Revalidar assinaturas, SECURITY DEFINER, owner/configuração/search_path e ACLs da RPC nova e stub legado. | Não inclui corpos; não prova lógica nem versão do código implantado. |
| `storage` | `05_storage_metadata.sql` | Verificar buckets e limites/MIME observáveis frente a imagens e `media-quarantine`. | Não lê objetos nem policies completas de conteúdo; execução não valida uploads. |
| `extensions` | `06_extensions_pg_net.sql` | Atualizar versão/schema/ACL de `pg_net` e funções/objetos relevantes ao risco histórico. | Não chama HTTP e não prova schema exposure/egress/caller efetivo. |
| `jobs` | `07_jobs_metadata.sql` | Comparar forma de catálogo para cron/filas sem obter linhas de execução. | Não lê registros de cron, comandos, payloads ou comprova que schedule está ativo. |
| `ledger` | `08_migration_ledger.sql` | Confirmar conjunto atual de versões usando apenas coluna `version`. | Não compara conteúdo e falha/forma incompatível deve ficar `NOT_VERIFIED`. |

Para investigar se cron está efetivamente agendado, quais comandos executa, o estado operacional do worker, secrets/Vault, Edge Functions, Auth, Vercel ou TikTok, este pacote é insuficiente. Essas verificações exigem preparação e autorização separadas, preferencialmente por interfaces oficiais, sem exportar segredos.

## Comandos manuais preparados

Os comandos abaixo executam no máximo um componente cada e devem ser copiados/confirmados somente após autorização individual. Não foram executados.

```bash
bash scripts/cloud-audit/component-readonly/run-component-audit.sh preflight
```

Após o resultado do preflight ser apresentado e uma aprovação própria para cada item, os demais nomes permitidos são:

```bash
bash scripts/cloud-audit/component-readonly/run-component-audit.sh schema
bash scripts/cloud-audit/component-readonly/run-component-audit.sh rls
bash scripts/cloud-audit/component-readonly/run-component-audit.sh grants
bash scripts/cloud-audit/component-readonly/run-component-audit.sh routines
bash scripts/cloud-audit/component-readonly/run-component-audit.sh storage
bash scripts/cloud-audit/component-readonly/run-component-audit.sh extensions
bash scripts/cloud-audit/component-readonly/run-component-audit.sh jobs
bash scripts/cloud-audit/component-readonly/run-component-audit.sh ledger
```

O operador deve registrar fora do repositório o caminho do relatório, horário local do cliente, componente, hash aprovado e exit status. Relatório bruto permanece protegido fora do worktree. Não selecionar automaticamente relatórios antigos nem alimentar novos relatórios em comandos adicionais sem revisar conteúdo/escopo.

## Matriz de autorização por componente

| Ordem | Componente | Hash SQL (prefixo) | Estado de autorização |
|---:|---|---|---|
| 0 | preflight | `7f31204f…` | PENDENTE — primeira aprovação específica |
| 1 | schema | `ad5064b5…` | PENDENTE — nova autorização depois do resultado anterior |
| 2 | rls | `1ce0c044…` | PENDENTE — nova autorização depois do resultado anterior |
| 3 | grants | `d393c7ce…` | PENDENTE — nova autorização depois do resultado anterior |
| 4 | routines | `efad3520…` | PENDENTE — nova autorização depois do resultado anterior |
| 5 | storage | `dfce37f7…` | PENDENTE — nova autorização depois do resultado anterior |
| 6 | extensions | `21e4c355…` | PENDENTE — nova autorização depois do resultado anterior |
| 7 | jobs | `6b91012c…` | PENDENTE — nova autorização depois do resultado anterior |
| 8 | ledger | `a58508f7…` | PENDENTE — nova autorização depois do resultado anterior |

O Gate 3.18 autoriza somente preparar. Mesmo a autorização do `preflight` não autoriza outros componentes; cada próximo passo requer apresentação do resultado anterior e aprovação explícita própria.

## Critérios de parada

Parar sem retry e preservar somente a saída válida se ocorrer divergência de hash/CA, falha de DNS/TLS/autenticação, database/usuário inesperado, guard bloqueado, erro SQL, JSON inválido/incompleto, seção incorreta, relatório com conteúdo fora do escopo ou condição não prevista. `NOT_VERIFIED` não deve ser transformado em ausência ou MATCH. Não ajustar host, CA, timeout, grants ou SQL para contornar bloqueio.

Depois de cada relatório: validar um único JSON e seção esperada, sanitizar somente para revisão, comparar com a evidência histórica e aguardar autorização antes do componente seguinte. Se o estado da role for diferente de NOLOGIN ou houver diferença material de privilégios, interromper a reconciliação e reportar; não conter/revogar automaticamente.

## Riscos residuais

1. **ALTO — exposição histórica de pg_net:** ACLs foram observadas no snapshot do Gate 3.13; exposição via Data API e abuso não foram demonstrados. Novo metadata não prova exploração ou egress.
2. **ALTO — RPCs e migration 09:** a função nova e stub existem no código local, mas corpos/versões Cloud não são coletados por este pacote. Nome/assinatura/propriedades não comprovam igualdade.
3. **ALTO — RLS/Storage:** catálogos não substituem teste sintético cross-workspace e de upload/download em staging.
4. **ALTO — estado de migrations:** ledger fornece versão, não hash do arquivo executado; o estado relatado é histórico e precisa nova captura antes de comparação.
5. **MÉDIO/ALTO — cron/worker:** consulta `jobs` somente inventaria a forma dos catálogos; schedules/comandos/health permanecem não verificados.
6. **MÉDIO — relatórios:** nomes de objetos e metadados de segurança podem ser sensíveis; manter arquivos modo restrito fora do repositório e não os compartilhar em bruto.
7. **MÉDIO — identidade/horário:** wrapper fixa TLS/host, mas JSON não é assinado pelo servidor; mtime é horário do cliente, não prova independente de execução.
8. **NOLOGIN da auditoria:** confirmado no Gate 3.10, não no snapshot de reconciliação atual. O pacote grants poderá observar o estado somente se o catálogo o permitir.

## Validação local desta preparação

- `node --test scripts/cloud-audit/component-readonly/component-readonly.test.mjs`: **5/5 aprovados**.
- `bash -n scripts/cloud-audit/component-readonly/run-component-audit.sh`: aprovado.
- `node --check scripts/cloud-audit/component-readonly/test-component-readonly-local.mjs`: aprovado.
- SHA-256 de todos os SQLs, guard, wrapper, testes e migration 09 recalculados; pins do wrapper coincidem.
- 30 arquivos de migration encontrados; as versões 01–09 acima estão presentes.
- O harness `test-component-readonly-local.mjs` **não foi executado**: ele cria/remove um database de fixture e cria/remove uma role no cluster Supabase local `tiktok-saas`. Como o gate proíbe alterar roles e o pacote já foi validado por testes estáticos, não alterei esse cluster local.
- `git diff --check`: aprovado após a gravação deste documento.

## Próxima autorização necessária

Para iniciar a Etapa B, o proprietário deverá aprovar especificamente o componente `preflight`, confirmando Project Ref `djrwfvcxgpyknmizqumn`, Direct host/porta/database/usuário já fixados, operador, janela e finalidade. A autorização deverá permitir somente o comando `bash scripts/cloud-audit/component-readonly/run-component-audit.sh preflight` com SHA-256 SQL `7f31204f14829d66e576dcc06cf28c955ed37ed19c34975a981c450bec90561e`. Após receber e revisar seu JSON, a reconciliação para e aguarda autorização separada para `schema`.
