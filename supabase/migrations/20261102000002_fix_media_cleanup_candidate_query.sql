-- Evita colisão entre o nome da coluna retornada por PL/pgSQL e a coluna do CTE.
create or replace function public.claim_media_cleanup_candidates(p_limit integer, p_lock uuid)
returns table (media_asset_id uuid, workspace_id uuid, storage_key text, file_size_bytes bigint, dry_run boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with eligible as materialized (
    select m.id, m.workspace_id, m.created_at, s.auto_delete_media_batch_size
    from public.media_assets m
    join public.workspace_settings s on s.workspace_id = m.workspace_id
    where s.auto_delete_media_enabled
      and m.status = 'READY'
      and (m.cleanup_locked_at is null or m.cleanup_locked_at < now() - interval '15 minutes')
      and exists (
        select 1 from public.publication_jobs published
        where (published.media_asset_id = m.id or m.id = any(coalesce(published.media_asset_ids, '{}'::uuid[])))
          and published.status = 'PUBLISHED'
          and published.updated_at <= now() - make_interval(hours => s.auto_delete_media_grace_hours)
      )
      and not exists (
        select 1 from public.publication_jobs active
        where (active.media_asset_id = m.id or m.id = any(coalesce(active.media_asset_ids, '{}'::uuid[])))
          and active.status in ('DRAFT', 'SCHEDULED', 'READY', 'PROCESSING', 'RETRY_WAIT', 'BLOCKED_APPROVAL', 'BLOCKED_PERMISSION', 'BLOCKED_REAUTH', 'UNKNOWN')
      )
  ), ranked as (
    select e.id,
           row_number() over (partition by e.workspace_id order by e.created_at) as workspace_position,
           e.auto_delete_media_batch_size
    from eligible e
  ), candidates as (
    select m.id
    from public.media_assets m
    join ranked r on r.id = m.id
    where r.workspace_position <= r.auto_delete_media_batch_size
    order by m.created_at
    limit least(greatest(p_limit, 1), 50)
    for update of m skip locked
  ), locked as (
    update public.media_assets m
       set cleanup_lock_token = p_lock, cleanup_locked_at = now(), cleanup_attempts = cleanup_attempts + 1, cleanup_last_error = null
      from candidates c where m.id = c.id
      returning m.id, m.workspace_id, m.storage_key, m.file_size_bytes
  )
  select l.id, l.workspace_id, l.storage_key, l.file_size_bytes, s.auto_delete_media_dry_run
  from locked l join public.workspace_settings s on s.workspace_id = l.workspace_id;
end;
$$;
