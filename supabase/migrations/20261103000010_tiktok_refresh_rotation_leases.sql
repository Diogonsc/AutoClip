-- Login Kit refresh-token rotation. All network I/O remains outside SQL transactions.
-- An expired IN_FLIGHT attempt is ambiguous and is never retried with its old token.
alter table public.oauth_connections
  add column token_version bigint not null default 1,
  add column refresh_state text not null default 'READY'
    check (refresh_state in ('READY', 'IN_FLIGHT', 'REAUTH_REQUIRED')),
  add column refresh_attempt_id uuid,
  add column refresh_started_at timestamptz,
  add constraint oauth_connections_refresh_attempt_consistency check (
    (refresh_state = 'IN_FLIGHT' and refresh_attempt_id is not null and refresh_started_at is not null)
    or (refresh_state <> 'IN_FLIGHT' and refresh_attempt_id is null and refresh_started_at is null)
  );

alter table public.tiktok_shop_connections
  add column token_version bigint not null default 1,
  add column refresh_state text not null default 'READY'
    check (refresh_state in ('READY', 'IN_FLIGHT', 'REAUTH_REQUIRED')),
  add column refresh_attempt_id uuid,
  add column refresh_started_at timestamptz,
  add constraint tiktok_shop_refresh_attempt_consistency check (
    (refresh_state = 'IN_FLIGHT' and refresh_attempt_id is not null and refresh_started_at is not null)
    or (refresh_state <> 'IN_FLIGHT' and refresh_attempt_id is null and refresh_started_at is null)
  );

create or replace function public.save_tiktok_connection(
  p_channel uuid, p_open_id text, p_scopes text[], p_enc_access text, p_enc_refresh text,
  p_access_exp timestamptz, p_refresh_exp timestamptz
)
returns text language plpgsql security definer set search_path = '' as $$
declare v_ws uuid;
begin
  select c.workspace_id into v_ws from public.channels c where c.id = p_channel for update;
  if v_ws is null then raise exception 'channel not found'; end if;
  begin
    update public.channels set provider_user_id = p_open_id, connection_status = 'CONNECTED',
      granted_scopes = coalesce(p_scopes, '{}'), authorized_at = now(), last_validated_at = now(),
      last_error_code = null, last_error_message = null where id = p_channel;
  exception when unique_violation then return 'duplicate';
  end;
  insert into public.oauth_connections
    (workspace_id, channel_id, encrypted_access_token, encrypted_refresh_token,
     access_token_expires_at, refresh_token_expires_at, granted_scopes)
  values (v_ws, p_channel, p_enc_access, p_enc_refresh, p_access_exp, p_refresh_exp, coalesce(p_scopes, '{}'))
  on conflict (channel_id) do update set
    workspace_id = excluded.workspace_id,
    encrypted_access_token = excluded.encrypted_access_token,
    encrypted_refresh_token = excluded.encrypted_refresh_token,
    access_token_expires_at = excluded.access_token_expires_at,
    refresh_token_expires_at = excluded.refresh_token_expires_at,
    granted_scopes = excluded.granted_scopes,
    token_version = public.oauth_connections.token_version + 1,
    refresh_state = 'READY', refresh_attempt_id = null, refresh_started_at = null,
    updated_at = now();
  return 'ok';
end;
$$;

