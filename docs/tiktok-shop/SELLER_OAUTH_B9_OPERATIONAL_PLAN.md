# Fase 1B.2B.9 — plano operacional de homologação Seller OAuth

**Data:** 2026-11-11  
**Estado:** preparação local concluída; **NO-GO** para Sandbox e produção.

Este documento não autoriza deploy, migrations remotas, alteração de secrets ou
OAuth real. Ele registra o ponto de partida da primeira autorização e a ordem
controlada de uma futura janela autorizada.

## Diagnóstico técnico atual

| Controle | Evidência no repositório | Estado |
|---|---|---|
| Start Seller | `tiktok-shop-seller-start` aceita somente `POST`, valida JWT e usa RPC no contexto do usuário | Testado localmente; não publicado. |
| URL de autorização | builder fixo para `https://services.tiktokshop.com/open/authorize`, com `service_id` backend-only e state aleatório | Testado com mocks; `service_id` real não foi verificado. |
| Callback compartilhado | `tiktok-oauth-callback` classifica state no backend; desconhecido, expirado ou ambíguo falha fechado | Testado localmente; callback remoto não verificado. |
| State | SHA-256 persistido, TTL máximo 10 min, claim único e trava concorrente por usuário/workspace | pgTAP e duas sessões PostgreSQL locais aprovados. |
| Token Seller | exige `user_type=0`, timestamps absolutos e os dois `granted_scopes` mínimos | Testado por mocks; token real não observado. |
| Credenciais | AES-256-GCM com AAD, ciphertext-only, RLS/RPCs e auditoria sanitizada | Testado localmente; chave real ausente. |
| Refresh | lease, fencing token e `credential_version` contra escrita atrasada | Testado localmente; contrato real de rotação pendente. |
| Content Posting | mantém callback existente enquanto `TIKTOK_SHOP_ENABLED=false` | Testado localmente; smoke remoto obrigatório. |

`TIKTOK_SHOP_ENABLED=false` permanece a autoridade no backend. A constante
`SELLER_OAUTH_UI_ENABLED=false` adiciona uma segunda proteção no cliente; o
botão isolado não está ligado a uma rota ativa.

## Partner Center: fatos e hipóteses

### Confirmados por evidência fornecida

- Mercado Brasil; aplicativo AutoClip; serviço público em **Rascunho**.
- Development Shop brasileira criada.
- Redirect URI informada: `https://autoclipe.vercel.app/tiktok/callback`.
- `seller.authorization.info` e `seller.product.basic` ativos no app.
- A primeira concessão OAuth ainda não foi comprovada.
- A interface leva a uma tela de renovação e informa que a autorização não foi
  concluída; a avaliação do aplicativo ainda não foi enviada.

### O que isso não prova

