-- =====================================================================
-- RLS, helpers de autorização e grants (princípio do menor privilégio)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers (SECURITY DEFINER para evitar recursão de RLS em workspace_members)
-- ---------------------------------------------------------------------
create function private.role_in(p_workspace uuid, p_roles public.workspace_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = p_workspace
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

create function private.is_member(p_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.role_in(p_workspace, array['OWNER','ADMIN','EDITOR','VIEWER']::public.workspace_role[]);
$$;

create function private.can_edit(p_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.role_in(p_workspace, array['OWNER','ADMIN','EDITOR']::public.workspace_role[]);
$$;

create function private.can_admin(p_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.role_in(p_workspace, array['OWNER','ADMIN']::public.workspace_role[]);
$$;

create function private.is_owner(p_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.role_in(p_workspace, array['OWNER']::public.workspace_role[]);
$$;

create function private.shares_workspace_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members a
    join public.workspace_members b on b.workspace_id = a.workspace_id
    where a.user_id = (select auth.uid())
      and b.user_id = p_user
  );
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.role_in(uuid, public.workspace_role[]),
  private.is_member(uuid),
  private.can_edit(uuid),
  private.can_admin(uuid),
  private.is_owner(uuid),
  private.shares_workspace_with(uuid)
to authenticated, service_role;

-- Somente OWNER liga/desliga a publicação automática (spec 5.1).
create function private.guard_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.auto_publish_enabled is distinct from old.auto_publish_enabled
     and (select auth.uid()) is not null           -- service_role (auth.uid() nulo) é confiável
     and not private.is_owner(new.workspace_id) then
    raise exception 'only OWNER can change auto_publish_enabled' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_settings
  before update on public.workspace_settings
  for each row execute function private.guard_settings();

-- ---------------------------------------------------------------------
-- Grants: nada para anon; authenticated só o necessário (por coluna)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

grant select on
  public.profiles, public.workspaces, public.workspace_members,
  public.workspace_settings, public.channels, public.media_assets,
  public.publication_jobs, public.publication_attempts, public.publication_events,
  public.audit_logs, public.notifications
to authenticated;

grant update (display_name) on public.profiles to authenticated;
grant update (name) on public.workspaces to authenticated;

grant insert (workspace_id, user_id, role) on public.workspace_members to authenticated;
grant update (role) on public.workspace_members to authenticated;
grant delete on public.workspace_members to authenticated;

grant update (default_timezone, auto_publish_enabled) on public.workspace_settings to authenticated;

-- connection_status/provider_user_id/escopos só o backend define (OAuth).
grant insert (workspace_id, display_name) on public.channels to authenticated;
grant update (display_name) on public.channels to authenticated;
grant delete on public.channels to authenticated;

-- status/checksum/duração são definidos pelo backend após validar o upload.
grant insert (id, workspace_id, original_filename, storage_key, mime_type,
              file_size_bytes, tags, category, created_by)
  on public.media_assets to authenticated;
grant update (original_filename, tags, category) on public.media_assets to authenticated;
grant delete on public.media_assets to authenticated;

grant insert (workspace_id, channel_id, media_asset_id, caption, privacy_level,
              scheduled_at, timezone, status, created_by)
  on public.publication_jobs to authenticated;
grant update (channel_id, media_asset_id, caption, privacy_level,
              scheduled_at, timezone, status)
  on public.publication_jobs to authenticated;
grant delete on public.publication_jobs to authenticated;

grant update (read_at) on public.notifications to authenticated;

-- oauth_connections: nenhum grant para anon/authenticated (tokens nunca saem do backend).

-- ---------------------------------------------------------------------
-- Habilitar RLS em tudo (inclusive oauth_connections: defesa em profundidade)
-- ---------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.workspaces          enable row level security;
alter table public.workspace_members   enable row level security;
alter table public.workspace_settings  enable row level security;
alter table public.channels            enable row level security;
alter table public.oauth_connections   enable row level security;
alter table public.media_assets        enable row level security;
alter table public.publication_jobs    enable row level security;
alter table public.publication_attempts enable row level security;
alter table public.publication_events  enable row level security;
alter table public.audit_logs          enable row level security;
alter table public.notifications       enable row level security;

-- ---------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------

-- profiles
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_workspace_with(id));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- workspaces (criação via RPC create_workspace; sem policy de insert)
create policy workspaces_select on public.workspaces
  for select to authenticated
  using (private.is_member(id));

create policy workspaces_update on public.workspaces
  for update to authenticated
  using (private.can_admin(id))
  with check (private.can_admin(id));

-- workspace_members: ADMIN gerencia, mas só OWNER mexe em OWNER.
create policy members_select on public.workspace_members
  for select to authenticated
  using (private.is_member(workspace_id));

create policy members_insert on public.workspace_members
  for insert to authenticated
  with check (
    private.is_owner(workspace_id)
    or (private.can_admin(workspace_id) and role <> 'OWNER')
  );

create policy members_update on public.workspace_members
  for update to authenticated
  using (
    private.is_owner(workspace_id)
    or (private.can_admin(workspace_id) and role <> 'OWNER')
  )
  with check (
    private.is_owner(workspace_id)
    or (private.can_admin(workspace_id) and role <> 'OWNER')
  );

create policy members_delete on public.workspace_members
  for delete to authenticated
  using (
    private.is_owner(workspace_id)
    or (private.can_admin(workspace_id) and role <> 'OWNER')
    or user_id = (select auth.uid())   -- qualquer membro pode sair (guard_last_owner protege)
  );

-- workspace_settings
create policy settings_select on public.workspace_settings
  for select to authenticated
  using (private.is_member(workspace_id));

create policy settings_update on public.workspace_settings
  for update to authenticated
  using (private.can_admin(workspace_id))
  with check (private.can_admin(workspace_id));

-- channels
create policy channels_select on public.channels
  for select to authenticated
  using (private.is_member(workspace_id));

create policy channels_insert on public.channels
  for insert to authenticated
  with check (private.can_edit(workspace_id));

create policy channels_update on public.channels
  for update to authenticated
  using (private.can_edit(workspace_id))
  with check (private.can_edit(workspace_id));

create policy channels_delete on public.channels
  for delete to authenticated
  using (private.can_admin(workspace_id));

-- media_assets
create policy media_select on public.media_assets
  for select to authenticated
  using (private.is_member(workspace_id));

create policy media_insert on public.media_assets
  for insert to authenticated
  with check (private.can_edit(workspace_id) and created_by = (select auth.uid()));

create policy media_update on public.media_assets
  for update to authenticated
  using (private.can_edit(workspace_id))
  with check (private.can_edit(workspace_id));

create policy media_delete on public.media_assets
  for delete to authenticated
  using (private.can_admin(workspace_id));

-- publication_jobs: usuário só cria/edita rascunhos e agendamentos ainda não iniciados.
create policy jobs_select on public.publication_jobs
  for select to authenticated
  using (private.is_member(workspace_id));

create policy jobs_insert on public.publication_jobs
  for insert to authenticated
  with check (
    private.can_edit(workspace_id)
    and created_by = (select auth.uid())
    and status in ('DRAFT', 'SCHEDULED')
  );

create policy jobs_update on public.publication_jobs
  for update to authenticated
  using (
    private.can_edit(workspace_id)
    and status in ('DRAFT', 'SCHEDULED', 'READY', 'RETRY_WAIT',
                   'BLOCKED_APPROVAL', 'BLOCKED_PERMISSION', 'BLOCKED_REAUTH')
  )
  with check (
    private.can_edit(workspace_id)
    and status in ('DRAFT', 'SCHEDULED', 'CANCELLED')
  );

create policy jobs_delete on public.publication_jobs
  for delete to authenticated
  using (private.can_edit(workspace_id) and status in ('DRAFT', 'CANCELLED'));

-- attempts / events: somente leitura para membros (escrita só via backend/triggers)
create policy attempts_select on public.publication_attempts
  for select to authenticated
  using (private.is_member(workspace_id));

create policy events_select on public.publication_events
  for select to authenticated
  using (private.is_member(workspace_id));

-- audit_logs: ADMIN+ lê; escrita só backend
create policy audit_select on public.audit_logs
  for select to authenticated
  using (private.can_admin(workspace_id));

-- notifications: cada usuário vê e marca como lidas as suas
create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()) and private.is_member(workspace_id));

create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
