# Gate 3.13 — Reconciliação final Local × Supabase Cloud

## Estado e método

Esta reconciliação usa exclusivamente nove relatórios JSON locais produzidos manualmente pelo proprietário para o Project Ref `djrwfvcxgpyknmizqumn`, database `postgres`. Nenhuma consulta Cloud adicional foi feita. Os arquivos originais permanecem fora do repositório, sob `~/autoclip-component-audit.*`, modo 0600. Os hashes abaixo identificam os artefatos examinados; timestamps e hashes locais não são assinatura do servidor nem prova criptográfica de quem executou as consultas.

O preflight registrou `postgres`, database `postgres`, PostgreSQL 17.11 e TLS ativo TLS 1.3. Host/Project Ref dependem do wrapper fixo e da confirmação do operador. As consultas não acessaram conteúdo de negócio, objetos Storage, linhas de jobs, comandos cron, corpos de funções, tokens ou valores do Vault.

## Ledger de migrations

Resultado: **21 MATCH por identificador de versão, 0 CLOUD_ONLY, 8 LOCAL_ONLY, 0 NOT_VERIFIED** no escopo estrito do ledger. `MATCH` significa que a versão aparece nos dois conjuntos; não compara o SQL aplicado no Cloud com o arquivo local. O ledger não prova igualdade integral do schema.

| Versão | Arquivo local | Status |
|---|---|---|
| 20261020000001 | `20261020000001_schema.sql` | MATCH |
| 20261020000002 | `20261020000002_rls.sql` | MATCH |
| 20261020000003 | `20261020000003_storage_and_queue.sql` | MATCH |
| 20261020000004 | `20261020000004_frontend_support.sql` | MATCH |
| 20261021000001 | `20261021000001_enum_sent_to_inbox.sql` | MATCH |
| 20261021000002 | `20261021000002_tiktok_integration.sql` | MATCH |
| 20261023000001 | `20261023000001_channel_defaults.sql` | MATCH |
| 20261028000001 | `20261028000001_platform_user_management.sql` | MATCH |
| 20261028000002 | `20261028000002_platform_user_deletion.sql` | MATCH |
| 20261028000003 | `20261028000003_is_platform_owner.sql` | MATCH |
| 20261029000001 | `20261029000001_platform_flags_and_scheduling_safety.sql` | MATCH |
| 20261030000001 | `20261030000001_client_approvals_and_reports.sql` | MATCH |
| 20261031000001 | `20261031000001_photo_carousel_posts.sql` | MATCH |
| 20261031000002 | `20261031000002_tiktok_shop_affiliates.sql` | MATCH |
| 20261031000003 | `20261031000003_shoppable_video_jobs.sql` | MATCH |
| 20261031000004 | `20261031000004_shoppable_anchor_unicode.sql` | MATCH |
| 20261101000001 | `20261101000001_lock_down_tiktok_shop_tokens.sql` | MATCH |
| 20261101000002 | `20261101000002_shop_publish_reconciliation.sql` | MATCH |
| 20261101000003 | `20261101000003_channel_delete_cascade.sql` | MATCH |
| 20261102000001 | `20261102000001_saas_entitlements_and_media_retention.sql` | MATCH |
| 20261102000002 | `20261102000002_fix_media_cleanup_candidate_query.sql` | MATCH |
| 20261103000001 | `20261103000001_account_groups_and_publication_batches.sql` | LOCAL_ONLY |
| 20261103000002 | `20261103000002_batch_management_and_carousels.sql` | LOCAL_ONLY |
| 20261103000003 | `20261103000003_allow_image_media_uploads.sql` | LOCAL_ONLY |
| 20261103000004 | `20261103000004_secure_media_validation_pipeline.sql` | LOCAL_ONLY |
| 20261103000005 | `20261103000005_video_validation_and_legacy_revalidation.sql` | LOCAL_ONLY |
| 20261103000006 | `20261103000006_video_worker_heartbeat.sql` | LOCAL_ONLY |
| 20261103000007 | `20261103000007_video_worker_api_credentials.sql` | LOCAL_ONLY |
| 20261103000008 | `20261103000008_gate_video_validation_on_storage_upload.sql` | LOCAL_ONLY |

