# Gate 3.12 — inventário técnico de componentes

## Escopo e evidência

Este inventário é uma inspeção estática do worktree atual. Ele não comprova deploy ou configuração remota. O repositório contém **29 migrations SQL**, **12 diretórios de Edge Functions com `index.ts`**, e **14 arquivos pgTAP** em `supabase/tests/database`. Diretórios `_shared` e `_tests` são suporte, não funções implantáveis. O estado Cloud só é confirmado para o preflight TLS histórico e a contenção NOLOGIN da role auditora, conforme [relatório Gate 3.11](CLOUD_SECURITY_AUDIT_FINAL_REPORT.md).

Status usados: **INSPEÇÃO LOCAL** = código/migration lido; **VALIDADO LOCALMENTE** = teste local executado; **PENDENTE REMOTO** = deploy/configuração Cloud não comprovados; **NÃO AVALIADO** = sem evidência suficiente.

## Banco e dados

| Componente | Responsabilidade | Origem principal | Dependências/superfície | Dados e autorização esperada | Evidência / status |
|---|---|---|---|---|---|
| `public` — workspaces, membros, perfis e configurações | Identidade SaaS, papéis OWNER/ADMIN/EDITOR/VIEWER | `20261020000001_schema.sql`, `20261020000002_rls.sql` | Supabase Auth `auth.users`; RLS e helpers `private.*` | IDs, nomes e membership; membership do workspace via `auth.uid()` | Migrations + pgTAP `01_isolation`; INSPEÇÃO LOCAL, Cloud PENDENTE |
| Canais e `oauth_connections` | Associação workspace–conta TikTok e tokens OAuth cifrados | Migrations base e `20261021000002_tiktok_integration.sql` | Edge Functions de OAuth e worker; FKs compostas `(channel_id, workspace_id)` | Tokens nunca devem ser retornados ao cliente; acesso backend privilegiado separado | INSPEÇÃO LOCAL; isolamento revisitado em `06_tiktok_shop_token_isolation`; Cloud PENDENTE |
| `media_assets` e publicação | Mídia, jobs, tentativas, eventos, logs e notificações | Migrations base + carrossel, vídeo e batches | RLS; Storage privado; worker, TikTok, quotas | Paths, legendas e metadados podem ser sensíveis; membro/workspace + papel | INSPEÇÃO LOCAL; testes 01–14 disponíveis; estado Cloud PENDENTE |
| Entitlements, quotas e reservas | Planos, trial, ciclos, reservas e auditoria de limpeza | `20261102000001_saas_entitlements_and_media_retention.sql` | triggers/RPCs `SECURITY DEFINER`, filas e cancelamentos | Leituras por workspace; mutações transacionais e autorização por papel | INSPEÇÃO LOCAL; pgTAP 07/08; cobrança desligada/fora do escopo |
| Lotes/grupos | Agrupamento de canais e operações de lote/reagendamento | `20261103000001_account_groups_and_publication_batches.sql`, `20261103000002_batch_management_and_carousels.sql` | FKs compostas, RPCs idempotentes, UI | Membros do mesmo workspace; operações atômicas por chave de idempotência | INSPEÇÃO LOCAL; pgTAP 09/10; Cloud PENDENTE |
| Validação de mídia | Quarentena, conclusão de upload, claims/leases e validação FFmpeg | Migrations `20261103000004`–`08` | Storage, `media-validate`, API worker HMAC | Worker confiável; completar/rejeitar por claim token; RLS/service role | INSPEÇÃO LOCAL; pgTAP 11–14; homologação operacional PENDENTE |
| `private` | Helpers de autorização, triggers e funções internas | Migrations base e posteriores | Não exposto como schema PostgREST conforme intenção local; grants específicos | SECURITY DEFINER, `search_path=''` predominante; validar owner/EXECUTE no Cloud | INSPEÇÃO LOCAL; exposição Cloud PENDENTE |
| Storage | Bucket `media`, privado, políticas por prefixo workspace | `20261020000003_storage_and_queue.sql`, políticas posteriores | `storage.buckets`, `storage.objects`, signed URL e funções de validação | Arquivos privados; prefixo UUID de workspace e membership | Configuração local inspecionada; bucket/policies Cloud NÃO VERIFICADOS |
| Extensões | `pg_cron` para recuperação/rotinas; `pg_net` para chamadas internas | `20261020000003_storage_and_queue.sql`, `20261021000002_tiktok_integration.sql` | Vault, Edge Functions, schemas `cron`, `net`/`extensions` | Capacidade externa e comandos agendados são sensíveis | Gate 3.3 reportou ACLs ligadas a pg_net; eficácia/impacto completo PENDENTE |

## Edge Functions e processos

