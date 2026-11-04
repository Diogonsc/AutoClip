-- Operações seguras sobre itens de lote, agregados paginados e suporte PHOTO no lote.

create table public.publication_batch_operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  batch_id uuid references public.publication_batches(id) on delete set null,
  action text not null check (action in ('CANCEL', 'RESCHEDULE')),
  idempotency_key uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(workspace_id, idempotency_key)
);
create index publication_batch_operations_batch_idx on public.publication_batch_operations(batch_id, created_at desc);
alter table public.publication_batch_operations enable row level security;
grant select on public.publication_batch_operations to authenticated;
create policy publication_batch_operations_select on public.publication_batch_operations for select to authenticated using (private.is_member(workspace_id));

-- A confirmação continua atômica, mas passa as configurações de foto/carrossel
-- pelo mesmo validador já usado em publication_jobs.
create or replace function public.confirm_publication_batch(
  p_workspace uuid, p_idempotency_key uuid, p_items jsonb, p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_batch public.publication_batches; v_item jsonb; v_channel uuid; v_media uuid; v_scheduled timestamptz;
  v_caption text; v_post_type text; v_media_ids uuid[]; v_count integer := 0; v_mode text; v_creator_info jsonb;
begin
  if auth.uid() is null or not private.can_edit(p_workspace) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_idempotency_key is null then raise exception 'idempotency_key_required' using errcode = '22023'; end if;
  -- Serialize retries with the same workspace/key so concurrent confirmations
  -- return the committed batch instead of racing on the unique constraint.
  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text || ':' || p_idempotency_key::text, 0));
  select publish_mode into v_mode from public.workspace_settings where workspace_id=p_workspace;
  if v_mode is null then raise exception 'workspace_settings_missing' using errcode='23514'; end if;
  select * into v_batch from public.publication_batches where workspace_id = p_workspace and idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('batch_id',v_batch.id,'created',false,'item_count',(select count(*) from public.publication_jobs where batch_id=v_batch.id)); end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 500 then raise exception 'batch must contain between 1 and 500 items' using errcode='22023'; end if;
  if exists (select 1 from (select (x->>'channel_id') || ':' || coalesce(x->>'media_asset_ids',x->>'media_asset_id') || ':' || (x->>'scheduled_at') k from jsonb_array_elements(p_items) x) q group by k having count(*) > 1) then raise exception 'batch_duplicate_item' using errcode='23505'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_channel := (v_item->>'channel_id')::uuid; v_media := (v_item->>'media_asset_id')::uuid;
    v_scheduled := (v_item->>'scheduled_at')::timestamptz; v_caption := coalesce(v_item->>'caption','');
    v_post_type := coalesce(nullif(v_item->>'post_type',''),'VIDEO');
    select array_agg(value::uuid order by ordinality) into v_media_ids from jsonb_array_elements_text(coalesce(v_item->'media_asset_ids', jsonb_build_array(v_media::text))) with ordinality;
    if v_scheduled <= now() then raise exception 'batch_schedule_in_past' using errcode='22023'; end if;
    if char_length(v_caption)>2200 then raise exception 'batch_caption_too_long' using errcode='22023'; end if;
    if v_post_type not in ('VIDEO','PHOTO') then raise exception 'batch_post_type_invalid' using errcode='22023'; end if;
    select creator_info into v_creator_info from public.channels where id=v_channel and workspace_id=p_workspace and connection_status='CONNECTED';
    if not found then raise exception 'batch_channel_unavailable' using errcode='23514'; end if;
    if (v_item ? 'music_rights_confirmed' and jsonb_typeof(v_item->'music_rights_confirmed') not in ('boolean','null'))
       or (v_item ? 'brand_content' and jsonb_typeof(v_item->'brand_content') not in ('boolean','null'))
       or (v_item ? 'brand_organic' and jsonb_typeof(v_item->'brand_organic') not in ('boolean','null'))
       or (v_item ? 'allow_comment' and jsonb_typeof(v_item->'allow_comment') not in ('boolean','null'))
       or (v_item ? 'allow_duet' and jsonb_typeof(v_item->'allow_duet') not in ('boolean','null'))
       or (v_item ? 'allow_stitch' and jsonb_typeof(v_item->'allow_stitch') not in ('boolean','null'))
       or (v_item ? 'privacy_level' and jsonb_typeof(v_item->'privacy_level') not in ('string','null')) then
      raise exception 'batch_post_options_invalid_type' using errcode='22023';
    end if;
    if v_mode='DIRECT' then
      if v_item->>'privacy_level' is null or jsonb_typeof(v_creator_info->'privacy_level_options') is distinct from 'array'
         or coalesce((v_creator_info->'privacy_level_options') ? (v_item->>'privacy_level'),false) is not true then
        raise exception 'batch_privacy_unavailable' using errcode='23514';
      end if;
      if jsonb_typeof(v_item->'allow_comment') is distinct from 'boolean'
         or jsonb_typeof(v_item->'brand_content') is distinct from 'boolean'
         or jsonb_typeof(v_item->'brand_organic') is distinct from 'boolean' then
        raise exception 'batch_post_options_required' using errcode='22023';
      end if;
      if v_post_type='VIDEO' and (jsonb_typeof(v_item->'allow_duet') is distinct from 'boolean' or jsonb_typeof(v_item->'allow_stitch') is distinct from 'boolean') then
        raise exception 'batch_video_interactions_required' using errcode='22023';
      end if;
      if v_post_type='PHOTO' and ((v_item ? 'allow_duet' and jsonb_typeof(v_item->'allow_duet') <> 'null') or (v_item ? 'allow_stitch' and jsonb_typeof(v_item->'allow_stitch') <> 'null')) then
        raise exception 'batch_photo_interactions_unsupported' using errcode='22023';
      end if;
    end if;
    if v_mode='INBOX' and (v_item->>'privacy_level' is not null or v_item->>'allow_comment' is not null
       or v_item->>'allow_duet' is not null or v_item->>'allow_stitch' is not null
       or coalesce((v_item->>'brand_content')::boolean,false) or coalesce((v_item->>'brand_organic')::boolean,false)) then
      raise exception 'batch_direct_options_in_inbox' using errcode='22023';
    end if;
    if v_post_type='PHOTO' and v_mode <> 'DIRECT' then raise exception 'photo_requires_direct_post' using errcode='23514'; end if;
    if v_post_type='VIDEO' and coalesce((v_item->>'music_rights_confirmed')::boolean,false) is not true then
      raise exception 'music_rights_consent_required' using errcode='23514';
    end if;
    -- O trigger validate_publication_media_assets confere ordem, tipo, workspace e READY novamente no insert.
    if v_post_type='PHOTO' and cardinality(v_media_ids) not between 1 and 35 then raise exception 'batch_photo_count_invalid' using errcode='22023'; end if;
    if exists(select 1 from public.publication_jobs where workspace_id=p_workspace and channel_id=v_channel and media_asset_id=v_media and scheduled_at=v_scheduled and status not in ('CANCELLED','FAILED')) then raise exception 'batch_existing_duplicate' using errcode='23505'; end if;
    v_count:=v_count+1;
  end loop;
  insert into public.publication_batches(workspace_id,created_by,idempotency_key,label,strategy,metadata)
  values(p_workspace,auth.uid(),p_idempotency_key,nullif(p_metadata->>'label',''),coalesce(nullif(p_metadata->>'strategy',''),'ALL_TO_ALL'),p_metadata) returning * into v_batch;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_media := (v_item->>'media_asset_id')::uuid; v_post_type := coalesce(nullif(v_item->>'post_type',''),'VIDEO');
    select array_agg(value::uuid order by ordinality) into v_media_ids from jsonb_array_elements_text(coalesce(v_item->'media_asset_ids', jsonb_build_array(v_media::text))) with ordinality;
    insert into public.publication_jobs(workspace_id,batch_id,channel_id,media_asset_id,media_asset_ids,post_type,caption,scheduled_at,timezone,status,created_by,music_rights_confirmed,privacy_level,allow_comment,allow_duet,allow_stitch,brand_content,brand_organic,idempotency_key)
    values(p_workspace,v_batch.id,(v_item->>'channel_id')::uuid,v_media,v_media_ids,v_post_type,coalesce(v_item->>'caption',''),(v_item->>'scheduled_at')::timestamptz,coalesce(nullif(v_item->>'timezone',''),'UTC'),'SCHEDULED',auth.uid(),coalesce((v_item->>'music_rights_confirmed')::boolean,false),nullif(v_item->>'privacy_level',''),(v_item->>'allow_comment')::boolean,(v_item->>'allow_duet')::boolean,(v_item->>'allow_stitch')::boolean,coalesce((v_item->>'brand_content')::boolean,false),coalesce((v_item->>'brand_organic')::boolean,false),gen_random_uuid());
  end loop;
  insert into public.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata) values(p_workspace,auth.uid(),'publication_batch.confirmed','publication_batch',v_batch.id,jsonb_build_object('item_count',v_count,'strategy',v_batch.strategy));
  return jsonb_build_object('batch_id',v_batch.id,'created',true,'item_count',v_count);
