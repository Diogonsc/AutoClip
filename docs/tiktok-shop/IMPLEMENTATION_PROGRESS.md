# TikTok Shop — acompanhamento de implementação

## Fase 1A — infraestrutura Seller local

**Status:** CONCLUÍDA LOCALMENTE / NO-GO PARA HOMOLOGAÇÃO

### Evidências externas

- O Partner Center Sandbox BR confirmou `GET /authorization/202309/shops` e
  `POST /product/202502/products/search` com `code: 0`.
- Search Products retornou catálogo quando `page_size` foi 20; zero é inválido.
- Get Product foi validado na ferramenta oficial, mas o endpoint/versionamento
  específico do aplicativo ainda precisa ser congelado pelo SDK/API reference.

### Implementado

- Cliente Seller interno com assinatura HMAC, token somente backend, classificação
  de erros e timeout delegado ao chamador.
- Builder de URL Seller com `service_id`, `state` e Redirect URI configurados.
- Get Authorized Shops e Search Products (`POST`, página padrão 20).
- Adaptador de Get Product deliberadamente bloqueado até confirmação da rota
  específica do SDK do aplicativo.
- Variáveis Sandbox sem valores reais no arquivo de exemplo.

### Segurança e gates

- `TIKTOK_SHOP_ENABLED` continua `false`; nenhuma Edge Function foi habilitada.
- Nenhuma migration foi criada/aplicada: a migration de lançamento revoga Shop
  inclusive para `service_role`, e sua reativação requer revisão separada.
- Nenhum token, segredo ou chamada autenticada foi usado nos testes.

### Testes locais

- `bun test supabase/functions/_tests/tiktok_shop_seller.test.ts` — 5 aprovados.
- `node --test scripts/test_tiktok_shop_isolation.mjs` — 5 aprovados.
- frontend typecheck, testes (51) e build — aprovados.

### Fase 1B — bloqueadores

1. Secrets Sandbox configurados exclusivamente no Supabase.
2. `service_id`, host regional e Redirect URI Seller confirmados.
3. Contrato de troca/refresh Seller e endpoint Get Product confirmados no SDK.
4. Migration de reativação/RLS revisada em Supabase local/disposable.
5. Callback e catálogo homologados pelo backend contra Sandbox.

## Fase 1A.1 — correção de contratos Seller

**Status:** GO LOCAL / NO-GO SANDBOX

- Normalizado o contrato observado do Partner Center: `id`/`cipher` para
  `shop_id`/`shop_cipher`, sem descartar lojas válidas.
- Host fixado por allowlist HTTPS; nenhum host de configuração arbitrário é aceito.
- Paginação possui page size válido, limite de páginas, token repetido e AbortSignal.
- Get Product valida ID mas permanece bloqueado até confirmação de rota/versionamento.
- A assinatura HMAC ordena parâmetros e exclui `sign`/`access_token`; a regra do
  header para 202309+ foi confirmada na documentação, mas falta vetor oficial e
  validação Sandbox.

## Fase 1B.2B.3 — início autenticado do Seller OAuth

**Status:** GO LOCAL / NO-GO PARA SANDBOX E PRODUÇÃO

### Implementado localmente

- Edge Function `tiktok-shop-seller-start`, ainda não publicada, registrada em
  `supabase/config.toml`. Ela aceita exclusivamente `POST`, faz validação
  explícita do JWT e executa a RPC de criação de state no contexto do usuário.
- O navegador só envia `workspace_id` UUID. `service_id`, host de autorização e
  Redirect URI são derivados exclusivamente da configuração backend e do builder
  Seller ROW já aprovado; segredos nunca entram no bundle ou na resposta.
- A migration local `20261109000001_harden_seller_oauth_start.sql` exige
  membership com permissão de edição, estado SHA-256 válido e, por usuário e
  workspace, no máximo um state `PENDING` não expirado. O TTL continua sendo dez
  minutos; o state em claro não é persistido.
- `SellerOAuthConnectButton` é um componente isolado e acessível, mas permanece
  invisível e não acionável enquanto `SELLER_OAUTH_UI_ENABLED` e a flag backend
  `TIKTOK_SHOP_ENABLED` forem `false`. Ele não foi ligado a nenhuma tela ativa.

### Evidências locais

- Novo teste da Edge Function cobre JWT ausente/inválido, método inválido,
  workspace inválido ou não autorizado, hash/state únicos, serviço confiável e
  fail-closed da feature flag.
- O teste de callback compartilhado agora reutiliza um state persistido pelo
  fluxo real e confirma conclusão atômica e rejeição de replay.
- pgTAP inclui autorização por workspace, unicidade de tentativa pendente, hash
  inválido e negação de `anon` para a RPC de criação.

### Bloqueadores para qualquer ativação

1. Aplicar as migrations somente após aprovação, em ambiente remoto controlado.
2. Publicar a Edge Function e configurar, exclusivamente no backend,
   `TIKTOK_SHOP_SELLER_SERVICE_ID` e os demais secrets Seller já documentados.
3. Confirmar no Partner Center a Redirect URI compartilhada e executar
   homologação OAuth/Sandbox autorizada, inclusive callback e refresh.
4. Revisar a integração da ação em uma tela Seller autorizada antes de ligar a
   flag; a UI deliberadamente não expõe o botão hoje.

