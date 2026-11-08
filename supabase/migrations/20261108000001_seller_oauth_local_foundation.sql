-- Local-only preparation. Do not apply remotely before Seller OAuth review.
create type public.seller_oauth_state_status as enum ('PENDING','CLAIMED','COMPLETED','FAILED','EXPIRED');
create table public.seller_oauth_states (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 initiated_by uuid not null references auth.users(id), state_hash text not null unique,
 status public.seller_oauth_state_status not null default 'PENDING', expires_at timestamptz not null,
 claimed_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(),
 check (expires_at <= created_at + interval '10 minutes')
);
create table public.seller_connections (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 provider text not null default 'tiktok_shop_seller', seller_open_id text not null, seller_name text, seller_region text,
 user_type smallint not null check (user_type=0), granted_scopes text[] not null default '{}', status text not null default 'CONNECTED', connected_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,seller_open_id)
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

alter table public.seller_oauth_states add column connection_id uuid references public.seller_connections(id) on delete set null;
alter table public.seller_oauth_states add constraint seller_state_status_check check (
  (status='PENDING' and claimed_at is null and completed_at is null) or
  (status in ('CLAIMED','FAILED','EXPIRED') and claimed_at is not null) or
  (status='COMPLETED' and claimed_at is not null and completed_at is not null)
);
create index seller_oauth_states_workspace_idx on public.seller_oauth_states(workspace_id, created_at desc);

create table public.seller_shops (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 connection_id uuid not null references public.seller_connections(id) on delete cascade,
 shop_id text not null, shop_cipher text not null, shop_name text, region text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(connection_id, shop_id), unique(connection_id, workspace_id)
);
create table public.seller_audit_events (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 connection_id uuid references public.seller_connections(id) on delete set null,
 event_type text not null check (event_type in ('OAUTH_STARTED','STATE_CLAIMED','OAUTH_COMPLETED','OAUTH_FAILED','REFRESH_STARTED','REFRESH_COMPLETED','REFRESH_FAILED','REAUTH_REQUIRED','CONNECTION_REVOKED')),
 correlation_id uuid not null default gen_random_uuid(), metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), check (not (metadata ?| array['access_token','refresh_token','app_secret','auth_code','code']))
);
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
create function public.complete_seller_oauth_state(p_state uuid, p_open_id text, p_name text, p_region text, p_scopes text[])
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.seller_oauth_states; v_connection uuid; begin select * into v from public.seller_oauth_states where id=p_state and status='CLAIMED' for update; if not found then raise exception 'state not claimed' using errcode='42501'; end if; insert into public.seller_connections(workspace_id,seller_open_id,seller_name,seller_region,user_type,granted_scopes) values(v.workspace_id,p_open_id,p_name,p_region,0,p_scopes) on conflict(workspace_id,seller_open_id) do update set seller_name=excluded.seller_name, seller_region=excluded.seller_region, granted_scopes=excluded.granted_scopes returning id into v_connection; update public.seller_oauth_states set status='COMPLETED',completed_at=now(),connection_id=v_connection where id=v.id; insert into public.seller_audit_events(workspace_id,connection_id,event_type) values(v.workspace_id,v_connection,'OAUTH_COMPLETED'); return v_connection; end $$;
revoke execute on function public.claim_seller_oauth_state(text), public.complete_seller_oauth_state(uuid,text,text,text,text[]), public.fail_seller_oauth_state(uuid) from public, anon, authenticated;
revoke execute on function public.create_seller_oauth_state(uuid,text,uuid) from public, anon;
grant execute on function public.create_seller_oauth_state(uuid,text,uuid) to authenticated;
grant execute on function public.claim_seller_oauth_state(text), public.complete_seller_oauth_state(uuid,text,text,text[]), public.fail_seller_oauth_state(uuid) to service_role;
