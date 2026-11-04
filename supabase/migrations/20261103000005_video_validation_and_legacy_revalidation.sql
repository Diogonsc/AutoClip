-- Validação de vídeos em worker isolado e revalidação rastreável de mídia legada.
alter table public.media_assets
  drop constraint if exists media_assets_validation_status_check,
  add constraint media_assets_validation_status_check
    check (validation_status in ('PENDING','VALIDATING','VALIDATED','REJECTED','UNVERIFIED')),
  add column if not exists validation_claim_token uuid,
  add column if not exists validation_locked_until timestamptz,
  add column if not exists validation_next_attempt_at timestamptz,
  add column if not exists validation_attempt_count smallint not null default 0
    check (validation_attempt_count between 0 and 3),
  add column if not exists detected_video_codec text;

create index if not exists media_assets_video_validation_queue_idx
  on public.media_assets(validation_next_attempt_at,created_at,id)
  where status='UPLOADING' and validation_status in ('PENDING','VALIDATING');
create index if not exists media_assets_legacy_validation_idx
  on public.media_assets(workspace_id,created_at,id)
  where status='READY' and validation_status='UNVERIFIED';

-- A limpeza não pode competir com a revalidação nem remover mídia legada sem
-- atestado. Preserva a semântica de dry-run e referências da RPC anterior.
create or replace function public.claim_media_cleanup_candidates(p_limit integer,p_lock uuid)
returns table(media_asset_id uuid,workspace_id uuid,storage_key text,file_size_bytes bigint,dry_run boolean)
language plpgsql security definer set search_path='' as $$
begin
  return query
  with eligible as materialized (
    select m.id,m.workspace_id,m.created_at,s.auto_delete_media_batch_size
    from public.media_assets m join public.workspace_settings s on s.workspace_id=m.workspace_id
    where s.auto_delete_media_enabled and m.status='READY' and m.validation_status='VALIDATED'
      and m.validation_claim_token is null and (m.cleanup_locked_at is null or m.cleanup_locked_at<now()-interval '15 minutes')
      and exists(select 1 from public.publication_jobs published
        where (published.media_asset_id=m.id or m.id=any(coalesce(published.media_asset_ids,'{}'::uuid[])))
          and published.status='PUBLISHED' and published.updated_at<=now()-make_interval(hours=>s.auto_delete_media_grace_hours))
      and not exists(select 1 from public.publication_jobs active
        where (active.media_asset_id=m.id or m.id=any(coalesce(active.media_asset_ids,'{}'::uuid[])))
          and active.status in ('DRAFT','SCHEDULED','READY','PROCESSING','RETRY_WAIT','BLOCKED_APPROVAL','BLOCKED_PERMISSION','BLOCKED_REAUTH','UNKNOWN'))
  ), ranked as (
    select e.id,row_number() over(partition by e.workspace_id order by e.created_at) as workspace_position,e.auto_delete_media_batch_size from eligible e
  ), candidates as (
    select m.id from public.media_assets m join ranked r on r.id=m.id
    where r.workspace_position<=r.auto_delete_media_batch_size order by m.created_at
    limit least(greatest(coalesce(p_limit,1),1),50) for update of m skip locked
  ), locked as (
    update public.media_assets m set cleanup_lock_token=p_lock,cleanup_locked_at=now(),cleanup_attempts=m.cleanup_attempts+1,cleanup_last_error=null
    from candidates c where m.id=c.id returning m.id,m.workspace_id,m.storage_key,m.file_size_bytes
  ) select l.id,l.workspace_id,l.storage_key,l.file_size_bytes,s.auto_delete_media_dry_run
    from locked l join public.workspace_settings s on s.workspace_id=l.workspace_id;
end; $$;
revoke all on function public.claim_media_cleanup_candidates(integer,uuid) from public,anon,authenticated;
grant execute on function public.claim_media_cleanup_candidates(integer,uuid) to service_role;

