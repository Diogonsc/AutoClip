# TikTok Content Posting API — checklist de auditoria e gravação da demonstração

> O status da auditoria é controlado pela plataforma e começa como `tiktok_audited=false`. Não altere para `true` até o TikTok confirmar a auditoria/aprovação. Este documento não substitui os requisitos atuais do portal de desenvolvedores.

## Preparação antes de gravar

- Use uma conta de teste real, com consentimento do titular, e dados que possam aparecer na gravação.
- Confirme no portal TikTok for Developers quais produtos, escopos e diretrizes se aplicam ao app e ao fluxo de publicação habilitado.
- Mantenha o aplicativo em modo de teste durante a demonstração. Não mostre tokens, segredos, chaves, IDs sensíveis ou dados de outros clientes.
- Prepare um vídeo de teste curto e autorizado, com áudio próprio/licenciado ou sem áudio, legenda e indicação de conteúdo comercial quando aplicável.

## Roteiro sugerido para a gravação

1. Mostrar o nome do app e o fluxo de login/consentimento/autorização do TikTok, incluindo as permissões solicitadas.
2. Mostrar a seleção do canal e a identificação do criador (apelido, @usuário e foto quando a API retornar a URL do avatar).
3. Mostrar a biblioteca, a prévia do vídeo e os metadados detectados: formato, duração e resolução.
4. Mostrar a confirmação explícita de direitos/consentimento do áudio antes de agendar.
5. Mostrar as opções reais retornadas pelo TikTok para privacidade, comentários, dueto e stitch.
6. Mostrar os controles de divulgação comercial: promoção da própria marca e parceria paga, marcados apenas quando aplicáveis.
7. Agendar no modo INBOX e mostrar o estado/resultado sem afirmar que a publicação foi concluída publicamente pela API.
8. Se o portal exigir demonstração de Direct Post, demonstrar o comportamento permitido no estado atual do app de teste e deixar claro que apps não auditados podem ficar restritos a `SELF_ONLY`.
9. Mostrar o histórico/resultado e como a interface explica erros e a ação recomendada.

## Antes de enviar ao TikTok

- Validar que o fluxo gravado corresponde exatamente ao build publicado e às URLs registradas no portal.
- Conferir os requisitos atuais de consentimento, preview, duração, disclosure comercial, identidade do criador e tratamento de erros diretamente no portal.
- Fazer a gravação completa com captura de tela real. Este projeto não gera uma gravação real do TikTok automaticamente.
- Só após aprovação confirmada, alterar `public.platform_flags.tiktok_audited` para `true` por uma operação administrativa controlada.