end; $$;

create or replace function public.cancel_publication_batch_items(p_workspace uuid, p_job_ids uuid[], p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing public.publication_batch_operations; v_count integer; v_batch uuid;
begin
  if auth.uid() is null or not private.can_edit(p_workspace) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_idempotency_key is null then raise exception 'idempotency_key_required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from public.publication_batch_operations where workspace_id=p_workspace and idempotency_key=p_idempotency_key;
  if found then return v_existing.result; end if;
  if coalesce(cardinality(p_job_ids),0)=0 or cardinality(p_job_ids)>500 then raise exception 'invalid batch item selection' using errcode='22023'; end if;
  perform 1 from public.publication_jobs where workspace_id=p_workspace and id=any(p_job_ids) and status in ('DRAFT','SCHEDULED','READY','RETRY_WAIT','BLOCKED_APPROVAL','BLOCKED_PERMISSION','BLOCKED_REAUTH') order by id for update;
  select count(*) into v_count from public.publication_jobs where workspace_id=p_workspace and id=any(p_job_ids) and status in ('DRAFT','SCHEDULED','READY','RETRY_WAIT','BLOCKED_APPROVAL','BLOCKED_PERMISSION','BLOCKED_REAUTH');
  if v_count <> cardinality(p_job_ids) then raise exception 'batch_cancel_state_invalid' using errcode='23514'; end if;
  select batch_id into v_batch from public.publication_jobs where id=any(p_job_ids) limit 1;
  update public.publication_jobs set status='CANCELLED' where workspace_id=p_workspace and id=any(p_job_ids);
  insert into public.publication_batch_operations(workspace_id,batch_id,action,idempotency_key,actor_user_id,result) values(p_workspace,v_batch,'CANCEL',p_idempotency_key,auth.uid(),jsonb_build_object('cancelled',v_count));
  insert into public.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata) values(p_workspace,auth.uid(),'publication_batch.cancelled','publication_batch',v_batch,jsonb_build_object('count',v_count));
  return jsonb_build_object('cancelled',v_count);