-- READY + VALIDATING/UNVERIFIED/REJECTED preserva a linha histórica enquanto
-- agendamento/worker continuam exigindo VALIDATED. Somente RPCs service_role
-- podem mudar esses campos (grant de UPDATE do cliente é metadata-only).
create or replace function private.guard_media_validation_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and auth.role() is distinct from 'service_role' and (
    new.status is distinct from old.status
    or new.storage_key is distinct from old.storage_key
    or new.file_size_bytes is distinct from old.file_size_bytes
    or new.validation_status is distinct from old.validation_status
    or new.checksum_sha256 is distinct from old.checksum_sha256
    or new.detected_mime_type is distinct from old.detected_mime_type
    or new.detected_video_codec is distinct from old.detected_video_codec
    or new.duration_seconds is distinct from old.duration_seconds
    or new.width is distinct from old.width
    or new.height is distinct from old.height
    or new.validated_at is distinct from old.validated_at
    or new.validator_version is distinct from old.validator_version
    or new.validation_error_code is distinct from old.validation_error_code
    or new.validation_claim_token is distinct from old.validation_claim_token
    or new.validation_locked_until is distinct from old.validation_locked_until
    or new.validation_next_attempt_at is distinct from old.validation_next_attempt_at
    or new.validation_attempt_count is distinct from old.validation_attempt_count
  ) then raise exception 'media_validation_server_only' using errcode='42501'; end if;
  if new.status='READY' and new.validation_status not in ('VALIDATED','VALIDATING','UNVERIFIED','REJECTED') then
    raise exception 'media_requires_server_validation' using errcode='23514';
  end if;
  if new.status='READY' and new.validation_status='VALIDATED' and (
    new.checksum_sha256 is null or new.detected_mime_type is null
    or new.validated_at is null or new.validator_version is null
  ) then raise exception 'media_requires_server_validation' using errcode='23514'; end if;
  if new.status='READY' and new.validation_status='VALIDATED' and new.mime_type='video/mp4'
     and (new.detected_mime_type<>'video/mp4' or new.detected_video_codec<>'h264') then
    raise exception 'video_requires_h264_attestation' using errcode='23514';
  end if;
  if tg_op='UPDATE' and old.validation_status='VALIDATED' and (
    new.storage_key is distinct from old.storage_key
    or new.checksum_sha256 is distinct from old.checksum_sha256
    or new.detected_mime_type is distinct from old.detected_mime_type
  ) then raise exception 'validated_media_is_immutable' using errcode='23514'; end if;
  return new;
end; $$;

