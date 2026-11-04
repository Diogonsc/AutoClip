-- Initial launch availability boundary: Login Kit / Content Posting remain enabled;
-- TikTok Shop data and historical jobs are preserved but unavailable to clients/workers.

-- Keep old Shop jobs in place, but prevent either publication or polling claims.
create or replace function public.claim_publication_jobs(p_limit integer, p_worker text)
returns setof public.publication_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select j.id
    from public.publication_jobs j
    join public.workspace_settings s
      on s.workspace_id = j.workspace_id and s.auto_publish_enabled
    where j.status in ('SCHEDULED', 'RETRY_WAIT')
      and j.scheduled_at <= now()
      and coalesce(j.next_attempt_at, now()) <= now()
      and j.shop_product_id is null
      and j.shop_video_id is null
      and coalesce(j.remote_publish_id, '') not like 'shop:%'
    order by j.scheduled_at
    limit greatest(p_limit, 0)
    for update of j skip locked
  ),
  upd as (
    update public.publication_jobs j
       set status = 'PROCESSING',
           locked_at = now(),
           locked_by = p_worker,
           next_attempt_at = null,
           attempt_count = j.attempt_count + 1
      from picked
     where j.id = picked.id
    returning j.*
  ),
  att as (
    insert into public.publication_attempts (workspace_id, publication_job_id, attempt_number)
    select u.workspace_id, u.id,
           coalesce((select max(a.attempt_number) from public.publication_attempts a
                      where a.publication_job_id = u.id), 0) + 1
    from upd u
  )
  select * from upd;
end;
$$;

create or replace function public.claim_polling_jobs(p_limit integer, p_worker text)
returns setof public.publication_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select j.id
    from public.publication_jobs j
    where j.status = 'PROCESSING'
      and j.remote_publish_id is not null
      and j.locked_at is null
      and coalesce(j.next_attempt_at, now()) <= now()
      and j.shop_product_id is null
      and j.shop_video_id is null
      and j.remote_publish_id not like 'shop:%'
    order by j.next_attempt_at nulls first
    limit greatest(p_limit, 0)
    for update of j skip locked
  ),
  upd as (
    update public.publication_jobs j
       set locked_at = now(), locked_by = p_worker
      from picked
     where j.id = picked.id
    returning j.*
  )
  select * from upd;
end;
$$;

-- Database-level fail-closed guard for any Shop metadata write, including direct
-- PostgREST use. Existing Shop jobs remain unchanged unless a Shop field is edited.
create or replace function public.validate_shoppable_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.shop_product_id is not null
       or new.shop_anchor_title is not null
       or new.shop_is_ai_generated
       or new.shop_video_id is not null then
      raise exception 'TIKTOK_SHOP_DISABLED' using errcode = '55000';
    end if;
  elsif new.shop_product_id is distinct from old.shop_product_id
     or new.shop_anchor_title is distinct from old.shop_anchor_title
     or new.shop_is_ai_generated is distinct from old.shop_is_ai_generated
     or new.shop_video_id is distinct from old.shop_video_id then
    raise exception 'TIKTOK_SHOP_DISABLED' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists publication_shoppable_guard on public.publication_jobs;
create trigger publication_shoppable_guard
before insert or update of shop_product_id, shop_anchor_title, shop_is_ai_generated, shop_video_id
on public.publication_jobs
for each row execute function public.validate_shoppable_publication();

create or replace function public.validate_publication_shop_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'TIKTOK_SHOP_DISABLED' using errcode = '55000';
  return null;
end;
$$;

-- Preserve rows while making Shop tables unavailable to browser and Edge service-role
-- clients. Re-enablement requires a separately reviewed migration and code change.
revoke all privileges on table public.tiktok_shop_connections,
  public.tiktok_shop_products, public.publication_shop_products,
  public.tiktok_shop_orders, public.tiktok_shop_sync_runs,
  public.tiktok_shop_oauth_states
from public, anon, authenticated, service_role;

revoke execute on function public.assert_tiktok_shop_access(uuid, text),
  public.create_tiktok_shop_connection(uuid),
  public.create_tiktok_shop_oauth_state(uuid),
  public.consume_tiktok_shop_oauth_state(text),
  public.list_tiktok_shop_connections(uuid),
  public.acquire_tiktok_shop_token_refresh(uuid, uuid),
  public.complete_tiktok_shop_token_refresh(uuid, uuid, bigint, text, text, timestamptz, timestamptz),
  public.fail_tiktok_shop_token_refresh(uuid, uuid, bigint),
  public.save_tiktok_shop_oauth_connection(uuid, text, text, text, timestamptz, timestamptz, text[])
from public, anon, authenticated, service_role;
