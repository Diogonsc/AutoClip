-- Local-only preparation. Do not apply remotely before Seller OAuth review.
create type public.seller_oauth_state_status as enum ('PENDING','CLAIMED','COMPLETED','FAILED','EXPIRED');
create table public.seller_oauth_states (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 initiated_by uuid not null references auth.users(id), state_hash text not null unique,
 status public.seller_oauth_state_status not null default 'PENDING', expires_at timestamptz not null,
 claimed_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(),
 check (
   expires_at > created_at
   and expires_at <= created_at + interval '10 minutes'
 )
);
create table public.seller_connections (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 provider text not null default 'tiktok_shop_seller', seller_open_id text not null, seller_name text, seller_region text,
 user_type smallint not null check (user_type=0), granted_scopes text[] not null default '{}', status text not null default 'CONNECTED' check (status in ('CONNECTED','REAUTH_REQUIRED','REVOKED','ERROR')), connected_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,seller_open_id), unique(id,workspace_id)
);
create table public.seller_credentials (
 connection_id uuid primary key references public.seller_connections(id) on delete cascade, access_token_ciphertext text not null, refresh_token_ciphertext text not null,
 access_expires_at timestamptz not null, refresh_expires_at timestamptz not null, encryption_key_version smallint not null default 1, credential_version bigint not null default 1,
 refresh_lease_owner uuid, refresh_lease_expires_at timestamptz, refresh_fencing_token bigint not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(refresh_expires_at>=access_expires_at)
);
alter table public.seller_oauth_states enable row level security; alter table public.seller_connections enable row level security; alter table public.seller_credentials enable row level security;
revoke all on public.seller_credentials from public, anon, authenticated;
revoke all on public.seller_oauth_states from public, anon, authenticated;
revoke all on public.seller_connections from public, anon;
grant select on public.seller_connections to authenticated;
create policy seller_connections_select on public.seller_connections for select to authenticated using (private.is_member(workspace_id));

alter table public.seller_oauth_states add column connection_id uuid;
alter table public.seller_oauth_states add constraint seller_oauth_states_connection_workspace_fkey
  foreign key (connection_id, workspace_id)
  references public.seller_connections(id, workspace_id) on delete set null;
alter table public.seller_oauth_states add constraint seller_state_status_check check (
  (status='PENDING' and claimed_at is null and completed_at is null) or
  (status in ('CLAIMED','FAILED','EXPIRED') and claimed_at is not null) or
  (status='COMPLETED' and claimed_at is not null and completed_at is not null)
);
create index seller_oauth_states_workspace_idx on public.seller_oauth_states(workspace_id, created_at desc);

create function private.guard_seller_oauth_state_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('COMPLETED', 'FAILED', 'EXPIRED') then
    raise exception 'seller oauth state is terminal' using errcode = '42501';
  end if;

  if old.status = 'PENDING' and new.status not in ('PENDING', 'CLAIMED', 'EXPIRED') then
    raise exception 'invalid seller oauth state transition' using errcode = '22023';
  end if;

  if old.status = 'CLAIMED' and new.status not in ('CLAIMED', 'COMPLETED', 'FAILED') then
    raise exception 'invalid seller oauth state transition' using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger seller_oauth_states_transition_guard
  before update on public.seller_oauth_states
  for each row execute function private.guard_seller_oauth_state_transition();

create table public.seller_shops (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 connection_id uuid not null,
 shop_id text not null, shop_cipher text not null, shop_name text, region text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(connection_id, shop_id),
 foreign key (connection_id, workspace_id)
   references public.seller_connections(id, workspace_id) on delete cascade
);
create table public.seller_audit_events (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 connection_id uuid,
 event_type text not null check (event_type in ('OAUTH_STARTED','STATE_CLAIMED','OAUTH_COMPLETED','OAUTH_FAILED','REFRESH_STARTED','REFRESH_COMPLETED','REFRESH_FAILED','REAUTH_REQUIRED','CONNECTION_REVOKED')),
 correlation_id uuid not null default gen_random_uuid(), metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), check (not (metadata ?| array['access_token','refresh_token','app_secret','auth_code','code']))
);
alter table public.seller_audit_events add constraint seller_audit_events_connection_workspace_fkey
  foreign key (connection_id, workspace_id)
  references public.seller_connections(id, workspace_id) on delete set null;
create index seller_shops_workspace_idx on public.seller_shops(workspace_id);
create index seller_audit_workspace_idx on public.seller_audit_events(workspace_id, created_at desc);
alter table public.seller_shops enable row level security; alter table public.seller_audit_events enable row level security;
revoke all on public.seller_shops, public.seller_audit_events from public, anon;
grant select on public.seller_shops, public.seller_audit_events to authenticated;
create policy seller_shops_select on public.seller_shops for select to authenticated using (private.is_member(workspace_id));
create policy seller_audit_select on public.seller_audit_events for select to authenticated using (private.can_admin(workspace_id));

