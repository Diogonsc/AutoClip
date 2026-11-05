# Gate 3.19 — reconciliação de segurança local × Cloud

## Parecer

**GO para continuar preparação local. NO-GO para staging remoto e produção.** A coleta manual read-only do Gate 3.18 está acessível localmente e foi verificada por hash. Ela confirma diferenças relevantes de RPC e Storage frente ao código local, mas não contém corpos de funções, linhas operacionais, conteúdo de Storage, comandos cron, configurações de Auth/Edge/Vercel nem valores de Vault. A auditoria não comprova equivalência completa, isolamento em runtime ou prontidão operacional.

Nenhuma conexão Cloud foi aberta durante o Gate 3.19. Nenhuma migration, role, grant, policy, função, bucket ou job remoto foi alterado. A role `autoclip_cloud_auditor` permanece com `NOLOGIN` conforme a evidência anterior e também conforme o snapshot de grants do Gate 3.18; ela não foi usada.

## Proveniência e preservação das evidências

O branch observado é `main`. O worktree já continha numerosas alterações locais e arquivos não rastreados antes deste gate; elas foram preservadas. Os relatórios abaixo estão fora do repositório, em `/home/diogo-nascimento`, com permissão `0600`. Não foram copiados para o repositório. Os horários são `mtime` do filesystem do cliente em UTC, não timestamps assinados pelo servidor.

| Componente | Arquivo protegido | SHA-256 | `mtime` UTC do cliente |
|---|---|---|---|
| preflight | `autoclip-component-audit.IYaOVC` | `3b6ff5dbf70c691c57d0f18a728ba2245834501ee5248773b279578928546f39` | 2026-11-02 14:20:02 |
| ledger | `autoclip-component-audit.J3GOFn` | `706d5aa8218cc3cd7ea079ee331126441de32e9384aa87c7a33b8c2e81726b27` | 2026-11-02 14:21:13 |
| schema | `autoclip-component-audit.kEoNAx` | `1e85c7035df2866e13a15d2206b36ca8da344c531389fd3114895978be88da78` | 2026-11-02 14:22:13 |
| RLS | `autoclip-component-audit.IMHCGC` | `146813146a5cd904b014e9372e28c72ee020700117f66cd2d0bbd90a71122b3e` | 2026-11-02 14:30:05 |
| grants | `autoclip-component-audit.o5VEDX` | `d703372bc2922db5208e0004aea3014b7efee72e8054dfc2325fa560e8b1d8e2` | 2026-11-02 14:32:06 |
| routines | `autoclip-component-audit.RQaqic` | `f320a21bcd708a4252c150528ac80b2402a90bf65837a656314487dd6c27c123` | 2026-11-02 14:38:31 |
| Storage | `autoclip-component-audit.Sg2bMU` | `1521382de203fdd9cfb7f2c9831dffdabe06da7a9de7abb5e16de4c796088ff4` | 2026-11-02 14:43:40 |
| extensions | `autoclip-component-audit.etViZY` | `8b6c1cb8b881febfd4135d9d0b4a4dbc06ad6fff3d7024be521f77232ff30b8a` | 2026-11-02 14:47:27 |
| jobs | `autoclip-component-audit.J5zt6P` | `d5371b148188eb3156edb7dc8037c38a0216469de47c395711b0405e9a773cf2` | 2026-11-02 14:49:41 |

All nine files parsed as JSON and their protected file modes and SHA-256 hashes were rechecked locally. The reports' top-level section names were `environment_preflight`, `migration_ledger`, `schema_inventory`, `rls_policies`, `roles_grants_public`, `security_definer_functions`, `storage_bucket_metadata`, `extensions_and_pg_net`, and `jobs_and_queue_catalog_shape`. This verifies local file integrity since collection, not the truth of the remote system or a cryptographic signature of the collection.

## Reconciliação do ledger

| Classificação por identificador | Quantidade | Resultado |
|---|---:|---|
| MATCH | 21 | Todas as versões observadas no ledger constam entre os nomes locais. |
| CLOUD_ONLY | 0 | Nenhum ID do ledger observado está ausente localmente. |
| LOCAL_ONLY | 9 | `20261103000001` a `20261103000009`. |
| NOT_VERIFIED | 0 no conjunto do ledger | Não significa que o schema inteiro foi comparado. |

A comparação local independente dos arrays de versões chegou aos mesmos totais: 30 arquivos locais, 21 IDs no JSON, 21 interseções, nove locais apenas e nenhum ID remoto apenas. MATCH é somente igualdade de identificador. O ledger guarda versão, não o hash do conteúdo SQL, e não demonstra ausência de drift manual.