Escopos ativos não são `granted_scopes`, Development Shop disponível não prova
que a conta logada é a principal autorizadora e Rascunho não é, por si só, causa
confirmada de falha. A documentação atual afirma que contas de teste criadas em
Development Shop podem testar aplicativo não publicado; elegibilidade concreta
continua dependente de tipo de app, mercado e Partner Center. [Visão geral de
desenvolvimento](https://partner.tiktokshop.com/docv2/page/64f198e74830a5028854bf8f)

O fluxograma oficial distingue integrações Seller (`user_type=0`) das Creator e
Partner; portanto, tokens de outros fluxos não podem ser reutilizados. [Tipos
de desenvolvedor](https://partner.tiktokshop.com/docv2/page/tts-developer-types)
Após autorização Seller, `GET /authorization/202309/shops` requer token Seller
e `seller.authorization.info`. [Get Authorized
Shops](https://partner.tiktokshop.com/docv2/page/6507ead7b99d5302be949ba9)

### Hipóteses que exigem confirmação manual

1. A tela de “Renovar” pode pertencer a um registro de serviço incompleto ou a
   um fluxo TSP distinto do OAuth Open API de primeira autorização.
2. A conta atual pode não ser a conta principal da Development Shop ou não ter
   autorização para gerenciar o serviço.
3. `service_id`, tipo de serviço, mercado ou situação de revisão podem não ser
   elegíveis para o fluxo Seller ROW/BR pretendido.

Nenhuma hipótese deve ser tratada como causa até que o owner consulte o detalhe
do serviço ou abra ticket no Partner Center.

## Dependências de deploy e rollback

Migrations devem ser aplicadas **na ordem versionada**, após backup e inventário
remoto em leitura: `20261108000001`, `20261108000002`, `20261108000003`,
`20261109000001` e `20261110000001`. Só então a Function de callback
compartilhado e `tiktok-shop-seller-start` podem ser publicadas, ainda com flag
desligada. A ordem não é autorização para executar esses passos.

Secrets exclusivos de Edge Functions, por nome somente:

- `TIKTOK_SHOP_APP_KEY`
- `TIKTOK_SHOP_APP_SECRET`
- `TIKTOK_SHOP_SELLER_SERVICE_ID`
- `TIKTOK_SHOP_SELLER_TOKEN_ENCRYPTION_KEY`
- `WEB_URL`

Antes da ativação temporária, executar smoke de Content Posting com conta de
teste autorizada. Em incidente: voltar a flag ao modo fail-closed, preservar
eventos/credentials, não fazer rollback SQL destrutivo e publicar somente uma
migration corretiva compatível. O procedimento completo está em
`SELLER_DEPLOY_ROLLBACK_RUNBOOK.md`.

## Matriz E2E e dependências externas

| Teste | Aceite | Requer remote/credenciais |
|---|---|---|
| Criação de state | hash, TTL, exclusão concorrente e workspace autorizado | Não; coberto localmente. |
| Aceite/recusa Seller | callback terminal, sem vazamento de code/token | Sim, Partner Center/Development Shop. |
| State expirado/replay | nenhuma troca de token após state terminal | Local e, na janela, Sandbox. |
| `granted_scopes` | ambos os escopos retornados; parcial não persiste | Sim, token real. |
| Credenciais cifradas | apenas ciphertext e metadados permitidos | Local e inspeção remota sanitizada. |
| Lojas autorizadas | `GET /authorization/202309/shops` retorna e vincula ao workspace correto | Sim, token Seller real. |
| Refresh/revogação | timestamps, lease/fencing e reautorização conservadora | Sim, token/tempo/erro real. |
| Isolamento A/B | nenhuma leitura/escrita cross-tenant | Local e cenário remoto com dois workspaces. |
| Content Posting | Login Kit, callback, refresh e fluxo de teste seguem íntegros | Sim, smoke pós-publicação. |

## Prontidão para avaliação futura

| Item | Estado |
|---|---|
| Landing pública | Existe rota `/` localmente; publicação/versão remota não auditada nesta fase. |
| Login e `/app` | Rotas implementadas; `/app` exige sessão e carrega workspace. |
| Conta de demonstração isolada | **Ausente/pende de criação manual**; não criar nesta fase. |
| Tela Seller demonstrável | **Ausente de rota ativa** enquanto flags permanecem desligadas. |
| Material técnico | Checklists, runbook e matriz E2E existem; faltam screenshots/vídeo e evidência Sandbox. |

Assim, não é seguro afirmar que a aplicação esteja pronta para avaliação TikTok
Shop. Antes de enviar avaliação, é preciso habilitar e validar o fluxo em
Sandbox, criar uma conta demonstrativa isolada e disponibilizar uma experiência
Seller revisada que só exponha dados reais autorizados.

## Checklist de primeira autorização (somente após aprovação explícita)

1. Owner confirma service ID Seller ROW/BR, Redirect URI, conta principal e
   aptidão para **primeira** autorização, registrando evidência sanitizada.
2. Executar preflight sanitizado e verificador de configuração sem imprimir
   valores; os dois precisam concluir sem bloqueadores estáticos.
3. Administrador confirma backup, versão remota, migrations e Functions em
   leitura; aprova janela e plano de rollback.
4. Preparar dois workspaces e dois usuários de teste: editor/admin no A e
   usuário sem membership no A para teste de isolamento. Confirmar acesso a
   `/app`, sem usar dados de clientes.
5. Publicar migrations/Functions aprovadas com flag ainda desligada; executar
   smoke Content Posting.
6. Com autorização explícita, habilitar temporariamente somente no Sandbox e
   executar a matriz E2E; interromper ao primeiro evento crítico.
7. Coletar somente eventos sanitizados, retornar a flag ao modo fail-closed se
   necessário e decidir GO/NO-GO posterior.

## Decisão

| Escopo | Status |
|---|---|
| Revisão local e documentação | **GO** |
| Preparação de deploy (planejamento) | **GO condicional** |
| Deploy, migration remota e secrets | **NO-GO** |
| Primeira autorização OAuth Sandbox | **NO-GO** |
| Produção e avaliação TikTok Shop | **NO-GO** |
