-- Organização persistente de contas e confirmação atômica de agendamentos em lote.
-- Esta migration é aditiva e deve ser aplicada primeiro apenas no Supabase local/homologação.

create table public.account_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text,
  color text not null default '#6366f1' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, name)
);
create index account_groups_workspace_idx on public.account_groups(workspace_id, name);

create table public.account_group_members (
  workspace_id uuid not null,
  group_id uuid not null,
  channel_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (group_id, channel_id),
  foreign key (group_id, workspace_id)
    references public.account_groups(id, workspace_id) on delete cascade,
  foreign key (channel_id, workspace_id)
    references public.channels(id, workspace_id) on delete cascade
);
create index account_group_members_workspace_channel_idx on public.account_group_members(workspace_id, channel_id);
create index account_group_members_workspace_group_channel_idx on public.account_group_members(workspace_id, group_id, channel_id);

create table public.publication_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  idempotency_key uuid not null,
  label text,
  strategy text not null default 'ALL_TO_ALL' check (strategy in ('ALL_TO_ALL', 'SEQUENTIAL', 'BALANCED', 'CSV')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, idempotency_key)
);
create index publication_batches_workspace_idx on public.publication_batches(workspace_id, created_at desc, id desc);

alter table public.publication_jobs add column if not exists batch_id uuid;
alter table public.publication_jobs
  add constraint publication_jobs_batch_workspace_fkey
  foreign key (batch_id, workspace_id)
  references public.publication_batches(id, workspace_id)
  on delete set null (batch_id);
create index publication_jobs_batch_idx on public.publication_jobs(batch_id, created_at desc) where batch_id is not null;

create trigger set_updated_at before update on public.account_groups
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.publication_batches
  for each row execute function private.set_updated_at();

alter table public.account_groups enable row level security;
alter table public.account_group_members enable row level security;
alter table public.publication_batches enable row level security;

grant select on public.account_groups, public.account_group_members, public.publication_batches to authenticated;
grant insert (workspace_id, name, description, color, created_by) on public.account_groups to authenticated;
grant update (name, description, color) on public.account_groups to authenticated;
grant delete on public.account_groups to authenticated;
grant insert (workspace_id, group_id, channel_id) on public.account_group_members to authenticated;
grant delete on public.account_group_members to authenticated;

create policy account_groups_select on public.account_groups for select to authenticated
  using (private.is_member(workspace_id));
create policy account_groups_insert on public.account_groups for insert to authenticated
  with check (private.can_edit(workspace_id) and created_by = (select auth.uid()));
create policy account_groups_update on public.account_groups for update to authenticated
  using (private.can_edit(workspace_id)) with check (private.can_edit(workspace_id));
create policy account_groups_delete on public.account_groups for delete to authenticated
  using (private.can_edit(workspace_id));
create policy account_group_members_select on public.account_group_members for select to authenticated
  using (private.is_member(workspace_id));
create policy account_group_members_insert on public.account_group_members for insert to authenticated
  with check (private.can_edit(workspace_id));
create policy account_group_members_delete on public.account_group_members for delete to authenticated
  using (private.can_edit(workspace_id));
create policy publication_batches_select on public.publication_batches for select to authenticated
  using (private.is_member(workspace_id));

