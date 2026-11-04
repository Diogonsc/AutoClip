begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select ok((select relrowsecurity from pg_class where oid='public.media_validation_workers'::regclass),'telemetria possui RLS');
select ok(not has_table_privilege('anon','public.media_validation_workers','SELECT'),'anon não pode ler telemetria');
select ok(not has_table_privilege('authenticated','public.media_validation_workers','SELECT'),'cliente não pode ler telemetria global');
select ok(not has_function_privilege('authenticated','public.media_validation_worker_heartbeat(uuid,text,text,integer,integer,integer,integer,timestamp with time zone)','EXECUTE'),'cliente não pode emitir heartbeat privilegiado');
select ok(has_function_privilege('service_role','public.media_validation_worker_heartbeat(uuid,text,text,integer,integer,integer,integer,timestamp with time zone)','EXECUTE'),'worker pode emitir heartbeat');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"99999999-0000-0000-0000-000000000012"}',true);
select throws_ok($$select public.media_validation_worker_heartbeat('11111111-1111-1111-1111-111111111111','3.6.0','ONLINE',0,0,0,0,null)$$,'42501',null,'cliente não consegue invocar telemetria');
reset role;

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($$select public.media_validation_worker_heartbeat('11111111-1111-1111-1111-111111111111','3.6.0','ONLINE',4,1,0,1200,null)$$,'worker atualiza heartbeat');
select is((select pending_count from public.media_validation_workers where instance_id='11111111-1111-1111-1111-111111111111'),4,'telemetria persiste contadores');
select throws_ok($$select public.media_validation_worker_heartbeat('11111111-1111-1111-1111-111111111111','3.6.0','ONLINE',-1,0,0,0,null)$$,'22023',null,'contadores negativos são recusados');
reset role;
select * from finish();
rollback;
