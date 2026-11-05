begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users(id, instance_id, aud, role, email) values
 ('31910000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','oauth-rotation@test.invalid');
create temp table oauth_ctx(channel_id uuid, workspace_id uuid);
insert into oauth_ctx
select '31910000-0000-0000-0000-000000000011', id from public.workspaces
where owner_user_id='31910000-0000-0000-0000-000000000001';
grant select on oauth_ctx to authenticated, service_role;
insert into public.channels(id, workspace_id, display_name, provider_user_id, connection_status)
select channel_id, workspace_id, 'synthetic OAuth rotation fixture', 'oauth-rotation-user', 'CONNECTED'::public.channel_status from oauth_ctx;
insert into public.oauth_connections(workspace_id, channel_id, encrypted_access_token, encrypted_refresh_token,
 access_token_expires_at, refresh_token_expires_at, granted_scopes)
select workspace_id, channel_id, 'cipher-access-v1', 'cipher-refresh-v1', now()-interval '1 second',
 now()+interval '30 days', array['user.info.basic'] from oauth_ctx;
insert into public.channels(id, workspace_id, display_name, provider_user_id, connection_status)
select '31910000-0000-0000-0000-000000000041', workspace_id, 'legacy OAuth expiry fixture', 'legacy-oauth-user', 'CONNECTED'::public.channel_status from oauth_ctx;
insert into public.oauth_connections(workspace_id, channel_id, encrypted_access_token, encrypted_refresh_token,
 access_token_expires_at, refresh_token_expires_at, granted_scopes)
select workspace_id, '31910000-0000-0000-0000-000000000041', 'legacy-cipher-access', 'legacy-cipher-refresh',
 now()-interval '1 second', null, array['user.info.basic'] from oauth_ctx;

select ok(not has_function_privilege('authenticated','public.acquire_tiktok_token_refresh(uuid,uuid,uuid)','EXECUTE'), 'authenticated cannot acquire refresh lease');
select ok(not has_function_privilege('authenticated','public.complete_tiktok_token_refresh(uuid,uuid,uuid,bigint,text,text,timestamptz,timestamptz,text[])','EXECUTE'), 'authenticated cannot persist rotated credentials');
select ok(not has_table_privilege('service_role','public.oauth_connections','INSERT'), 'service_role cannot insert token rows directly');
select ok(not has_table_privilege('service_role','public.oauth_connections','UPDATE'), 'service_role cannot update token or lease fields directly');
select ok(not has_table_privilege('service_role','public.oauth_connections','TRUNCATE'), 'service_role cannot truncate token rows directly');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select ok(not (select rolsuper from pg_roles where rolname=current_user), 'refresh RPC runs under non-superuser service_role');
select throws_ok($sql$insert into public.oauth_connections(workspace_id,channel_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at,granted_scopes) select workspace_id,channel_id,'cipher-direct-insert','cipher-direct-refresh',now()+interval '1 hour',now()+interval '1 day',array[]::text[] from oauth_ctx$sql$, '42501', null, 'service_role cannot insert token rows directly');
select throws_ok($sql$insert into public.oauth_connections(workspace_id,channel_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at,granted_scopes) select workspace_id,channel_id,'cipher-direct-upsert','cipher-direct-upsert-refresh',now()+interval '1 hour',now()+interval '1 day',array[]::text[] from oauth_ctx on conflict (channel_id) do update set encrypted_refresh_token=excluded.encrypted_refresh_token$sql$, '42501', null, 'service_role cannot use UPSERT to replace token rows');
select throws_ok(format('update public.oauth_connections set encrypted_access_token=%L, encrypted_refresh_token=%L where channel_id=%L',
 'cipher-stale-direct-access','cipher-stale-direct-refresh',(select channel_id from oauth_ctx)),
 '42501', null, 'service_role cannot bypass refresh CAS with a direct UPDATE');
