-- Do not let the validator claim a PENDING row while the browser is still
-- uploading its quarantine object. Completion is recorded only by the trusted
-- media-validate Edge Function after it has downloaded and size-checked the
-- exact private object.
alter table public.media_assets
  add column if not exists upload_completed_at timestamptz;

revoke update (upload_completed_at) on public.media_assets from public, anon, authenticated;

create index if not exists media_assets_video_validation_ready_queue_idx
  on public.media_assets(validation_next_attempt_at, created_at, id)
  where status='UPLOADING' and validation_status in ('PENDING','VALIDATING')
    and upload_completed_at is not null;

create or replace function public.mark_media_upload_completed(p_media_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_workspace uuid; v_size bigint; v_state text; v_completed timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  select workspace_id,file_size_bytes,status::text||':'||validation_status,upload_completed_at
    into v_workspace,v_size,v_state,v_completed
  from public.media_assets where id=p_media_id for update;
  if not found then raise exception 'media_not_found' using errcode='P0002'; end if;
  if v_completed is not null then return; end if;
  if v_state<>'UPLOADING:PENDING' then
    raise exception 'media_upload_state_conflict' using errcode='40001';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id='media-quarantine'
      and o.name=v_workspace::text||'/'||p_media_id::text||'/upload'
      and coalesce(o.metadata->>'size','') ~ '^[0-9]+$'
      and (o.metadata->>'size')::bigint=v_size
  ) then
    raise exception 'media_upload_object_missing_or_size_mismatch' using errcode='23514';
  end if;
  update public.media_assets set upload_completed_at=now()
    where id=p_media_id and upload_completed_at is null;
end; $$;
revoke all on function public.mark_media_upload_completed(uuid) from public,anon,authenticated;
grant execute on function public.mark_media_upload_completed(uuid) to service_role;

create or replace function public.claim_pending_video_validation(p_limit integer default 2,p_lease_seconds integer default 180)
returns table(media_id uuid,workspace_id uuid,storage_key text,mime_type text,file_size_bytes bigint,
              claim_token uuid,storage_source text,attempt_count smallint)
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  update public.media_assets set status='FAILED',validation_status='REJECTED',
    validation_error_code='VIDEO_VALIDATION_ATTEMPTS_EXHAUSTED',validation_claim_token=null,validation_locked_until=null
  where status='UPLOADING' and validation_status='VALIDATING' and validation_locked_until<now()
    and validation_attempt_count>=3;
  return query
  with candidates as (
    select m.id from public.media_assets m
    where m.status='UPLOADING' and m.mime_type='video/mp4' and m.upload_completed_at is not null
      and m.validation_attempt_count<3
      and (m.validation_next_attempt_at is null or m.validation_next_attempt_at<=now())
      and (m.validation_status='PENDING' or (m.validation_status='VALIDATING' and m.validation_locked_until<now()))
    order by m.created_at,m.id limit least(greatest(coalesce(p_limit,2),1),10)
    for update skip locked
  ), claimed as (
    update public.media_assets m set validation_status='VALIDATING',validation_claim_token=gen_random_uuid(),
      validation_locked_until=now()+make_interval(secs=>least(greatest(coalesce(p_lease_seconds,180),30),600)),
      validation_next_attempt_at=null,validation_attempt_count=m.validation_attempt_count+1,validation_error_code=null
    from candidates c where m.id=c.id
    returning m.id,m.workspace_id,m.storage_key,m.mime_type,m.file_size_bytes,m.validation_claim_token,m.validation_attempt_count
  ) select c.id,c.workspace_id,c.storage_key,c.mime_type,c.file_size_bytes,c.validation_claim_token,
      'media-quarantine'::text,c.validation_attempt_count from claimed c;
end; $$;
revoke all on function public.claim_pending_video_validation(integer,integer) from public,anon,authenticated;
grant execute on function public.claim_pending_video_validation(integer,integer) to service_role;
