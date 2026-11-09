# Seller OAuth — checklist de entrada para Sandbox

## Bloqueadoras

- [ ] Cadastrar e confirmar no Partner Center uma Redirect URI exclusiva para Seller, proposta: `https://autoclipe.vercel.app/tiktok-shop/seller/callback`.
- [ ] Confirmar no Partner Center se o aplicativo aceita mais de uma Redirect URI. Se não aceitar, definir roteamento de servidor para a URI compartilhada sem permitir que state de Content Posting, Creator ou Seller seja consumido por outro fluxo.
- [ ] Implementar e revisar o adaptador público Seller somente após a decisão de URI; ele deve chamar exclusivamente as RPCs Seller e permanecer separado de `tiktok-oauth-callback` e `tiktok-shop-oauth-callback`.
- [ ] Configurar no backend, fora do repositório, App Key, App Secret, service ID e chave AES-256 de Seller. Nunca configurar no frontend.
- [ ] Aplicar migrations em ambiente Sandbox autorizado e validar OAuth, token exchange, lojas e refresh reais.

## Importantes, não bloqueadoras para iniciar Sandbox controlado

- [ ] Definir observabilidade de eventos `OAUTH_*` e `REFRESH_*`, sem token, code ou URL de token.
- [ ] Definir job/scheduler de refresh somente após validar a política de rotação real do refresh token Seller.
- [ ] Validar no Sandbox se `granted_scopes` é preservado ou alterado no refresh e revalidar as capacidades críticas.

## Melhorias futuras

- [ ] Métricas agregadas de lease perdida, reautorização e rate limit.
- [ ] Processo administrativo de rotação da chave de criptografia por `encryption_key_version`.

## Decisão atual

**NO-GO para Sandbox autenticado e deploy.** A implementação local é testada, mas falta a Redirect URI Seller confirmada, secrets backend e a publicação controlada do callback. `TIKTOK_SHOP_ENABLED` continua `false`.