## Os nove componentes coletados

| Componente | Observação do relatório | Limite decisivo |
|---|---|---|
| preflight | `postgres`, `postgres`, PostgreSQL 17.11, TLS ativo segundo a sessão; wrapper/endereço aprovados na coleta manual. | Snapshot; a identidade do servidor também depende do endpoint/CA e da validação do operador. |
| ledger | 21 valores de versão. | Sem conteúdo/hash de migrations. |
| schema | 104 schemas e 293 relações visíveis no escopo consultado. | Visibilidade de catálogo e forma estrutural, não igualdade dos corpos/funções. |
| RLS | 142 relações e 45 policies visíveis; 30 tabelas `public` com RLS; nove sem policy; `FORCE RLS` inativo nas relações inventariadas. Cinco policies em `storage.objects` foram registradas na evidência anterior do Gate 3.13. | Metadados não demonstram avaliação runtime de policies. |
| grants | 33 roles; 3.424 ACLs de relações, 84 de coluna, 7.139 de rotinas, 261 de schema, 290 defaults, 18 database ACLs, 26 memberships e zero ACLs de large objects no relatório. | Não é um teste de autorização via PostgREST/API nem de todos os caminhos implícitos. |
| routines | 59 SECURITY DEFINER visíveis (31 `public`, 25 `private`, 2 `vault`, 1 `pgbouncer`); 14 com `PUBLIC EXECUTE`, 39 com `authenticated EXECUTE`; todas com `search_path=""` segundo metadados. | Corpos não coletados; nome/assinatura/propriedade não prova a lógica implantada. |
| Storage | Bucket `media`, privado, 50 MiB, MIME `video/mp4`, `video/quicktime`, `video/webm`; nenhum objeto ou signed URL acessado. | Policies e acesso real a dois workspaces não foram exercitados; bucket não prova isolamento. |
| extensions | Sete extensões: `pg_cron 1.6.4`, `pg_net 0.20.4`, `pg_stat_statements 1.11`, `pgcrypto 1.3`, `plpgsql 1.0`, `supabase_vault 0.3.1`, `uuid-ossp 1.1`; 12 rotinas `net` com PUBLIC EXECUTE. | Nenhuma chamada HTTP, linha de extensão ou secret lido; permissões do schema e endpoint efetivo importam. |
| jobs | Catálogos `cron.job`/`cron.job_run_details` e outras relações de jobs encontrados, com RLS ligado; nenhum registro operacional/comando cron lido ou job disparado. | Existência de catálogo não prova agendamento ativo, conteúdo, sucesso ou health do worker. |

### Divergência RPC de alto risco

O snapshot Cloud registra `public.change_workspace_plan(uuid,text)` e `public.resolve_unknown_job(uuid,text)` como `SECURITY DEFINER`, `search_path=""`, owner `postgres`, `authenticated EXECUTE=true`, sem `PUBLIC`/`anon EXECUTE`. Os corpos não foram coletados. A migration local `20261103000009_harden_manual_plan_and_unknown_resolution.sql` não consta do ledger observado. Portanto, o estado Cloud observado não comprova os controles locais novos:

- `change_workspace_plan`: o SQL local exige `service_role` ou operador de plataforma, trava assinatura, bloqueia provedor de cobrança e registra evento; isso é evidência local, não do corpo Cloud.
- `resolve_unknown_job`: o SQL local de três argumentos exige `request_id`, `private.can_admin` ou `service_role`, trava o job, limita resultado e torna replay idempotente. A assinatura antiga local é stub fail-closed. O Cloud observado ainda expõe a assinatura de dois argumentos a `authenticated`; não se pode atribuir ao Cloud o stub local.

Isso não demonstra exploração, mas é uma divergência observada que impede staging até o estado e rollout serem revisados separadamente. Não se deve fazer alteração Cloud neste gate.

### RPCs e caminhos de autorização locais revisados