-- Confirma todo o lote ou nada. O trigger existente de quota é a fonte de verdade;
-- uma quota insuficiente aborta a transação inteira e não deixa jobs parciais.
create or replace function public.confirm_publication_batch(
  p_workspace uuid,
  p_idempotency_key uuid,
  p_items jsonb,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.publication_batches;
  v_item jsonb;
  v_channel uuid;
  v_media uuid;
  v_scheduled timestamptz;
  v_timezone text;
  v_caption text;
  v_key text;
  v_count integer := 0;
begin
  if (select auth.uid()) is null or not private.can_edit(p_workspace) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_batch from public.publication_batches
   where workspace_id = p_workspace and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('batch_id', v_batch.id, 'created', false,
      'item_count', (select count(*) from public.publication_jobs where batch_id = v_batch.id));
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 500 then
    raise exception 'batch must contain between 1 and 500 items' using errcode = '22023';
  end if;

  -- A chave composta é deliberadamente estrita: mesma conta, mídia e instante no lote é duplicação.
  if exists (
    select 1 from (
      select (x->>'channel_id') || ':' || (x->>'media_asset_id') || ':' || (x->>'scheduled_at') as k
      from jsonb_array_elements(p_items) x
    ) d group by k having count(*) > 1
  ) then raise exception 'batch_duplicate_item' using errcode = '23505'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_channel := (v_item->>'channel_id')::uuid;
    v_media := (v_item->>'media_asset_id')::uuid;
    v_scheduled := (v_item->>'scheduled_at')::timestamptz;
    v_timezone := coalesce(nullif(v_item->>'timezone', ''), 'UTC');
    v_caption := coalesce(v_item->>'caption', '');
    if v_scheduled <= now() then raise exception 'batch_schedule_in_past' using errcode = '22023'; end if;
    if char_length(v_caption) > 2200 then raise exception 'batch_caption_too_long' using errcode = '22023'; end if;
    if not exists (select 1 from public.channels where id = v_channel and workspace_id = p_workspace and connection_status = 'CONNECTED') then
      raise exception 'batch_channel_unavailable' using errcode = '23514';
    end if;
    if not exists (select 1 from public.media_assets where id = v_media and workspace_id = p_workspace and status = 'READY') then
      raise exception 'batch_media_unavailable' using errcode = '23514';
    end if;
    if exists (select 1 from public.publication_jobs where workspace_id = p_workspace and channel_id = v_channel and media_asset_id = v_media and scheduled_at = v_scheduled and status not in ('CANCELLED', 'FAILED')) then
      raise exception 'batch_existing_duplicate' using errcode = '23505';
    end if;
    v_count := v_count + 1;
  end loop;

  insert into public.publication_batches(workspace_id, created_by, idempotency_key, label, strategy, metadata)
  values (p_workspace, auth.uid(), p_idempotency_key, nullif(p_metadata->>'label',''),
    coalesce(nullif(p_metadata->>'strategy',''), 'ALL_TO_ALL'), p_metadata)
  returning * into v_batch;

  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.publication_jobs(
      workspace_id, batch_id, channel_id, media_asset_id, caption, scheduled_at, timezone,
      status, created_by, music_rights_confirmed, privacy_level, allow_comment, allow_duet, allow_stitch,
      brand_content, brand_organic, idempotency_key
    ) values (
      p_workspace, v_batch.id, (v_item->>'channel_id')::uuid, (v_item->>'media_asset_id')::uuid,
      coalesce(v_item->>'caption',''), (v_item->>'scheduled_at')::timestamptz,
      coalesce(nullif(v_item->>'timezone',''), 'UTC'), 'SCHEDULED', auth.uid(),
      coalesce((v_item->>'music_rights_confirmed')::boolean, false),
      nullif(v_item->>'privacy_level',''), (v_item->>'allow_comment')::boolean,
      (v_item->>'allow_duet')::boolean, (v_item->>'allow_stitch')::boolean,
      coalesce((v_item->>'brand_content')::boolean, false), coalesce((v_item->>'brand_organic')::boolean, false), gen_random_uuid()
    );
  end loop;
  insert into public.audit_logs(workspace_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_workspace, auth.uid(), 'publication_batch.confirmed', 'publication_batch', v_batch.id,
    jsonb_build_object('item_count', v_count, 'strategy', v_batch.strategy));
  return jsonb_build_object('batch_id', v_batch.id, 'created', true, 'item_count', v_count);
end;
$$;
revoke all on function public.confirm_publication_batch(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.confirm_publication_batch(uuid, uuid, jsonb, jsonb) to authenticated, service_role;
