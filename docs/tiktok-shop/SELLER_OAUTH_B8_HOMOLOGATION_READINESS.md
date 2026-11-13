# Fase 1B.2B.8 — prontidão para homologação Seller OAuth

**Data:** 2026-11-11  
**Escopo:** revisão local e preparação operacional. Nenhuma autorização OAuth,
chamada Sandbox, deploy, migration remota, alteração de secret ou ativação da
feature flag foi executada.

## Evidências confirmadas fora do repositório

| Evidência do Partner Center | Classificação | Limite da evidência |
|---|---|---|
| Serviço público para Brasil, com status **Rascunho** | Observado manualmente | Não comprova que a conta/loja pode concluir OAuth. |
| Redirect URI `https://autoclipe.vercel.app/tiktok/callback` | Observado manualmente | Deve ser confirmada novamente no momento da janela. |
| `seller.authorization.info` e `seller.product.basic` ativos | Observado manualmente | São permissões configuradas para o app; não são `granted_scopes` de um token. |
| Development Shop brasileira disponível | Observado manualmente | Não prova que a conta logada é a principal autorizadora. |
| Primeira autorização não concluída; interface encaminha para Renovar | Observado manualmente | Não estabelece a causa nem é um teste do callback AutoClip. |
| Avaliação do aplicativo ainda não enviada | Observado manualmente | Não foi comprovado que isso bloqueie Development Shop no mercado/serviço atual. |

O código mantém `SELLER_REQUIRED_SCOPES` com **ambos** os escopos. O callback
só aceita um token após `granted_scopes` conter os dois. Portanto, “ativo no
Partner Center” e “concedido na autorização” são sinais deliberadamente
distintos.

## Auditoria de implementação local

| Área | Componentes principais | Resultado local | Limite remoto |
|---|---|---|---|
| Start autenticado | `tiktok-shop-seller-start/index.ts`, `tiktok-shop-seller-start-handler.ts` | POST/JWT, workspace autorizado, state hash e URL backend-only | Function ainda não foi publicada. |
| Feature flag | `_shared/tiktok-shop-availability.ts`, botão Seller | `false` no backend e na UI; bloqueio antes de gravar state | Não há configuração remota verificada. |
| Callback compartilhado | `tiktok-oauth-callback/index.ts`, `tiktok-shared-oauth-router.ts` | classificação servidor-side, sem fallback para state desconhecido/ambíguo | Não há callback publicado testado. |
| State/RLS | migrations Seller e RPCs | TTL, claim único, exclusão concorrente e isolamento cobertos localmente | Migrations remotas não verificadas. |
| Credenciais | `tiktok-shop-seller-crypto.ts`, persistence | AES-256-GCM/AAD, ciphertext somente e auditoria sem segredos | Chave real não foi configurada. |
| Refresh | `tiktok-shop-seller-refresh.ts` | lease, fencing e `credential_version` cobertos por testes | Token/rotação reais não foram testados. |
| Content Posting | callback existente, roteiro de regressão | flag desligada preserva o caminho anterior; testes locais passam | É obrigatório smoke remoto após publicação. |

## Primeira autorização versus renovação

O fluxo AutoClip para **primeira** autorização não precisa de conexão ou refresh
prévio: o Start gera um state novo, envia somente `service_id` e `state` para a
URL Seller e o callback consome esse state uma vez antes da troca de código.
Uma tela do Partner Center que leva a “Renovar” não percorre esse fluxo, pois
não foi iniciada por state emitido pelo AutoClip enquanto a função/flag não
estão publicadas.

Hipóteses que exigem confirmação do operador, sem diagnóstico definitivo:

1. O link aberto pode pertencer a uma autorização de serviço já incompleta ou
   a um fluxo de renovação, não à primeira autorização Open API.
2. A conta logada pode não ser a conta principal autorizadora da Development
   Shop, ou não ter a permissão do Partner Center necessária para gerenciar
   autorizações.
3. `service_id`, mercado, tipo do serviço ou elegibilidade de app em Rascunho
   podem não corresponder ao fluxo Seller ROW/BR selecionado.
4. A avaliação não enviada pode ser relevante a esse produto/mercado, mas não
   há evidência suficiente para tratá-la como a causa.

As páginas oficiais foram consultadas em 2026-11-11; o portal exige JavaScript
para renderizar o contrato completo na coleta automatizada. Elas devem ser
reabertas pelo proprietário no Partner Center antes da execução para confirmar
o contrato e a elegibilidade efetivos:

