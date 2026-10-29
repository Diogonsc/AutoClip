-- Refina a exclusão de contas e o bloqueio de contas desativadas.
--
-- * delete_platform_user: workspaces próprios SEM outro OWNER são apagados (com todos os dados);
--   workspaces próprios COM outro OWNER são transferidos a ele (não ficam órfãos nem somem
--   para quem ainda os usa). Retorna os ids apagados para o chamador limpar o Storage.
-- * create_workspace: conta desativada não cria novos workspaces com um JWT ainda válido.

drop function if exists public.delete_platform_user(uuid);

create function public.delete_platform_user(p_user_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted   uuid[] := '{}';
  v_ws        uuid;
  v_new_owner uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.platform_owners where user_id = p_user_id)
     and (select count(*) from public.platform_owners) <= 1 then
    raise exception 'cannot delete the last platform owner' using errcode = '23514';
  end if;

  for v_ws in
    select w.id from public.workspaces w where w.owner_user_id = p_user_id for update
  loop
    select m.user_id into v_new_owner
    from public.workspace_members m
    where m.workspace_id = v_ws
      and m.role = 'OWNER'
      and m.user_id <> p_user_id
    order by m.created_at
    limit 1;

    if v_new_owner is null then
      delete from public.workspaces where id = v_ws;
      v_deleted := v_deleted || v_ws;
    else
      update public.workspaces set owner_user_id = v_new_owner where id = v_ws;
    end if;
  end loop;

  delete from auth.users where id = p_user_id;
  return v_deleted;
end;
$$;
revoke execute on function public.delete_platform_user(uuid) from public, anon, authenticated;
grant execute on function public.delete_platform_user(uuid) to service_role;

create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.is_account_active((select auth.uid())) then
    raise exception 'account disabled' using errcode = '42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception 'invalid workspace name' using errcode = '22023';
  end if;
  return private.bootstrap_workspace((select auth.uid()), btrim(p_name));
end;
$$;
