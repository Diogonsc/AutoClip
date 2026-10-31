-- Estrutura SaaS: planos, assinaturas, quota de publicação e retenção segura
-- de mídia. Não há cobrança nem exclusão física automática nesta migration.

create type public.subscription_status as enum ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');
create type public.quota_reservation_status as enum ('RESERVED', 'CONSUMED', 'RELEASED');

create table public.billing_plans (
  id text primary key,
  display_name text not null,
  max_connected_accounts integer not null check (max_connected_accounts between 1 and 1000),
  monthly_publication_limit integer not null check (monthly_publication_limit > 0),
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.billing_plans (id, display_name, max_connected_accounts, monthly_publication_limit, price_cents, sort_order)
values
  ('starter', 'Starter', 3, 120, 4990, 10),
  ('pro', 'Pro', 10, 600, 11990, 20),
  ('advanced', 'Advanced', 25, 1800, 22990, 30),
  ('agency', 'Agency', 50, 4000, 37990, 40),
  ('enterprise', 'Enterprise', 100, 8000, 64990, 50)
on conflict (id) do update set
  display_name = excluded.display_name,
  max_connected_accounts = excluded.max_connected_accounts,
  monthly_publication_limit = excluded.monthly_publication_limit,
  price_cents = excluded.price_cents,
  sort_order = excluded.sort_order,
  updated_at = now();

create table public.workspace_subscriptions (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  plan_id text not null references public.billing_plans(id),
  status public.subscription_status not null default 'TRIALING',
  provider text not null default 'MANUAL' check (provider in ('MANUAL', 'STRIPE', 'MERCADO_PAGO')),
  provider_customer_id text,
  provider_subscription_id text,
  current_period_started_at timestamptz not null default now(),
  current_period_ends_at timestamptz not null default (now() + interval '30 days'),
  trial_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_ends_at > current_period_started_at)
);

create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  previous_plan_id text,
  next_plan_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index subscription_events_workspace_idx on public.subscription_events(workspace_id, created_at desc);

-- Workspaces já existentes entram no Starter ativo sem apagar ou alterar dados.
insert into public.workspace_subscriptions (workspace_id, plan_id, status, current_period_started_at, current_period_ends_at)
select w.id, 'starter', 'ACTIVE', now(), now() + interval '30 days'
from public.workspaces w
on conflict (workspace_id) do nothing;

create function private.create_workspace_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_subscriptions (
    workspace_id, plan_id, status, current_period_started_at, current_period_ends_at, trial_ends_at
  ) values (
    new.id, 'starter', 'TRIALING', now(), now() + interval '7 days', now() + interval '7 days'
  );
  return new;
end;
$$;

create trigger create_workspace_subscription
after insert on public.workspaces
for each row execute function private.create_workspace_subscription();

create table public.workspace_usage_cycles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  period_started_at timestamptz not null,
  period_ends_at timestamptz not null,
  publication_limit integer not null check (publication_limit > 0),
  reserved_publications integer not null default 0 check (reserved_publications >= 0),
  consumed_publications integer not null default 0 check (consumed_publications >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, period_started_at),
  check (period_ends_at > period_started_at),
  check (reserved_publications + consumed_publications <= publication_limit)
);
create index workspace_usage_cycles_current_idx on public.workspace_usage_cycles(workspace_id, period_ends_at desc);

