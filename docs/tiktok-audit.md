# Auditoria do app no TikTok (Content Posting API)

Sem auditoria, **todo post direto sai privado** (`SELF_ONLY`), mesmo que a API devolva sucesso, e os
posts feitos antes da aprovação continuam privados depois dela. Por isso o app mostra um aviso de
"modo de teste" até o owner ligar a flag **"App aprovado pelo TikTok"** em `/owner/usuarios`.

## Roteiro do vídeo de demonstração
Grave a tela narrando (legendas na tela ajudam) e mostre, nesta ordem:
1. Login no AutoClip e **Conectar canal** → tela de autorização do TikTok → retorno ao app.
2. **Nova publicação**: nome/apelido do criador, lista de privacidade **sem valor padrão**,
   comentário/dueto/stitch **desmarcados** (e desabilitados quando a conta os bloqueia).
3. Divulgação de conteúdo comercial: ligar o toggle sem escolher opção (botão bloqueado), escolher
   "Sua marca" (rótulo *Conteúdo promocional*) e "Conteúdo de marca" (rótulo *Parceria paga*; "Somente eu" some).
4. **Prévia** do vídeo/legenda e a declaração com link para a *Music Usage Confirmation*; marcar a autorização.
5. Agendar → publicação processada → post aparecendo no TikTok (status e histórico).
6. Páginas públicas de **Política de Privacidade** e **Termos** abrindo.

## Cuidados que reprovam
- Pedir escopos que o vídeo não mostra (peça só `user.info.basic`, `video.publish`, `video.upload`).
- Publicar com um clique, sem tela de confirmação.
- Opções que contradizem as configurações da conta do criador.
- Links de política/termos quebrados.

## Limites a respeitar
- ~15 posts por criador por dia (compartilhado entre apps e posts manuais).
- 5 usuários/24h e contas privadas enquanto o app não for auditado.
- Domínio de `PULL_FROM_URL` precisa ser verificado no portal (fotos/carrossel).
