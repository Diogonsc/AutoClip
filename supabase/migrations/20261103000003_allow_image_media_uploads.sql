-- Alinha a allowlist do bucket privado às imagens aceitas pela biblioteca e pelo
-- fluxo PHOTO: o bucket original aceitava apenas vídeos, bloqueando JPEG/PNG/WebP.
update storage.buckets
set allowed_mime_types = array[
  'video/mp4', 'video/quicktime', 'video/webm',
  'image/jpeg', 'image/png', 'image/webp'
]
where id = 'media';

do $$
begin
  if not exists(select 1 from storage.buckets where id = 'media') then
    raise exception 'media storage bucket is missing';
  end if;
end;
$$;
