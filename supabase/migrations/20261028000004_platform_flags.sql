-- Flags globais da plataforma (ex.: se o app já foi auditado pelo TikTok para posts públicos).
-- Leitura para qualquer usuário autenticado via RPC; escrita somente pela Edge Function admin-users.
create table public.platform_flags (
  key        text primary key check (key ~ '^[a-z0-9_]{1,64}$'),
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.platform_flags enable row level security;
revoke all on public.platform_flags from public, anon, authenticated;
grant select, insert, update, delete on public.platform_flags to service_role;

insert into public.platform_flags (key, value) values ('tiktok_audited', 'false'::jsonb);

create function public.get_platform_flags()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb) from public.platform_flags f;
$$;
revoke execute on function public.get_platform_flags() from public, anon;
grant execute on function public.get_platform_flags() to authenticated;