-- Este produto valida MP4 com H.264 e áudio AAC opcional. MOV/WebM são
-- recusados no começo do fluxo até existir suporte de decodificação aprovado.
create or replace function public.begin_media_upload(
  p_workspace uuid,p_filename text,p_mime text,p_size bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=gen_random_uuid(); v_ext text;
begin
  if auth.uid() is null or not private.can_edit(p_workspace) then raise exception 'forbidden' using errcode='42501'; end if;
  if length(coalesce(p_filename,'')) not between 1 and 255 or p_size is null or p_size<=0 or p_size>52428800 then
    raise exception 'invalid_media_upload_metadata' using errcode='22023';
  end if;
  v_ext:=case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
    when 'image/webp' then 'webp' when 'video/mp4' then 'mp4' else null end;
  if v_ext is null or (p_mime like 'image/%' and p_size>20971520) then raise exception 'media_mime_or_size_not_allowed' using errcode='22023'; end if;
  insert into public.media_assets(id,workspace_id,original_filename,storage_key,mime_type,file_size_bytes,status,validation_status,created_by)
  values(v_id,p_workspace,btrim(p_filename),p_workspace::text||'/'||v_id::text||'/original.'||v_ext,p_mime,p_size,'UPLOADING','PENDING',auth.uid());
  return jsonb_build_object('media_id',v_id,'storage_key',p_workspace::text||'/'||v_id::text||'/original.'||v_ext,
    'quarantine_key',p_workspace::text||'/'||v_id::text||'/upload');
end; $$;
revoke all on function public.begin_media_upload(uuid,text,text,bigint) from public,anon;
grant execute on function public.begin_media_upload(uuid,text,text,bigint) to authenticated;

update storage.buckets set allowed_mime_types=array['video/mp4','image/jpeg','image/png','image/webp']
where id='media-quarantine';

-- Claim com lease: duas instâncias não processam o mesmo upload. Claims expirados
-- são recuperados; após 3 tentativas ficam FAILED (upload novo), sem promoção.
create or replace function public.claim_pending_video_validation(p_limit integer default 2,p_lease_seconds integer default 180)
returns table(media_id uuid,workspace_id uuid,storage_key text,mime_type text,file_size_bytes bigint,
              claim_token uuid,storage_source text,attempt_count smallint)
language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  update public.media_assets set status='FAILED',validation_status='REJECTED',
    validation_error_code='VIDEO_VALIDATION_ATTEMPTS_EXHAUSTED',validation_claim_token=null,validation_locked_until=null
  where status='UPLOADING' and validation_status='VALIDATING' and validation_locked_until<now() and validation_attempt_count>=3;
  return query
  with candidates as (
    select m.id from public.media_assets m
    where m.status='UPLOADING' and m.mime_type='video/mp4' and m.validation_attempt_count<3
      and (m.validation_next_attempt_at is null or m.validation_next_attempt_at<=now())
      and (m.validation_status='PENDING' or (m.validation_status='VALIDATING' and m.validation_locked_until<now()))
    order by m.created_at,m.id limit least(greatest(coalesce(p_limit,2),1),10)
    for update skip locked
  ), claimed as (
    update public.media_assets m set validation_status='VALIDATING',validation_claim_token=gen_random_uuid(),
      validation_locked_until=now()+make_interval(secs=>least(greatest(coalesce(p_lease_seconds,180),30),600)),
      validation_next_attempt_at=null,
      validation_attempt_count=m.validation_attempt_count+1,validation_error_code=null
    from candidates c where m.id=c.id
    returning m.id,m.workspace_id,m.storage_key,m.mime_type,m.file_size_bytes,m.validation_claim_token,m.validation_attempt_count
  ) select c.id,c.workspace_id,c.storage_key,c.mime_type,c.file_size_bytes,c.validation_claim_token,'media-quarantine'::text,c.validation_attempt_count from claimed c;
end; $$;
revoke all on function public.claim_pending_video_validation(integer,integer) from public,anon,authenticated;
grant execute on function public.claim_pending_video_validation(integer,integer) to service_role;

create or replace function public.claim_legacy_media_revalidation(p_media_id uuid)
returns table(media_id uuid,workspace_id uuid,storage_key text,mime_type text,file_size_bytes bigint,
              claim_token uuid,storage_source text,attempt_count smallint)
language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  update public.media_assets set validation_status='REJECTED',validation_error_code='LEGACY_VALIDATION_ATTEMPTS_EXHAUSTED',
    validation_claim_token=null,validation_locked_until=null
  where id=p_media_id and status='READY' and validation_status='VALIDATING'
    and validation_locked_until<now() and validation_attempt_count>=3;
  return query
  update public.media_assets m set validation_status='VALIDATING',validation_claim_token=gen_random_uuid(),
    validation_locked_until=now()+interval '10 minutes',validation_attempt_count=m.validation_attempt_count+1,
    validation_error_code=null,validation_next_attempt_at=null
  where m.id=p_media_id and m.status='READY' and m.validation_status in ('UNVERIFIED','VALIDATING')
    and m.cleanup_lock_token is null and m.validation_attempt_count<3
    and (m.validation_claim_token is null or m.validation_locked_until<now())
    and (m.validation_next_attempt_at is null or m.validation_next_attempt_at<=now())
  returning m.id,m.workspace_id,m.storage_key,m.mime_type,m.file_size_bytes,m.validation_claim_token,'media'::text,m.validation_attempt_count;
end; $$;
revoke all on function public.claim_legacy_media_revalidation(uuid) from public,anon,authenticated;
grant execute on function public.claim_legacy_media_revalidation(uuid) to service_role;

create or replace function public.release_media_validation_claim(p_media_id uuid,p_claim_token uuid,p_error_code text)
returns void language plpgsql security definer set search_path='' as $$
declare v_status public.media_status; v_legacy boolean;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  select status,validation_status='VALIDATING' and status='READY' into v_status,v_legacy
  from public.media_assets where id=p_media_id and validation_claim_token=p_claim_token for update;
  if not found then raise exception 'media_validation_claim_stale' using errcode='40001'; end if;
  update public.media_assets set
    status=case when v_legacy then 'READY'::public.media_status when validation_attempt_count>=3 then 'FAILED'::public.media_status else 'UPLOADING'::public.media_status end,
    validation_status=case when v_legacy and validation_attempt_count>=3 then 'REJECTED' when v_legacy then 'UNVERIFIED' when validation_attempt_count>=3 then 'REJECTED' else 'PENDING' end,
    validation_error_code=left(coalesce(p_error_code,'VIDEO_VALIDATION_RETRYABLE'),64),
    validation_claim_token=null,validation_locked_until=null,
    validation_next_attempt_at=case when validation_attempt_count>=3 then null else now()+make_interval(secs=>least(300,15*(2^greatest(validation_attempt_count-1,0))::integer)) end
  where id=p_media_id;
end; $$;
revoke all on function public.release_media_validation_claim(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.release_media_validation_claim(uuid,uuid,text) to service_role;

create or replace function public.reject_video_media_validation(p_media_id uuid,p_claim_token uuid,p_code text)
returns void language plpgsql security definer set search_path='' as $$
declare v_status public.media_status; v_legacy boolean;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  select status,(status='READY') into v_status,v_legacy from public.media_assets
  where id=p_media_id and validation_status='VALIDATING' and validation_claim_token=p_claim_token for update;
  if not found then raise exception 'media_validation_claim_stale' using errcode='40001'; end if;
  update public.media_assets set status=case when v_legacy then 'READY'::public.media_status else 'FAILED'::public.media_status end,
    validation_status='REJECTED',validation_error_code=left(coalesce(p_code,'VIDEO_VALIDATION_REJECTED'),64),
    validation_claim_token=null,validation_locked_until=null,validation_next_attempt_at=null where id=p_media_id;
end; $$;
revoke all on function public.reject_video_media_validation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reject_video_media_validation(uuid,uuid,text) to service_role;

create or replace function public.complete_video_media_validation(
  p_media_id uuid,p_claim_token uuid,p_size bigint,p_sha256 text,p_mime text,p_codec text,
  p_duration numeric,p_width integer,p_height integer,p_validator_version text
) returns void language plpgsql security definer set search_path='' as $$
declare v_legacy boolean;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_size<=0 or p_size>52428800 or p_sha256 !~ '^[a-f0-9]{64}$' or p_mime<>'video/mp4'
     or p_codec<>'h264' or p_duration<=0 or p_duration>600 or p_width<360 or p_height<360
     or p_width>4096 or p_height>4096 or p_width::bigint*p_height>16000000
     or p_validator_version is null then raise exception 'invalid_video_validation_attestation' using errcode='22023'; end if;
  select status='READY' into v_legacy from public.media_assets
  where id=p_media_id and validation_status='VALIDATING' and validation_claim_token=p_claim_token for update;
  if not found then raise exception 'media_validation_claim_stale' using errcode='40001'; end if;
  update public.media_assets set file_size_bytes=p_size,checksum_sha256=p_sha256,detected_mime_type=p_mime,
    detected_video_codec=p_codec,duration_seconds=p_duration,width=p_width,height=p_height,
    validation_status='VALIDATED',validated_at=now(),validator_version=p_validator_version,
    validation_error_code=null,validation_claim_token=null,validation_locked_until=null,validation_next_attempt_at=null,
    status=case when v_legacy then 'READY'::public.media_status else 'READY'::public.media_status end
  where id=p_media_id and mime_type=p_mime;
  if not found then raise exception 'media_validation_state_conflict' using errcode='40001'; end if;
end; $$;
revoke all on function public.complete_video_media_validation(uuid,uuid,bigint,text,text,text,numeric,integer,integer,text) from public,anon,authenticated;
grant execute on function public.complete_video_media_validation(uuid,uuid,bigint,text,text,text,numeric,integer,integer,text) to service_role;

-- Finaliza revalidação de legado no mesmo registro e objeto: nenhum job, quota,
-- referência ou histórico é reescrito. Aceita apenas tipos efetivamente validados.
create or replace function public.complete_legacy_media_revalidation(
  p_media_id uuid,p_claim_token uuid,p_size bigint,p_sha256 text,p_mime text,p_codec text,
  p_duration numeric,p_width integer,p_height integer,p_validator_version text
) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_size<=0 or p_size>(case when p_mime like 'image/%' then 20971520 else 52428800 end)
     or p_sha256 !~ '^[a-f0-9]{64}$' or p_validator_version is null
     or p_mime not in ('video/mp4','image/jpeg','image/png','image/webp') then
    raise exception 'invalid_legacy_media_attestation' using errcode='22023';
  end if;
  if p_mime='video/mp4' and (p_codec<>'h264' or p_duration<=0 or p_duration>600
     or p_width<360 or p_height<360 or p_width>4096 or p_height>4096 or p_width::bigint*p_height>16000000) then
    raise exception 'invalid_legacy_video_attestation' using errcode='22023';
  elsif p_mime<>'video/mp4' and (p_width<360 or p_height<360 or p_width>4096 or p_height>4096 or p_width::bigint*p_height>16000000) then
    raise exception 'invalid_legacy_image_attestation' using errcode='22023';
  end if;
  update public.media_assets set file_size_bytes=p_size,checksum_sha256=p_sha256,
    detected_mime_type=p_mime,detected_video_codec=case when p_mime='video/mp4' then p_codec else null end,
    duration_seconds=case when p_mime='video/mp4' then p_duration else null end,
    width=p_width,height=p_height,validation_status='VALIDATED',validated_at=now(),
    validator_version=p_validator_version,validation_error_code=null,
    validation_claim_token=null,validation_locked_until=null,validation_next_attempt_at=null,status='READY'
  where id=p_media_id and status='READY' and validation_status='VALIDATING'
    and validation_claim_token=p_claim_token and mime_type=p_mime and storage_deleted_at is null;
  if not found then raise exception 'legacy_media_validation_state_conflict' using errcode='40001'; end if;
end; $$;
revoke all on function public.complete_legacy_media_revalidation(uuid,uuid,bigint,text,text,text,numeric,integer,integer,text) from public,anon,authenticated;
grant execute on function public.complete_legacy_media_revalidation(uuid,uuid,bigint,text,text,text,numeric,integer,integer,text) to service_role;

create or replace function public.resume_media_validation_blocked_jobs(p_workspace uuid,p_job_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  if auth.uid() is null or not private.can_edit(p_workspace) then raise exception 'forbidden' using errcode='42501'; end if;
  if coalesce(cardinality(p_job_ids),0)=0 or cardinality(p_job_ids)>500 then raise exception 'invalid job selection' using errcode='22023'; end if;
  perform 1 from public.publication_jobs j where j.workspace_id=p_workspace and j.id=any(p_job_ids) order by j.id for update;
  select count(*) into v_count from public.publication_jobs j
    join public.media_assets m on m.id=j.media_asset_id and m.workspace_id=j.workspace_id
    join public.publication_quota_reservations r on r.publication_job_id=j.id and r.workspace_id=j.workspace_id and r.status='RESERVED'
    join public.channels c on c.id=j.channel_id and c.workspace_id=j.workspace_id and c.connection_status='CONNECTED'
  where j.workspace_id=p_workspace and j.id=any(p_job_ids) and j.status='BLOCKED_PERMISSION'
    and j.last_error_code='MEDIA_VALIDATION_REQUIRED' and j.remote_publish_id is null and j.scheduled_at>now()
    and m.status='READY' and m.validation_status='VALIDATED' and m.checksum_sha256 is not null;
  if v_count<>cardinality(p_job_ids) then raise exception 'media_resume_preconditions_failed' using errcode='23514'; end if;
  update public.publication_jobs set status='SCHEDULED',last_error_code=null,last_error_message=null,
    next_attempt_at=null,locked_at=null,locked_by=null
  where workspace_id=p_workspace and id=any(p_job_ids);
  insert into public.audit_logs(workspace_id,actor_user_id,action,entity_type,metadata)
    values(p_workspace,auth.uid(),'media_validation_jobs_resumed','publication_job',jsonb_build_object('job_count',v_count));
  return v_count;
end; $$;
revoke all on function public.resume_media_validation_blocked_jobs(uuid,uuid[]) from public,anon;
grant execute on function public.resume_media_validation_blocked_jobs(uuid,uuid[]) to authenticated;

-- O worker deve bloquear vídeo enquanto não for validado; mantém atualizações
-- READY/VALIDATED apenas, e impede agendamento de MOV/WebM não aceitos no produto.
create or replace function public.validate_publication_media_assets()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if new.post_type='PHOTO' then
    if coalesce(array_length(new.media_asset_ids,1),0) not between 1 and 35 then raise exception 'photo_media_count_invalid' using errcode='23514'; end if;
    foreach v_id in array new.media_asset_ids loop
      if not exists(select 1 from public.media_assets m where m.id=v_id and m.workspace_id=new.workspace_id
        and m.status='READY' and m.validation_status='VALIDATED' and m.checksum_sha256 is not null
        and m.mime_type in ('image/jpeg','image/png','image/webp') and m.cleanup_lock_token is null) then raise exception 'photo_media_not_validated' using errcode='23514'; end if;
    end loop;
  elsif not exists(select 1 from public.media_assets m where m.id=new.media_asset_id and m.workspace_id=new.workspace_id
    and m.status='READY' and m.validation_status='VALIDATED' and m.detected_mime_type='video/mp4'
    and m.detected_video_codec='h264' and m.checksum_sha256 is not null and m.cleanup_lock_token is null) then
    raise exception 'video_media_not_validated' using errcode='23514';
  end if;
  return new;
end; $$;
