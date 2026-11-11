# Diagnóstico operacional — primeira autorização Seller Sandbox

**Data:** 2026-11-11
**Estado:** diagnóstico local baseado em código, relatos de interface e fontes
oficiais. Nenhuma autorização, chamada Sandbox, deploy, migration remota ou
leitura de secret foi executada.

## Fatos confirmados

- O PR #19 cria a URL Seller oficial com `service_id` backend-only e `state`
  aleatório; a primeira autorização não depende de refresh nem de conexão
  anterior.
- O callback usa state hash, TTL máximo de dez minutos, claim único e rota
  compartilhada que não escolhe provedor por parâmetros do navegador.
- A validação local exige `user_type=0` e que **ambos** os escopos retornados em
  `granted_scopes` sejam `seller.authorization.info` e `seller.product.basic`.
- As capturas relatadas confirmam ambos os escopos como ativos no Partner Center.
  Isso demonstra disponibilidade para o app, mas não substitui a validação de
  `granted_scopes` do token emitido para uma autorização específica.
- O endpoint/function, migrations e feature flag ainda não estão ativos no
  ambiente remoto. Uma URL manual do Partner Center não testa o state/callback
  emitido pelo AutoClip.

## Relatos e hipóteses

| Sintoma relatado | Hipóteses plausíveis | Não confirmado |
|---|---|---|
| Tela abre renovação e informa que a autorização não foi concluída | registro de serviço/autorização parcialmente criado; link emitido no contexto de renovação; tipo de serviço/app exige etapa anterior | o estado real do serviço e o motivo retornado pelo Partner Center |
| Gerenciar autorizações mostra acesso negado e retorna para `/home` | conta não é a principal da loja; papel do Partner Center não inclui gestão; sessão/mercado/app incompatível; restrição temporária de serviço em rascunho | qual conta/role/mercado está efetivamente logado |
| App em rascunho | Development Shop pode testar apps não publicados usando contas de teste, mas elegibilidade depende do tipo de app/mercado/configuração | que o app/serviço específico está elegível no BR e com esse `service_id` |

Para TSP/service authorization, a fonte oficial registra que o Seller principal
é quem pode autorizar o serviço e que a primeira autorização pode depender de
serviço publicado. Não presumir que este fluxo é idêntico ao OAuth Open API
somente porque ambos usam telas de autorização.

## Perguntas manuais para o Partner Center

1. O `service_id` corresponde ao serviço Seller ROW/BR deste app, e não a um
   serviço Creator/TSP diferente?
2. A Redirect URI cadastrada é exatamente
   `https://autoclipe.vercel.app/tiktok/callback`?
3. A conta usada é o main account da Development Shop `SANDBOX_BR7703293130270885633`?
4. O painel mostra o serviço como apto à **primeira** autorização ou somente à
   renovação? Há um registro anterior incompleto que precisa ser cancelado pelo
   owner/suporte?
5. Os dois escopos aparecem ativos para o serviço e poderão constar em
   `granted_scopes` do token Seller? Esta última resposta só é verificável após
   callback autorizado.
6. O tipo do app e o mercado BR permitem autorização de Development Shop com o
   app em rascunho? Se não, qual pré-requisito de revisão/publicação é exigido?

## Procedimento futuro, condicionado a autorização explícita

1. Preencher um arquivo local sanitizado de evidência e executar:

   ```bash
   node scripts/verify_seller_oauth_preflight.mjs ./seller-preflight-evidence.json
   ```

   O arquivo contém somente booleans, URI e nomes de escopo; nunca valores de
   token, secret ou service ID.
2. Executar o verificador de configuração backend, sem imprimir secrets.
3. Confirmar backup, inventário remoto, migration e SHA aprovados.
4. Publicar somente com a flag ainda desligada; executar smoke do Content
   Posting antes de habilitar Seller no Sandbox.
5. Iniciar a primeira autorização **pela UI do AutoClip**, para gerar state
   associado ao workspace. Não usar link manual avulso como prova de integração.
6. Validar callback, scopes concedidos, lojas autorizadas, replay, expiração,
   isolamento A/B, refresh e regressão Content Posting. Desligar a flag ao
   primeiro erro crítico.

## Decisão

| Escopo | Decisão |
|---|---|
| Revisão local do PR | GO — testes locais e preflight preparados |
| Preparação de deploy | NO-GO — aguardam evidência/autorizações manuais e janela aprovada |
| OAuth Sandbox real | NO-GO — Partner Center, secrets, migrations/Functions remotas e autorização explícita pendentes |