end; $$;

create or replace function public.reschedule_publication_batch_items(p_workspace uuid, p_items jsonb, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing public.publication_batch_operations; v_item jsonb; v_job uuid; v_at timestamptz; v_count integer:=0; v_batch uuid; v_ids uuid[];
begin
  if auth.uid() is null or not private.can_edit(p_workspace) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_idempotency_key is null then raise exception 'idempotency_key_required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from public.publication_batch_operations where workspace_id=p_workspace and idempotency_key=p_idempotency_key;
  if found then return v_existing.result; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 500 then raise exception 'invalid reschedule selection' using errcode='22023'; end if;
  if exists(select 1 from (select (x->>'job_id')::uuid id from jsonb_array_elements(p_items) x) q group by id having count(*)>1) then raise exception 'duplicate_reschedule_job' using errcode='23505'; end if;
  select array_agg((x->>'job_id')::uuid order by (x->>'job_id')::uuid) into v_ids from jsonb_array_elements(p_items) x;
  if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x->'scheduled_at') is distinct from 'string' or jsonb_typeof(x->'original_scheduled_at') is distinct from 'string' or jsonb_typeof(x->'timezone') is distinct from 'string' or not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=x->>'timezone')) then
    raise exception 'invalid_reschedule_datetime_or_timezone' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where (x->>'scheduled_at')::timestamptz <= now()) then raise exception 'batch_schedule_in_past' using errcode='22023'; end if;
  -- Locks em ordem estável: serialize cancelamento/reagendamento e evite deadlocks entre seleções invertidas.
  perform 1 from public.publication_jobs j where j.workspace_id=p_workspace and j.id=any(v_ids) order by j.id for update;
  select count(*) into v_count from public.publication_jobs j where j.workspace_id=p_workspace and j.id=any(v_ids) and j.status in ('SCHEDULED','READY','RETRY_WAIT');
  if v_count <> cardinality(v_ids) then raise exception 'batch_reschedule_state_invalid' using errcode='23514'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) x join public.publication_jobs j on j.workspace_id=p_workspace and j.id=(x->>'job_id')::uuid where j.scheduled_at is distinct from (x->>'original_scheduled_at')::timestamptz) then
    raise exception 'batch_reschedule_stale' using errcode='40001';
  end if;
  if (select count(distinct j.batch_id) from public.publication_jobs j where j.workspace_id=p_workspace and j.id=any(v_ids)) <> 1 then raise exception 'batch_reschedule_mixed_batches' using errcode='23514'; end if;
  -- Conflitos entre os horários novos do próprio lote.
  if exists(
    select 1 from jsonb_array_elements(p_items) x
    join public.publication_jobs j on j.workspace_id=p_workspace and j.id=(x->>'job_id')::uuid
    group by j.channel_id,j.media_asset_id,(x->>'scheduled_at')::timestamptz having count(*)>1
  ) then raise exception 'batch_existing_duplicate' using errcode='23505'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_job:=(v_item->>'job_id')::uuid; v_at:=(v_item->>'scheduled_at')::timestamptz;
    if exists(select 1 from public.publication_jobs j join public.publication_jobs target on target.id=v_job and target.workspace_id=p_workspace where j.workspace_id=p_workspace and j.channel_id=target.channel_id and j.media_asset_id=target.media_asset_id and j.scheduled_at=v_at and j.id<>v_job and j.id<>all(v_ids) and j.status not in ('CANCELLED','FAILED')) then raise exception 'batch_existing_duplicate' using errcode='23505'; end if;
  end loop;
  select batch_id into v_batch from public.publication_jobs where workspace_id=p_workspace and id=any(v_ids) limit 1;
  update public.publication_jobs j set scheduled_at=(x->>'scheduled_at')::timestamptz, timezone=x->>'timezone'
    from jsonb_array_elements(p_items) x where j.workspace_id=p_workspace and j.id=(x->>'job_id')::uuid;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_ids) then raise exception 'batch_reschedule_incomplete' using errcode='23514'; end if;
  insert into public.publication_batch_operations(workspace_id,batch_id,action,idempotency_key,actor_user_id,result) values(p_workspace,v_batch,'RESCHEDULE',p_idempotency_key,auth.uid(),jsonb_build_object('rescheduled',v_count));
  insert into public.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata) values(p_workspace,auth.uid(),'publication_batch.rescheduled','publication_batch',v_batch,jsonb_build_object('count',v_count));
  return jsonb_build_object('rescheduled',v_count);
