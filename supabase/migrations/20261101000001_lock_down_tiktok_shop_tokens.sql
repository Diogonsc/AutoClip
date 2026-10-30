-- TikTok Shop credentials are backend-only. Browser clients receive a safe
-- connection summary through the RPC below, never the token-bearing row.

revoke select on table public.tiktok_shop_connections from authenticated;
drop policy if exists shop_connections_select on public.tiktok_shop_connections;

create or replace function public.list_tiktok_shop_connections(p_workspace uuid)
returns table (
  id uuid,
  workspace_id uuid,
  channel_id uuid,
  creator_id text,
  shop_cipher text,
  shop_name text,
  connection_status public.shop_connection_status,
  granted_scopes text[],
  last_synced_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_workspace) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.workspace_id,
    c.channel_id,
    c.creator_id,
    c.shop_cipher,
    c.shop_name,
    c.connection_status,
    c.granted_scopes,
    c.last_synced_at,
    c.last_error_code,
    c.last_error_message,
    c.created_at
  from public.tiktok_shop_connections c
  where c.workspace_id = p_workspace
  order by c.created_at;
end;
$$;

revoke execute on function public.list_tiktok_shop_connections(uuid) from public, anon;
grant execute on function public.list_tiktok_shop_connections(uuid) to authenticated;