| Função/processo | Responsabilidade e dependências | Acesso/segredos | Status da análise |
|---|---|---|---|
| `admin-users` | Operações administrativas de usuário/workspace e mídia | `SUPABASE_SERVICE_ROLE_KEY`; autentica solicitante e allowlist de owners | INSPEÇÃO LOCAL; revisar ações destrutivas e deployment/configuração Cloud |
| `client-approval` | Fluxo de aprovação de publicação por link/token | RPCs e tokens de aprovação | INSPEÇÃO LOCAL; autorização e expiração remota PENDENTES |
| `media-cleanup` | Claim de candidatos e remoção física Storage | `WORKER_SECRET`, service role; default dry-run/configuração por workspace | INSPEÇÃO LOCAL; não ativar. Janela não atômica entre Storage delete e RPC de conclusão |
| `media-serve` | Proxy de imagem para TikTok via URL HMAC de curta duração | `MEDIA_PROXY_SECRET`, service role Storage | INSPEÇÃO LOCAL; teste de expiração/anti-replay e domínio Cloud PENDENTES |
| `media-validate` | Confere usuário/token, workspace e quarentena, valida/promove asset | `SUPABASE_SERVICE_ROLE_KEY`; status e path do asset | INSPEÇÃO LOCAL; latência/memória/limites e Storage Cloud PENDENTES |
| `publication-worker` | Claim/recuperação, publicação e consulta de status | Service role + credenciais TikTok cifradas | INSPEÇÃO LOCAL; cron/deploy/segredos Cloud PENDENTES |
| `tiktok-channel` | Iniciar OAuth, creator info, revogar/desconectar | JWT repassado a RPC `assert_channel_access`; token só servidor | INSPEÇÃO LOCAL; confirmação de JWT/redirect Cloud PENDENTE |
| `tiktok-oauth-callback` | Callback sem JWT com state de uso único, troca code e salva tokens cifrados | Service role no backend; encryption key | INSPEÇÃO LOCAL; OAuth real não executado |
| `tiktok-shop` | OAuth, sincronização de produto e dados Shop | JWT/RPC de acesso; Shop secrets e tokens cifrados | INSPEÇÃO LOCAL; endpoint/escopos Shop e deploy PENDENTES |
| `tiktok-shop-oauth-callback` | Consome state e persiste conexão Shop | Service role, segredo de criptografia | INSPEÇÃO LOCAL; callback real não executado |
| `tiktok-shop-publish` | Publicação Shop e reconciliação | Service role e tokens Shop cifrados | INSPEÇÃO LOCAL; integração externa não homologada |
| `video-worker-api` | HMAC, nonce e endpoints de validação/heartbeat | Segredo HMAC e service role | INSPEÇÃO LOCAL; rotação/segredos/deploy Cloud PENDENTES |
| Worker Docker local | Baixa tarefa, valida FFmpeg/FFprobe e reporta por API HMAC | Credenciais locais/worker, rede e volume temporário | Código/Compose local inspecionados; autostart, recuperação e observabilidade no host PENDENTES |

`supabase/config.toml` e `verify_jwt` são configuração local; não provam os flags das funções Cloud. Deploy/verificação requerem interface oficial e autorização própria. Jobs em cron, filas, retries, quotas ou publicações reais não foram consultados nem disparados neste Gate.

## Frontend e infraestrutura

| Componente | Arquivos | Superfície / proteção esperada | Evidência / status |
|---|---|---|---|
| Cliente Supabase | `apps/web/src/lib/supabase.ts` | Usa `VITE_SUPABASE_URL` e chave anon pública; sessão persistida e refresh; nunca deve conter service role | INSPEÇÃO LOCAL; domínio, envs e deploy Vercel PENDENTES |
| Rotas e workspace ativo | `apps/web/src/App.tsx`, providers e páginas | Rotas autenticadas e contexto de workspace; chamadas com `workspace_id`; backend/RLS deve ser autoridade final | INSPEÇÃO LOCAL; cross-tenant de produção PENDENTE |
| UI de mídia, publicação e batches | `apps/web/src/pages/*`, `components/*`, `lib/hooks.ts` | Supabase JS usa credencial pública; RPCs para operações transacionais; URL assinada temporária para preview | INSPEÇÃO LOCAL; validar expiração/CSP e workspace no Cloud |
| Admin UI | `UsersAdminPage.tsx`, Edge Function `admin-users` | Não deve conter chave administrativa; acesso mediado por endpoint e allowlist | INSPEÇÃO LOCAL; configuração de owner Cloud PENDENTE |
| Vercel | `apps/web/vercel.json`, scripts/docs de deploy | Rewrites para proxy de mídia, build e variáveis `VITE_*` | Arquivos locais disponíveis; projeto, domains, envs, headers e deployments NÃO VERIFICADOS |
| Supabase local | `supabase/config.toml`, `supabase/migrations`, `supabase/tests/database` | CLI/local stack identificada como `tiktok-saas`; jamais confundir com Cloud ref | INSPEÇÃO LOCAL; 29 migrations, ledger Cloud PENDENTE |
| CI/CD e deploy | `deploy/`, `docs/DEPLOY_RUNBOOK.md`, scripts | Mudanças Cloud exigem hash, janela, backup e autorização separada | Runbooks locais; pipelines/deploy remotos NÃO VERIFICADOS |
| Configuração ambiental | `.env.example`, `apps/web/.env.example`, `supabase/functions/.env.example`, `deploy/local-worker/.env.example` | Só nomes/placeholder; segredos reais nunca em VITE/frontend/repo | Arquivos template inspecionados; valores remotos não lidos |

## Superfícies SQL observadas localmente

A varredura textual encontrou 29 arquivos de migrations, 56 declarações `CREATE POLICY`, 36 ocorrências `ENABLE ROW LEVEL SECURITY` e 94 ocorrências textuais de `SECURITY DEFINER` em 23 arquivos de migration. Esses números são **contagens de texto, não contagens deduplicadas de objetos atuais** (há `CREATE OR REPLACE` e versões sucessivas). Extensões declaradas localmente incluem `pg_cron` e `pg_net`. As regras de workspace usam helpers `private.is_member/can_edit/can_admin/is_owner`, FKs compostas com `workspace_id` e políticas por operação; testes pgTAP testam isolamento em fixtures.

Não se conclui que todas as funções ou policies sejam perfeitas: ainda faltam revisão individual da definição/owner/EXECUTE real de cada rotina, comparação com o schema remoto e testes negativos integrados no ambiente autorizado. O Gate Cloud 3.3 registrou ACLs públicas/extensão e não foi revogado nada neste Gate.