The eight local-only migrations form an ordered dependency chain: account groups/batches → batch operations/carousel management → image allowlist and quarantine/validation pipeline → validation queue/revalidation → worker heartbeat → worker nonce/replay protection → gate validation on completed Storage upload. Do not apply out of order or infer that each is independently deployable.

The Cloud schema inventory supports this ledger difference: it contains no `account_groups`, `account_group_members`, `publication_batches`, `publication_batch_operations`, `media_validation_workers` or `video_worker_api_nonces`; Cloud `media_assets` lacks the validation columns from the later local migrations. Cloud bucket inventory contains only private `media` with three video MIME types; no `media-quarantine` bucket was observed. These are confirmed observations from the supplied catalog reports, subject to catalog visibility and the exact capture scope. The media validation and carousel features represented by those local migrations are therefore **not verified as deployed and are observably absent from the current Cloud inventory**.

## Relatórios analisados

| Componente | Seção | SHA-256 do JSON local | Evidência/limite |
|---|---|---|---|
| Preflight | `environment_preflight` | `3b6ff5dbf70c691c57d0f18a728ba2245834501ee5248773b279578928546f39` | PostgreSQL 17.11, database/user e TLS; identidade do host depende do wrapper/operador |
| Schema | `schema_inventory` | `1e85c7035df2866e13a15d2206b36ca8da344c531389fd3114895978be88da78` | 104 schemas, 293 relações visíveis; definições de índices/constraints são metadados sensíveis |
| RLS | `rls_policies` | `146813146a5cd904b014e9372e28c72ee020700117f66cd2d0bbd90a71122b3e` | 142 relações catalogadas, 45 policies; catálogo, não teste de autorização em runtime |
| Roles/grants | `roles_grants_public` | `d703372bc2922db5208e0004aea3014b7efee72e8054dfc2325fa560e8b1d8e2` | ACLs, roles/memberships e defaults visíveis; sem leitura de valores |
| Rotinas | `security_definer_functions` | `f320a21bcd708a4252c150528ac80b2402a90bf65837a656314487dd6c27c123` | 59 rotinas SECURITY DEFINER visíveis; sem corpos |
| Storage | `storage_bucket_metadata` | `1521382de203fdd9cfb7f2c9831dffdabe06da7a9de7abb5e16de4c796088ff4` | Um bucket privado `media`; nenhum objeto lido |
| Extensões | `extensions_and_pg_net` | `8b6c1cb8b881febfd4135d9d0b4a4dbc06ad6fff3d7024be521f77232ff30b8a` | Extensões/rotinas e forma de catálogos; nenhuma chamada HTTP ou linha operacional |
| Jobs | `jobs_and_queue_catalog_shape` | `d5371b148188eb3156edb7dc8037c38a0216469de47c395711b0405e9a773cf2` | Forma de catálogos; não revela se cron jobs estão agendados nem seu comando |
| Ledger | `migration_ledger` | `706d5aa8218cc3cd7ea079ee331126441de32e9384aa87c7a33b8c2e81726b27` | 21 versões; somente a coluna `version` |

Os relatórios não foram copiados para o repositório. Manter a cópia original protegida e aplicar retenção local aprovada.

Os mtimes locais observados cobrem `2026-11-02 01:08` a `01:28` (`America/Sao_Paulo`); são horários do filesystem cliente, não timestamps assinados do servidor. Os nove arquivos têm JSON válido e uma seção cada. Não há identificador criptográfico de execução emitido pelo Cloud no formato atual.

## Reconciliação de componentes

