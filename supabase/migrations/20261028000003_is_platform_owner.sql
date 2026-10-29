-- Permite ao front saber (só para exibir o menu) se o usuário logado é owner da plataforma,
-- sem depender da Edge Function. A autorização real continua na Edge Function admin-users.
create function public.is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_owners o where o.user_id = (select auth.uid())
  ) and private.is_account_active((select auth.uid()));
$$;
revoke execute on function public.is_platform_owner() from public, anon;
grant execute on function public.is_platform_owner() to authenticated;
