# Hardening do início OAuth Seller — pré-homologação

**Data:** 2026-11-10
**Escopo:** PR #19, execução exclusivamente local. Nenhum deploy, migration
remota, secret real, OAuth real ou chamada ao Sandbox foi realizado.

## Controles implementados

| Área | Controle | Evidência local |
|---|---|---|
| Concorrência | `create_seller_oauth_state` serializa por `workspace_id` e `auth.uid()` com advisory transaction lock antes de verificar state `PENDING`. | Duas sessões PostgreSQL independentes: uma criação vence e a concorrente recebe `23505`. |
| State | Somente SHA-256 é persistido; TTL é limitado a 10 minutos; callback faz claim atômico antes da troca. | pgTAP e ensaio Shared OAuth local. |
| Autorização | A Edge Function requer Bearer JWT validado no Auth e chama a RPC no contexto do JWT; `private.can_edit` decide a permissão. | testes unitários e pgTAP de cross-workspace/anon. |
| Feature flag | Backend falha antes de validar JWT, acessar banco ou gerar state. A interface exige simultaneamente flag compilada e permissão. | testes do handler e do componente. |
| Callback compartilhado | O roteador consulta state no servidor, aceita somente um provedor conhecido e falha fechado em state desconhecido, expirado, repetido, ambíguo ou erro de banco. | testes do roteador e ensaio local. |
| Credenciais | Tokens Seller ficam cifrados AES-256-GCM com AAD por workspace/conexão/tipo; RLS/grants não permitem leitura de `seller_credentials` por `anon` ou `authenticated`. | testes Seller e pgTAP. |

## Contrato do início local

`POST /functions/v1/tiktok-shop-seller-start`

- Entrada aceita: `{ "workspace_id": "UUID" }` e Bearer JWT.
- Entrada recusada/não utilizada: `user_id`, `service_id`, `app_key`,
  `app_secret`, `redirect_uri`, host e escopos fornecidos pelo navegador.
- Saída bem-sucedida: somente `{ "authorization_url": "https://services.tiktokshop.com/open/authorize?..." }`.
- Erros são genéricos e `Cache-Control: no-store` é aplicado.
- A interface também recusa URL de autorização fora do origin/caminho oficial
  antes de navegar.

## Callback e isolamento

O callback compartilhado continua em `/tiktok/callback`. Seller usa
`seller_oauth_states`; Content Posting usa `oauth_states`; Creator Affiliate
mantém seu callback/tabelas independentes. Parâmetros como `provider`,
`workspace_id` e `service_id` não participam da decisão de roteamento.

Enquanto `TIKTOK_SHOP_ENABLED=false`, o callback preserva o caminho existente
de Content Posting e o início Seller retorna indisponível antes de criar state.

## Configuração necessária para homologação autorizada

Configurar somente como secrets das Edge Functions Supabase, jamais em Vite ou
no navegador:

- `TIKTOK_SHOP_APP_KEY`
- `TIKTOK_SHOP_APP_SECRET`
- `TIKTOK_SHOP_SELLER_SERVICE_ID`
- `TIKTOK_SHOP_SELLER_TOKEN_ENCRYPTION_KEY`
- `WEB_URL`

Antes de qualquer configuração, confirmar manualmente no Partner Center que a
Redirect URI cadastrada é exatamente `https://autoclipe.vercel.app/tiktok/callback`
e que o `service_id` corresponde ao Seller ROW/BR. Não inferir aceitação de
múltiplas Redirect URIs.

## Ordem de homologação e rollback

1. Aprovar este PR e a janela de alteração; registrar backup e SHA.
2. Em ambiente isolado/autorizado, aplicar migrations na ordem versionada.
3. Publicar `tiktok-oauth-callback` e `tiktok-shop-seller-start` com a mesma
   revisão; manter a flag desligada.
4. Configurar secrets por operador autorizado, confirmando presença sem revelar
   valores.
5. Executar smoke do Content Posting antes e depois de qualquer ativação
   temporária do Seller.
6. Só com aprovação explícita, habilitar temporariamente Seller no Sandbox e
   testar aceite, recusa, expiração, replay, escopos e isolamento A/B.
7. Em falha, desligar a flag, interromper novas tentativas e retornar as
   funções/migrations conforme `SELLER_DEPLOY_ROLLBACK_RUNBOOK.md`; não apagar
   evidência de auditoria nem credenciais sem processo de revogação aprovado.

## GO/NO-GO

**GO local para revisão. NO-GO para Sandbox, deploy e produção.**

Bloqueadores: confirmação do Partner Center/Redirect URI, secrets backend,
migrations e Functions remotas, aprovação de janela, smoke de Content Posting e
homologação OAuth Seller real. Testes locais não substituem essas evidências.
