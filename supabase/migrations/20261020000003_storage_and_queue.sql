-- =====================================================================
-- Storage (bucket privado de vídeos) + fila de publicação no Postgres
-- =====================================================================

-- ---------------------------------------------------------------------
-- Bucket 'media' (privado). Limite do plano Free: 50 MB por arquivo.
-- Caminho: <workspace_id>/<media_id>/original.<ext>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 52428800,
        array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Extrai o workspace da primeira pasta do caminho (NULL se não for UUID válido).
create function private.storage_workspace(p_name text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[1]
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(p_name))[1])::uuid
  end;
$$;
grant execute on function private.storage_workspace(text) to authenticated, service_role;

create policy media_objects_select on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and private.is_member(private.storage_workspace(name)));

create policy media_objects_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and private.can_edit(private.storage_workspace(name)));

create policy media_objects_update on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and private.can_edit(private.storage_workspace(name)))
  with check (bucket_id = 'media' and private.can_edit(private.storage_workspace(name)));

create policy media_objects_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and private.can_admin(private.storage_workspace(name)));

-- ---------------------------------------------------------------------
-- Validação ao agendar: mídia pronta e data não passada
-- ---------------------------------------------------------------------
create function private.validate_job_scheduling()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('SCHEDULED', 'READY')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if not exists (
      select 1 from public.media_assets m
      where m.id = new.media_asset_id
        and m.workspace_id = new.workspace_id
        and m.status = 'READY'
    ) then
      raise exception 'media asset is not READY' using errcode = '23514';
    end if;
    if new.scheduled_at < now() - interval '1 minute' then
      raise exception 'scheduled_at is in the past' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_job_scheduling
  before insert or update of status on public.publication_jobs
  for each row execute function private.validate_job_scheduling();

-- ---------------------------------------------------------------------
-- Histórico: toda mudança de status gera um evento
-- ---------------------------------------------------------------------
create function private.log_job_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.publication_events (workspace_id, publication_job_id, event_type, event_payload)
  values (
    new.workspace_id, new.id, 'STATUS_CHANGED',
    jsonb_build_object('from', case when tg_op = 'UPDATE' then old.status::text end,
                       'to', new.status::text,
                       'actor', (select auth.uid()))
  );
  return new;
end;
$$;

create trigger log_job_status_insert
  after insert on public.publication_jobs
  for each row execute function private.log_job_status();

create trigger log_job_status_update
  after update of status on public.publication_jobs
  for each row when (old.status is distinct from new.status)
  execute function private.log_job_status();

-- ---------------------------------------------------------------------
-- Fila: claim transacional (FOR UPDATE SKIP LOCKED)
-- Só pega jobs de workspaces com auto_publish_enabled = true (trava spec 2.6).
-- Chamada pela Edge Function com service_role.
-- ---------------------------------------------------------------------
create function public.claim_publication_jobs(p_limit integer, p_worker text)
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
           attempt_count = j.attempt_count + 1
      from picked
     where j.id = picked.id
    returning j.*
  ),
  att as (
    insert into public.publication_attempts (workspace_id, publication_job_id, attempt_number)
    select u.workspace_id, u.id, u.attempt_count from upd u
  )
  select * from upd;
end;
$$;

revoke execute on function public.claim_publication_jobs(integer, text) from public, anon, authenticated;
grant execute on function public.claim_publication_jobs(integer, text) to service_role;

-- ---------------------------------------------------------------------
-- Recuperação: job preso em PROCESSING vira UNKNOWN (NUNCA reenvia sozinho,
-- para não duplicar publicação — spec 2.7 / 7). Exige reconciliação.
-- ---------------------------------------------------------------------
create function private.recover_stale_jobs(p_stale interval default interval '15 minutes')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with stale as (
    update public.publication_jobs j
       set status = 'UNKNOWN',
           locked_at = null,
           last_error_code = 'STALE_LOCK',
           last_error_message = 'Processamento interrompido; reconciliar estado remoto antes de reenviar.'
     where j.status = 'PROCESSING'
       and j.locked_at < now() - p_stale
    returning j.id, j.attempt_count
  ),
  closed as (
    update public.publication_attempts a
       set finished_at = now(), result = 'UNKNOWN', error_code = 'STALE_LOCK'
      from stale s
     where a.publication_job_id = s.id
       and a.attempt_number = s.attempt_count
       and a.finished_at is null
  )
  select count(*) into v_count from stale;
  return v_count;
end;
$$;
revoke execute on function private.recover_stale_jobs(interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- pg_cron: recuperação a cada minuto.
-- O disparo do worker (pg_cron -> pg_net -> Edge Function) é criado na migration
-- 20261021000002, com URL/segredo guardados no Vault.
-- ---------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'recover-stale-publication-jobs',
  '* * * * *',
  $$select private.recover_stale_jobs()$$
);
