-- Uploads passam por quarentena e validação confiável antes de se tornarem agendáveis.
alter table public.media_assets
  add column validation_status text not null default 'UNVERIFIED'
    check (validation_status in ('PENDING','VALIDATED','REJECTED','UNVERIFIED')),
  add column detected_mime_type text,
  add column validated_at timestamptz,
  add column validator_version text,
  add column validation_error_code text;

-- Mídias anteriores à validação server-side permanecem no histórico, mas não são
-- implicitamente confiáveis para novos agendamentos ou publicações.
update public.media_assets
set validation_status = case when status = 'READY' then 'UNVERIFIED' else 'PENDING' end;

create index media_assets_validation_idx
  on public.media_assets(workspace_id, validation_status, status, created_at desc);

create or replace function private.guard_media_validation_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'READY' and (
    new.validation_status <> 'VALIDATED'
    or new.checksum_sha256 is null
    or new.detected_mime_type is null
    or new.validated_at is null
    or new.validator_version is null
  ) then
    raise exception 'media_requires_server_validation' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.validation_status = 'VALIDATED' and (
    new.storage_key is distinct from old.storage_key
    or new.checksum_sha256 is distinct from old.checksum_sha256
    or new.detected_mime_type is distinct from old.detected_mime_type
  ) then
    raise exception 'validated_media_is_immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger guard_media_validation_state
  before insert or update on public.media_assets
  for each row execute function private.guard_media_validation_state();

-- Usuários não podem criar registros de mídia arbitrários nem finalizar uploads.
revoke insert on public.media_assets from authenticated;
revoke execute on function public.finalize_media(uuid, numeric, integer, integer) from public, anon, authenticated;

