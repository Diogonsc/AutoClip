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

