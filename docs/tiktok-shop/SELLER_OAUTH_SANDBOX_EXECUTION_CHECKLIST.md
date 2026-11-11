# Checklist de homologação controlada — OAuth Seller

**Estado:** preparação local; **NO-GO** para Sandbox e produção.

## Fontes consultadas em 2026-11-10

- [Developer types and `user_type`](https://partner.tiktokshop.com/docv2/page/tts-developer-types): integradores atuam como Seller com `user_type=0`.
- [Creator authorization guide](https://partner.tiktokshop.com/docv2/page/678e3a362dccb8030ea6f98c): distingue Seller (`services.{region}.tiktokshop.com/open/authorize`, `service_id`) de Creator, registra callback com `code`/`state` e os endpoints de token/refresh.
- [Get Authorized Shops](https://partner.tiktokshop.com/docv2/page/6507ead7b99d5302be949ba9): Seller requer token `user_type=0` e escopo `seller.authorization.info` para `GET /authorization/202309/shops`.
- [API versioning](https://partner.tiktokshop.com/docv2/page/api-versioning): o caminho versionado participa da assinatura e a versão suportada deve ser confirmada na referência antes do uso.
- [Guidance for Seller onboarding](https://partner.tiktokshop.com/docv2/page/affiliate-integration): após autorização Seller, validar lojas autorizadas e pesquisar produtos é o fluxo recomendado.

## Auditoria do contrato implementado

| Elemento | Implementação | Estado |
|---|---|---|
| Authorization URL | `https://services.tiktokshop.com/open/authorize`, `service_id`, `state` aleatório servidor-side | Compatível com a fonte consultada; confirmar host regional ROW/BR no Partner Center. |
| Callback | URI fixa compartilhada `https://autoclipe.vercel.app/tiktok/callback`; roteamento pelo state no banco | Pendente de confirmação manual no Partner Center; não aceitar URL dinâmica. |
| Token exchange | `GET https://auth.tiktok-shops.com/api/v2/token/get`, `app_key`, `app_secret`, `auth_code`, `grant_type=authorized_code` | Validado localmente por mocks; Sandbox pendente. |
| Refresh | `GET https://auth.tiktok-shops.com/api/v2/token/refresh`, `refresh_token`, `grant_type=refresh_token` | Validado localmente por mocks; Sandbox pendente. |
| Validações | `code=0`, `user_type=0`, `open_id`, expirações Unix absolutas, escopos mínimos `seller.authorization.info` e `seller.product.basic` | Implementado/testado localmente. |
| Recusa/expiração/replay | State hash SHA-256, TTL máximo 10 min, claim atômico e state terminal | Implementado/testado localmente. |

Não há divergência confirmada entre a documentação consultada e o cliente OAuth
local. A documentação não é prova de que o Partner Center aceitou a URI, o
`service_id`, os escopos ou o contrato de uma conta Sandbox específica.

### Escopos ativos versus concedidos

Os dois escopos estão relatados como ativos no Partner Center. Isso habilita a
possibilidade de concessão, mas o callback continua exigindo que ambos estejam
presentes no `granted_scopes` do token emitido. Um token com só um dos dois é
rejeitado antes de qualquer persistência. Essa diferença está coberta pelos
testes Seller e não deve ser removida sem evidência de contrato oficial.

## Verificador de configuração local

Executar apenas no ambiente controlado que recebeu secrets por operador
autorizado:

```bash
node scripts/verify_seller_oauth_configuration.mjs
```

Ele mostra exclusivamente `READY`, `BLOCKED` ou `WARNING` por nome de variável;
nunca imprime valores. Valida presença de `TIKTOK_SHOP_APP_KEY`,
`TIKTOK_SHOP_APP_SECRET`, `TIKTOK_SHOP_SELLER_SERVICE_ID`, chave AES-256-GCM,
primeira origem de `WEB_URL` e flag local declarativa. O sucesso desse comando
não habilita o Seller nem substitui uma aprovação.

## Pré-condições manuais obrigatórias

1. Owner confirma no Partner Center a Redirect URI exata e o `service_id` Seller
   ROW/BR, com evidência sanitizada.
2. Administrador confirma backup, janela e inventário remoto somente leitura.
3. Secrets são configurados no runtime de Edge Functions; nenhum `VITE_*`,
   browser, log ou ticket recebe secret.
4. Migrations e SHA são revisados; não usar rollback destrutivo para migrations
   já aplicadas.
5. Owner autoriza por escrito uma ativação temporária somente de Sandbox.

## Roteiro E2E Sandbox (não executar sem autorização)

| Cenário | Evidência esperada | Interromper se |
|---|---|---|
| Início autorizado no workspace A | URL Seller oficial e apenas hash de state persistido | URL/secret/configuração aparece na resposta. |
| Usuário sem editor ou workspace B | erro genérico; nenhum state criado | enumeração ou state cross-tenant. |
| Recusa | state `FAILED`, sem tokens | state reabre ou callback tenta trocar code. |
| State expirado/repetido | callback falha fechado; sem token exchange | replay é aceito. |
| Aceite válido | `user_type=0`, escopos mínimos, ciphertext apenas | token/plaintext em DB/log/response. |
| Refresh | lease/fencing preservam a versão mais nova | resposta atrasada sobrescreve token. |
| Revogação | conexão marca reautorização necessária conforme erro oficial | loop de refresh ou perda silenciosa de auditoria. |
| Isolamento A/B | B não lê/consome/atualiza dados de A | qualquer IDOR/RLS bypass. |
| Content Posting | Login Kit, callback, refresh e publicação de teste controlada continuam funcionando | callback Content recebe state Seller ou vice-versa. |

## Sequência segura de publicação e rollback

Seguir `SELLER_DEPLOY_ROLLBACK_RUNBOOK.md`: backup e inventário, migrations
aprovadas, Functions aprovadas com flag ainda `false`, smoke do Content Posting,
e somente então ativação temporária no Sandbox. Em falha: interromper novas
autorizações com a flag, preservar auditoria, não apagar credenciais
automaticamente e usar migration corretiva/versão compatível após análise.

## Decisão objetiva

| Critério | Estado |
|---|---|
| Código, RLS, state, callback e refresh locais | GO local |
| CI/PR no SHA publicado | GO: PR #19 Draft, checks Vercel aprovados na consulta de 2026-11-10 |
| Partner Center / Redirect URI / service ID | BLOQUEADOR — não verificado |
| Secrets backend | BLOQUEADOR — não configurados/verificados |
| Migrations e Functions remotas | BLOQUEADOR — não aplicadas/publicadas |
| E2E Sandbox e regressão remota Content Posting | BLOQUEADOR — não autorizado/executado |

**Conclusão: NO-GO para Sandbox e produção.** A próxima etapa só pode começar
após autorização explícita e confirmação de todas as pré-condições manuais.