| Componente | Estado local | Estado observado no Cloud | Classificação | Confiança/limite |
|---|---|---|---|---|
| PostgreSQL | Migrations e código no worktree | 17.11, DB `postgres` | MATCH parcial | Versão e conexão observadas; não prova equivalência de schema |
| Ledger | 29 versões locais | 21 versões, todas presentes localmente | 21 MATCH, 8 LOCAL_ONLY | IDs comparados; conteúdo SQL não comparado |
| Tabelas de lote | Migrations 3.13 locais | Tabelas de grupos/lotes não observadas | MISMATCH observado | Inventário do catálogo não encontrou objetos |
| Validação de mídia | Migrations de validação local | colunas/worker/nonce ausentes no inventário | MISMATCH observado | Não valida código Edge/worker implantado |
| RLS `public` | Policies locais nas migrations | 30 relações com RLS; nenhuma relação pública sem RLS; 9 com RLS e zero policy | NOT_VERIFIED quanto à semântica | 45 policies totais observadas; comparação policy a policy pendente |
| Storage | `media` e migrations locais de quarentena | Um bucket privado `media`, 50 MiB, MIME de vídeo; cinco policies em `storage.objects` | MISMATCH para imagens/quarentena | Sem leitura de objetos; policy conditions não comprovam isolamento em runtime |
| Rotinas | SQL local em migrations | 59 SECURITY DEFINER observadas; sem corpos | NOT_VERIFIED para equivalência | Nome, assinatura e propriedades não provam corpo igual |
| Grants/PUBLIC | Migrations e SQL local | Grants observados incluindo `net` e rotinas | Risco confirmado de ACL | Efetividade funcional depende também de schema exposure, permissões de conexão/API e contexto |
| Extensões | Dependências locais | `pg_cron 1.6.4`, `pg_net 0.20.4`, Vault e outras observadas | PARTIAL MATCH | Metadados de extensão não comprovam uso/estado operacional |
| Jobs/cron | Código SQL local agenda tarefas | Somente forma de catálogo; rows e comandos não consultados | NOT_VERIFIED | Não concluir que scheduler está ativo ou correto |
| Role auditora | Script contém contenção | `autoclip_cloud_auditor` NOLOGIN, atributos restritos; membership `postgres`→auditor com ADMIN OPTION | MATCH ao diagnóstico histórico | O relatório atual não verificou sessões; grants de TEMP/CONNECT permanecem descritos em diagnóstico anterior |
| Auth/Edge/Vercel/TikTok | Código e configurações locais | Sem consulta a interfaces oficiais | NOT_VERIFIED | Nenhum acesso a usuários, tokens ou secrets |

## Achados de segurança prioritários

### R1 — `pg_net` exposto por ACL de PUBLIC — ALTO, investigação bloqueia homologação

Os relatórios mostram `USAGE` em `net` para `PUBLIC`, `EXECUTE` para `PUBLIC` em rotinas como `net.http_get`, `net.http_post` e `net.http_delete`, e ACL de `PUBLIC` com privilégios de leitura/escrita incluindo `MAINTAIN` em `net.http_request_queue` e `net._http_response`; a sequence também possui ACL pública. Isso é evidência confirmada de ACL observada e de caminho efetivo para roles que tenham sessão no banco. A consulta não provou que o schema `net` está exposto pela API Supabase nem executou chamadas; SSRF, exfiltração ou alteração abusiva são riscos potenciais, não exploração demonstrada. Prioridade: revisar exposição de schemas/API e necessidade funcional, mapear chamadores `SECURITY DEFINER` e formular eventual correção específica em gate separado. Não revogar PUBLIC genericamente.

### R2 — RPC `change_workspace_plan` acessível a `authenticated` — ALTO