create or replace function public.begin_media_upload(
  p_workspace uuid, p_filename text, p_mime text, p_size bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_ext text;
  v_key text;
begin
  if auth.uid() is null or not private.can_edit(p_workspace) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(coalesce(p_filename,'')) not between 1 and 255
     or p_size is null or p_size <= 0 or p_size > 52428800 then
    raise exception 'invalid_media_upload_metadata' using errcode = '22023';
  end if;
  v_ext := case p_mime
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' when 'video/webm' then 'webm'
    else null end;
  if v_ext is null or (p_mime like 'image/%' and p_size > 20971520) then
    raise exception 'media_mime_or_size_not_allowed' using errcode = '22023';
  end if;
  v_key := p_workspace::text || '/' || v_id::text || '/original.' || v_ext;
  insert into public.media_assets(id,workspace_id,original_filename,storage_key,mime_type,file_size_bytes,status,validation_status,created_by)
  values(v_id,p_workspace,btrim(p_filename),v_key,p_mime,p_size,'UPLOADING','PENDING',auth.uid());
  return jsonb_build_object('media_id',v_id,'storage_key',v_key,'quarantine_key',p_workspace::text||'/'||v_id::text||'/upload');
end;
$$;
revoke all on function public.begin_media_upload(uuid,text,text,bigint) from public, anon;
grant execute on function public.begin_media_upload(uuid,text,text,bigint) to authenticated;

create or replace function public.fail_media_upload(p_media_id uuid,p_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.media_assets set status='FAILED',validation_status='REJECTED',
    validation_error_code=left(coalesce(p_code,'UPLOAD_FAILED'),64)
  where id=p_media_id and created_by=auth.uid() and private.can_edit(workspace_id)
    and status='UPLOADING' and validation_status='PENDING';
  if not found then raise exception 'media_upload_not_found_or_not_owned' using errcode='42501'; end if;
end;
$$;
revoke all on function public.fail_media_upload(uuid,text) from public,anon;
grant execute on function public.fail_media_upload(uuid,text) to authenticated;

-- Somente a função confiável (service_role) pode gravar evidência e promover READY.
create or replace function public.complete_media_validation(
  p_media_id uuid, p_size bigint, p_sha256 text, p_detected_mime text,
  p_width integer, p_height integer, p_duration numeric, p_validator_version text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_size <= 0 or p_sha256 !~ '^[a-f0-9]{64}$' or p_validator_version is null then
    raise exception 'invalid_validation_attestation' using errcode='22023';
  end if;
  update public.media_assets set
    file_size_bytes=p_size, checksum_sha256=p_sha256, detected_mime_type=p_detected_mime,
    width=p_width, height=p_height, duration_seconds=p_duration,
    validation_status='VALIDATED', validated_at=now(), validator_version=p_validator_version,
    validation_error_code=null, status='READY'
  where id=p_media_id and status='UPLOADING' and validation_status='PENDING' and mime_type=p_detected_mime;
  if not found then raise exception 'media_validation_state_conflict' using errcode='40001'; end if;
end;
$$;
revoke all on function public.complete_media_validation(uuid,bigint,text,text,integer,integer,numeric,text) from public,anon,authenticated;
grant execute on function public.complete_media_validation(uuid,bigint,text,text,integer,integer,numeric,text) to service_role;

create or replace function public.reject_media_validation(p_media_id uuid, p_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  update public.media_assets set status='FAILED', validation_status='REJECTED',
    validation_error_code=left(coalesce(p_code,'VALIDATION_FAILED'),64)
  where id=p_media_id and status='UPLOADING' and validation_status='PENDING';
end;
$$;
revoke all on function public.reject_media_validation(uuid,text) from public,anon,authenticated;
grant execute on function public.reject_media_validation(uuid,text) to service_role;

-- Destino definitivo é imutável para clientes. Upload direto ocorre apenas na quarentena.
drop policy if exists media_objects_insert on storage.objects;
drop policy if exists media_objects_update on storage.objects;
drop policy if exists media_objects_delete_own_orphan on storage.objects;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('media-quarantine','media-quarantine',false,52428800,
  array['video/mp4','video/quicktime','video/webm','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=52428800,allowed_mime_types=excluded.allowed_mime_types;

create policy media_quarantine_insert on storage.objects for insert to authenticated
with check (
  bucket_id='media-quarantine'
  and private.can_edit(private.storage_workspace(name))
  and exists(select 1 from public.media_assets m
    where m.workspace_id=private.storage_workspace(name)
      and name=m.workspace_id::text||'/'||m.id::text||'/upload'
      and m.status='UPLOADING' and m.validation_status='PENDING'
      and m.created_by=(select auth.uid()))
);
create policy media_quarantine_delete_own on storage.objects for delete to authenticated
using (
  bucket_id='media-quarantine'
  and private.can_edit(private.storage_workspace(name))
  and owner_id=(select auth.uid())::text
  and exists(select 1 from public.media_assets m where m.workspace_id=private.storage_workspace(name)
    and name=m.workspace_id::text||'/'||m.id::text||'/upload' and m.created_by=(select auth.uid())
    and m.status in ('UPLOADING','FAILED'))
);

-- O caminho observado pelo worker só é elegível se houver atestado server-side.
create or replace function private.validate_job_scheduling()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('SCHEDULED','READY') and (tg_op='INSERT' or old.status is distinct from new.status) then
    if not exists(select 1 from public.media_assets m where m.id=new.media_asset_id
      and m.workspace_id=new.workspace_id and m.status='READY'
      and m.validation_status='VALIDATED' and m.checksum_sha256 is not null
      and m.cleanup_lock_token is null) then
      raise exception 'media asset is not validated and READY' using errcode='23514';
    end if;
    if new.scheduled_at < now()-interval '1 minute' then raise exception 'scheduled_at is in the past' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_publication_media_assets()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_count integer:=0;
begin
  if new.post_type='PHOTO' then
    if coalesce(array_length(new.media_asset_ids,1),0) not between 1 and 35 then raise exception 'photo_media_count_invalid' using errcode='23514'; end if;
    foreach v_id in array new.media_asset_ids loop
      if not exists(select 1 from public.media_assets m where m.id=v_id and m.workspace_id=new.workspace_id
        and m.status='READY' and m.validation_status='VALIDATED' and m.checksum_sha256 is not null
        and m.mime_type in ('image/jpeg','image/png','image/webp') and m.cleanup_lock_token is null) then
        raise exception 'photo_media_not_validated' using errcode='23514';
      end if;
      v_count:=v_count+1;
    end loop;
  elsif not exists(select 1 from public.media_assets m where m.id=new.media_asset_id and m.workspace_id=new.workspace_id
      and m.status='READY' and m.validation_status='VALIDATED' and m.checksum_sha256 is not null
      and m.mime_type in ('video/mp4','video/quicktime','video/webm') and m.cleanup_lock_token is null) then
    raise exception 'video_media_not_validated' using errcode='23514';
  end if;
  return new;
end;
$$;
