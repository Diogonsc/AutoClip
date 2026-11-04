-- Replay protection for the narrow video-worker Edge API. The worker itself
-- never receives service_role; only the trusted Edge runtime can call this RPC.
create table if not exists public.video_worker_api_nonces (
  nonce uuid primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.video_worker_api_nonces enable row level security;
revoke all on public.video_worker_api_nonces from public, anon, authenticated;
grant select, insert, delete on public.video_worker_api_nonces to service_role;

create or replace function public.consume_video_worker_api_nonce(p_nonce uuid,p_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_inserted integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  if p_nonce is null or p_expires_at is null or p_expires_at<=now()
     or p_expires_at>now()+interval '2 minutes' then
    raise exception 'worker_nonce_invalid' using errcode='22023';
  end if;
  delete from public.video_worker_api_nonces where expires_at<now();
  insert into public.video_worker_api_nonces(nonce,expires_at)
    values(p_nonce,p_expires_at) on conflict do nothing;
  get diagnostics v_inserted=row_count;
  return v_inserted=1;
end; $$;
revoke all on function public.consume_video_worker_api_nonce(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.consume_video_worker_api_nonce(uuid,timestamptz) to service_role;

-- An expired lease is no longer allowed to approve, reject, or release a task.
create or replace function public.complete_video_media_validation(
  p_media_id uuid,p_claim_token uuid,p_size bigint,p_sha256 text,p_mime text,p_codec text,
  p_duration numeric,p_width integer,p_height integer,p_validator_version text
) returns void language plpgsql security definer set search_path='' as $$
declare v_legacy boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_size<=0 or p_size>52428800 or p_sha256 !~ '^[a-f0-9]{64}$' or p_mime<>'video/mp4'
     or p_codec<>'h264' or p_duration<=0 or p_duration>600 or p_width<360 or p_height<360
     or p_width>4096 or p_height>4096 or p_width::bigint*p_height>16000000
     or p_validator_version is null then raise exception 'invalid_video_validation_attestation' using errcode='22023'; end if;
  select status='READY' into v_legacy from public.media_assets
  where id=p_media_id and validation_status='VALIDATING' and validation_claim_token=p_claim_token
    and validation_locked_until>now() for update;
  if not found then raise exception 'media_validation_claim_stale' using errcode='40001'; end if;
  update public.media_assets set file_size_bytes=p_size,checksum_sha256=p_sha256,detected_mime_type=p_mime,
    detected_video_codec=p_codec,duration_seconds=p_duration,width=p_width,height=p_height,
    validation_status='VALIDATED',validated_at=now(),validator_version=p_validator_version,
    validation_error_code=null,validation_claim_token=null,validation_locked_until=null,validation_next_attempt_at=null,
    status='READY'
  where id=p_media_id and mime_type=p_mime;
  if not found then raise exception 'media_validation_state_conflict' using errcode='40001'; end if;
end; $$;
revoke all on function public.complete_video_media_validation(uuid,uuid,bigint,text,text,text,numeric,integer,integer,text) from public,anon,authenticated;
grant execute on function public.complete_video_media_validation(uuid,uuid,bigint,text,text,text,numeric,integer,integer,text) to service_role;

create or replace function public.reject_video_media_validation(p_media_id uuid,p_claim_token uuid,p_code text)
returns void language plpgsql security definer set search_path='' as $$
declare v_status public.media_status; v_legacy boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  select status,(status='READY') into v_status,v_legacy from public.media_assets
  where id=p_media_id and validation_status='VALIDATING' and validation_claim_token=p_claim_token
    and validation_locked_until>now() for update;
  if not found then raise exception 'media_validation_claim_stale' using errcode='40001'; end if;
  update public.media_assets set status=case when v_legacy then 'READY'::public.media_status else 'FAILED'::public.media_status end,
    validation_status='REJECTED',validation_error_code=left(coalesce(p_code,'VIDEO_VALIDATION_REJECTED'),64),
    validation_claim_token=null,validation_locked_until=null,validation_next_attempt_at=null where id=p_media_id;
end; $$;
revoke all on function public.reject_video_media_validation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reject_video_media_validation(uuid,uuid,text) to service_role;

create or replace function public.release_media_validation_claim(p_media_id uuid,p_claim_token uuid,p_error_code text)
returns void language plpgsql security definer set search_path='' as $$
declare v_status public.media_status; v_legacy boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  select status,(validation_status='VALIDATING' and status='READY') into v_status,v_legacy
  from public.media_assets where id=p_media_id and validation_claim_token=p_claim_token
    and validation_locked_until>now() for update;
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
