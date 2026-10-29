

## Fotos e carrosséis TikTok

A biblioteca aceita JPEG, PNG e WebP. A criação de publicações de foto/carrossel é feita no modo Direct Post (não no modo Caixa de entrada) por `PULL_FROM_URL`. Antes de ativar esse fluxo em produção, configure um domínio HTTPS próprio no Supabase Storage e verifique esse domínio no portal de desenvolvedores do TikTok. Configure o segredo `TIKTOK_VERIFIED_MEDIA_HOST` com o hostname exato usado pelas URLs assinadas. Se a configuração estiver ausente ou não corresponder ao hostname real, o worker bloqueia a publicação antes de chamar a API do TikTok. O aplicativo não tenta tornar o bucket privado público.

Os horários sugeridos no formulário são heurísticas locais (11h30, 14h30 e 18h30 no fuso selecionado), evitam conflitos próximos no mesmo canal e não alegam ser previsões de engajamento.


## Validação desta revisão (28/10/2026)

- Testes automatizados das Edge Functions: 86 aprovados.
- Verificação de sintaxe TypeScript/TSX do frontend: 66 arquivos sem erros de sintaxe.
- Build completo e typecheck do frontend: não executados com sucesso neste ambiente porque as dependências npm não puderam ser instaladas (timeout do registro npm). Execute `npm ci` e `npm run build` em ambiente com acesso ao registro antes de implantar.
- Publicação real de fotos: depende de domínio HTTPS próprio, verificado no portal TikTok e configurado em `TIKTOK_VERIFIED_MEDIA_HOST`; sem isso o worker bloqueia o envio de forma explícita.
