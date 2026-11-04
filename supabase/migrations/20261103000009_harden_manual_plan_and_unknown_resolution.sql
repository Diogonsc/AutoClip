-- Gate 3.15: privileged manual plan changes and UNKNOWN job resolution.
-- Manual plan changes are an operator action until billing is implemented.

create table public.publication_job_manual_resolutions (
  request_id uuid primary key,
  publication_job_id uuid not null references public.publication_jobs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  outcome text not null check (outcome in ('PUBLISHED', 'NOT_PUBLISHED')),
  created_at timestamptz not null default now()
);

alter table public.publication_job_manual_resolutions enable row level security;
revoke all on public.publication_job_manual_resolutions from public, anon, authenticated, service_role;

create or replace function public.change_workspace_plan(p_workspace uuid, p_plan text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_limit integer;
  v_provider text;
begin
  if (select auth.role()) is distinct from 'service_role'
     and not public.is_platform_owner() then
    raise exception 'platform operator required' using errcode = '42501';
  end if;

  select plan_id, provider into v_old, v_provider
  from public.workspace_subscriptions
  where workspace_id = p_workspace
  for update;
  if not found then
    raise exception 'subscription not found' using errcode = '22023';
  end if;
  if v_provider <> 'MANUAL' then
    raise exception 'billing-managed subscription cannot be changed manually' using errcode = '42501';
  end if;

  select monthly_publication_limit into v_limit
  from public.billing_plans
  where id = p_plan and active;
  if v_limit is null then
    raise exception 'plan not available' using errcode = '22023';
  end if;

  update public.workspace_subscriptions
     set plan_id = p_plan,
         status = 'ACTIVE',
         cancel_at_period_end = false,
         cancelled_at = null
   where workspace_id = p_workspace;

  update public.workspace_usage_cycles
     set publication_limit = greatest(v_limit, consumed_publications + reserved_publications)
   where workspace_id = p_workspace and period_ends_at > now();

  insert into public.subscription_events
    (workspace_id, actor_user_id, event_type, previous_plan_id, next_plan_id)
  values
    (p_workspace, auth.uid(), 'PLAN_CHANGED_MANUAL', v_old, p_plan);
end;
$$;

create or replace function public.resolve_unknown_job(
  p_job uuid,
  p_outcome text,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.publication_jobs;
  v_existing public.publication_job_manual_resolutions;
  v_actor uuid := (select auth.uid());
begin
  if p_request_id is null then
    raise exception 'request id required' using errcode = '22023';
  end if;
  if p_outcome is null or p_outcome not in ('PUBLISHED', 'NOT_PUBLISHED') then
    raise exception 'invalid outcome' using errcode = '22023';
  end if;

  select * into v
  from public.publication_jobs
  where id = p_job
  for update;
  if not found then
    raise exception 'job not found' using errcode = '42501';
  end if;
  if (select auth.role()) is distinct from 'service_role'
     and not private.can_admin(v.workspace_id) then
    raise exception 'job not found' using errcode = '42501';
  end if;

  select * into v_existing
  from public.publication_job_manual_resolutions
  where request_id = p_request_id;
  if found then
    if v_existing.publication_job_id = p_job
       and v_existing.outcome = p_outcome
       and v_existing.actor_user_id is not distinct from v_actor then
      return;
    end if;
    raise exception 'request id already used' using errcode = '22023';
  end if;

  if v.status <> 'UNKNOWN' then
    raise exception 'job is not UNKNOWN' using errcode = '22023';
  end if;

  insert into public.publication_job_manual_resolutions
    (request_id, publication_job_id, workspace_id, actor_user_id, outcome)
  values (p_request_id, p_job, v.workspace_id, v_actor, p_outcome);

  if p_outcome = 'PUBLISHED' then
    update public.publication_jobs
       set status = 'PUBLISHED', last_error_code = null, last_error_message = null
     where id = p_job;
  else
    update public.publication_jobs
       set status = 'SCHEDULED',
           scheduled_at = now(),
           remote_publish_id = null,
           attempt_count = 0,
           next_attempt_at = null,
           last_error_code = null,
           last_error_message = null
     where id = p_job;
  end if;

  perform public.add_job_event(
    p_job,
    'MANUAL_RESOLUTION',
    jsonb_build_object(
      'outcome', p_outcome,
      'actor', v_actor,
      'request_id', p_request_id
    )
  );
end;
$$;

-- Keep the legacy API name during the bundle-cache transition, but fail closed.
-- Never synthesize a request_id or delegate: old clients cannot prove retry identity.
create or replace function public.resolve_unknown_job(p_job uuid, p_outcome text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'client update required; reload AutoClip before resolving job'
    using errcode = '0A000';
end;
$$;

revoke execute on function public.change_workspace_plan(uuid, text) from public, anon;
grant execute on function public.change_workspace_plan(uuid, text) to authenticated, service_role;

revoke execute on function public.resolve_unknown_job(uuid, text, uuid) from public, anon;
grant execute on function public.resolve_unknown_job(uuid, text, uuid) to authenticated, service_role;
revoke execute on function public.resolve_unknown_job(uuid, text) from public, anon;
grant execute on function public.resolve_unknown_job(uuid, text) to authenticated;