Cloud metadata confirma função `public.change_workspace_plan(uuid,text)`, owner `postgres`, `SECURITY DEFINER`, `search_path=""`, `authenticated EXECUTE=true`, `PUBLIC/anon EXECUTE=false`. A migration local implementa autorização `private.can_admin(p_workspace)` e muda plano/status/limites e registra evento. O corpo Cloud não foi coletado; portanto não está provado que seja igual. Risco potencial: um administrador de workspace alterar entitlement sem checkout/cobrança ou validação server-side de plano. Como cobrança permanece fora do escopo, suspender qualquer interpretação de plano como cobrança e revisar a RPC antes de piloto. Confirmar allowlist de `p_plan`, transação/eventos e autorização de plataforma na implementação implantada.

### R3 — RPC `resolve_unknown_job` acessível a `authenticated` — ALTO

Cloud metadata confirma função `public.resolve_unknown_job(uuid,text)`, owner `postgres`, `SECURITY DEFINER`, `search_path=""`, `authenticated EXECUTE=true`, `PUBLIC/anon EXECUTE=false`. Migration local exige `private.can_edit` do workspace e status `UNKNOWN`, e permite decidir `PUBLISHED` ou `NOT_PUBLISHED`; o corpo remoto não foi lido. Pode alterar histórico e estado usado por reconciliação, retenção e quota. Exigir autorização de papel mais estrita ou justificar o fluxo, auditar efeitos transacionais e fazer teste de cross-tenant/concorrência em ambiente isolado antes de homologação.

### R4 — Funções trigger `SECURITY DEFINER` com EXECUTE público — MÉDIO, revisão

As três funções `validate_publication_media_assets`, `validate_publication_shop_product` e `validate_shoppable_publication` aparecem como SECURITY DEFINER e EXECUTE público. O código local as define como trigger functions; PostgreSQL não permite invocá-las como funções comuns, e o catálogo informa propriedades, não prova que seus triggers estão instalados em Cloud. Não há exploração demonstrada. Confirmar triggers e grants de `TRIGGER` nos objetos antes de tratar como risco explorável; revisar corpos/`search_path` localmente e comparar versão por mecanismo autorizado.

### R5 — RLS e políticas Storage — ALTO até teste isolado

O catálogo mostra RLS ativa em todas as 30 relações de `public`; nove têm zero policy e, portanto, tendem a negar acesso via RLS a roles comuns, mas privilégios de owner/service roles e RPCs SECURITY DEFINER permanecem fora dessa proteção. Cinco policies foram observadas em `storage.objects`, associadas ao bucket `media`; o bucket é privado. As expressões são metadados, não prova de acesso cross-workspace impossível. Fazer testes negativos com duas identidades/workspaces sintéticos em ambiente isolado; não usar dados reais.

### R6 — Código de validação de mídia local não corresponde ao estado observado — ALTO para feature/implantação

O ledger omite oito migrations locais e o inventário Cloud não contém os novos objetos/colunas; o bucket Cloud não contém MIME de imagem ou `media-quarantine`. Isso pode impedir os fluxos locais de carrossel/validação e significa que a segurança do pipeline novo não está implantada/verificada. Não aplicar migrations neste gate. Fazer revisão ordenada das oito, baseline/backup e autorização individual antes de qualquer implantação.

### R7 — Vault e credenciais — ALTO, configuração parcial observada

ACL catalogada mostra leitura de `vault.decrypted_secrets` por `service_role` e privilégios grantable de `postgres`; nenhum valor foi lido. Isso é coerente com chamadas internas de Edge/cron, mas aumenta o impacto de vazamento de service-role. Acesso real aos secrets, quem pode invocar as funções que os consomem, rotação, logs e Edge secrets não foram verificados. Manter como investigação prioritária por interface oficial e análise do código local; nunca exportar valores.

### R8 — Scheduler e media cleanup — NOT_VERIFIED

