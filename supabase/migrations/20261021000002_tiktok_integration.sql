-- =====================================================================
-- Integração TikTok: OAuth, worker de publicação e disparo por pg_cron.
-- Tudo que mexe em tokens ou em estado de execução é service_role-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Modo de publicação do workspace
--    INBOX  = envia o vídeo ao rascunho do criador (escopo video.upload)
--    DIRECT = Direct Post (escopo video.publish; exige app auditado
--             para publicar fora do modo privado)
-- ---------------------------------------------------------------------
alter table public.workspace_settings
  add column publish_mode text not null default 'INBOX'
  check (publish_mode in ('INBOX', 'DIRECT'));

grant update (publish_mode) on public.workspace_settings to authenticated;

create or replace function private.guard_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.auto_publish_enabled is distinct from old.auto_publish_enabled
      or new.publish_mode is distinct from old.publish_mode)
     and (select auth.uid()) is not null           -- service_role (auth.uid() nulo) é confiável
     and not private.is_owner(new.workspace_id) then
    raise exception 'only OWNER can change publishing settings' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Canais: escopos concedidos e opções do criador (não sensíveis)
-- ---------------------------------------------------------------------
alter table public.channels
  add column granted_scopes   text[] not null default '{}',
  add column creator_info     jsonb,
  add column creator_info_at  timestamptz;

-- ---------------------------------------------------------------------
-- 3. Publicações: opções de interação e divulgação comercial
--    NULL em allow_* = ainda não escolhido (bloqueia o Direct Post).
-- ---------------------------------------------------------------------
alter table public.publication_jobs
  add column allow_comment boolean,
  add column allow_duet    boolean,
  add column allow_stitch  boolean,
  add column brand_content boolean not null default false,
  add column brand_organic boolean not null default false,
  add constraint publication_jobs_caption_len check (char_length(caption) <= 2200);

grant insert (allow_comment, allow_duet, allow_stitch, brand_content, brand_organic)
  on public.publication_jobs to authenticated;
grant update (allow_comment, allow_duet, allow_stitch, brand_content, brand_organic)
  on public.publication_jobs to authenticated;

-- Ao reagendar manualmente um job bloqueado/em espera, zera o contador de tentativas.
create function private.reset_on_user_reschedule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and old.status in ('BLOCKED_APPROVAL', 'BLOCKED_PERMISSION', 'BLOCKED_REAUTH', 'RETRY_WAIT')
     and new.status = 'SCHEDULED' then
    new.attempt_count := 0;
    new.next_attempt_at := null;
    new.last_error_code := null;
    new.last_error_message := null;
  end if;
  return new;
end;
$$;

create trigger reset_on_user_reschedule
  before update on public.publication_jobs
  for each row execute function private.reset_on_user_reschedule();

-- ---------------------------------------------------------------------
-- 4. Estados de OAuth (anti-CSRF). Sem grants: só RPCs.
-- ---------------------------------------------------------------------
create table public.oauth_states (
  state           text primary key,
  workspace_id    uuid not null,
  channel_id      uuid not null,
  user_id         uuid not null references auth.users (id) on delete cascade,
  required_scopes text[] not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '10 minutes',
  foreign key (channel_id, workspace_id)
    references public.channels (id, workspace_id) on delete cascade
);
alter table public.oauth_states enable row level security;