| Operação | Evidência local/controles | Estado Cloud e limite |
|---|---|---|
| `change_workspace_plan` | Migration 09 valida operador da plataforma ou `service_role`, rejeita assinatura de provedor, exige plano ativo, atualiza assinatura/ciclo e registra evento. Testes pgTAP negativos para OWNER/ADMIN/EDITOR/VIEWER e outros workspaces, positivos para operador e serviço. | O snapshot mostra EXECUTE de `authenticated` na assinatura antiga; corpo remoto não coletado; migration 09 está ausente do ledger. BLOCKER de implantação. |
| `resolve_unknown_job` | Migration 09 valida request ID/outcome, bloqueia job, confirma membership OWNER/ADMIN (`private.can_admin`) ou serviço, controla estado UNKNOWN, registra chave/evento e aceita replay idêntico. Stub 2-arg local falha sem mutar. | Snapshot mostra somente assinatura antiga 2-arg SECURITY DEFINER com authenticated EXECUTE. Controle local novo não está demonstrado no Cloud. BLOCKER. |
| `add_member_by_email` | `20261020000004_frontend_support.sql`: `private.can_admin`; somente OWNER pode atribuir OWNER; email normalizado; INSERT em workspace específico. Grants limitados às roles usuárias; testagem runtime Cloud não feita. | Metadados mostram authenticated EXECUTE; corpo remoto não coletado. Requer reconciliação de corpo/policy em staging. |
| `cancel_workspace_subscription` | `20261102000001_saas_entitlements_and_media_retention.sql`: `private.can_admin`, marca cancelamento ao fim do período e registra evento, sem cobrança. | Cloud metadata mostra EXECUTE authenticated; corpo não coletado. Billing continua fora de escopo. |
| `create_workspace` | Migration base valida `auth.uid()` e nome 1–80, então chama bootstrap transacional. | Metadados de função não provam bootstrap/cotas atuais em Cloud. |
| `finalize_media` | Migration antiga verifica `private.can_edit` e objeto existente no bucket; inicialmente podia definir `READY`. Migration local 04 remove EXECUTE de authenticated no fluxo de validação novo. | Cloud mostra assinatura antiga e authenticated EXECUTE; M04 de hardening ainda está ausente do snapshot. Risco significativo de aceitar READY sem atestado local novo; corpo remoto não coletado, então explorar isso não está demonstrado. Bloqueia staging de mídia até reconciliação. |
| `private.*` em RLS | Helpers `role_in/is_member/can_edit/can_admin/is_owner` usam SECURITY DEFINER e `search_path=''`, queries qualificadas, membership por `auth.uid()`. | Lista de policies é metadado; não comprova equivalência nem cross-tenant em runtime. |

O snapshot registra grants SQL `DELETE` para `authenticated` em `channels`, `media_assets`, `publication_jobs`, `publication_shop_products` e `workspace_members`. RLS/policies e triggers locais definem escopo adicional, mas uma ACL DELETE não deve ser tratada como prova de exposição irrestrita; tampouco prova de segurança. O conjunto de policies e os cenários negativos cross-workspace devem ser testados sobre um deploy compatível em staging antes de homologação.

RLS habilitado com zero policies (`oauth_connections`, `oauth_states`, `platform_flags`, `platform_owners`, `platform_user_settings`, `publication_approval_links`, `tiktok_shop_connections`, `tiktok_shop_oauth_states`, `worker_leases`) tende a negar operações de roles comuns sujeitas a RLS; não é por si só vulnerabilidade. Owner, service role, BYPASSRLS e funções SECURITY DEFINER são caminhos distintos. `FORCE ROW LEVEL SECURITY=false` não é falha automática, mas owner da tabela pode estar fora da proteção normal.

As três funções trigger `validate_publication_media_assets`, `validate_publication_shop_product` e `validate_shoppable_publication` aparecem no inventário anterior com SECURITY DEFINER e PUBLIC EXECUTE. Funções trigger não são normalmente chamadas como funções RPC, mas triggers instalados, ACLs dos objetos e corpos implantados devem ser conferidos antes de classificar o caminho como ininvocável. Não há exploração demonstrada.

## `pg_net`, cron e Vault

O snapshot confirma ACL observável de `PUBLIC`: USAGE em `net`, EXECUTE em 12 rotinas `net` (`http_get`, `http_post`, `http_delete`, auxiliares incluídas) e ACLs amplas na fila/respostas da extensão, cujas tabelas observadas não tinham RLS. As funções inventariadas não eram SECURITY DEFINER. Acesso efetivo requer schema USAGE, sessão e demais grants; exposição de `net` à API/Data API e caminho de invocação arbitrária não foram verificados. O código local usa `net.http_post` em `private.invoke_publication_worker()` e `private.invoke_media_cleanup()`, por wrappers SECURITY DEFINER com execute fechado no SQL local e secrets lidos do Vault. Os relatórios não revelam quem executa os cron jobs nem seu texto, e não provam que a versão implantada corresponde ao código local.