create or replace function public.acquire_tiktok_token_refresh(p_channel uuid, p_workspace uuid, p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_conn public.oauth_connections%rowtype; v_channel_status text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_channel is null or p_workspace is null or p_attempt is null then raise exception 'invalid refresh claim' using errcode = '22023'; end if;
  select c.connection_status::text into v_channel_status from public.channels c
    where c.id = p_channel and c.workspace_id = p_workspace for update;
  if not found then return jsonb_build_object('state', 'NOT_FOUND'); end if;
  select * into v_conn from public.oauth_connections
    where channel_id = p_channel and workspace_id = p_workspace for update;
  if not found then return jsonb_build_object('state', 'NOT_FOUND'); end if;
  if v_channel_status <> 'CONNECTED' then return jsonb_build_object('state', 'REAUTH_REQUIRED'); end if;
  if v_conn.refresh_state = 'REAUTH_REQUIRED' then return jsonb_build_object('state', 'REAUTH_REQUIRED'); end if;
  if v_conn.refresh_state = 'IN_FLIGHT' then
    if v_conn.refresh_started_at < clock_timestamp() - interval '90 seconds' then
      update public.oauth_connections set refresh_state = 'REAUTH_REQUIRED', refresh_attempt_id = null,
        refresh_started_at = null, updated_at = now()
        where channel_id = p_channel and workspace_id = p_workspace and token_version = v_conn.token_version;
      update public.channels set connection_status = 'REAUTH_REQUIRED', last_error_code = 'REFRESH_OUTCOME_UNKNOWN',
        last_error_message = 'A renovação anterior teve resultado indeterminado; reconecte o canal.'
        where id = p_channel and workspace_id = p_workspace;
      return jsonb_build_object('state', 'REAUTH_REQUIRED');
    end if;
    return jsonb_build_object('state', 'BUSY');
  end if;
  if v_conn.encrypted_refresh_token is null or v_conn.refresh_token_expires_at <= clock_timestamp() then
    update public.oauth_connections set refresh_state='REAUTH_REQUIRED', updated_at=now()
      where channel_id=p_channel and workspace_id=p_workspace and token_version=v_conn.token_version and refresh_state='READY';
    update public.channels set connection_status='REAUTH_REQUIRED',
      last_error_code=case when v_conn.encrypted_refresh_token is null then 'NO_REFRESH_TOKEN' else 'REFRESH_EXPIRED' end,
      last_error_message='A autorização precisa ser renovada pelo proprietário do canal.'
      where id=p_channel and workspace_id=p_workspace;
    return jsonb_build_object('state', 'REAUTH_REQUIRED');
  end if;
  if not exists (select 1 from public.channels c where c.id = p_channel and c.workspace_id = p_workspace and c.connection_status = 'CONNECTED') then
    return jsonb_build_object('state', 'REAUTH_REQUIRED');
  end if;
  update public.oauth_connections set refresh_state = 'IN_FLIGHT', refresh_attempt_id = p_attempt,
    refresh_started_at = clock_timestamp(), updated_at = now()
    where channel_id = p_channel and workspace_id = p_workspace and token_version = v_conn.token_version
      and refresh_state = 'READY';
  select * into v_conn from public.oauth_connections where channel_id = p_channel and workspace_id = p_workspace;
  return jsonb_build_object('state', 'ACQUIRED', 'token_version', v_conn.token_version,
    'connection', jsonb_build_object('channel_id', v_conn.channel_id, 'workspace_id', v_conn.workspace_id,
      'encrypted_access_token', v_conn.encrypted_access_token, 'encrypted_refresh_token', v_conn.encrypted_refresh_token,
      'access_token_expires_at', v_conn.access_token_expires_at, 'refresh_token_expires_at', v_conn.refresh_token_expires_at,
      'granted_scopes', v_conn.granted_scopes, 'refresh_state', v_conn.refresh_state, 'token_version', v_conn.token_version));
end;
$$;

create or replace function public.complete_tiktok_token_refresh(
  p_channel uuid, p_workspace uuid, p_attempt uuid, p_token_version bigint,
  p_enc_access text, p_enc_refresh text, p_access_exp timestamptz, p_refresh_exp timestamptz, p_scopes text[]
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_enc_access is null or p_enc_access = '' or p_enc_refresh is null or p_enc_refresh = ''
    or p_access_exp is null or p_refresh_exp is null or p_access_exp <= now() or p_refresh_exp <= now() then
    raise exception 'invalid token rotation payload' using errcode = '22023';
  end if;
  perform 1 from public.channels where id = p_channel and workspace_id = p_workspace for update;
  if not found then return false; end if;
  update public.oauth_connections set encrypted_access_token = p_enc_access, encrypted_refresh_token = p_enc_refresh,
    access_token_expires_at = p_access_exp, refresh_token_expires_at = p_refresh_exp,
    granted_scopes = coalesce(p_scopes, '{}'), token_version = token_version + 1,
    refresh_state = 'READY', refresh_attempt_id = null, refresh_started_at = null, updated_at = now()
    where channel_id = p_channel and workspace_id = p_workspace and token_version = p_token_version
      and refresh_state = 'IN_FLIGHT' and refresh_attempt_id = p_attempt;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then return false; end if;
  update public.channels set granted_scopes = coalesce(p_scopes, '{}'), connection_status = 'CONNECTED',
    last_error_code = null, last_error_message = null where id = p_channel and workspace_id = p_workspace;
  return true;
end;
$$;

create or replace function public.fail_tiktok_token_refresh(
  p_channel uuid, p_workspace uuid, p_attempt uuid, p_token_version bigint, p_error_code text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_rows integer; v_code text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_error_code is null or p_error_code not in ('REFRESH_OUTCOME_UNKNOWN', 'REFRESH_CONTEXT_MISMATCH', 'REFRESH_PERSISTENCE_UNKNOWN') then
    raise exception 'invalid refresh error code' using errcode = '22023';
  end if;
  perform 1 from public.channels where id = p_channel and workspace_id = p_workspace for update;
  if not found then return false; end if;
  update public.oauth_connections set refresh_state = 'REAUTH_REQUIRED', refresh_attempt_id = null,
    refresh_started_at = null, updated_at = now()
    where channel_id = p_channel and workspace_id = p_workspace and token_version = p_token_version
      and refresh_state = 'IN_FLIGHT' and refresh_attempt_id = p_attempt;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then return false; end if;
  v_code := p_error_code;
  update public.channels set connection_status = 'REAUTH_REQUIRED', last_error_code = v_code,
    last_error_message = 'A renovação teve resultado indeterminado; reconecte o canal.'
    where id = p_channel and workspace_id = p_workspace;
  return true;
end;
$$;

create or replace function public.acquire_tiktok_shop_token_refresh(p_connection uuid, p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_conn public.tiktok_shop_connections%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_connection is null or p_attempt is null then raise exception 'invalid refresh claim' using errcode = '22023'; end if;
  select * into v_conn from public.tiktok_shop_connections where id = p_connection for update;
  if not found then return jsonb_build_object('state', 'NOT_FOUND'); end if;
  if v_conn.connection_status <> 'CONNECTED' or v_conn.refresh_state = 'REAUTH_REQUIRED' then
    return jsonb_build_object('state', 'REAUTH_REQUIRED');
  end if;
  if v_conn.refresh_state = 'IN_FLIGHT' then
    if v_conn.refresh_started_at < clock_timestamp() - interval '90 seconds' then
      update public.tiktok_shop_connections set refresh_state = 'REAUTH_REQUIRED', refresh_attempt_id = null,
        refresh_started_at = null, connection_status = 'REAUTH_REQUIRED', last_error_code = 'REFRESH_OUTCOME_UNKNOWN',
        last_error_message = 'A renovação anterior teve resultado indeterminado; reconecte a loja.' where id = p_connection;
      return jsonb_build_object('state', 'REAUTH_REQUIRED');
    end if;
    return jsonb_build_object('state', 'BUSY');
  end if;
  if v_conn.encrypted_refresh_token is null or v_conn.refresh_token_expires_at <= clock_timestamp() then
    update public.tiktok_shop_connections set connection_status='REAUTH_REQUIRED', refresh_state='REAUTH_REQUIRED',
      last_error_code=case when v_conn.encrypted_refresh_token is null then 'NO_REFRESH_TOKEN' else 'REFRESH_EXPIRED' end,
      last_error_message='A autorização precisa ser renovada pelo proprietário da loja.'
      where id=p_connection;
    return jsonb_build_object('state', 'REAUTH_REQUIRED');
  end if;
  update public.tiktok_shop_connections set refresh_state = 'IN_FLIGHT', refresh_attempt_id = p_attempt,
    refresh_started_at = clock_timestamp(), updated_at = now() where id = p_connection and token_version = v_conn.token_version;
  select * into v_conn from public.tiktok_shop_connections where id = p_connection;
  return jsonb_build_object('state', 'ACQUIRED', 'token_version', v_conn.token_version,
    'connection', jsonb_build_object('id',v_conn.id,'workspace_id',v_conn.workspace_id,'channel_id',v_conn.channel_id,
      'encrypted_access_token',v_conn.encrypted_access_token,'encrypted_refresh_token',v_conn.encrypted_refresh_token,
      'access_token_expires_at',v_conn.access_token_expires_at,'refresh_token_expires_at',v_conn.refresh_token_expires_at,
      'granted_scopes',v_conn.granted_scopes,'token_version',v_conn.token_version,'refresh_state',v_conn.refresh_state));
end;
$$;

create or replace function public.complete_tiktok_shop_token_refresh(
  p_connection uuid, p_attempt uuid, p_token_version bigint, p_enc_access text, p_enc_refresh text,
  p_access_exp timestamptz, p_refresh_exp timestamptz
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_enc_access is null or p_enc_access = '' or p_enc_refresh is null or p_enc_refresh = ''
    or p_access_exp is null or p_refresh_exp is null or p_access_exp <= now() or p_refresh_exp <= now() then
    raise exception 'invalid token rotation payload' using errcode = '22023';
  end if;
  update public.tiktok_shop_connections set encrypted_access_token=p_enc_access, encrypted_refresh_token=p_enc_refresh,
    access_token_expires_at=p_access_exp, refresh_token_expires_at=p_refresh_exp, token_version=token_version+1,
    refresh_state='READY', refresh_attempt_id=null, refresh_started_at=null, last_error_code=null, last_error_message=null, updated_at=now()
    where id=p_connection and token_version=p_token_version and refresh_state='IN_FLIGHT' and refresh_attempt_id=p_attempt;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.fail_tiktok_shop_token_refresh(p_connection uuid, p_attempt uuid, p_token_version bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.tiktok_shop_connections set refresh_state='REAUTH_REQUIRED', refresh_attempt_id=null,
    refresh_started_at=null, connection_status='REAUTH_REQUIRED', last_error_code='REFRESH_OUTCOME_UNKNOWN',
    last_error_message='A renovação teve resultado indeterminado; reconecte a loja.', updated_at=now()
    where id=p_connection and token_version=p_token_version and refresh_state='IN_FLIGHT' and refresh_attempt_id=p_attempt;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.save_tiktok_shop_oauth_connection(
  p_connection uuid, p_creator_id text, p_enc_access text, p_enc_refresh text,
  p_access_exp timestamptz, p_refresh_exp timestamptz, p_scopes text[]
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_enc_access is null or p_enc_access = '' or p_enc_refresh is null or p_enc_refresh = ''
    or p_access_exp is null or p_refresh_exp is null or p_access_exp <= now() or p_refresh_exp <= now() then
    raise exception 'invalid OAuth credentials' using errcode = '22023';
  end if;
  update public.tiktok_shop_connections set creator_id=p_creator_id, encrypted_access_token=p_enc_access,
    encrypted_refresh_token=p_enc_refresh, access_token_expires_at=p_access_exp, refresh_token_expires_at=p_refresh_exp,
    granted_scopes=coalesce(p_scopes,'{}'), connection_status='CONNECTED', token_version=token_version+1,
    refresh_state='READY', refresh_attempt_id=null, refresh_started_at=null, last_error_code=null,
    last_error_message=null, updated_at=now() where id=p_connection;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke execute on function public.save_tiktok_connection(uuid,text,text[],text,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.save_tiktok_connection(uuid,text,text[],text,text,timestamptz,timestamptz) to service_role;
revoke execute on function public.acquire_tiktok_token_refresh(uuid,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.complete_tiktok_token_refresh(uuid,uuid,uuid,bigint,text,text,timestamptz,timestamptz,text[]) from public, anon, authenticated;
revoke execute on function public.fail_tiktok_token_refresh(uuid,uuid,uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.acquire_tiktok_token_refresh(uuid,uuid,uuid) to service_role;
grant execute on function public.complete_tiktok_token_refresh(uuid,uuid,uuid,bigint,text,text,timestamptz,timestamptz,text[]) to service_role;
grant execute on function public.fail_tiktok_token_refresh(uuid,uuid,uuid,bigint,text) to service_role;
revoke execute on function public.acquire_tiktok_shop_token_refresh(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.complete_tiktok_shop_token_refresh(uuid,uuid,bigint,text,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke execute on function public.fail_tiktok_shop_token_refresh(uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.acquire_tiktok_shop_token_refresh(uuid,uuid) to service_role;
grant execute on function public.complete_tiktok_shop_token_refresh(uuid,uuid,bigint,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.fail_tiktok_shop_token_refresh(uuid,uuid,bigint) to service_role;
revoke execute on function public.save_tiktok_shop_oauth_connection(uuid,text,text,text,timestamptz,timestamptz,text[]) from public, anon, authenticated;
grant execute on function public.save_tiktok_shop_oauth_connection(uuid,text,text,text,timestamptz,timestamptz,text[]) to service_role;
