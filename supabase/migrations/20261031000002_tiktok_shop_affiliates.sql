-- TikTok Shop / Afiliados. Tokens permanecem exclusivamente no backend.
-- O catálogo é um cache por workspace; a fonte de verdade continua sendo o TikTok Shop.

create type public.shop_connection_status as enum ('PENDING_AUTH', 'CONNECTED', 'REAUTH_REQUIRED', 'ERROR', 'REVOKED');
create type public.shop_order_status as enum ('PENDING', 'PAID', 'COMPLETED', 'CANCELLED', 'RETURNED', 'REFUNDED', 'UNKNOWN');

create table public.tiktok_shop_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  creator_id text,
  shop_cipher text,
  shop_name text,
  connection_status public.shop_connection_status not null default 'PENDING_AUTH',
  encrypted_access_token text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  granted_scopes text[] not null default '{}',
  last_synced_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, channel_id)
);
create index tiktok_shop_connections_workspace_idx on public.tiktok_shop_connections(workspace_id);

create table public.tiktok_shop_products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.tiktok_shop_connections(id) on delete cascade,
  external_product_id text not null,
  title text not null,
  description text,
  image_url text,
  detail_url text,
  promotion_url text,
  currency text,
  price numeric(14,2),
  commission_rate numeric(8,4),
  commission_amount numeric(14,2),
  availability text,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id, external_product_id)
);
create index tiktok_shop_products_workspace_idx on public.tiktok_shop_products(workspace_id, synced_at desc);

create table public.publication_shop_products (
  publication_job_id uuid not null references public.publication_jobs(id) on delete cascade,
  product_id uuid not null references public.tiktok_shop_products(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  position smallint not null default 0 check (position >= 0),
  promotion_url text,
  created_at timestamptz not null default now(),
  primary key (publication_job_id, product_id),
  unique (publication_job_id, position)
);
create index publication_shop_products_workspace_idx on public.publication_shop_products(workspace_id);

create table public.tiktok_shop_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.tiktok_shop_connections(id) on delete cascade,
  product_id uuid references public.tiktok_shop_products(id) on delete set null,
  external_order_id text not null,
  external_order_line_id text,
  status public.shop_order_status not null default 'UNKNOWN',
  currency text,
  order_amount numeric(14,2),
  commission_amount numeric(14,2),
  ordered_at timestamptz,
  settled_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id, external_order_id, external_order_line_id)
);
create index tiktok_shop_orders_workspace_idx on public.tiktok_shop_orders(workspace_id, ordered_at desc);

create table public.tiktok_shop_sync_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.tiktok_shop_connections(id) on delete cascade,
  kind text not null check (kind in ('PRODUCTS', 'ORDERS')),
  status text not null check (status in ('RUNNING', 'SUCCEEDED', 'FAILED')),
  result jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.tiktok_shop_oauth_states (
  state text primary key,
  connection_id uuid not null references public.tiktok_shop_connections(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table public.tiktok_shop_oauth_states enable row level security;

create trigger set_updated_at before update on public.tiktok_shop_connections for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.tiktok_shop_products for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.tiktok_shop_orders for each row execute function private.set_updated_at();

-- Impede que uma publicação receba produto de outro workspace.
create or replace function public.validate_publication_shop_product()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.publication_jobs j join public.tiktok_shop_products p on p.id = new.product_id
    where j.id = new.publication_job_id and j.workspace_id = new.workspace_id and p.workspace_id = new.workspace_id
  ) then raise exception 'publication and product must belong to the same workspace'; end if;
  return new;
end; $$;
create trigger publication_shop_product_guard before insert or update on public.publication_shop_products
for each row execute function public.validate_publication_shop_product();

revoke all on public.tiktok_shop_connections, public.tiktok_shop_products, public.publication_shop_products,
  public.tiktok_shop_orders, public.tiktok_shop_sync_runs from anon, authenticated;
grant select on public.tiktok_shop_connections, public.tiktok_shop_products, public.publication_shop_products,
  public.tiktok_shop_orders, public.tiktok_shop_sync_runs to authenticated;
grant insert, update, delete on public.publication_shop_products to authenticated;

alter table public.tiktok_shop_connections enable row level security;
alter table public.tiktok_shop_products enable row level security;
alter table public.publication_shop_products enable row level security;
alter table public.tiktok_shop_orders enable row level security;
alter table public.tiktok_shop_sync_runs enable row level security;

create policy shop_connections_select on public.tiktok_shop_connections for select to authenticated using (private.is_member(workspace_id));
create policy shop_products_select on public.tiktok_shop_products for select to authenticated using (private.is_member(workspace_id));
create policy publication_shop_products_select on public.publication_shop_products for select to authenticated using (private.is_member(workspace_id));
create policy publication_shop_products_write on public.publication_shop_products for all to authenticated
  using (private.can_edit(workspace_id)) with check (private.can_edit(workspace_id));
create policy shop_orders_select on public.tiktok_shop_orders for select to authenticated using (private.is_member(workspace_id));
create policy shop_sync_runs_select on public.tiktok_shop_sync_runs for select to authenticated using (private.can_edit(workspace_id));

-- A Edge Function sempre confirma o papel do usuário via esta RPC antes de sincronizar.
create function public.assert_tiktok_shop_access(p_connection uuid, p_level text default 'edit')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from public.tiktok_shop_connections where id = p_connection;
  if v_ws is null then raise exception 'shop connection not found' using errcode = '42501'; end if;
  if p_level = 'admin' then
    if not private.can_admin(v_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  elsif not private.can_edit(v_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  return v_ws;
end; $$;
revoke execute on function public.assert_tiktok_shop_access(uuid, text) from public, anon;
grant execute on function public.assert_tiktok_shop_access(uuid, text) to authenticated;

create function public.create_tiktok_shop_connection(p_channel uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_id uuid;
begin
  v_ws := public.assert_channel_access(p_channel, 'edit');
  insert into public.tiktok_shop_connections(workspace_id, channel_id)
  values (v_ws, p_channel)
  on conflict (workspace_id, channel_id) do update set updated_at = now()
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.create_tiktok_shop_connection(uuid) from public, anon;
grant execute on function public.create_tiktok_shop_connection(uuid) to authenticated;

create function public.create_tiktok_shop_oauth_state(p_connection uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_state text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  v_ws := public.assert_tiktok_shop_access(p_connection, 'edit');
  delete from public.tiktok_shop_oauth_states where expires_at < now();
  insert into public.tiktok_shop_oauth_states(state, connection_id, workspace_id, user_id)
  values (v_state, p_connection, v_ws, (select auth.uid()));
  return v_state;
end; $$;
revoke execute on function public.create_tiktok_shop_oauth_state(uuid) from public, anon;
grant execute on function public.create_tiktok_shop_oauth_state(uuid) to authenticated;

create function public.consume_tiktok_shop_oauth_state(p_state text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.tiktok_shop_oauth_states;
begin
  delete from public.tiktok_shop_oauth_states where state = p_state returning * into v;
  if not found or v.expires_at < now() then return null; end if;
  return jsonb_build_object('connection_id', v.connection_id, 'workspace_id', v.workspace_id);
end; $$;
revoke execute on function public.consume_tiktok_shop_oauth_state(text) from public, anon, authenticated;
grant execute on function public.consume_tiktok_shop_oauth_state(text) to service_role;