Risco: possibilidade de uso de rotinas HTTP, manipulação/observação de fila ou acesso a destinos de rede se um principal não pretendido tiver caminho efetivo. SSRF, exfiltração e exploração não foram demonstradas. Não revogar ACL globalmente: primeiro confirmar schema exposto, owner/caller efetivo, extensão, wrappers e dependências do cron em ambiente separado.

O relatório de ACL mostrou os metadados de privilégio/Vault sem conteúdo de secrets. Configuração de secrets Edge, retenção/rotação, exposição de tokens OAuth e acesso administrativo ao Vault não foram avaliados integralmente.

O relatório de jobs encontrou `cron.job` e `cron.job_run_details` com RLS habilitado, sem ler linhas ou texto de comandos. Cron ativo, schedules, caller e sucesso do worker ficam `NOT_VERIFIED`.

## Segurança multi-tenant e autorização

As migrations base definem helpers de workspace e policies usando `workspace_id`; as migrations 01–02 acrescentam chaves estrangeiras compostas e checagens de workspace para grupos/lotes/canais/mídias; os testes pgTAP atuais exercitam usuários sintéticos e negativas cross-workspace para RPCs e operações principais. São evidências de implementação/teste local. Não equivalem a teste no Cloud. Pontos de atenção:

- RPCs SECURITY DEFINER devem validar usuário/tenant em cada caminho e manter `search_path` vazio; a presença de `authenticated EXECUTE` é aceitável apenas se a autorização interna estiver correta.
- Há permissões SQL DELETE em tabelas operacionais; a aplicação precisa conservar políticas/constraints, conferir associação do tenant e evitar cascades não planejadas.
- `workspace_members` e operações OWNER/ADMIN exigem revisão de concorrência para impedir remoção do último OWNER e elevação de papel.
- `worker_leases` sem policy explícita significa que roles comuns não devem ler/escrever linhas via RLS; worker/service role precisa ser restrito e auditável.
- Nenhuma evidência do pacote lê dados reais nem mede isolamento em execução.

## Mídia, Storage e limpeza

O Storage Cloud observado é privado e aceita somente vídeo, 50 MiB. O código local mais novo introduz `media-quarantine`, imagens, pipeline de validação, checksum/atestado e proibição de `READY` sem validação; essas mudanças estão nas migrations 03–08 e não constavam do ledger do snapshot. Não há prova de implantação dessas políticas nem testes Cloud.

A migration 04 reclassifica todas as linhas existentes de `media_assets` (`READY` torna-se `UNVERIFIED`, demais `PENDING`); esse backfill pode gerar locks/WAL e bloquear/publicar mídia legada até revalidação. A migration 05 substitui candidatos de cleanup e exige `VALIDATED`, ausência de claims e ausência de jobs ativos, incluindo `UNKNOWN`, além de grace period e lock por mídia. A função `media-cleanup` local usa segredo interno e remove somente candidatos devolvidos pelo RPC; porém, quando `dry_run=false`, a exclusão física é real. Settings localmente defaultam cleanup off/dry-run on, mas configuração Cloud não foi lida. Excluir por Storage e depois completar o estado DB também deixa janela de falha parcial se a chamada de Storage e a transação de confirmação divergirem. A limpeza deve continuar desativada e sem disparos durante a homologação inicial.

## OAuth TikTok e rotação de refresh token

**Premissa externa não verificada neste gate:** foi fornecida a mudança futura a partir de 2026-12-01 (access token 2 horas, refresh token 180 dias, refresh token rotacionado e anterior invalidado). Não consultei documentação externa nem chamei TikTok; a compatibilidade contratual precisa de confirmação em fonte oficial antes do corte.

Inspeção estática local:

- `supabase/functions/_shared/tokens.ts` atualiza quando faltam menos de cinco minutos para expiração, decripta o refresh token e chama a interface `refreshAccessToken`.
- Se a resposta inclui refresh token novo, cifra e persiste; se não inclui, mantém `encrypted_refresh_token` antigo. Isso pode ser incompatível com rotação obrigatória que invalide o token anterior.
- `createTokenStore.saveTokens` em `_shared/supabase-db.ts` grava os tokens por `channel_id`, sem CAS/versionamento/lock de banco. O worker tem lease global, mas não há proteção local comprovada por conexão contra duas chamadas de refresh concorrentes de `tiktok-channel` e worker.
- `tiktok-shop` e `tiktok-shop-publish` contêm caminhos de refresh independentes; quando resposta não tem novo refresh, retêm o antigo; chamada/atualização também não evidencia lock/CAS. Não misturar o contrato TikTok Shop com Content Posting API; confirmar especificação separadamente.
- Não foi localizado teste de unidade do fluxo `ensureAccessToken` e persistência concorrente. Os testes `crypto_tiktok.test.ts` testam parsing/resposta de refresh e tokens, mas não corrida de duas renovações, persistência atômica, rollback ou falha entre resposta e gravação.
- Tokens são cifrados em código local e chaves vêm de ambiente server-side; configuração/deploy e logs reais não foram auditados.

