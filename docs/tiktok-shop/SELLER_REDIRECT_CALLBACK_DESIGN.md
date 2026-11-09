# Seller OAuth Redirect e callback — design de preparação

## Estado atual

- Content Posting usa a rota pública web `/tiktok/callback`, que encaminha o fluxo existente para a Edge Function `tiktok-oauth-callback`.
- Creator Affiliate usa uma Edge Function independente: `tiktok-shop-oauth-callback`.
- Seller possui somente adaptadores locais (`tiktok-shop-seller-http.ts`); não há `Deno.serve`, rota web ou função publicada.
- `TIKTOK_SHOP_ENABLED` permanece `false`.

## Cenário A — URI exclusiva (recomendado)

URI proposta: `https://autoclipe.vercel.app/tiktok-shop/seller/callback`.

1. O Partner Center redireciona navegador com `code`, `state` ou erro para a URI exclusiva.
2. A rota web não lê nem persiste tokens; encaminha a requisição ao adaptador Seller de backend configurado para essa URI.
3. O backend hasheia o state recebido, chama `claim_seller_oauth_state`, troca o code somente com App Secret backend, valida `user_type=0` e os escopos mínimos.
4. Access/refresh tokens são cifrados antes da RPC transacional de conclusão. A resposta não contém token, secret, code ou URL de token.
5. Falhas após claim chamam `fail_seller_oauth_state`; state nunca volta a ser utilizável.

### Contrato HTTP proposto

- Método: `GET`.
- Entrada aceita: `state`, `code`, `error` e `error_description` apenas para classificação interna.
- Sucesso: redirecionamento server-side a uma página de conexão concluída, sem parâmetros sensíveis.
- Falha: redirecionamento a uma página genérica de erro ou resposta genérica. Nunca refletir `code`, tokens, segredo, URL de token ou detalhes SQL.
- Não aceitar `redirect_uri`, host, service ID ou workspace pelo navegador.

### Controles

- State criptograficamente aleatório, SHA-256 armazenado, TTL de dez minutos e consumo atômico.
- Estado vinculado a workspace/usuário no banco; callback não depende de sessão de navegador.
- RPCs de claim, conclusão e refresh exclusivas de backend/service role.
- AAD AES-GCM: workspace, conexão, versão e tipo de token.
- CORS não é necessário ao callback de navegação; não conceder origem ampla.

## Cenário B — URI compartilhada (implementação local, desativada)

Como a interface atual do Partner Center mostra apenas um campo de Redirect URI, foi preparada uma alternativa local para manter exatamente `https://autoclipe.vercel.app/tiktok/callback`. Ela não habilita o Seller: `TIKTOK_SHOP_ENABLED` continua uma constante `false` e, nesse estado, o callback Content Posting mantém exatamente o caminho anterior.

Quando e somente quando a flag for revisada e habilitada depois de deploy/migration autorizados, `tiktok-oauth-callback` fará o seguinte:

1. A página web remove `code` e `state` da barra de endereço e os envia à Edge Function existente por `POST`.
2. O roteador consulta no backend, antes de consumir qualquer state, as duas evidências persistidas: `oauth_states.state` ativo para Content Posting e o SHA-256 do valor em `seller_oauth_states.state_hash` com status `PENDING` para Seller.
3. Exatamente uma evidência determina o fluxo. Valor desconhecido, expirado, reproduzido, consulta indisponível ou uma colisão ambígua recebe resultado genérico e **não** é encaminhado ao consumidor Content Posting.
4. O fluxo Content Posting recebe a requisição original, sem alteração de contrato. O fluxo Seller chama somente o adaptador Seller, que faz claim atômico, valida `user_type=0` e os escopos mínimos, cifra as credenciais e conclui pela RPC transacional.

`provider`, `workspace_id`, `service_id`, `redirect_uri` e quaisquer outros query parameters do navegador não participam da decisão. Creator Affiliate continua fora desse roteamento: usa `tiktok-shop-oauth-callback` e seu armazenamento de state próprio.

### Contrato da URL compartilhada

- O Partner Center deve manter cadastrado exatamente `https://autoclipe.vercel.app/tiktok/callback`, sem query string ou curingas.
- A documentação oficial descreve a Redirect URL configurada no aplicativo como o destino do callback, portanto a URL utilizada no fluxo Seller deve ser confirmada manualmente como idêntica ao valor cadastrado. A documentação consultada em 2026-11-09 não confirmou suporte a múltiplas URLs para este aplicativo/mercado.
- O `state` Seller é enviado no link de autorização e é a única correlação aceita no callback; não contém workspace, token, segredo ou indicador de provedor.
- A resposta pública contém apenas resultado controlado e, para Seller, o identificador não sensível `provider: "seller"`; não inclui authorization code, tokens, App Secret, SQL ou URL de token.
- Em navegação `GET` direta para o adaptador, Seller responde com redirecionamento limpo a `/canais?tiktok_shop=connected|error` (ou texto genérico sem parâmetros se `WEB_URL` estiver ausente). Em `POST`, usado pela página web, responde JSON controlado. Métodos diferentes de `GET`/`POST` retornam `405` antes de qualquer consulta ou consumo de state.

Fonte oficial consultada em 2026-11-09: [TikTok Shop Partner Center — OAuth integration guide](https://partner.tiktokshop.com/docv2/page/678e3a362dccb8030ea6f98c). Ela diferencia links Seller (`services.{region}.tiktokshop.com/open/authorize` com `service_id`) de Creator e recomenda validar o `state` no callback do servidor.

## Evidência local adicional

`bun scripts/test_shared_oauth_callback_local.mjs` executa somente contra o Supabase local descartável. O ensaio usa clientes local `authenticated` e `service_role`, cria estados reais pelas RPCs, confirma classificação Content/Seller, estado desconhecido/expirado/ambíguo, conclusão transacional, rejeição de replay e bloqueio RLS de states/credenciais. Não usa App Secret, token TikTok, OAuth real ou Sandbox.

## Confirmação manual no Partner Center

1. Verificar se o serviço Seller aceita múltiplas Redirect URLs.
2. Se aceitar, cadastrar exatamente a URI exclusiva proposta, sem curingas, query string ou HTTP.
3. Confirmar que a URI aparece no authorization link e que o service ID corresponde ao serviço Seller.
4. Registrar evidência sem exportar App Secret, tokens ou authorization code.
5. Somente então revisar e publicar o adaptador backend e a rota de chegada.

## GO/NO-GO

**NO-GO para Sandbox/deploy:** sem confirmação manual da URI compartilhada no Partner Center, secrets backend, revisão da Edge Function publicada e autorização explícita para homologação.
**GO local para 1B.2B.1:** roteador revisado, flag fail-closed, estados isolados, testes de compatibilidade/replay/expiração aprovados e plano de rollback definido.
