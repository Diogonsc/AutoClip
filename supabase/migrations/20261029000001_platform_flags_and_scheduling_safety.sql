-- Estado global de auditoria do app. O status começa sempre como NÃO auditado.
-- Somente administradores do banco alteram a linha; clientes apenas leem a RPC.
create table if not exists public.platform_flags (
  singleton boolean primary key default true check (singleton),
  tiktok_audited boolean not null default false,
  demo_video_url text,
  updated_at timestamptz not null default now()
);

insert into public.platform_flags (singleton, tiktok_audited, demo_video_url)
values (true, false, null)
on conflict (singleton) do nothing;

alter table public.publication_jobs
  add column if not exists music_rights_confirmed boolean not null default false;

alter table public.platform_flags enable row level security;
revoke all on public.platform_flags from anon, authenticated;

drop function if exists public.get_platform_flags();
create function public.get_platform_flags()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tiktok_audited', coalesce(f.tiktok_audited, false),
    'test_mode', not coalesce(f.tiktok_audited, false),
    'demo_video_url', f.demo_video_url,
    'updated_at', f.updated_at
  )
  from public.platform_flags f
  where f.singleton = true
  union all
  select jsonb_build_object(
    'tiktok_audited', false,
    'test_mode', true,
    'demo_video_url', null,
    'updated_at', null
  )
  where not exists (select 1 from public.platform_flags where singleton = true)
  limit 1;
$$;
revoke all on function public.get_platform_flags() from public, anon;
grant execute on function public.get_platform_flags() to authenticated;

-- Limite operacional conservador: no máximo 15 publicações agendadas/ativas por canal
-- e por data local. É uma proteção do produto, não uma afirmação de limite oficial do TikTok.
create or replace function private.guard_channel_daily_schedule_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local_date date;
  v_count integer;
begin
  if new.status in ('SCHEDULED', 'READY', 'PROCESSING', 'RETRY_WAIT')
     and new.music_rights_confirmed is not true then
    raise exception 'music_rights_consent_required: confirme os direitos/consentimento do áudio antes de agendar.'
      using errcode = '23514';
  end if;

  if new.status in ('SCHEDULED', 'READY', 'PROCESSING', 'RETRY_WAIT')
     and exists (
       select 1
       from public.workspace_settings s
       join public.platform_flags f on f.singleton = true
       where s.workspace_id = new.workspace_id
         and s.publish_mode = 'DIRECT'
         and not f.tiktok_audited
     )
     and coalesce(new.privacy_level, '') <> 'SELF_ONLY' then
    raise exception 'tiktok_app_not_audited: Direct Post deve ficar em SELF_ONLY até a auditoria do app.'
      using errcode = '23514';
  end if;

  if new.status not in ('SCHEDULED', 'READY', 'PROCESSING', 'RETRY_WAIT')
     or new.scheduled_at is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.scheduled_at is not distinct from old.scheduled_at
     and new.channel_id is not distinct from old.channel_id then
    return new;
  end if;

  v_local_date := (new.scheduled_at at time zone coalesce(nullif(new.timezone, ''), 'UTC'))::date;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.channel_id::text || ':' || v_local_date::text, 0));
  select count(*) into v_count
  from public.publication_jobs j
  where j.channel_id = new.channel_id
    and j.id <> new.id
    and j.status in ('SCHEDULED', 'READY', 'PROCESSING', 'RETRY_WAIT')
    and j.scheduled_at is not null
    and (j.scheduled_at at time zone coalesce(nullif(j.timezone, ''), 'UTC'))::date = v_local_date;

  if v_count >= 15 then
    raise exception 'daily_channel_schedule_limit: este canal já tem 15 publicações agendadas para essa data local. Escolha outro horário/dia.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_channel_daily_schedule_limit on public.publication_jobs;
create trigger guard_channel_daily_schedule_limit
before insert or update of status, scheduled_at, channel_id
on public.publication_jobs
for each row execute function private.guard_channel_daily_schedule_limit();

grant insert (music_rights_confirmed) on public.publication_jobs to authenticated;
grant update (music_rights_confirmed) on public.publication_jobs to authenticated;

-- Alertas dentro do app para falhas/bloqueios; e-mail/WhatsApp ficam desativados nesta etapa.
create or replace function private.notify_publication_failure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_body text;
begin
  if new.status not in ('FAILED', 'BLOCKED_APPROVAL', 'BLOCKED_PERMISSION', 'BLOCKED_REAUTH', 'UNKNOWN') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status
     and old.last_error_code is not distinct from new.last_error_code then
    return new;
  end if;

  v_title := case new.status
    when 'BLOCKED_REAUTH' then 'Reconecte seu canal TikTok'
    when 'BLOCKED_PERMISSION' then 'Permissão necessária para publicar'
    when 'BLOCKED_APPROVAL' then 'Publicação bloqueada pela auditoria do app'
    when 'UNKNOWN' then 'Confirme o resultado da publicação'
    else 'Falha ao publicar vídeo'
  end;
  v_body := coalesce(nullif(new.last_error_message, ''), 'Abra o histórico da publicação para ver os detalhes e a ação recomendada.');

  insert into public.notifications (workspace_id, user_id, type, title, body)
  select new.workspace_id, wm.user_id, 'PUBLICATION_' || new.status::text, v_title, v_body
  from public.workspace_members wm
  where wm.workspace_id = new.workspace_id
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists notify_publication_failure on public.publication_jobs;
create trigger notify_publication_failure
  after insert or update of status, last_error_code, last_error_message
  on public.publication_jobs
  for each row execute function private.notify_publication_failure();