Classificação: risco **HIGH** para continuidade/reauth quando a rotação obrigatória estiver efetiva; falha de segurança/exposição ainda não demonstrada. Antes de staging, adicionar store com compare-and-swap/lease por conexão, persistir access+refresh+expirações como unidade e ensaiar refresh concorrente, timeout ambíguo, resposta sem refresh e reautorização. Primeiro validar a exigência oficial e endpoints de TikTok/Shop.

## Resultados locais executados neste Gate

| Comando | Resultado | Ambiente/limite |
|---|---|---|
| `node --test scripts/cloud-audit/component-readonly/component-readonly.test.mjs` | 5/5 passaram | Testes estáticos do pacote Cloud read-only; nenhum acesso remoto. |
| `node scripts/test_gate_316_rpc_concurrency.mjs` | pgTAP 15 arquivos/225 assertions; lint sem erro bloqueador (1 linha de warning); 41 assertions de concorrência passaram | Harness cria projeto Supabase temporário, portas loopback e fixtures sintéticas; stack própria foi parada pelo harness. Sem Cloud. |
| `npm run test --prefix apps/web` | 5 arquivos/45 testes passaram | Vitest local. |
| `npm run typecheck --prefix apps/web` | passou | TypeScript. |
| `npm run build --prefix apps/web` | passou, 2.413 módulos | Build local; não é deploy. |
| `bun test supabase/functions/_tests` | 5 arquivos/96 testes passaram | Mocks/fixtures das Edge Functions; não chama TikTok real. Não exercita concorrência de refresh-token no TokenStore. |

**Não executado:** Playwright E2E neste Gate. `apps/web/e2e/run-local-e2e.mjs` usa o Supabase local persistente `tiktok-saas`, cria usuários/workspaces/objetos e tenta removê-los no `finally`; não é um stack descartável independente. Para preservar o ambiente compartilhado conforme a regra de teste destrutivo, não o executei. Resultado histórico 20/20 dos Gates anteriores não é contabilizado como teste atual. O harness de concorrência executou stack descartável. Lint de frontend não possui script configurado; `supabase db lint` foi coberto pelo harness. `git diff --check` executado na validação final.

## Limitações e estado da role temporária

Relatório de grants de 02-11-2026 observa `autoclip_cloud_auditor` existente, `LOGIN=false`, validade `2026-11-15T00:43:58+00:00`, `CONNECTION LIMIT 1`, sem atributos administrativos. A membership observada é `postgres` como membro da role auditora com `ADMIN OPTION`; não é uma associação inversa que dê poderes ao auditor. Grants `CONNECT` e `TEMP`/PUBLIC e memberships permanecem; NOLOGIN desativa novas conexões diretas, não remove grants, membership ou sessões que já estivessem abertas. Snapshot recente registra zero dependências e atributos restritos; a role não foi removida.

## Próxima ordem de correção e evidência

1. Confirmar oficialmente as mudanças de token e implementar/testar rotação atômica antes de homologar OAuth.
2. Bloquear staging até revisar e aprovar a migration 09 e reconcile as duas assinaturas RPC sensíveis; não restaurar a implementação 2-arg permissiva.
3. Ensaiar migrations 03–05 como corte integrado de mídia/Storage, com amostra sintética, backfill medido, restore testado e cleanup desligado.
4. Testar RLS, Storage, DELETE e funções com duas identidades sintéticas em staging isolado, inclusive falhas e roles reais do aplicativo.
5. Mapear caller/schema exposure e dependências de pg_net/cron antes de qualquer ACL change.
6. Revisar secrets, Auth, Edge Functions, Vercel, egress, backup/restore, logs e alertas em interfaces oficiais sob autorização separada.
7. Somente depois submeter uma solicitação independente de autorização para staging; isso não autoriza produção.

Referências: [matriz de migrations](GATE_3_19_MIGRATION_MATRIX.md), [registro de riscos](GATE_3_19_RISK_REGISTER.md), [plano de staging](GATE_3_19_STAGING_PLAN.md) e [decisão GO/NO-GO](GATE_3_19_GO_NO_GO.md).
