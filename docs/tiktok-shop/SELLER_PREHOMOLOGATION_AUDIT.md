# Auditoria de pré-homologação — TikTok Shop Seller OAuth

**Data:** 2026-11-09
**Base auditada:** `origin/main` em `cff8c66` (inclui PR #17)
**Escopo:** leitura de código/configuração versionada e testes locais. Nenhuma chamada TikTok, alteração remota, migration remota, deploy ou secret real foi usado.

## Conclusão executiva

O AutoClip possui uma fundação Seller OAuth local com state hash, criptografia AES-GCM, persistência/RLS, callback compartilhado preparado e refresh com lease. Ela **não está operacionalmente pronta para Sandbox**: não existe endpoint autenticado registrado para iniciar Seller OAuth e não existe interface que o chame. A flag é uma constante `false`, portanto o Seller não é alcançável no runtime publicado atual.

Isso é intencional como postura fail-closed, mas é bloqueador de homologação. Testes locais não constituem prova de configuração do Partner Center, de secrets remotos, de funções publicadas nem de contratos TikTok em execução.

## Inventário

| Área | Arquivo / símbolo | Contrato e dependências | Estado |
|---|---|---|---|
| Frontend, retorno compartilhado | `apps/web/src/pages/TikTokOAuthCallbackPage.tsx` — `TikTokOAuthCallbackPage` | Lê `code/state/error`, remove-os da URL e faz POST a `tiktok-oauth-callback`; resultados Seller controlados vão para `tiktok_shop=`. Depende de Supabase Web configurado. | IMPLEMENTADO, mas Seller não pode ser iniciado pela UI |
| Frontend, início Seller | Busca em `apps/web/src` | Não há botão/hook/rota que invoque início Seller. | **AUSENTE — bloqueador** |
| Content Posting, início | `supabase/functions/tiktok-channel/index.ts`; `_shared/handlers.ts` — `handleChannel` | JWT do usuário -> `assert_channel_access` -> `create_oauth_state` -> Login Kit URL. | IMPLEMENTADO |
| Content Posting, callback | `supabase/functions/tiktok-oauth-callback/index.ts`; `_shared/oauth.ts` | Callback público, state de uso único e `consume_oauth_state`; troca code, cifra tokens e grava conexão. | IMPLEMENTADO; preservado quando Shop está desligado |
| Content Posting, refresh | `_shared/tokens.ts`, `_shared/worker.ts`, `publication-worker` | Refresh e worker próprios, separados de Seller. | IMPLEMENTADO; regressão local coberta |
| Creator Affiliate | `tiktok-shop/index.ts`; `tiktok-shop-oauth-callback/index.ts`; migration `20261031000002_tiktok_shop_affiliates.sql` | State/tabelas `tiktok_shop_*`, callback próprio, `user_type=1`. | PARCIAL/isolado; feature desligada |
| Seller, início de domínio | `_shared/tiktok-shop-seller-flow.ts` — `startSellerOAuth`; `_shared/tiktok-shop-seller-http.ts` — `handleSellerOAuthStartRequest` | Exige adaptação HTTP autenticada com cliente JWT e `create_seller_oauth_state`. `service_id` backend-only. | PARCIAL — adaptador não registrado |
| Seller, state/callback | `_shared/tiktok-shared-oauth-router.ts`; `_shared/tiktok-shared-oauth-classifier.ts`; `tiktok-oauth-callback/index.ts` | Quando a flag for habilitada, classifica state ativo em `oauth_states` ou SHA-256 em `seller_oauth_states`; desconhecido/ambíguo falha fechado. | IMPLEMENTADO LOCALMENTE, inativo |
| Seller, token exchange | `_shared/tiktok-shop-seller-oauth.ts` — `sellerTokenRequest` | GET `auth.tiktok-shops.com/api/v2/token/{get,refresh}`, `grant_type`, `user_type=0`, escopos, timestamps absolutos. AbortSignal é repassado. | IMPLEMENTADO COM MOCKS; contrato real pendente |
| Seller, criptografia | `_shared/tiktok-shop-seller-crypto.ts` | AES-256-GCM via chave backend, AAD workspace/conexão/tipo/versão. | IMPLEMENTADO LOCALMENTE |
| Seller, persistência | migrations `20261108000001..00003`; `_shared/tiktok-shop-seller-persistence.ts` | States, connections, credentials, shops, auditoria, RPCs, RLS, lease/fencing. | IMPLEMENTADO LOCALMENTE; remoto não verificado |
| Seller, refresh | `_shared/tiktok-shop-seller-refresh.ts` | Lease, fencing token e `credential_version`; não há scheduler registrado. | IMPLEMENTADO COMO SERVIÇO, não acionado em produção |
| Edge Functions | `supabase/config.toml` | Registra Content, Creator Shop e outras funções; nenhuma função Seller-start específica. `tiktok-oauth-callback` é a futura rota compartilhada. | PARCIAL |
| Vercel | `apps/web/vercel.json`; `apps/web/src/App.tsx` | SPA rewrite torna `/tiktok/callback` página React; `/m/:token` é o único rewrite para Edge. | IMPLEMENTADO NO CÓDIGO; remoto não verificado |

## Verificações críticas

### 1. Início autenticado Seller — NÃO ATENDIDO

`handleSellerOAuthStartRequest` existe em `_shared/tiktok-shop-seller-http.ts`, mas o próprio comentário registra que não está em `Deno.serve`. Nenhuma função em `supabase/functions/*/index.ts` a monta com `rpcAsUser`, e o frontend não a usa. Logo não há prova de JWT, `workspace_id`, `private.can_edit` ou criação de state em uma requisição Seller real.

**Correção necessária em fase posterior autorizada:** Edge Function de início Seller, autenticada pelo JWT, que obtenha workspace somente por autorização server-side e chame `create_seller_oauth_state` pelo cliente do usuário. A URL de autorização não deve aceitar `service_id`, host ou redirect enviados pelo navegador.

### 2. State, replay, concorrência e isolamento — LOCALMENTE ATENDIDO

As migrations armazenam apenas `state_hash`, TTL máximo de 10 minutos e state terminal. `claim_seller_oauth_state` usa `UPDATE ... WHERE status='PENDING' AND expires_at>now() RETURNING`. RLS e grants impedem leitura direta de states e credenciais por `authenticated`/`anon`; a persistência usa RPCs service-role. O refresh tem lease, fencing token e versão de credencial.

Evidência local: 322 pgTAP e `scripts/test_shared_oauth_callback_local.mjs` passaram. Isso não comprova que essas migrations estejam no projeto Supabase remoto.

### 3. Callback compartilhado — LOCALMENTE ATENDIDO, REMOTO NÃO VERIFICADO

Com `TIKTOK_SHOP_ENABLED=false`, `tiktok-oauth-callback` executa o callback Content Posting existente sem consultar as tabelas Seller. Com habilitação futura, o roteador só despacha após encontrar exatamente um state ativo no backend; não usa `provider`, `workspace_id`, `service_id` ou redirect recebido do navegador. GET Seller gera redirect limpo; POST retorna JSON controlado. Métodos fora de GET/POST recebem 405 antes de leitura de state.

O `tiktok-shop-oauth-callback` do Creator permanece independente. Não há encaminhamento de state Creator para Seller/Content.

### 4. Redirect URI — PENDENTE DE CONFIRMAÇÃO MANUAL

Seller está codificado para `https://autoclipe.vercel.app/tiktok/callback` em `_shared/tiktok-shop-seller-oauth.ts`. O frontend possui essa rota. Porém:

- a amostra `supabase/functions/.env.example` ainda descreve `TIKTOK_REDIRECT_URI` do Content Posting como URL de Edge Function;
- `TIKTOK_SHOP_SELLER_REDIRECT_URI` está documentada, mas não é consumida pelo builder Seller;
- não há leitura do Partner Center nesta auditoria.

O valor efetivamente cadastrado no Partner Center e o `TIKTOK_REDIRECT_URI` remoto devem ser conferidos manualmente antes de qualquer flag/deploy. Não assumir que múltiplas URIs são aceitas.

### 5. Contrato do authorization link — PARCIALMENTE CONFIRMADO

O builder Seller usa `https://services.tiktokshop.com/open/authorize?service_id=…&state=…`, sem parâmetro de redirect dinâmico. O guia oficial consultado em 2026-11-09 diferencia Seller (`service_id`) de Creator (`app_key`) e aponta a Redirect URL cadastrada como destino do callback. A confirmação de host ROW/BR e da URI cadastrada continua dependente do Partner Center/Sandbox.

### 6. Falhas operacionais

- Cancelamento é propagado por `AbortSignal`; há testes de cancelamento no cliente OAuth.
- Não há timeout próprio configurável no cliente Seller: ele depende do sinal da requisição. **Importante:** definir orçamento/timeout explícito antes de Sandbox.
- Falha de lookup compartilhado falha fechado; não há fallback para Content Posting.
- Falhas de token/criptografia marcam state como falho após claim e não o reabrem.
- Indisponibilidade do Supabase ainda não foi medida em ambiente remoto.

### 7. Logs, correlação e dados sensíveis

Os handlers evitam registrar code/tokens/secret e a constraint de auditoria rejeita chaves sensíveis recursivamente. Eventos Seller têm `correlation_id` no banco, porém o callback não propaga um ID de correlação explícito pelos logs. **Importante, não bloqueador local:** definir correlação operacional antes da homologação para diagnóstico sem segredos.

## Ambiente remoto — somente leitura

| Item | Resultado |
|---|---|
| Merge do PR #17 em `main` | VERIFICADO via GitHub: `cff8c66` |
| Migrations Seller aplicadas no Supabase remoto | NÃO VERIFICADO — não foi feita conexão remota |
| Versões publicadas das Edge Functions | NÃO VERIFICADO |
| Secrets/configurações Supabase | NÃO VERIFICADO; valores não foram lidos |
| Projeto Vercel, branch de produção, envs | NÃO VERIFICADO; apenas `apps/web/vercel.json` versionado foi lido |
| Preview Vercel no PR #17 | Observado no GitHub como check; não é evidência de publicação de Edge Function |
| Backups/restore remoto | NÃO VERIFICADO |

## Achados e severidade

| Severidade | Achado | Efeito |
|---|---|---|
| BLOQUEADOR | Não há endpoint/UI para iniciar Seller OAuth | Não é possível gerar state/URL e iniciar autorização Sandbox |
| BLOQUEADOR | Partner Center/Redirect URI/secrets remotos não verificados | Callback/token exchange real não pode ser validado com segurança |
| BLOQUEADOR | Migrations e Edge Function Seller não confirmadas remotamente | Código local não prova compatibilidade do ambiente |
| IMPORTANTE | Timeout próprio ausente no cliente Seller | Risco de ocupação indevida em falha de rede |
| IMPORTANTE | `TIKTOK_SHOP_SELLER_REDIRECT_URI` documentada, mas não consumida | Possível divergência de configuração |
| IMPORTANTE | Sem scheduler/observabilidade de refresh em produção | Refresh não ocorrerá autonomamente |
| MELHORIA | Correlação de logs não é propagada no callback | Diagnóstico operacional limitado |

## Testes locais executados

- `supabase db reset --local --no-seed`
- `supabase test db --local` — 322 pgTAP aprovados
- `bun scripts/test_shared_oauth_callback_local.mjs` — aprovado; usa apenas Supabase local
- testes Seller OAuth/API/callback/refresh e roteador compartilhado — 32 aprovados
- `node --test scripts/test_tiktok_shop_isolation.mjs` — 5 aprovados
- `npm --prefix apps/web run typecheck` — aprovado
- `npm --prefix apps/web test` — 52 aprovados
- `npm --prefix apps/web run build` — aprovado
- `deno check --node-modules-dir=auto supabase/functions/tiktok-oauth-callback/index.ts` — aprovado
- `git diff --check` — aprovado

## Decisão

**NO-GO para Sandbox, deploy e produção.** A entrada em homologação exige primeiro uma implementação revisada do endpoint/UI de início Seller, confirmações remotas em modo leitura e aprovações manuais listadas em `SELLER_SANDBOX_GO_NO_GO.md`.
