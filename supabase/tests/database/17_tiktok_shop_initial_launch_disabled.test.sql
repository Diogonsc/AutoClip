-- pgTAP: Shop tables/RPCs are closed and queue claims preserve Shop jobs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select ok(not has_table_privilege('anon', 'public.tiktok_shop_connections', 'SELECT'), 'anon cannot read Shop connections');
select ok(not has_table_privilege('authenticated', 'public.tiktok_shop_connections', 'SELECT'), 'authenticated cannot read Shop connections');
select ok(not has_table_privilege('service_role', 'public.tiktok_shop_connections', 'SELECT'), 'service_role client cannot read Shop connections directly');
select ok(not has_table_privilege('authenticated', 'public.tiktok_shop_products', 'SELECT'), 'authenticated cannot read Shop products');
select ok(not has_table_privilege('authenticated', 'public.tiktok_shop_orders', 'SELECT'), 'authenticated cannot read Shop orders');
select ok(not has_function_privilege('authenticated', 'public.create_tiktok_shop_connection(uuid)', 'EXECUTE'), 'authenticated cannot create Shop connection');
select ok(not has_function_privilege('authenticated', 'public.create_tiktok_shop_oauth_state(uuid)', 'EXECUTE'), 'authenticated cannot start Shop OAuth');
select ok(not has_function_privilege('authenticated', 'public.list_tiktok_shop_connections(uuid)', 'EXECUTE'), 'authenticated cannot list Shop connections');
select ok(not has_function_privilege('service_role', 'public.consume_tiktok_shop_oauth_state(text)', 'EXECUTE'), 'Shop callback cannot consume OAuth state');
select ok(not has_function_privilege('service_role', 'public.acquire_tiktok_shop_token_refresh(uuid,uuid)', 'EXECUTE'), 'Shop token refresh RPC is unavailable');
select ok(not has_function_privilege('service_role', 'public.save_tiktok_shop_oauth_connection(uuid,text,text,text,timestamptz,timestamptz,text[])', 'EXECUTE'), 'Shop token persistence RPC is unavailable');

select ok(pg_get_functiondef('public.claim_publication_jobs(integer,text)'::regprocedure) ~* 'shop_product_id is null', 'publication claim excludes Shop jobs');
select ok(pg_get_functiondef('public.claim_polling_jobs(integer,text)'::regprocedure) ~* 'shop_product_id is null', 'polling claim excludes Shop jobs');
select ok(pg_get_functiondef('public.validate_shoppable_publication()'::regprocedure) ~ 'TIKTOK_SHOP_DISABLED', 'publication trigger fails closed for Shop metadata');
select ok(pg_get_functiondef('public.validate_publication_shop_product()'::regprocedure) ~ 'TIKTOK_SHOP_DISABLED', 'Shop association trigger fails closed');

select * from finish();
rollback;
