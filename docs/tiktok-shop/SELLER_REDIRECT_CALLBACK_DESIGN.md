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

## Cenário B — URI compartilhada (não implementar sem aprovação)

Se o Partner Center não permitir URI exclusiva, a função publicada em `/tiktok/callback` precisaria roteamento server-side baseado em um marcador de provedor registrado junto ao state antes do redirecionamento. O roteador deve consultar apenas o hash do state, chamar exclusivamente o consumidor daquele provedor e rejeitar state desconhecido, expirado ou de outra família. Não usar parâmetro de fluxo fornecido pelo navegador como autoridade. Este cenário altera o callback Content Posting e exige revisão específica; não está implementado.

## Confirmação manual no Partner Center

1. Verificar se o serviço Seller aceita múltiplas Redirect URLs.
2. Se aceitar, cadastrar exatamente a URI exclusiva proposta, sem curingas, query string ou HTTP.
3. Confirmar que a URI aparece no authorization link e que o service ID corresponde ao serviço Seller.
4. Registrar evidência sem exportar App Secret, tokens ou authorization code.
5. Somente então revisar e publicar o adaptador backend e a rota de chegada.

## GO/NO-GO

**NO-GO:** sem confirmação/cadastro da URI exclusiva, secrets backend, revisão do callback publicado e autorização para Sandbox.  
**GO para 1B.2B:** URI exclusiva confirmada, contrato de callback revisado, migrations aprovadas para ambiente Sandbox e plano de rollback definido.