end; $$;

create or replace function public.list_publication_batches(
  p_workspace uuid, p_limit integer default 25, p_offset integer default 0,
  p_search text default null, p_channel uuid default null, p_status text default null,
  p_created_from date default null, p_created_to date default null, p_batch text default null,
  p_group uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_rows jsonb; v_total integer;
begin
  if auth.uid() is null or not private.is_member(p_workspace) then raise exception 'forbidden' using errcode='42501'; end if;
  if length(coalesce(p_search,''))>200 or length(coalesce(p_batch,''))>80 then raise exception 'batch_filter_too_long' using errcode='22023'; end if;
  if p_created_from is not null and p_created_to is not null and p_created_from>p_created_to then raise exception 'invalid_batch_date_range' using errcode='22023'; end if;
  if p_status is not null and not exists(select 1 from unnest(enum_range(null::public.publication_status)) s where s::text=p_status) then raise exception 'invalid_publication_status' using errcode='22023'; end if;
  with filtered as materialized (
    select b.* from public.publication_batches b where b.workspace_id=p_workspace
      and (p_search is null or b.id::text ilike '%'||p_search||'%' or coalesce(b.label,'') ilike '%'||p_search||'%')
      and (p_batch is null or b.id::text=p_batch)
      and (p_created_from is null or b.created_at >= (p_created_from::timestamp at time zone 'UTC'))
      and (p_created_to is null or b.created_at < ((p_created_to+1)::timestamp at time zone 'UTC'))
      and (p_channel is null or exists(select 1 from public.publication_jobs j where j.workspace_id=p_workspace and j.batch_id=b.id and j.channel_id=p_channel))
      and (p_status is null or exists(select 1 from public.publication_jobs j where j.workspace_id=p_workspace and j.batch_id=b.id and j.status::text=p_status))
      and (p_group is null or exists(select 1 from public.publication_jobs j join public.account_group_members gm on gm.workspace_id=j.workspace_id and gm.channel_id=j.channel_id where j.workspace_id=p_workspace and j.batch_id=b.id and gm.group_id=p_group))
  ), page as materialized (
    select * from filtered order by created_at desc,id desc limit least(greatest(p_limit,1),100) offset greatest(p_offset,0)
  ), stats as (
    select f.id,f.workspace_id,f.created_by,f.idempotency_key,f.label,f.strategy,f.metadata,f.created_at,f.updated_at,
      s.total,s.published,s.failed,s.cancelled,s.awaiting,s.completed,s.scheduled,s.processing,s.unknown,s.sent_to_inbox,s.channels
    from page f cross join lateral (
      select count(*)::int total,
        count(*) filter(where status='PUBLISHED')::int published,
        count(*) filter(where status='FAILED')::int failed,
        count(*) filter(where status='CANCELLED')::int cancelled,
        count(*) filter(where status in ('SENT_TO_INBOX','UNKNOWN','BLOCKED_APPROVAL','BLOCKED_PERMISSION','BLOCKED_REAUTH'))::int awaiting,
        count(*) filter(where status in ('PUBLISHED','FAILED','CANCELLED'))::int completed,
        count(*) filter(where status in ('SCHEDULED','READY','RETRY_WAIT'))::int scheduled,
        count(*) filter(where status='PROCESSING')::int processing,
        count(*) filter(where status='UNKNOWN')::int unknown,
        count(*) filter(where status='SENT_TO_INBOX')::int sent_to_inbox,
        coalesce(array_agg(distinct channel_id),array[]::uuid[]) channels
      from public.publication_jobs where workspace_id=p_workspace and batch_id=f.id
    ) s
  )
  select coalesce((select jsonb_agg(to_jsonb(stats) order by created_at desc,id desc) from stats),'[]'::jsonb), (select count(*)::int from filtered)
    into v_rows,v_total;
  return jsonb_build_object('rows',v_rows,'total',v_total);
end; $$;
create index if not exists publication_jobs_batch_status_idx on public.publication_jobs(batch_id,status,scheduled_at) where batch_id is not null;
create index if not exists publication_jobs_workspace_batch_status_idx on public.publication_jobs(workspace_id,batch_id,status) where batch_id is not null;
create index if not exists publication_jobs_workspace_channel_batch_idx on public.publication_jobs(workspace_id,channel_id,batch_id) where batch_id is not null;
revoke all on function public.cancel_publication_batch_items(uuid,uuid[],uuid), public.reschedule_publication_batch_items(uuid,jsonb,uuid), public.list_publication_batches(uuid,integer,integer,text,uuid,text,date,date,text,uuid) from public,anon;
grant execute on function public.cancel_publication_batch_items(uuid,uuid[],uuid), public.reschedule_publication_batch_items(uuid,jsonb,uuid), public.list_publication_batches(uuid,integer,integer,text,uuid,text,date,date,text,uuid) to authenticated,service_role;