select is(public.acquire_tiktok_token_refresh((select channel_id from oauth_ctx),(select workspace_id from oauth_ctx),'31910000-0000-0000-0000-000000000021')->>'state','ACQUIRED','first process acquires durable refresh state');
select is(public.acquire_tiktok_token_refresh((select channel_id from oauth_ctx),(select workspace_id from oauth_ctx),'31910000-0000-0000-0000-000000000022')->>'state','BUSY','concurrent process cannot reuse the old refresh token');
select is(public.complete_tiktok_token_refresh((select channel_id from oauth_ctx),(select workspace_id from oauth_ctx),'31910000-0000-0000-0000-000000000021',1,'cipher-access-v2','cipher-refresh-v2',now()+interval '2 hours',now()+interval '180 days',array['user.info.basic']),true,'rotated credentials and expiry commit atomically');
select is((select token_version from public.oauth_connections where channel_id=(select channel_id from oauth_ctx)),2::bigint,'successful persist advances fencing version');
select is(public.complete_tiktok_token_refresh((select channel_id from oauth_ctx),(select workspace_id from oauth_ctx),'31910000-0000-0000-0000-000000000021',1,'stale-access','stale-refresh',now()+interval '2 hours',now()+interval '180 days',array[]::text[]),false,'late stale attempt cannot overwrite newer generation');
select is(public.save_tiktok_connection((select channel_id from oauth_ctx),'reauthorized-user',array['user.info.basic'],
 'cipher-access-reauthorized','cipher-refresh-reauthorized',now()+interval '2 hours',now()+interval '180 days'),
 'ok','explicit OAuth reauthorization remains available through its privileged RPC');
select is((select token_version from public.oauth_connections where channel_id=(select channel_id from oauth_ctx)),3::bigint,
 'reauthorization advances the token generation');
select is(public.complete_tiktok_token_refresh((select channel_id from oauth_ctx),(select workspace_id from oauth_ctx),'31910000-0000-0000-0000-000000000021',2,
 'cipher-access-late','cipher-refresh-late',now()+interval '2 hours',now()+interval '180 days',array[]::text[]),false,
 'an old refresh completion cannot overwrite a later reauthorization');
reset role;
update public.oauth_connections set refresh_state='IN_FLIGHT', refresh_attempt_id='31910000-0000-0000-0000-000000000023', refresh_started_at=clock_timestamp()-interval '91 seconds' where channel_id=(select channel_id from oauth_ctx);
set local role service_role;
select is(public.acquire_tiktok_token_refresh((select channel_id from oauth_ctx),(select workspace_id from oauth_ctx),'31910000-0000-0000-0000-000000000024')->>'state','REAUTH_REQUIRED','expired in-flight refresh is ambiguous and is not retried');
select is((select connection_status::text from public.channels where id=(select channel_id from oauth_ctx)),'REAUTH_REQUIRED','ambiguous attempt marks channel for reauthorization');
select is(public.acquire_tiktok_token_refresh('31910000-0000-0000-0000-000000000041',(select workspace_id from oauth_ctx),'31910000-0000-0000-0000-000000000043')->>'state','REAUTH_REQUIRED','legacy Login Kit row with unknown refresh expiry fails closed');
select is((select connection_status::text from public.channels where id='31910000-0000-0000-0000-000000000041'),'REAUTH_REQUIRED','unknown Login Kit expiry marks channel for reauthorization');
reset role;
select ok(not has_function_privilege('authenticated','public.acquire_tiktok_shop_token_refresh(uuid,uuid)','EXECUTE'), 'authenticated cannot acquire Shop refresh lease');
select ok(not has_function_privilege('authenticated','public.save_tiktok_shop_oauth_connection(uuid,text,text,text,timestamptz,timestamptz,text[])','EXECUTE'), 'authenticated cannot replace Shop credentials');
select ok(not has_function_privilege('service_role','public.acquire_tiktok_shop_token_refresh(uuid,uuid)','EXECUTE'), 'Shop refresh RPC is disabled for the initial launch');
select ok(not has_function_privilege('service_role','public.save_tiktok_shop_oauth_connection(uuid,text,text,text,timestamptz,timestamptz,text[])','EXECUTE'), 'Shop OAuth persistence is disabled for the initial launch');
select throws_ok(format('select public.save_tiktok_connection(%L,%L,%L::text[],%L,%L,%L::timestamptz,%L::timestamptz)',
 (select channel_id from oauth_ctx),'oauth-user',array['user.info.basic']::text[],'cipher-access','cipher-refresh',
 now()+interval '2 hours',null), '22023', null, 'Login Kit OAuth save rejects unknown refresh expiry');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"31910000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok(format('select public.acquire_tiktok_token_refresh(%L,%L,%L)',(select channel_id from oauth_ctx),(select workspace_id from oauth_ctx),'31910000-0000-0000-0000-000000000025'),'42501',null,'authenticated cannot call service refresh RPC');
select * from finish();
rollback;
