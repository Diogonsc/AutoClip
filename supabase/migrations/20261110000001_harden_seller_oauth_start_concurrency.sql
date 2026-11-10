-- A check followed by INSERT is not mutually exclusive across transactions.
-- Serialize only Seller-start attempts for the same actor/workspace; the lock
-- is released automatically on COMMIT or ROLLBACK and does not affect tenants.
create or replace function public.create_seller_oauth_state(
  p_workspace uuid,
  p_state_hash text,
  p_connection uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_state_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid state hash' using errcode = '22023';
  end if;
  if not private.can_edit(p_workspace) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- The key is derived only from trusted DB values. This prevents two valid
  -- calls from both observing no PENDING state and inserting independently.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace::text || ':' || v_actor::text, 872341)
  );

  if p_connection is not null and not exists(
    select 1 from public.seller_connections c
    where c.id = p_connection and c.workspace_id = p_workspace
  ) then
    raise exception 'connection/workspace mismatch' using errcode = '42501';
  end if;
  if exists(
    select 1 from public.seller_oauth_states s
    where s.workspace_id = p_workspace
      and s.initiated_by = v_actor
      and s.status = 'PENDING'
      and s.expires_at > now()
  ) then
    raise exception 'seller authorization already pending' using errcode = '23505';
  end if;

  insert into public.seller_oauth_states(
    workspace_id, initiated_by, connection_id, state_hash, expires_at
  ) values (
    p_workspace, v_actor, p_connection, p_state_hash, now() + interval '10 minutes'
  ) returning id into v_id;
  insert into public.seller_audit_events(workspace_id, connection_id, event_type)
  values (p_workspace, p_connection, 'OAUTH_STARTED');
  return v_id;
end;
$$;

revoke execute on function public.create_seller_oauth_state(uuid, text, uuid) from public, anon;
grant execute on function public.create_seller_oauth_state(uuid, text, uuid) to authenticated;