-- Verifica permissão do usuário sobre um canal; devolve o workspace.
create function public.assert_channel_access(p_channel uuid, p_level text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select c.workspace_id into v_ws from public.channels c where c.id = p_channel;
  if v_ws is null then
    raise exception 'channel not found' using errcode = '42501';
  end if;
  if p_level = 'admin' then
    if not private.can_admin(v_ws) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  elsif not private.can_edit(v_ws) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_ws;
end;
$$;
revoke execute on function public.assert_channel_access(uuid, text) from public, anon;
grant execute on function public.assert_channel_access(uuid, text) to authenticated;

create function public.create_oauth_state(p_channel uuid, p_base_scopes text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws    uuid;
  v_mode  text;
  v_state text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_scopes text[];
begin
  v_ws := public.assert_channel_access(p_channel, 'edit');

  select s.publish_mode into v_mode
  from public.workspace_settings s where s.workspace_id = v_ws;
  v_mode := coalesce(v_mode, 'INBOX');

  v_scopes := coalesce(p_base_scopes, '{}')
    || case when v_mode = 'DIRECT' then array['video.upload', 'video.publish']
            else array['video.upload'] end;

  delete from public.oauth_states where expires_at < now();

  insert into public.oauth_states (state, workspace_id, channel_id, user_id, required_scopes)
  values (v_state, v_ws, p_channel, (select auth.uid()), v_scopes);

  return jsonb_build_object('state', v_state, 'scopes', to_jsonb(v_scopes), 'publish_mode', v_mode);
end;
$$;
revoke execute on function public.create_oauth_state(uuid, text[]) from public, anon;
grant execute on function public.create_oauth_state(uuid, text[]) to authenticated;

-- Consome (uso único) o state; devolve NULL se inexistente ou expirado.
create function public.consume_oauth_state(p_state text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.oauth_states;
begin
  delete from public.oauth_states where state = p_state returning * into v;
  if not found or v.expires_at < now() then
    return null;
  end if;
  return jsonb_build_object(
    'workspace_id', v.workspace_id,
    'channel_id', v.channel_id,
    'user_id', v.user_id,
    'required_scopes', to_jsonb(v.required_scopes)
  );
end;
$$;
revoke execute on function public.consume_oauth_state(text) from public, anon, authenticated;
grant execute on function public.consume_oauth_state(text) to service_role;

-- Grava a conexão OAuth e marca o canal como CONECTADO, atomicamente.
create function public.save_tiktok_connection(
  p_channel     uuid,
  p_open_id     text,
  p_scopes      text[],
  p_enc_access  text,
  p_enc_refresh text,
  p_access_exp  timestamptz,
  p_refresh_exp timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select c.workspace_id into v_ws from public.channels c where c.id = p_channel for update;
  if v_ws is null then
    raise exception 'channel not found';
  end if;

  begin
    update public.channels
       set provider_user_id   = p_open_id,
           connection_status  = 'CONNECTED',
           granted_scopes     = coalesce(p_scopes, '{}'),
           authorized_at      = now(),
           last_validated_at  = now(),
           last_error_code    = null,
           last_error_message = null
     where id = p_channel;
  exception when unique_violation then
    return 'duplicate';
  end;

  insert into public.oauth_connections
    (workspace_id, channel_id, encrypted_access_token, encrypted_refresh_token,
     access_token_expires_at, refresh_token_expires_at, granted_scopes)
  values
    (v_ws, p_channel, p_enc_access, p_enc_refresh, p_access_exp, p_refresh_exp, coalesce(p_scopes, '{}'))
  on conflict (channel_id) do update
    set encrypted_access_token   = excluded.encrypted_access_token,
        encrypted_refresh_token  = excluded.encrypted_refresh_token,
        access_token_expires_at  = excluded.access_token_expires_at,
        refresh_token_expires_at = excluded.refresh_token_expires_at,
        granted_scopes           = excluded.granted_scopes;

  return 'ok';
end;
$$;
revoke execute on function public.save_tiktok_connection(uuid, text, text[], text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.save_tiktok_connection(uuid, text, text[], text, text, timestamptz, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------
-- 5. Lease: garante UMA execução do worker por vez (evita refresh de
--    token concorrente, que quebraria a rotação do refresh_token).
-- ---------------------------------------------------------------------
create table public.worker_leases (
  name       text primary key,
  holder     uuid not null,
  expires_at timestamptz not null
);
alter table public.worker_leases enable row level security;

create function public.acquire_worker_lease(p_name text, p_holder uuid, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  insert into public.worker_leases (name, holder, expires_at)
  values (p_name, p_holder, now() + make_interval(secs => p_ttl_seconds))
  on conflict (name) do update
    set holder = excluded.holder, expires_at = excluded.expires_at
    where public.worker_leases.expires_at < now()
       or public.worker_leases.holder = excluded.holder;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create function public.release_worker_lease(p_name text, p_holder uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.worker_leases where name = p_name and holder = p_holder;
$$;

revoke execute on function public.acquire_worker_lease(text, uuid, integer) from public, anon, authenticated;
revoke execute on function public.release_worker_lease(text, uuid) from public, anon, authenticated;
grant execute on function public.acquire_worker_lease(text, uuid, integer) to service_role;
grant execute on function public.release_worker_lease(text, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 6. Fila
-- ---------------------------------------------------------------------

-- Claim de novos envios. attempt_number vem do histórico (não do contador),
-- pois o contador é zerado ao reagendar e o número da tentativa não se repete.
create or replace function public.claim_publication_jobs(p_limit integer, p_worker text)
returns setof public.publication_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select j.id
    from public.publication_jobs j
    join public.workspace_settings s
      on s.workspace_id = j.workspace_id and s.auto_publish_enabled
    where j.status in ('SCHEDULED', 'RETRY_WAIT')
      and j.scheduled_at <= now()
      and coalesce(j.next_attempt_at, now()) <= now()
    order by j.scheduled_at
    limit greatest(p_limit, 0)
    for update of j skip locked
  ),
  upd as (
    update public.publication_jobs j
       set status = 'PROCESSING',
           locked_at = now(),
           locked_by = p_worker,
           next_attempt_at = null,
           attempt_count = j.attempt_count + 1
      from picked
     where j.id = picked.id
    returning j.*
  ),
  att as (
    insert into public.publication_attempts (workspace_id, publication_job_id, attempt_number)
    select u.workspace_id, u.id,
           coalesce((select max(a.attempt_number) from public.publication_attempts a
                      where a.publication_job_id = u.id), 0) + 1
    from upd u
  )
  select * from upd;
end;
$$;

-- Claim de jobs já enviados ao TikTok que aguardam conferência de status.
-- Roda mesmo com a publicação automática desligada (só reconcilia).
create function public.claim_polling_jobs(p_limit integer, p_worker text)
returns setof public.publication_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select j.id
    from public.publication_jobs j
    where j.status = 'PROCESSING'
      and j.remote_publish_id is not null
      and j.locked_at is null
      and coalesce(j.next_attempt_at, now()) <= now()
    order by j.next_attempt_at nulls first
    limit greatest(p_limit, 0)
    for update of j skip locked
  ),
  upd as (
    update public.publication_jobs j
       set locked_at = now(), locked_by = p_worker
      from picked
     where j.id = picked.id
    returning j.*
  )
  select * from upd;
end;
$$;

create function public.add_job_event(p_job uuid, p_type text, p_payload jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.publication_events (workspace_id, publication_job_id, event_type, event_payload)
  select j.workspace_id, j.id, p_type, coalesce(p_payload, '{}'::jsonb)
  from public.publication_jobs j where j.id = p_job;
$$;

-- Persiste o publish_id ANTES do upload: é o que permite reconciliar depois.
create function public.record_remote_id(p_job uuid, p_remote_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.publication_jobs set remote_publish_id = p_remote_id where id = p_job;
  perform public.add_job_event(p_job, 'REMOTE_ID_RECORDED', jsonb_build_object('publish_id', p_remote_id));
end;
$$;

-- Encerra (ou reagenda) um processamento: job, tentativa, evento e notificação
-- na mesma transação.
create function public.finish_job(
  p_job             uuid,
  p_status          public.publication_status,
  p_error_code      text default null,
  p_error_message   text default null,
  p_remote_id       text default null,
  p_clear_remote    boolean default false,
  p_next_attempt_at timestamptz default null,
  p_result          text default null,
  p_remote_status   text default null,
  p_refund          boolean default false,
  p_event_type      text default null,
  p_event_payload   jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job     public.publication_jobs;
  v_attempt integer;
  v_title   text;
  v_users   uuid[];
begin
  select * into v_job from public.publication_jobs where id = p_job for update;
  if not found then
    raise exception 'job not found';
  end if;

  select max(a.attempt_number) into v_attempt
  from public.publication_attempts a where a.publication_job_id = p_job;

  if p_refund then
    delete from public.publication_attempts
     where publication_job_id = p_job and attempt_number = v_attempt;
  elsif v_attempt is not null then
    update public.publication_attempts
       set finished_at   = coalesce(finished_at, now()),
           result        = coalesce(p_result, result),
           error_code    = p_error_code,
           error_message = left(p_error_message, 500),
           remote_status = coalesce(p_remote_status, remote_status)
     where publication_job_id = p_job and attempt_number = v_attempt;
  end if;

  update public.publication_jobs
     set status             = p_status,
         last_error_code    = p_error_code,
         last_error_message = left(p_error_message, 500),
         remote_publish_id  = case when p_clear_remote then null
                                   else coalesce(p_remote_id, remote_publish_id) end,
         next_attempt_at    = p_next_attempt_at,
         locked_at          = null,
         locked_by          = null,
         attempt_count      = case when p_refund then greatest(attempt_count - 1, 0)
                                   else attempt_count end
   where id = p_job;

  if p_event_type is not null then
    perform public.add_job_event(p_job, p_event_type, p_event_payload);
  end if;

  v_title := case p_status::text
    when 'PUBLISHED'          then 'Vídeo publicado no TikTok'
    when 'SENT_TO_INBOX'      then 'Vídeo enviado ao TikTok: conclua a publicação no app'
    when 'FAILED'             then 'Falha ao publicar'
    when 'BLOCKED_APPROVAL'   then 'Publicação bloqueada: aprovação do app TikTok'
    when 'BLOCKED_PERMISSION' then 'Publicação bloqueada: permissão ou opções'
    when 'BLOCKED_REAUTH'     then 'Publicação bloqueada: reconecte o canal'
    when 'UNKNOWN'            then 'Resultado desconhecido: confira no TikTok'
    else null
  end;

  if v_title is not null then
    select array_agg(distinct u) into v_users
    from unnest(array[
      v_job.created_by,
      (select w.owner_user_id from public.workspaces w where w.id = v_job.workspace_id)
    ]) as u
    where u is not null;

    insert into public.notifications (workspace_id, user_id, type, title, body)
    select v_job.workspace_id, u, 'JOB_' || p_status::text, v_title, left(p_error_message, 300)
    from unnest(coalesce(v_users, '{}')) as u;
  end if;
end;
$$;

revoke execute on function public.claim_publication_jobs(integer, text) from public, anon, authenticated;
revoke execute on function public.claim_polling_jobs(integer, text) from public, anon, authenticated;
revoke execute on function public.add_job_event(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.record_remote_id(uuid, text) from public, anon, authenticated;
revoke execute on function public.finish_job(uuid, public.publication_status, text, text, text, boolean,
                                             timestamptz, text, text, boolean, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_publication_jobs(integer, text) to service_role;
grant execute on function public.claim_polling_jobs(integer, text) to service_role;
grant execute on function public.add_job_event(uuid, text, jsonb) to service_role;
grant execute on function public.record_remote_id(uuid, text) to service_role;
grant execute on function public.finish_job(uuid, public.publication_status, text, text, text, boolean,
                                            timestamptz, text, text, boolean, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------------
-- 7. Recuperação de jobs presos em PROCESSING
--    - com publish_id: libera para conferência de status (reconcilia);
--    - sem publish_id: o resultado do envio é desconhecido => UNKNOWN
--      (nunca reenvia sozinho).
-- ---------------------------------------------------------------------
create or replace function private.recover_stale_jobs(p_stale interval default interval '15 minutes')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unknown integer;
  v_released integer;
begin
  with released as (
    update public.publication_jobs j
       set locked_at = null,
           locked_by = null,
           next_attempt_at = now()
     where j.status = 'PROCESSING'
       and j.locked_at < now() - p_stale
       and j.remote_publish_id is not null
    returning j.id
  )
  select count(*) into v_released from released;

  with stale as (
    update public.publication_jobs j
       set status = 'UNKNOWN',
           locked_at = null,
           locked_by = null,
           last_error_code = 'STALE_LOCK',
           last_error_message = 'Processamento interrompido; reconciliar estado remoto antes de reenviar.'
     where j.status = 'PROCESSING'
       and j.locked_at < now() - p_stale
       and j.remote_publish_id is null
    returning j.id
  ),
  closed as (
    update public.publication_attempts a
       set finished_at = now(), result = 'UNKNOWN', error_code = 'STALE_LOCK'
      from stale s
     where a.publication_job_id = s.id
       and a.finished_at is null
  )
  select count(*) into v_unknown from stale;

  return v_unknown + v_released;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Resolução manual de um job UNKNOWN (o usuário conferiu no TikTok)
-- ---------------------------------------------------------------------
create function public.resolve_unknown_job(p_job uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.publication_jobs;
begin
  select * into v from public.publication_jobs where id = p_job for update;
  if not found or not private.can_edit(v.workspace_id) then
    raise exception 'job not found' using errcode = '42501';
  end if;
  if v.status <> 'UNKNOWN' then
    raise exception 'job is not UNKNOWN' using errcode = '22023';
  end if;

  if p_outcome = 'PUBLISHED' then
    update public.publication_jobs
       set status = 'PUBLISHED', last_error_code = null, last_error_message = null
     where id = p_job;
  elsif p_outcome = 'NOT_PUBLISHED' then
    update public.publication_jobs
       set status = 'SCHEDULED',
           scheduled_at = now(),
           remote_publish_id = null,
           attempt_count = 0,
           next_attempt_at = null,
           last_error_code = null,
           last_error_message = null
     where id = p_job;
  else
    raise exception 'invalid outcome' using errcode = '22023';
  end if;

  perform public.add_job_event(
    p_job, 'MANUAL_RESOLUTION',
    jsonb_build_object('outcome', p_outcome, 'actor', (select auth.uid()))
  );
end;
$$;
revoke execute on function public.resolve_unknown_job(uuid, text) from public, anon;
grant execute on function public.resolve_unknown_job(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Disparo do worker: pg_cron -> pg_net -> Edge Function.
--    URL e segredo ficam no Vault (ver README). Sem eles, não faz nada.
-- ---------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

create function private.invoke_publication_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'worker_secret';

  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/publication-worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;
revoke execute on function private.invoke_publication_worker() from public, anon, authenticated;

select cron.schedule(
  'invoke-publication-worker',
  '* * * * *',
  $$select private.invoke_publication_worker()$$
);
