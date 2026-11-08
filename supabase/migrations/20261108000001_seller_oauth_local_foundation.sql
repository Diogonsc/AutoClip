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
