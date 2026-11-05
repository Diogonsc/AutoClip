begin;
select plan(8);

select ok(has_table_privilege('service_role','public.video_worker_api_nonces','INSERT'), 'somente o serviço pode registrar nonce da API worker');
select ok(not has_table_privilege('authenticated','public.video_worker_api_nonces','SELECT'), 'usuário autenticado não lê nonces da API worker');
select ok(not has_function_privilege('authenticated','public.consume_video_worker_api_nonce(uuid,timestamp with time zone)','EXECUTE'), 'usuário não consome nonce privilegiado');
select ok(has_function_privilege('service_role','public.consume_video_worker_api_nonce(uuid,timestamp with time zone)','EXECUTE'), 'runtime confiável pode consumir nonce');

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(public.consume_video_worker_api_nonce('16111111-1111-4111-8111-111111111111',now()+interval '90 seconds'), 'nonce válido é aceito uma vez');
select ok(not public.consume_video_worker_api_nonce('16111111-1111-4111-8111-111111111111',now()+interval '90 seconds'), 'replay do mesmo nonce é rejeitado');
select throws_ok($$select public.consume_video_worker_api_nonce('17111111-1111-4111-8111-111111111111',now()+interval '5 minutes')$$,'22023',null,'expiração excessiva é rejeitada');
select throws_ok($$select public.consume_video_worker_api_nonce('18111111-1111-4111-8111-111111111111',now()-interval '1 second')$$,'22023',null,'nonce expirado é rejeitado');

select * from finish();
rollback;
