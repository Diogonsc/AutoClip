-- Telemetria global do worker; sem dados de usuário, mídia ou credenciais.
create table if not exists public.media_validation_workers (
  instance_id uuid primary key,
  worker_version text not null check (length(worker_version) between 1 and 64),
  status text not null check (status in ('ONLINE','DEGRADED','STOPPING')),
  last_heartbeat_at timestamptz not null default now(),
  last_completed_at timestamptz,
  pending_count integer not null default 0 check (pending_count >= 0),
  processing_count integer not null default 0 check (processing_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  average_validation_ms integer not null default 0 check (average_validation_ms between 0 and 1800000),
  updated_at timestamptz not null default now()
);

alter table public.media_validation_workers enable row level security;
revoke all on public.media_validation_workers from public, anon, authenticated;
grant select, insert, update on public.media_validation_workers to service_role;

create or replace function public.media_validation_worker_heartbeat(
  p_instance_id uuid,
  p_version text,
  p_status text,
  p_pending_count integer,
  p_processing_count integer,
  p_error_count integer,
  p_average_validation_ms integer,
  p_last_completed_at timestamptz default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  if p_instance_id is null or coalesce(length(p_version),0) not between 1 and 64
     or p_status not in ('ONLINE','DEGRADED','STOPPING')
     or p_pending_count is null or p_pending_count not between 0 and 1000000
     or p_processing_count is null or p_processing_count not between 0 and 1000
     or p_error_count is null or p_error_count not between 0 and 1000000
     or p_average_validation_ms is null or p_average_validation_ms not between 0 and 1800000
     or p_last_completed_at > now() + interval '5 minutes' then
    raise exception 'invalid_worker_heartbeat' using errcode='22023';
  end if;
  insert into public.media_validation_workers(
    instance_id, worker_version, status, last_heartbeat_at, last_completed_at,
    pending_count, processing_count, error_count, average_validation_ms, updated_at
  ) values (
    p_instance_id, p_version, p_status, now(), p_last_completed_at,
    p_pending_count, p_processing_count, p_error_count, p_average_validation_ms, now()
  ) on conflict (instance_id) do update set
    worker_version=excluded.worker_version, status=excluded.status,
    last_heartbeat_at=excluded.last_heartbeat_at,
    last_completed_at=coalesce(excluded.last_completed_at,public.media_validation_workers.last_completed_at),
    pending_count=excluded.pending_count, processing_count=excluded.processing_count,
    error_count=excluded.error_count, average_validation_ms=excluded.average_validation_ms,
    updated_at=excluded.updated_at;
end;
$$;
revoke all on function public.media_validation_worker_heartbeat(uuid,text,text,integer,integer,integer,integer,timestamptz) from public, anon, authenticated;
grant execute on function public.media_validation_worker_heartbeat(uuid,text,text,integer,integer,integer,integer,timestamptz) to service_role;