Cloud tem extensões `pg_cron`/`pg_net` e os catálogos esperados; o relatório explicitamente não leu linhas de jobs nem comandos. A migration local de cleanup agenda função a cada 15 minutos, mas ledger não prova estado operacional e pacote não confirmou agendamento. Não ativar ou presumir cleanup. Homologar dry-run, grace period, referências compartilhadas e falha entre Storage delete e RPC em ambiente isolado.

### R9 — Role temporária — MÉDIO residual

O pacote de grants confirma `can_login=false`, role presente e edge `postgres` membro da role auditora com `ADMIN OPTION`; não foram listadas sessões no pacote atual. Diagnóstico anterior reportou `CONNECT`/`TEMP` herdados de `PUBLIC`. NOLOGIN bloqueia login direto, não apaga ACLs nem a possibilidade de assunção por membro administrativo. Planejar remoção/limpeza em autorização separada; não alterar neste Gate.

### R10 — Trabalho de homologação externa — ALTO/pendente

Auth, configurações/versões de Edge Functions, secrets, Vercel, integrações TikTok, backup/restore e monitoramento não foram obtidos nesses relatórios SQL. Nenhuma destas áreas está homologada por existir código local.

## Riscos comprovados vs potenciais

**Confirmados como observação:** 21 IDs de migration no ledger; 8 ausentes; metadados da instância; ACL pública em `net`; grants EXECUTE de duas RPCs a `authenticated`; bucket privado e configuração MIME; 30 tabelas públicas com RLS; nove sem policy; atributos/membership da role nos catálogos consultados.

**Potenciais, não demonstrados:** chamada HTTP abusiva/exfiltração via `pg_net`; alteração indevida de plano; falsificação de status de job; bypass multi-tenant por RLS/RPC/Storage; exposição de secrets; duplicação ou perda de jobs/quota; cleanup prematuro; diferença entre bodies locais e Cloud. Nenhuma query leu linhas de usuários, jobs, Storage ou Vault, e não houve teste runtime de autorização.

## Plano de correção e gates recomendados

1. **Gate 3.14 — decisão de risco e triagem de RPCs/pg_net:** revisão owner de `change_workspace_plan`, `resolve_unknown_job`, exposição PostgREST de `net`, chamadores e ACLs; definir correções locais propostas. Não alterar Cloud até SQL/patch e aprovação próprios.
2. **Gate 3.15 — baseline e revisão de migrations:** revisar as oito migrations como conjunto, validar dependências e testes locais, estabelecer backup/restore e plano de rollback. Aprovação separada por arquivo/hash para futura execução; sem `db push` automático.
3. **Gate 3.16 — homologação isolada:** dois tenants sintéticos, testes negativos RLS/RPC/Storage, limites de quota concorrentes, upload/quarentena/validação, heartbeat, idempotência e falhas de rede.
4. **Gate 3.17 — interfaces não SQL:** Auth, Edge Functions/secrets, Vercel, TikTok app, logs, backup/PITR e monitoramento; evidências sem exportar segredos.
5. **Decisão formal de entrada:** apenas após fechar achados ALTO ou aceitá-los expressamente para sandbox isolado; isso não autoriza usuários reais nem cobrança.

## Critérios de bloqueio da homologação

- `pg_net` ACL pública sem justificativa/limitação e revisão do caminho de exposição.
- RPCs privilegiadas com corpos remotos não verificados ou autorização/efeitos não aprovados.
- RLS/Storage sem testes cross-workspace isolados.
- Pipeline local de validação de mídia tratado como Cloud-ready antes de migrações aprovadas e implantadas.
- Jobs/cleanup considerados ativos sem evidência de configuração e teste.
- Secrets/Auth/Edge/TikTok/backup/observabilidade não revisados.
- Qualquer erro ou permissão insuficiente na auditoria interpretada como ausência de objetos.

**Conclusão:** reconciliação de catálogo concluída com divergências concretas e riscos altos ainda abertos. O ambiente não está homologado para usuários reais nem para deploy das migrations locais sem revisão/autorização específica.
