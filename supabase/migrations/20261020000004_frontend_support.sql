-- =====================================================================
-- Suporte ao front-end: finalização de upload, convite de membros,
-- exclusão de uploads incompletos e trilha de auditoria automática.
-- =====================================================================

-- ---------------------------------------------------------------------
-- finalize_media: após o upload no Storage, confirma que o objeto existe
-- e marca a mídia como READY (usuário comum não tem grant em "status").
-- ---------------------------------------------------------------------
create function public.finalize_media(
  p_media_id uuid,
  p_duration numeric default null,
  p_width    integer default null,
  p_height   integer default null
)
returns public.media_assets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.media_assets;
  v_obj   storage.objects;
  v_size  bigint;
begin
  select * into v_media from public.media_assets where id = p_media_id;
  if not found or not private.can_edit(v_media.workspace_id) then
    raise exception 'media not found' using errcode = '42501';
  end if;

  if v_media.status <> 'UPLOADING' then
    return v_media;
  end if;

  select * into v_obj
  from storage.objects o
  where o.bucket_id = 'media' and o.name = v_media.storage_key;

  if not found then
    update public.media_assets set status = 'FAILED'
     where id = p_media_id returning * into v_media;
    return v_media;
  end if;

  v_size := nullif(v_obj.metadata ->> 'size', '')::bigint;

  update public.media_assets
     set status           = 'READY',
         file_size_bytes  = coalesce(v_size, file_size_bytes),
         duration_seconds = case when p_duration > 0 then p_duration end,
         width            = case when p_width  > 0 then p_width  end,
         height           = case when p_height > 0 then p_height end
   where id = p_media_id
  returning * into v_media;

  return v_media;
end;
$$;
revoke execute on function public.finalize_media(uuid, numeric, integer, integer) from public, anon;
grant execute on function public.finalize_media(uuid, numeric, integer, integer) to authenticated;

-- ---------------------------------------------------------------------
-- Editor pode apagar os PRÓPRIOS uploads que não terminaram.
-- ---------------------------------------------------------------------
drop policy media_delete on public.media_assets;
create policy media_delete on public.media_assets
  for delete to authenticated
  using (
    private.can_admin(workspace_id)
    or (
      private.can_edit(workspace_id)
      and created_by = (select auth.uid())
      and status in ('UPLOADING', 'FAILED')
    )
  );

-- Limpeza do objeto órfão no Storage (mesma regra).
create policy media_objects_delete_own_orphan on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and private.can_edit(private.storage_workspace(name))
    and owner_id = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------
-- add_member_by_email: ADMIN/OWNER adiciona usuário já cadastrado.
-- ---------------------------------------------------------------------
create function public.add_member_by_email(
  p_workspace uuid,
  p_email     text,
  p_role      public.workspace_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not private.can_admin(p_workspace) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role = 'OWNER' and not private.is_owner(p_workspace) then
    raise exception 'only OWNER can add another OWNER' using errcode = '42501';
  end if;

  select u.id into v_user
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  limit 1;

  if v_user is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (p_workspace, v_user, p_role);
end;
$$;
revoke execute on function public.add_member_by_email(uuid, text, public.workspace_role) from public, anon;
grant execute on function public.add_member_by_email(uuid, text, public.workspace_role) to authenticated;

-- ---------------------------------------------------------------------
-- Auditoria automática (sem valores de colunas: só quais campos mudaram).
-- ---------------------------------------------------------------------
create function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_ws      uuid  := (v_row ->> 'workspace_id')::uuid;
  v_changed text[];
  v_meta    jsonb := '{}'::jsonb;
begin
  -- Em cascade de exclusão do workspace o registro pai já não existe.
  if v_ws is null or not exists (select 1 from public.workspaces w where w.id = v_ws) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
    from jsonb_object_keys(v_row) k
    where v_row -> k is distinct from to_jsonb(old) -> k
      and k <> 'updated_at';
    if v_changed is null then
      return new;
    end if;
    v_meta := jsonb_build_object('changed', to_jsonb(v_changed));
  end if;

  if tg_table_name = 'workspace_members' then
    v_meta := v_meta || jsonb_build_object('member_user_id', v_row ->> 'user_id');
  end if;

  insert into public.audit_logs (workspace_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_ws,
    (select auth.uid()),
    tg_op,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_meta
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger audit_channels
  after insert or update or delete on public.channels
  for each row execute function private.audit_row();
create trigger audit_media_assets
  after insert or update or delete on public.media_assets
  for each row execute function private.audit_row();
create trigger audit_publication_jobs
  after insert or update or delete on public.publication_jobs
  for each row execute function private.audit_row();
create trigger audit_workspace_members
  after insert or update or delete on public.workspace_members
  for each row execute function private.audit_row();
create trigger audit_workspace_settings
  after update on public.workspace_settings
  for each row execute function private.audit_row();
