-- =====================================================================
-- SaaS TikTok — schema base (spec v1.1, adaptada: Supabase + Vercel)
-- Tabelas, enums, triggers e bootstrap de workspace.
-- RLS/grants ficam na migration 02; Storage e fila na migration 03.
-- =====================================================================

-- Schema privado: helpers de segurança que NÃO ficam expostos via PostgREST.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.workspace_role as enum ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');

create type public.channel_status as enum (
  'PENDING_AUTH', 'CONNECTED', 'REAUTH_REQUIRED',
  'PERMISSION_BLOCKED', 'REVOKED', 'ERROR'
);

create type public.publication_status as enum (
  'DRAFT', 'SCHEDULED', 'READY', 'PROCESSING', 'PUBLISHED', 'FAILED',
  'RETRY_WAIT', 'BLOCKED_APPROVAL', 'BLOCKED_PERMISSION', 'BLOCKED_REAUTH',
  'UNKNOWN', 'CANCELLED'
);

create type public.media_status as enum ('UPLOADING', 'READY', 'FAILED', 'DELETED');

-- ---------------------------------------------------------------------
-- Utilitário: updated_at
-- ---------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. profiles
-- ---------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. workspaces
-- ---------------------------------------------------------------------
create table public.workspaces (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  owner_user_id uuid not null references auth.users (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index workspaces_owner_idx on public.workspaces (owner_user_id);

-- ---------------------------------------------------------------------
-- 3. workspace_members
-- ---------------------------------------------------------------------
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         public.workspace_role not null default 'VIEWER',
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- ---------------------------------------------------------------------
-- 12. workspace_settings (criada junto, pois o bootstrap depende dela)
-- ---------------------------------------------------------------------
create table public.workspace_settings (
  workspace_id         uuid primary key references public.workspaces (id) on delete cascade,
  -- Trava de segurança (spec 2.6): publicação automática desligada por padrão.
  auto_publish_enabled boolean not null default false,
  default_timezone     text not null default 'America/Sao_Paulo',
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. channels
-- ---------------------------------------------------------------------
create table public.channels (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  provider          text not null default 'tiktok' check (provider in ('tiktok')),
  provider_user_id  text,  -- preenchido pelo callback OAuth (backend)
  display_name      text not null check (char_length(btrim(display_name)) between 1 and 120),
  connection_status public.channel_status not null default 'PENDING_AUTH',
  authorized_at     timestamptz,
  last_validated_at timestamptz,
  last_error_code   text,
  last_error_message text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Alvo das FKs compostas que garantem coerência de workspace.
  unique (id, workspace_id)
);
-- Mesma identidade do provedor não pode ser cadastrada duas vezes no mesmo workspace.
create unique index channels_provider_identity_uq
  on public.channels (workspace_id, provider, provider_user_id)
  where provider_user_id is not null;

-- ---------------------------------------------------------------------
-- 5. oauth_connections  (SOMENTE service_role — ver migration 02)
-- ---------------------------------------------------------------------
create table public.oauth_connections (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null,
  channel_id               uuid not null unique,
  provider                 text not null default 'tiktok',
  encrypted_access_token   text not null,   -- cifrado na Edge Function (AES-GCM)
  encrypted_refresh_token  text,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz,
  granted_scopes           text[] not null default '{}',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  foreign key (channel_id, workspace_id)
    references public.channels (id, workspace_id) on delete cascade
);
create index oauth_connections_workspace_idx on public.oauth_connections (workspace_id);

-- ---------------------------------------------------------------------
-- 6. media_assets
-- ---------------------------------------------------------------------
create table public.media_assets (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  original_filename text not null,
  storage_backend   text not null default 'supabase' check (storage_backend in ('supabase')),
  -- Caminho no bucket 'media': <workspace_id>/<media_id>/original.<ext>
  storage_key       text not null,
  mime_type         text not null,
  file_size_bytes   bigint not null check (file_size_bytes > 0),
  duration_seconds  numeric,
  width             integer,
  height            integer,
  tags              text[] not null default '{}',
  category          text,
  status            public.media_status not null default 'UPLOADING',
  checksum_sha256   text,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (id, workspace_id),
  unique (storage_backend, storage_key),
  -- O caminho precisa começar pelo workspace dono do arquivo.
  check (storage_key like workspace_id::text || '/%')
);
create index media_assets_workspace_idx on public.media_assets (workspace_id, created_at desc);
create index media_assets_tags_idx on public.media_assets using gin (tags);

-- ---------------------------------------------------------------------
-- 7. publication_jobs
-- ---------------------------------------------------------------------
create table public.publication_jobs (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  channel_id         uuid not null,
  media_asset_id     uuid not null,
  caption            text not null default '',
  privacy_level      text,   -- só valores retornados pela API oficial (spec 2.5)
  scheduled_at       timestamptz,
  timezone           text not null default 'America/Sao_Paulo',
  status             public.publication_status not null default 'DRAFT',
  remote_publish_id  text,
  idempotency_key    uuid not null default gen_random_uuid(),
  attempt_count      integer not null default 0,
  max_attempts       integer not null default 3,
  next_attempt_at    timestamptz,
  locked_at          timestamptz,
  locked_by          text,
  last_error_code    text,
  last_error_message text,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, idempotency_key),
  -- Coerência: canal e mídia SEMPRE do mesmo workspace da publicação (spec 4.7).
  foreign key (channel_id, workspace_id)
    references public.channels (id, workspace_id),
  foreign key (media_asset_id, workspace_id)
    references public.media_assets (id, workspace_id),
  check (status not in ('SCHEDULED', 'READY') or scheduled_at is not null)
);
create index publication_jobs_workspace_idx on public.publication_jobs (workspace_id, scheduled_at);
create index publication_jobs_channel_idx on public.publication_jobs (channel_id);
create index publication_jobs_media_idx on public.publication_jobs (media_asset_id);
-- Índice parcial usado pelo claim da fila.
create index publication_jobs_due_idx on public.publication_jobs (scheduled_at)
  where status in ('SCHEDULED', 'RETRY_WAIT');

-- ---------------------------------------------------------------------
-- 8. publication_attempts  (workspace_id denormalizado p/ RLS simples)
-- ---------------------------------------------------------------------
create table public.publication_attempts (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null,
  publication_job_id uuid not null,
  attempt_number     integer not null,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  result             text,
  error_code         text,
  error_message      text,
  remote_status      text,
  foreign key (publication_job_id, workspace_id)
    references public.publication_jobs (id, workspace_id) on delete cascade,
  unique (publication_job_id, attempt_number)
);
create index publication_attempts_workspace_idx on public.publication_attempts (workspace_id);

-- ---------------------------------------------------------------------
-- 9. publication_events  (nunca gravar tokens/segredos no payload)
-- ---------------------------------------------------------------------
create table public.publication_events (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null,
  publication_job_id uuid not null,
  event_type         text not null,
  event_payload      jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  foreign key (publication_job_id, workspace_id)
    references public.publication_jobs (id, workspace_id) on delete cascade
);
create index publication_events_job_idx on public.publication_events (publication_job_id, created_at);
create index publication_events_workspace_idx on public.publication_events (workspace_id);

-- ---------------------------------------------------------------------
-- 10. audit_logs
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  action        text not null,
  entity_type   text not null,
  entity_id     uuid,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index audit_logs_workspace_idx on public.audit_logs (workspace_id, created_at desc);

-- ---------------------------------------------------------------------
-- 11. notifications
-- ---------------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  type         text not null,
  title        text not null,
  body         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_workspace_idx on public.notifications (workspace_id);

-- ---------------------------------------------------------------------
-- Triggers de updated_at
-- ---------------------------------------------------------------------
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.workspaces
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.workspace_settings
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.channels
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.oauth_connections
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.publication_jobs
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Bootstrap: cria workspace + membro OWNER + settings
-- ---------------------------------------------------------------------
create function private.bootstrap_workspace(p_user uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  insert into public.workspaces (name, owner_user_id)
  values (p_name, p_user)
  returning id into v_ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws, p_user, 'OWNER');

  insert into public.workspace_settings (workspace_id) values (v_ws);

  return v_ws;
end;
$$;
revoke execute on function private.bootstrap_workspace(uuid, text) from public, anon, authenticated;

-- Novo usuário no Supabase Auth => profile + workspace pessoal.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Usuário'
  );
begin
  insert into public.profiles (id, display_name)
  values (new.id, v_name)
  on conflict (id) do nothing;

  perform private.bootstrap_workspace(new.id, 'Meu workspace');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- RPC: usuário autenticado cria um workspace adicional.
create function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception 'invalid workspace name' using errcode = '22023';
  end if;
  return private.bootstrap_workspace((select auth.uid()), btrim(p_name));
end;
$$;
revoke execute on function public.create_workspace(text) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;

-- Garante que todo workspace mantenha pelo menos um OWNER.
create function private.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'OWNER' and (tg_op = 'DELETE' or new.role <> 'OWNER') then
    -- Se o workspace está sendo apagado (cascade), não bloquear.
    if exists (select 1 from public.workspaces w where w.id = old.workspace_id)
       and not exists (
         select 1 from public.workspace_members m
         where m.workspace_id = old.workspace_id
           and m.role = 'OWNER'
           and m.user_id <> old.user_id
       ) then
      raise exception 'workspace must keep at least one OWNER' using errcode = '23514';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger guard_last_owner
  before update of role or delete on public.workspace_members
  for each row execute function private.guard_last_owner();