create function public.create_seller_oauth_state(p_workspace uuid, p_state_hash text, p_connection uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not private.can_edit(p_workspace) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_connection is not null and not exists(select 1 from public.seller_connections c where c.id=p_connection and c.workspace_id=p_workspace) then raise exception 'connection/workspace mismatch' using errcode='42501'; end if;
 insert into public.seller_oauth_states(workspace_id,initiated_by,connection_id,state_hash,expires_at) values(p_workspace,auth.uid(),p_connection,p_state_hash,now()+interval '10 minutes') returning id into v_id;
 insert into public.seller_audit_events(workspace_id,connection_id,event_type) values(p_workspace,p_connection,'OAUTH_STARTED'); return v_id;
end $$;
create function public.claim_seller_oauth_state(p_state_hash text)
returns public.seller_oauth_states language plpgsql security definer set search_path='' as $$
declare v public.seller_oauth_states;
begin
 update public.seller_oauth_states set status='CLAIMED',claimed_at=now() where state_hash=p_state_hash and status='PENDING' and expires_at>now() returning * into v;
 if not found then raise exception 'invalid or consumed seller oauth state' using errcode='42501'; end if;
 insert into public.seller_audit_events(workspace_id,connection_id,event_type) values(v.workspace_id,v.connection_id,'STATE_CLAIMED'); return v;
end $$;
create function public.fail_seller_oauth_state(p_state uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v public.seller_oauth_states; begin update public.seller_oauth_states set status='FAILED' where id=p_state and status='CLAIMED' returning * into v; if not found then raise exception 'state not claimed' using errcode='42501'; end if; insert into public.seller_audit_events(workspace_id,connection_id,event_type) values(v.workspace_id,v.connection_id,'OAUTH_FAILED'); end $$;
create function public.save_seller_connection_metadata(
  p_state uuid,
  p_open_id text,
  p_name text,
  p_region text,
  p_scopes text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.seller_oauth_states;
  v_connection uuid;
begin
  if coalesce(btrim(p_open_id), '') = '' then
    raise exception 'seller open id is required' using errcode = '22023';
  end if;

  select * into v
  from public.seller_oauth_states
  where id = p_state and status = 'CLAIMED'
  for update;
  if not found then
    raise exception 'state not claimed' using errcode = '42501';
  end if;

  insert into public.seller_connections(
    workspace_id, seller_open_id, seller_name, seller_region, user_type, granted_scopes
  ) values (
    v.workspace_id, p_open_id, nullif(btrim(p_name), ''), nullif(btrim(p_region), ''), 0,
    coalesce(p_scopes, '{}')
  ) on conflict (workspace_id, seller_open_id) do update
  set seller_name = excluded.seller_name,
      seller_region = excluded.seller_region,
      granted_scopes = excluded.granted_scopes,
      updated_at = now()
  returning id into v_connection;

  update public.seller_oauth_states
  set status = 'COMPLETED', completed_at = now(), connection_id = v_connection
  where id = v.id;

  insert into public.seller_audit_events(workspace_id, connection_id, event_type)
  values (v.workspace_id, v_connection, 'OAUTH_COMPLETED');
  return v_connection;
end;
$$;

create function public.complete_seller_oauth_state(
  p_state uuid,
  p_open_id text,
  p_name text,
  p_region text,
  p_scopes text[]
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.save_seller_connection_metadata(p_state, p_open_id, p_name, p_region, p_scopes);
$$;

create function public.upsert_seller_authorized_shops(
  p_workspace uuid,
  p_connection uuid,
  p_shops jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop jsonb;
  v_count integer := 0;
begin
  if jsonb_typeof(p_shops) <> 'array' then
    raise exception 'shops must be an array' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.seller_connections c
    where c.id = p_connection and c.workspace_id = p_workspace
  ) then
    raise exception 'connection/workspace mismatch' using errcode = '42501';
  end if;

  for v_shop in select value from jsonb_array_elements(p_shops)
  loop
    if coalesce(btrim(v_shop ->> 'shop_id'), '') = ''
       or coalesce(btrim(v_shop ->> 'shop_cipher'), '') = '' then
      raise exception 'shop id and cipher are required' using errcode = '22023';
    end if;

    insert into public.seller_shops(
      workspace_id, connection_id, shop_id, shop_cipher, shop_name, region
    ) values (
      p_workspace, p_connection, v_shop ->> 'shop_id', v_shop ->> 'shop_cipher',
      nullif(btrim(v_shop ->> 'shop_name'), ''), nullif(btrim(v_shop ->> 'region'), '')
    ) on conflict (connection_id, shop_id) do update
    set shop_cipher = excluded.shop_cipher,
        shop_name = excluded.shop_name,
        region = excluded.region,
        updated_at = now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function
  public.claim_seller_oauth_state(text),
  public.complete_seller_oauth_state(uuid,text,text,text,text[]),
  public.save_seller_connection_metadata(uuid,text,text,text,text[]),
  public.upsert_seller_authorized_shops(uuid,uuid,jsonb),
  public.fail_seller_oauth_state(uuid)
from public, anon, authenticated;
revoke execute on function public.create_seller_oauth_state(uuid,text,uuid) from public, anon;
grant execute on function public.create_seller_oauth_state(uuid,text,uuid) to authenticated;
grant execute on function
  public.claim_seller_oauth_state(text),
  public.complete_seller_oauth_state(uuid,text,text,text,text[]),
  public.save_seller_connection_metadata(uuid,text,text,text,text[]),
  public.upsert_seller_authorized_shops(uuid,uuid,jsonb),
  public.fail_seller_oauth_state(uuid)
to service_role;
