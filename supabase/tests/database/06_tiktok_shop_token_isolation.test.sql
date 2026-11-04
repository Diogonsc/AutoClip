-- pgTAP: no lançamento inicial, nenhum cliente ou worker pode acessar tokens Shop.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select ok(not has_table_privilege('anon', 'public.tiktok_shop_connections', 'SELECT'),
  'anon não pode ler conexões Shop nem tokens');
select ok(not has_table_privilege('authenticated', 'public.tiktok_shop_connections', 'SELECT'),
  'usuário autenticado não pode ler conexões Shop nem tokens');
select ok(not has_table_privilege('service_role', 'public.tiktok_shop_connections', 'SELECT'),
  'cliente Edge não pode ler diretamente conexões Shop');
select ok(not has_function_privilege('authenticated', 'public.list_tiktok_shop_connections(uuid)', 'EXECUTE'),
  'usuário autenticado não pode invocar listagem de conexões Shop');
select ok(not has_function_privilege('service_role', 'public.acquire_tiktok_shop_token_refresh(uuid,uuid)', 'EXECUTE'),
  'worker não pode renovar tokens Shop');
select * from finish();
rollback;