create table public.publication_quota_reservations (
  id uuid primary key default gen_random_uuid(),
  publication_job_id uuid not null unique,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  usage_cycle_id uuid not null references public.workspace_usage_cycles(id) on delete restrict,
  status public.quota_reservation_status not null,
  reserved_at timestamptz,
  consumed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index publication_quota_reservations_workspace_idx on public.publication_quota_reservations(workspace_id, created_at desc);
create index publication_quota_reservations_cycle_idx on public.publication_quota_reservations(usage_cycle_id, status);

create function private.ensure_workspace_usage_cycle(p_workspace uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription public.workspace_subscriptions;
  v_limit integer;
  v_cycle uuid;
begin
  select * into v_subscription
  from public.workspace_subscriptions
  where workspace_id = p_workspace
  for update;
  if not found then
    raise exception 'subscription not found' using errcode = '23514';
  end if;
  if v_subscription.status not in ('TRIALING', 'ACTIVE') then
    raise exception 'subscription is not active' using errcode = '23514';
  end if;

  if v_subscription.current_period_ends_at <= now() then
    update public.workspace_subscriptions
       set current_period_started_at = now(),
           current_period_ends_at = now() + interval '30 days',
           status = case when status = 'TRIALING' then 'EXPIRED'::public.subscription_status else status end
     where workspace_id = p_workspace
     returning * into v_subscription;
    if v_subscription.status not in ('TRIALING', 'ACTIVE') then
      raise exception 'subscription is not active' using errcode = '23514';
    end if;
  end if;

  select monthly_publication_limit into v_limit
  from public.billing_plans where id = v_subscription.plan_id and active;
  if v_limit is null then
    raise exception 'subscription plan is unavailable' using errcode = '23514';
  end if;

  insert into public.workspace_usage_cycles (workspace_id, period_started_at, period_ends_at, publication_limit)
  values (p_workspace, v_subscription.current_period_started_at, v_subscription.current_period_ends_at, v_limit)
  on conflict (workspace_id, period_started_at) do nothing;

  select id into v_cycle from public.workspace_usage_cycles
  where workspace_id = p_workspace and period_started_at = v_subscription.current_period_started_at
  for update;
  return v_cycle;
end;
$$;

create function private.apply_publication_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle uuid;
  v_usage public.workspace_usage_cycles;
  v_reservation public.publication_quota_reservations;
  v_activates boolean;
begin
  v_activates := new.status in ('SCHEDULED', 'READY', 'PROCESSING', 'RETRY_WAIT', 'BLOCKED_APPROVAL', 'BLOCKED_PERMISSION', 'BLOCKED_REAUTH', 'UNKNOWN');

  if v_activates and (tg_op = 'INSERT' or old.status not in ('SCHEDULED', 'READY', 'PROCESSING', 'RETRY_WAIT', 'BLOCKED_APPROVAL', 'BLOCKED_PERMISSION', 'BLOCKED_REAUTH', 'UNKNOWN')) then
    v_cycle := private.ensure_workspace_usage_cycle(new.workspace_id);
    select * into v_usage from public.workspace_usage_cycles where id = v_cycle for update;
    select * into v_reservation from public.publication_quota_reservations where publication_job_id = new.id for update;
    if not found then
      if v_usage.reserved_publications + v_usage.consumed_publications >= v_usage.publication_limit then
        raise exception 'publication_quota_exceeded: o limite de publicações deste ciclo foi atingido.' using errcode = '23514';
      end if;
      insert into public.publication_quota_reservations (publication_job_id, workspace_id, usage_cycle_id, status, reserved_at)
      values (new.id, new.workspace_id, v_cycle, 'RESERVED', now());
      update public.workspace_usage_cycles set reserved_publications = reserved_publications + 1 where id = v_cycle;
    elsif v_reservation.status = 'RELEASED' then
      if v_usage.reserved_publications + v_usage.consumed_publications >= v_usage.publication_limit then
        raise exception 'publication_quota_exceeded: o limite de publicações deste ciclo foi atingido.' using errcode = '23514';
      end if;
      update public.publication_quota_reservations
         set status = 'RESERVED', reserved_at = now(), released_at = null, release_reason = null
       where id = v_reservation.id;
      update public.workspace_usage_cycles set reserved_publications = reserved_publications + 1 where id = v_cycle;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status = 'PUBLISHED' and old.status <> 'PUBLISHED' then
    select * into v_reservation from public.publication_quota_reservations where publication_job_id = new.id for update;
    if found and v_reservation.status = 'RESERVED' then
      update public.publication_quota_reservations set status = 'CONSUMED', consumed_at = now() where id = v_reservation.id;
      update public.workspace_usage_cycles
         set reserved_publications = greatest(reserved_publications - 1, 0), consumed_publications = consumed_publications + 1
       where id = v_reservation.usage_cycle_id;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status in ('FAILED', 'CANCELLED') and old.status not in ('FAILED', 'CANCELLED') then
    select * into v_reservation from public.publication_quota_reservations where publication_job_id = new.id for update;
    if found and v_reservation.status = 'RESERVED' then
      update public.publication_quota_reservations
         set status = 'RELEASED', released_at = now(), release_reason = new.status::text
       where id = v_reservation.id;
      update public.workspace_usage_cycles set reserved_publications = greatest(reserved_publications - 1, 0) where id = v_reservation.usage_cycle_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger apply_publication_quota
before insert or update of status on public.publication_jobs
for each row execute function private.apply_publication_quota();

create function private.release_deleted_publication_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_reservation public.publication_quota_reservations;
begin
  select * into v_reservation from public.publication_quota_reservations where publication_job_id = old.id for update;
  if found and v_reservation.status = 'RESERVED' then
    update public.publication_quota_reservations set status = 'RELEASED', released_at = now(), release_reason = 'JOB_DELETED' where id = v_reservation.id;
    update public.workspace_usage_cycles set reserved_publications = greatest(reserved_publications - 1, 0) where id = v_reservation.usage_cycle_id;
  end if;
  return old;
end;
$$;
create trigger release_deleted_publication_quota
before delete on public.publication_jobs
for each row execute function private.release_deleted_publication_quota();

create function private.enforce_connected_channel_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_limit integer; v_count integer;
begin
  if new.connection_status <> 'CONNECTED' or (tg_op = 'UPDATE' and old.connection_status = 'CONNECTED') then return new; end if;
  perform 1 from public.workspace_subscriptions where workspace_id = new.workspace_id for update;
  select p.max_connected_accounts into v_limit
  from public.workspace_subscriptions s join public.billing_plans p on p.id = s.plan_id
  where s.workspace_id = new.workspace_id and s.status in ('TRIALING', 'ACTIVE');
  if v_limit is null then raise exception 'subscription is not active' using errcode = '23514'; end if;
  select count(*) into v_count from public.channels where workspace_id = new.workspace_id and connection_status = 'CONNECTED';
  if v_count >= v_limit then
    raise exception 'connected_channel_limit_exceeded: o limite de contas conectadas do plano foi atingido.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger enforce_connected_channel_limit
before insert or update of connection_status on public.channels
for each row execute function private.enforce_connected_channel_limit();

-- Ajusta o ciclo atual com agendamentos legados sem remover ou bloquear registros existentes.
insert into public.workspace_usage_cycles (workspace_id, period_started_at, period_ends_at, publication_limit, reserved_publications)
select s.workspace_id, s.current_period_started_at, s.current_period_ends_at,
       greatest(p.monthly_publication_limit, count(j.id)::integer), count(j.id)::integer
from public.workspace_subscriptions s
join public.billing_plans p on p.id = s.plan_id
left join public.publication_jobs j on j.workspace_id = s.workspace_id
  and j.status in ('SCHEDULED', 'READY', 'PROCESSING', 'RETRY_WAIT', 'BLOCKED_APPROVAL', 'BLOCKED_PERMISSION', 'BLOCKED_REAUTH', 'UNKNOWN')
group by s.workspace_id, s.current_period_started_at, s.current_period_ends_at, p.monthly_publication_limit
on conflict (workspace_id, period_started_at) do nothing;

insert into public.publication_quota_reservations (publication_job_id, workspace_id, usage_cycle_id, status, reserved_at)
select j.id, j.workspace_id, c.id, 'RESERVED', now()
from public.publication_jobs j
join public.workspace_subscriptions s on s.workspace_id = j.workspace_id
join public.workspace_usage_cycles c on c.workspace_id = s.workspace_id and c.period_started_at = s.current_period_started_at
where j.status in ('SCHEDULED', 'READY', 'PROCESSING', 'RETRY_WAIT', 'BLOCKED_APPROVAL', 'BLOCKED_PERMISSION', 'BLOCKED_REAUTH', 'UNKNOWN')
on conflict (publication_job_id) do nothing;

alter table public.workspace_settings
  add column if not exists auto_delete_media_enabled boolean not null default false,
  add column if not exists auto_delete_media_dry_run boolean not null default true,
  add column if not exists auto_delete_media_grace_hours integer not null default 24 check (auto_delete_media_grace_hours between 1 and 720),
  add column if not exists auto_delete_media_batch_size integer not null default 10 check (auto_delete_media_batch_size between 1 and 50);

alter table public.media_assets
  add column if not exists storage_deleted_at timestamptz,
  add column if not exists storage_deletion_reason text,
  add column if not exists cleanup_lock_token uuid,
  add column if not exists cleanup_locked_at timestamptz,
  add column if not exists cleanup_attempts integer not null default 0,
  add column if not exists cleanup_last_error text;

create table public.media_cleanup_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  media_asset_id uuid not null,
  action text not null check (action in ('DRY_RUN', 'DELETED', 'FAILED', 'SKIPPED')),
  bytes bigint not null default 0,
  reason text not null,
  error_message text,
  created_at timestamptz not null default now()
);
create index media_cleanup_audit_workspace_idx on public.media_cleanup_audit(workspace_id, created_at desc);

-- Uma trava de limpeza impede que um novo agendamento use um arquivo já reivindicado.
create or replace function private.validate_job_scheduling()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('SCHEDULED', 'READY') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if not exists (
      select 1 from public.media_assets m
      where m.id = new.media_asset_id and m.workspace_id = new.workspace_id and m.status = 'READY' and m.cleanup_lock_token is null
    ) then
      raise exception 'media asset is not READY or is being retained for cleanup' using errcode = '23514';
    end if;
    if new.scheduled_at < now() - interval '1 minute' then raise exception 'scheduled_at is in the past' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;

create function public.claim_media_cleanup_candidates(p_limit integer, p_lock uuid)
returns table (media_asset_id uuid, workspace_id uuid, storage_key text, file_size_bytes bigint, dry_run boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with eligible as materialized (
    select m.id, m.workspace_id, m.created_at, s.auto_delete_media_batch_size
    from public.media_assets m
    join public.workspace_settings s on s.workspace_id = m.workspace_id
    where s.auto_delete_media_enabled
      and m.status = 'READY'
      and (m.cleanup_locked_at is null or m.cleanup_locked_at < now() - interval '15 minutes')
      and exists (
        select 1 from public.publication_jobs published
        where (published.media_asset_id = m.id or m.id = any(coalesce(published.media_asset_ids, '{}'::uuid[])))
          and published.status = 'PUBLISHED'
          and published.updated_at <= now() - make_interval(hours => s.auto_delete_media_grace_hours)
      )
      and not exists (
        select 1 from public.publication_jobs active
        where (active.media_asset_id = m.id or m.id = any(coalesce(active.media_asset_ids, '{}'::uuid[])))
          and active.status in ('DRAFT', 'SCHEDULED', 'READY', 'PROCESSING', 'RETRY_WAIT', 'BLOCKED_APPROVAL', 'BLOCKED_PERMISSION', 'BLOCKED_REAUTH', 'UNKNOWN')
      )
  ), ranked as (
    select id, row_number() over (partition by workspace_id order by created_at) as workspace_position,
           auto_delete_media_batch_size
    from eligible
  ), candidates as (
    select m.id
    from public.media_assets m
    join ranked r on r.id = m.id
    where r.workspace_position <= r.auto_delete_media_batch_size
    order by m.created_at
    limit least(greatest(p_limit, 1), 50)
    for update of m skip locked
  ), locked as (
    update public.media_assets m
       set cleanup_lock_token = p_lock, cleanup_locked_at = now(), cleanup_attempts = cleanup_attempts + 1, cleanup_last_error = null
      from candidates c where m.id = c.id
      returning m.id, m.workspace_id, m.storage_key, m.file_size_bytes
  )
  select l.id, l.workspace_id, l.storage_key, l.file_size_bytes, s.auto_delete_media_dry_run
  from locked l join public.workspace_settings s on s.workspace_id = l.workspace_id;
end;
$$;

create function public.complete_media_cleanup(p_media uuid, p_lock uuid, p_deleted boolean, p_dry_run boolean, p_error text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_media public.media_assets; v_action text; v_reason text;
begin
  select * into v_media from public.media_assets where id = p_media for update;
  if not found or v_media.cleanup_lock_token is distinct from p_lock then return false; end if;
  if p_error is not null then
    update public.media_assets set cleanup_lock_token = null, cleanup_locked_at = null, cleanup_last_error = left(p_error, 500) where id = p_media;
    insert into public.media_cleanup_audit (workspace_id, media_asset_id, action, bytes, reason, error_message)
    values (v_media.workspace_id, p_media, 'FAILED', v_media.file_size_bytes, 'storage_delete_failed', left(p_error, 500));
    return true;
  end if;
  if p_dry_run then
    update public.media_assets set cleanup_lock_token = null, cleanup_locked_at = null where id = p_media;
    insert into public.media_cleanup_audit (workspace_id, media_asset_id, action, bytes, reason)
    values (v_media.workspace_id, p_media, 'DRY_RUN', v_media.file_size_bytes, 'eligible_after_grace_period');
    return true;
  end if;
  if not p_deleted then return false; end if;
  update public.media_assets
     set status = 'DELETED', storage_deleted_at = now(), storage_deletion_reason = 'auto_cleanup_after_published', cleanup_lock_token = null, cleanup_locked_at = null
   where id = p_media;
  insert into public.media_cleanup_audit (workspace_id, media_asset_id, action, bytes, reason)
  values (v_media.workspace_id, p_media, 'DELETED', v_media.file_size_bytes, 'auto_cleanup_after_published');
  return true;
end;
$$;

-- Não chama a Edge Function enquanto todos os workspaces estiverem com a
-- limpeza desativada. Assim a migration é segura antes do deploy da função.
create function private.invoke_media_cleanup()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from public.workspace_settings where auto_delete_media_enabled) then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'worker_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/media-cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;
revoke execute on function private.invoke_media_cleanup() from public, anon, authenticated;

select cron.schedule('invoke-media-cleanup', '*/15 * * * *', $$select private.invoke_media_cleanup()$$);

create function public.get_workspace_saas_overview(p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_cycle public.workspace_usage_cycles; v_sub public.workspace_subscriptions; v_plan public.billing_plans;
begin
  if not private.is_member(p_workspace) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_sub from public.workspace_subscriptions where workspace_id = p_workspace;
  select * into v_plan from public.billing_plans where id = v_sub.plan_id;
  select * into v_cycle from public.workspace_usage_cycles where workspace_id = p_workspace order by period_ends_at desc limit 1;
  return jsonb_build_object(
    'subscription_status', v_sub.status, 'plan_id', v_plan.id, 'plan_name', v_plan.display_name,
    'period_ends_at', v_sub.current_period_ends_at, 'trial_ends_at', v_sub.trial_ends_at,
    'connected_accounts', (select count(*) from public.channels where workspace_id = p_workspace and connection_status = 'CONNECTED'),
    'connected_account_limit', v_plan.max_connected_accounts,
    'publication_limit', coalesce(v_cycle.publication_limit, v_plan.monthly_publication_limit),
    'reserved_publications', coalesce(v_cycle.reserved_publications, 0), 'consumed_publications', coalesce(v_cycle.consumed_publications, 0),
    'storage_bytes', (select coalesce(sum(file_size_bytes), 0) from public.media_assets where workspace_id = p_workspace and status <> 'DELETED'),
    'deleted_storage_bytes', (select coalesce(sum(bytes), 0) from public.media_cleanup_audit where workspace_id = p_workspace and action = 'DELETED')
  );
end;
$$;

create function public.change_workspace_plan(p_workspace uuid, p_plan text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_old text; v_limit integer;
begin
  if not private.can_admin(p_workspace) then raise exception 'forbidden' using errcode = '42501'; end if;
  select plan_id into v_old from public.workspace_subscriptions where workspace_id = p_workspace for update;
  select monthly_publication_limit into v_limit from public.billing_plans where id = p_plan and active;
  if v_limit is null then raise exception 'plan not available' using errcode = '22023'; end if;
  update public.workspace_subscriptions set plan_id = p_plan, status = 'ACTIVE', cancel_at_period_end = false, cancelled_at = null where workspace_id = p_workspace;
  update public.workspace_usage_cycles set publication_limit = greatest(v_limit, consumed_publications + reserved_publications)
   where workspace_id = p_workspace and period_ends_at > now();
  insert into public.subscription_events (workspace_id, actor_user_id, event_type, previous_plan_id, next_plan_id)
  values (p_workspace, auth.uid(), 'PLAN_CHANGED_MANUAL', v_old, p_plan);
end;
$$;

create function public.cancel_workspace_subscription(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_admin(p_workspace) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.workspace_subscriptions set cancel_at_period_end = true, cancelled_at = now() where workspace_id = p_workspace;
  insert into public.subscription_events (workspace_id, actor_user_id, event_type) values (p_workspace, auth.uid(), 'CANCEL_AT_PERIOD_END');
end;
$$;

alter table public.billing_plans enable row level security;
alter table public.workspace_subscriptions enable row level security;
alter table public.workspace_usage_cycles enable row level security;
alter table public.publication_quota_reservations enable row level security;
alter table public.subscription_events enable row level security;
alter table public.media_cleanup_audit enable row level security;

grant select on public.billing_plans, public.workspace_subscriptions, public.workspace_usage_cycles, public.publication_quota_reservations, public.subscription_events, public.media_cleanup_audit to authenticated;
grant update (auto_delete_media_enabled, auto_delete_media_dry_run, auto_delete_media_grace_hours, auto_delete_media_batch_size) on public.workspace_settings to authenticated;

create policy billing_plans_select on public.billing_plans for select to authenticated using (active or public.is_platform_owner());
create policy subscriptions_select on public.workspace_subscriptions for select to authenticated using (private.is_member(workspace_id));
create policy usage_cycles_select on public.workspace_usage_cycles for select to authenticated using (private.is_member(workspace_id));
create policy quota_reservations_select on public.publication_quota_reservations for select to authenticated using (private.is_member(workspace_id));
create policy subscription_events_select on public.subscription_events for select to authenticated using (private.can_admin(workspace_id));
create policy media_cleanup_audit_select on public.media_cleanup_audit for select to authenticated using (private.can_admin(workspace_id));

revoke execute on function public.claim_media_cleanup_candidates(integer, uuid) from public, anon, authenticated;
revoke execute on function public.complete_media_cleanup(uuid, uuid, boolean, boolean, text) from public, anon, authenticated;
revoke execute on function public.get_workspace_saas_overview(uuid) from public, anon;
revoke execute on function public.change_workspace_plan(uuid, text) from public, anon;
revoke execute on function public.cancel_workspace_subscription(uuid) from public, anon;
grant execute on function public.claim_media_cleanup_candidates(integer, uuid) to service_role;
grant execute on function public.complete_media_cleanup(uuid, uuid, boolean, boolean, text) to service_role;
grant execute on function public.get_workspace_saas_overview(uuid) to authenticated;
grant execute on function public.change_workspace_plan(uuid, text) to authenticated;
grant execute on function public.cancel_workspace_subscription(uuid) to authenticated;
