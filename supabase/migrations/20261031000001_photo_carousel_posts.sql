-- Suporte a publicações de foto/carrossel. Mantém media_asset_id como primeira mídia para compatibilidade.
alter table public.publication_jobs
  add column if not exists post_type text not null default 'VIDEO' check (post_type in ('VIDEO','PHOTO')),
  add column if not exists media_asset_ids uuid[];

update public.publication_jobs
set media_asset_ids = array[media_asset_id]
where media_asset_ids is null;

create or replace function public.validate_publication_media_assets()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_count integer;
begin
  if new.media_asset_ids is null or cardinality(new.media_asset_ids) = 0 then
    new.media_asset_ids := array[new.media_asset_id];
  end if;
  if new.media_asset_ids[1] is distinct from new.media_asset_id then
    raise exception 'media_asset_id must be the first media_asset_ids entry';
  end if;
  if new.post_type = 'VIDEO' and cardinality(new.media_asset_ids) <> 1 then
    raise exception 'video publication must contain exactly one media asset';
  end if;
  if new.post_type = 'PHOTO' and cardinality(new.media_asset_ids) not between 1 and 35 then
    raise exception 'photo carousel must contain between 1 and 35 images';
  end if;
  foreach v_id in array new.media_asset_ids loop
    select count(*) into v_count from public.media_assets m
      where m.id = v_id and m.workspace_id = new.workspace_id and m.status = 'READY'
        and ((new.post_type = 'PHOTO' and m.mime_type like 'image/%') or (new.post_type = 'VIDEO' and m.mime_type like 'video/%'));
    if v_count <> 1 then raise exception 'publication media asset missing, not ready, wrong workspace or wrong media type'; end if;
  end loop;
  return new;
end; $$;
drop trigger if exists publication_media_assets_guard on public.publication_jobs;
create trigger publication_media_assets_guard before insert or update of media_asset_id, media_asset_ids, post_type, workspace_id on public.publication_jobs
for each row execute function public.validate_publication_media_assets();

create or replace function public.prevent_delete_used_carousel_media()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.publication_jobs j where old.id = any(coalesce(j.media_asset_ids, array[j.media_asset_id])) and j.status <> 'CANCELLED') then
    raise exception 'media asset is referenced by an active publication';
  end if;
  return old;
end; $$;
drop trigger if exists media_asset_carousel_delete_guard on public.media_assets;
create trigger media_asset_carousel_delete_guard before delete on public.media_assets
for each row execute function public.prevent_delete_used_carousel_media();
