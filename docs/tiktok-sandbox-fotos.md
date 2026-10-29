# Fotos/carrossel no Sandbox do TikTok

Fotos usam `PULL_FROM_URL`: o TikTok **baixa** as imagens de uma URL sua, e o domínio/prefixo precisa
estar verificado no portal. O Storage do Supabase é privado e fica em `supabase.co`, então as imagens
passam por um proxy no domínio da Vercel:

```
TikTok → https://autocliptiktok.vercel.app/m/<token>
       → (rewrite em apps/web/vercel.json)
       → Edge Function media-serve (valida o token HMAC, lê o Storage e devolve a imagem)
```

O token expira (1 h), só serve imagens (jpg/png/webp) e nunca vídeos.

## Passo a passo (Sandbox)
1. `supabase db push` e `supabase functions deploy media-serve publication-worker`.
2. Segredos: `supabase secrets set MEDIA_PROXY_SECRET=$(openssl rand -hex 32) TIKTOK_VERIFIED_MEDIA_HOST=autocliptiktok.vercel.app`.
3. Deploy da Vercel (o rewrite `/m/:token` vai junto).
4. Portal TikTok → app AutoClip → aba **Sandbox** → Content Posting API → **Verify domains** →
   **URL prefix** `https://autocliptiktok.vercel.app/` → baixe o arquivo de assinatura e coloque em
   `apps/web/public/` (mesmo nome, na raiz) → deploy → **Verify**.
5. No Sandbox, adicione sua conta em **Target Users** (só ela pode postar) e conecte o canal.
6. Crie uma publicação de fotos. Resultado esperado: evento `PHOTO_SUBMITTED` no histórico e a
   publicação privada (`SELF_ONLY`) no TikTok, pois o app ainda não está auditado.

## Teste rápido do proxy
Gere um token no worker (ou nos testes) e abra `https://autocliptiktok.vercel.app/m/<token>`:
deve devolver a imagem; token adulterado → 403; expirado → 410.