- [Developer types e `user_type`](https://partner.tiktokshop.com/docv2/page/tts-developer-types)
- [Get Authorized Shops](https://partner.tiktokshop.com/docv2/page/6507ead7b99d5302be949ba9)
- [Visão geral de desenvolvimento](https://partner.tiktokshop.com/docv2/page/64f198e74830a5028854bf8f)

## Preflight sem credenciais

O repositório oferece dois verificadores que não fazem rede nem mostram
segredos:

```bash
node scripts/verify_seller_oauth_configuration.mjs
node scripts/verify_seller_oauth_preflight.mjs ./seller-preflight-evidence.json
```

O primeiro valida **presença e formato**, no runtime controlado, dos nomes de
variáveis backend. O segundo aceita somente evidência sanitizada (booleans,
URI, status e nomes de escopo). `ready` no segundo comando significa apenas
“pré-requisitos estáticos para uma primeira tentativa”; `oauth_grant=PENDING`
permanece normal antes da autorização e nunca é um GO Sandbox.

Exemplo seguro, sem IDs ou credenciais:

```json
{
  "redirect_uri": "https://autoclipe.vercel.app/tiktok/callback",
  "service_id_confirmed": true,
  "seller_main_account_confirmed": true,
  "service_authorization_status": "INITIAL_AUTHORIZATION_READY",
  "partner_center_scopes": ["seller.authorization.info", "seller.product.basic"],
  "service_public": true,
  "market": "BR",
  "app_status": "DRAFT",
  "development_shop_available": true,
  "oauth_grant_proven": false
}
```

Automatizável localmente: URI canônica, contrato dos dois escopos, formato de
configuração, flag fail-closed e testes de state/RLS. Não automatizável sem
acesso autorizado: papel da conta no Seller Center, estado real do serviço,
aceitação da URI, secrets configurados, migrations/functions remotas e token
emitido.

## Conta de avaliação e workspace isolado

Antes da janela, um operador deve preparar, sem reutilizar workspace ou usuário
de clientes:

1. Um usuário AutoClip de avaliação, autenticado e com papel de edição/admin
   apenas no workspace `Seller OAuth Sandbox` dedicado.
2. Um segundo usuário e workspace de controle, sem membership no workspace de
   avaliação, para validar isolamento/IDOR.
3. Acesso confirmado ao painel autenticado `/app`; o usuário de avaliação não
   deve receber privilégios de platform owner nem acesso a dados de clientes.
4. A conta principal da Development Shop, com permissão de autorizar/gerenciar
   o serviço, confirmada pelo owner no Partner Center.
5. Uma janela com responsável por stop/rollback, logs sanitizados e aprovação
   explícita para ativação temporária de Sandbox.

Nenhuma dessas contas, tokens ou identificadores deve ser criada ou incluída no
repositório durante esta fase.

## Matriz E2E controlada

| Caso | Aceite | Evidência sanitizada | Falha crítica |
|---|---|---|---|
| Start aceito | Usuário editor no workspace A recebe URL oficial; apenas hash de state persiste | correlation ID/state status | URL fora da allowlist ou segredo retornado |
| Recusa do Seller | state fica `FAILED` sem token/credential | evento sem code | retry reutiliza state |
| Replay/expiração | callback não faz token exchange | state terminal/expirado | segunda troca ou alteração de conexão |
| Escopos | token contém os dois `granted_scopes` mínimos | lista de nomes de escopo | persistência com escopo parcial |
| Token/refresh | `user_type=0`, timestamps válidos, ciphertext; lease/fencing impede escrita velha | versões e eventos sem ciphertext | token/secret em log, resposta ou tabela legível |
| Isolamento | workspace B não vê, consome ou atualiza A | negação/RLS | leitura ou mutação cross-tenant |
| Content Posting | Login Kit/callback/refresh e uma operação de teste controlada permanecem funcionais | smoke sanitizado | state atravessa os provedores |

## GO/NO-GO

| Decisão | Estado | Justificativa |
|---|---|---|
| Revisão local da PR #19 | **GO** | implementação fail-closed, testes e documentos locais. |
| Preparação documental de deploy | **GO condicional** | runbook e preflight estão prontos; ainda requer owner, backup e inventário remoto em leitura. |
| Executar deploy/migrations remotas | **NO-GO** | não autorizado e sem verificação de backup/configuração/versões remotas. |
| OAuth Sandbox | **NO-GO** | primeiro fluxo não foi concluído, secrets/Partner Center/callback publicado e autorização explícita pendem. |
| Produção | **NO-GO** | depende de Sandbox E2E aprovado e revisão posterior. |

## Próxima ação operacional recomendada

O owner do Partner Center deve confirmar o `service_id` do fluxo Seller ROW/BR,
a URI exata, a conta principal e se o serviço está apto à **primeira**
autorização. Em seguida, com autorização explícita, engenharia deve executar
somente a etapa de inventário remoto em leitura e preencher a evidência
sanitizada. Não ativar flag, secrets, migrations ou funções antes desse
checkpoint.
