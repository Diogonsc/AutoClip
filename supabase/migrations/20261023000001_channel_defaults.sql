-- Padrões por canal: idioma, país e legenda/hashtags padrão.
-- São só rótulos e texto sugerido: o país NÃO altera como ou de onde a publicação é feita
-- (o envio é sempre pela API oficial do TikTok, para a conta que o usuário conectou).
-- A legenda e as hashtags padrão são usadas pelo front para pré-preencher a legenda de uma
-- nova publicação; o usuário vê e pode editar antes de agendar.

alter table public.channels
  add column language text
    check (language is null or language ~ '^[a-z]{2,3}(-[A-Za-z]{2,4})?$'),
  add column country text
    check (country is null or country ~ '^[A-Z]{2}$'),
  add column default_caption text not null default ''
    check (char_length(default_caption) <= 2200),
  add column default_hashtags text not null default ''
    check (char_length(default_hashtags) <= 500);

comment on column public.channels.language is 'Idioma do canal (BCP 47 curto, ex.: pt-BR, en-US). Só organização.';
comment on column public.channels.country is 'País do canal (ISO 3166-1 alpha-2, ex.: BR, US). Só organização.';
comment on column public.channels.default_caption is 'Texto padrão da legenda, pré-preenchido em novas publicações.';
comment on column public.channels.default_hashtags is 'Hashtags padrão (texto livre, ex.: "#fe #motivacao"), pré-preenchidas em novas publicações.';

-- Quem pode editar canais (OWNER/ADMIN/EDITOR) é decidido pela policy channels_update existente.
grant update (language, country, default_caption, default_hashtags) on public.channels to authenticated;
