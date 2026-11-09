-- Local-only Seller OAuth completion. Do not apply remotely before callback review.
-- Connection metadata, encrypted credentials, state completion and audit are one transaction.
create function public.complete_seller_oauth_authorization(
  p_state uuid,
  p_connection uuid,
  p_open_id text,
  p_name text,
  p_region text,
  p_scopes text[],
  p_enc_access text,
  p_enc_refresh text,
  p_access_exp timestamptz,
  p_refresh_exp timestamptz,
  p_key_version smallint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.seller_oauth_states;
  v_existing_connection uuid;
begin
  if coalesce(btrim(p_open_id), '') = ''
     or coalesce(btrim(p_enc_access), '') = ''
     or coalesce(btrim(p_enc_refresh), '') = ''
     or p_access_exp is null
     or p_refresh_exp is null
     or p_refresh_exp < p_access_exp
     or p_key_version < 1 then
    raise exception 'invalid seller authorization payload' using errcode = '22023';
  end if;

  select * into v_state
  from public.seller_oauth_states
  where id = p_state and status = 'CLAIMED'
  for update;
  if not found then
    raise exception 'state not claimed' using errcode = '42501';
  end if;

  if v_state.connection_id is not null and v_state.connection_id <> p_connection then
    raise exception 'state/connection mismatch' using errcode = '42501';
  end if;

  select id into v_existing_connection
  from public.seller_connections
  where workspace_id = v_state.workspace_id and seller_open_id = p_open_id
  for update;

  if found and v_existing_connection <> p_connection then
    raise exception 'seller already connected; reconnect using its connection id' using errcode = '23505';
  end if;

  if found then
    update public.seller_connections
    set seller_name = nullif(btrim(p_name), ''),
        seller_region = nullif(btrim(p_region), ''),
        granted_scopes = coalesce(p_scopes, '{}'),
        status = 'CONNECTED',
        updated_at = now()
    where id = p_connection;
  else
    insert into public.seller_connections(
      id, workspace_id, seller_open_id, seller_name, seller_region, user_type, granted_scopes
    ) values (
      p_connection, v_state.workspace_id, p_open_id, nullif(btrim(p_name), ''),
      nullif(btrim(p_region), ''), 0, coalesce(p_scopes, '{}')
    );
  end if;

  insert into public.seller_credentials(
    connection_id, access_token_ciphertext, refresh_token_ciphertext,
    access_expires_at, refresh_expires_at, encryption_key_version
  ) values (
    p_connection, p_enc_access, p_enc_refresh, p_access_exp, p_refresh_exp, p_key_version
  ) on conflict (connection_id) do update
  set access_token_ciphertext = excluded.access_token_ciphertext,
      refresh_token_ciphertext = excluded.refresh_token_ciphertext,
      access_expires_at = excluded.access_expires_at,
      refresh_expires_at = excluded.refresh_expires_at,
      encryption_key_version = excluded.encryption_key_version,
      credential_version = public.seller_credentials.credential_version + 1,
      refresh_lease_owner = null,
      refresh_lease_expires_at = null,
      updated_at = now();

  update public.seller_oauth_states
  set status = 'COMPLETED', completed_at = now(), connection_id = p_connection
  where id = v_state.id;

  insert into public.seller_audit_events(workspace_id, connection_id, event_type)
  values (v_state.workspace_id, p_connection, 'OAUTH_COMPLETED');

  return p_connection;
end;
$$;

revoke execute on function public.complete_seller_oauth_authorization(
  uuid, uuid, text, text, text, text[], text, text, timestamptz, timestamptz, smallint
) from public, anon, authenticated;
grant execute on function public.complete_seller_oauth_authorization(
  uuid, uuid, text, text, text, text[], text, text, timestamptz, timestamptz, smallint
) to service_role;
