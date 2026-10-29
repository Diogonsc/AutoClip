-- Platform-level user administration, separate from per-workspace OWNER roles.
create table public.platform_owners (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- Seed this list manually after deployment with the application's owner user UUID.
-- Example (SQL editor): insert into public.platform_owners (user_id) values ('<auth.users.id>');

alter table public.platform_owners enable row level security;
revoke all on public.platform_owners from public, anon, authenticated;
grant select, insert, update, delete on public.platform_owners to service_role;

create table public.platform_user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  is_active boolean not null default true,
  billing_started_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_user_settings enable row level security;
revoke all on public.platform_user_settings from public, anon, authenticated;
grant select, insert, update, delete on public.platform_user_settings to service_role;

create trigger set_updated_at before update on public.platform_user_settings
  for each row execute function private.set_updated_at();

-- Backfill existing accounts as active; new signups receive the same defaults.
insert into public.platform_user_settings (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create function private.handle_new_platform_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.platform_user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_platform_settings
  after insert on auth.users
  for each row execute function private.handle_new_platform_user();

revoke execute on function private.handle_new_platform_user() from public, anon, authenticated;

create function private.is_account_active(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select s.is_active from public.platform_user_settings s where s.user_id = p_user
  ), false);
$$;
revoke execute on function private.is_account_active(uuid) from public, anon;
grant execute on function private.is_account_active(uuid) to authenticated, service_role;

-- A suspended account keeps its records but cannot use any workspace role.
create or replace function private.role_in(p_workspace uuid, p_roles public.workspace_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_account_active((select auth.uid())) and exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = p_workspace
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

-- Account deletion is only callable with the server service role. Owned workspaces
-- (including their tenant data) and the Auth account are removed in one transaction.
create function public.delete_platform_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.platform_owners where user_id = p_user_id)
     and (select count(*) from public.platform_owners) <= 1 then
    raise exception 'cannot delete the last platform owner' using errcode = '23514';
  end if;

  delete from public.workspaces where owner_user_id = p_user_id;
  delete from auth.users where id = p_user_id;
end;
$$;
revoke execute on function public.delete_platform_user(uuid) from public, anon, authenticated;
grant execute on function public.delete_platform_user(uuid) to service_role;
