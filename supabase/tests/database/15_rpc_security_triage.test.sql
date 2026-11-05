-- Gate 3.15: privilégios administrativos, autorização multi-tenant e idempotência.
-- Fixtures sintéticas; transação integral revertida. Executar somente com banco Supabase local.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

insert into auth.users (id, instance_id, aud, role, email) values
  ('15100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate315-owner-a@test.invalid'),
  ('15100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate315-owner-b@test.invalid'),
  ('15100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate315-viewer@test.invalid'),
  ('15100000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate315-editor@test.invalid'),
  ('15100000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate315-admin@test.invalid'),
  ('15100000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate315-platform@test.invalid');
insert into public.platform_owners(user_id) values ('15100000-0000-0000-0000-000000000006');

create temporary table gate315_ctx (
  workspace_a uuid, workspace_b uuid,
  channel_a uuid, media_a uuid, channel_b uuid, media_b uuid,
  job_unknown_editor uuid, job_unknown_admin uuid, job_unknown_service uuid, job_unknown_other uuid
);
insert into gate315_ctx values (
  (select id from public.workspaces where owner_user_id='15100000-0000-0000-0000-000000000001'),
  (select id from public.workspaces where owner_user_id='15100000-0000-0000-0000-000000000002'),
  '15100000-0000-0000-0000-000000000011',
  '15100000-0000-0000-0000-000000000012',
  '15100000-0000-0000-0000-000000000016',
  '15100000-0000-0000-0000-000000000017',
  '15100000-0000-0000-0000-000000000013',
  '15100000-0000-0000-0000-000000000014',
  '15100000-0000-0000-0000-000000000015',
  '15100000-0000-0000-0000-000000000018'
);
grant select on gate315_ctx to authenticated;
grant select on gate315_ctx to service_role;

insert into public.workspace_members(workspace_id,user_id,role)
select workspace_a,'15100000-0000-0000-0000-000000000003'::uuid,'VIEWER'::public.workspace_role from gate315_ctx
union all select workspace_a,'15100000-0000-0000-0000-000000000004'::uuid,'EDITOR'::public.workspace_role from gate315_ctx
union all select workspace_a,'15100000-0000-0000-0000-000000000005'::uuid,'ADMIN'::public.workspace_role from gate315_ctx;
insert into public.channels(id,workspace_id,display_name)
select channel_a,workspace_a,'Gate 3.15 synthetic channel A' from gate315_ctx
union all select channel_b,workspace_b,'Gate 3.15 synthetic channel B' from gate315_ctx;
insert into public.media_assets(
  id,workspace_id,original_filename,storage_key,mime_type,file_size_bytes,status,
  validation_status,checksum_sha256,detected_mime_type,detected_video_codec,validated_at,validator_version
)
select media_a,workspace_a,'synthetic-a.mp4',workspace_a::text||'/'||media_a::text||'/original.mp4',
  'video/mp4',1024,'READY'::public.media_status,'VALIDATED',repeat('b',64),'video/mp4','h264',now(),'gate315-fixture'
from gate315_ctx
union all
select media_b,workspace_b,'synthetic-b.mp4',workspace_b::text||'/'||media_b::text||'/original.mp4',
  'video/mp4',1024,'READY'::public.media_status,'VALIDATED',repeat('c',64),'video/mp4','h264',now(),'gate315-fixture'
from gate315_ctx;
insert into public.publication_jobs(id,workspace_id,channel_id,media_asset_id,status,scheduled_at,music_rights_confirmed,created_by)
select job_unknown_editor,workspace_a,channel_a,media_a,'UNKNOWN'::public.publication_status,now()+interval '1 day',true,
  '15100000-0000-0000-0000-000000000001'::uuid from gate315_ctx
union all select job_unknown_admin,workspace_a,channel_a,media_a,'UNKNOWN'::public.publication_status,now()+interval '2 days',true,
  '15100000-0000-0000-0000-000000000001'::uuid from gate315_ctx
union all select job_unknown_service,workspace_a,channel_a,media_a,'UNKNOWN'::public.publication_status,now()+interval '3 days',true,
  '15100000-0000-0000-0000-000000000001'::uuid from gate315_ctx
union all select job_unknown_other,workspace_b,channel_b,media_b,'UNKNOWN'::public.publication_status,now()+interval '4 days',true,
  '15100000-0000-0000-0000-000000000002'::uuid from gate315_ctx;

select ok(has_function_privilege('authenticated','public.change_workspace_plan(uuid,text)','EXECUTE'), 'authenticated mantém EXECUTE, sujeito a autorização de operador da plataforma');
select ok(has_function_privilege('service_role','public.change_workspace_plan(uuid,text)','EXECUTE'), 'service_role mantém caminho administrativo interno');
select ok(to_regprocedure('public.resolve_unknown_job(uuid,text)') is not null,'assinatura antiga existe apenas como stub de compatibilidade fail-closed');
select ok(has_function_privilege('authenticated','public.resolve_unknown_job(uuid,text,uuid)','EXECUTE'), 'authenticated pode chamar a RPC protegida');
select ok(has_function_privilege('authenticated','public.resolve_unknown_job(uuid,text)','EXECUTE'), 'clientes antigos recebem erro controlado do stub sem efeitos');
select ok(not has_table_privilege('authenticated','public.workspace_usage_cycles','UPDATE'), 'authenticated não pode alterar ciclos de quota diretamente');
select ok(not has_table_privilege('authenticated','public.workspace_subscriptions','UPDATE'), 'authenticated não pode alterar assinaturas diretamente');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"15100000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok(format('select public.resolve_unknown_job(%L::uuid,%L)',(select job_unknown_editor from gate315_ctx),'NOT_PUBLISHED'),'0A000','client update required; reload AutoClip before resolving job','bundle legado recebe erro de atualização controlado');
reset role;
select is((select status::text||':'||(select count(*)::text from public.publication_job_manual_resolutions r where r.publication_job_id=j.id) from public.publication_jobs j where j.id=(select job_unknown_editor from gate315_ctx)),'UNKNOWN:0','chamada legada rejeitada não altera job nem cria trilha de resolução');
set local role authenticated;
select throws_ok(format('select public.change_workspace_plan(%L::uuid,%L)',(select workspace_a from gate315_ctx),'pro'),'42501',null,'OWNER do workspace não pode elevar o plano');
select throws_ok(format('update public.workspace_usage_cycles set publication_limit=999 where workspace_id=%L',(select workspace_a from gate315_ctx)),'42501',null,'tentativa de alterar quota diretamente é negada');

select set_config('request.jwt.claims','{"sub":"15100000-0000-0000-0000-000000000005","role":"authenticated"}',true);
select throws_ok(format('select public.change_workspace_plan(%L::uuid,%L)',(select workspace_a from gate315_ctx),'pro'),'42501',null,'ADMIN do workspace não pode elevar o plano');
select throws_ok(format('select public.resolve_unknown_job(%L::uuid,%L,%L::uuid)',(select job_unknown_other from gate315_ctx),'NOT_PUBLISHED','15100000-0000-0000-0000-000000000021'),'42501',null,'ADMIN não pode resolver job de outro workspace');

select set_config('request.jwt.claims','{"sub":"15100000-0000-0000-0000-000000000006","role":"authenticated"}',true);
select lives_ok(format('select public.change_workspace_plan(%L::uuid,%L)',(select workspace_a from gate315_ctx),'pro'),'operador de plataforma autorizado pode alterar plano manual');
reset role;
select is((select plan_id||':'||status::text from public.workspace_subscriptions where workspace_id=(select workspace_a from gate315_ctx)),'pro:ACTIVE','mudança administrativa atualiza assinatura sem fluxo de cobrança');
select is((select count(*)::integer from public.subscription_events where workspace_id=(select workspace_a from gate315_ctx) and event_type='PLAN_CHANGED_MANUAL' and actor_user_id='15100000-0000-0000-0000-000000000006'),1,'mudança registra operador responsável');

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok(format('select public.change_workspace_plan(%L::uuid,%L)',(select workspace_b from gate315_ctx),'advanced'),'service_role pode executar a mudança administrativa interna');
reset role;
select is((select plan_id from public.workspace_subscriptions where workspace_id=(select workspace_b from gate315_ctx)),'advanced','caminho interno registra a alteração no workspace alvo');
update public.workspace_subscriptions set provider='STRIPE', provider_customer_id='synthetic-customer', provider_subscription_id='synthetic-subscription' where workspace_id=(select workspace_b from gate315_ctx);
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok(format('select public.change_workspace_plan(%L::uuid,%L)',(select workspace_b from gate315_ctx),'enterprise'),'42501',null,'assinatura marcada como gerenciada por provedor não pode ser alterada manualmente');
reset role;
select is((select plan_id from public.workspace_subscriptions where workspace_id=(select workspace_b from gate315_ctx)),'advanced','bloqueio de provedor preserva o plano existente');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"15100000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok(format('select public.change_workspace_plan(%L::uuid,%L)',(select workspace_b from gate315_ctx),'pro'),'42501',null,'OWNER de outro workspace também não pode alterar plano');
select throws_ok(format('select public.resolve_unknown_job(%L::uuid,%L,%L::uuid)',(select job_unknown_editor from gate315_ctx),'NOT_PUBLISHED','15100000-0000-0000-0000-000000000022'),'42501',null,'usuário de outro workspace não resolve job');

select set_config('request.jwt.claims','{"sub":"15100000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select throws_ok(format('select public.change_workspace_plan(%L::uuid,%L)',(select workspace_a from gate315_ctx),'starter'),'42501',null,'VIEWER não altera plano');
select throws_ok(format('select public.resolve_unknown_job(%L::uuid,%L,%L::uuid)',(select job_unknown_editor from gate315_ctx),'NOT_PUBLISHED','15100000-0000-0000-0000-000000000023'),'42501',null,'VIEWER não resolve job');

select set_config('request.jwt.claims','{"sub":"15100000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select throws_ok(format('select public.change_workspace_plan(%L::uuid,%L)',(select workspace_a from gate315_ctx),'starter'),'42501',null,'EDITOR não altera plano');
select throws_ok(format('select public.resolve_unknown_job(%L::uuid,%L,%L::uuid)',(select job_unknown_editor from gate315_ctx),'NOT_PUBLISHED','15100000-0000-0000-0000-000000000024'),'42501',null,'EDITOR não resolve UNKNOWN');

select set_config('request.jwt.claims','{"sub":"15100000-0000-0000-0000-000000000005","role":"authenticated"}',true);
select throws_ok(format('select public.resolve_unknown_job(%L::uuid,%L,%L::uuid)',(select job_unknown_other from gate315_ctx),'NOT_PUBLISHED','15100000-0000-0000-0000-000000000025'),'42501',null,'ADMIN não resolve job de outro workspace');
select throws_ok(format('select public.resolve_unknown_job(%L::uuid,%L,%L::uuid)',(select job_unknown_admin from gate315_ctx),'INVALID','15100000-0000-0000-0000-000000000031'),'22023',null,'ADMIN não pode usar transição de estado fora da allowlist');
select lives_ok(format('select public.resolve_unknown_job(%L::uuid,%L,%L::uuid)',(select job_unknown_admin from gate315_ctx),'NOT_PUBLISHED','15100000-0000-0000-0000-000000000026'),'ADMIN resolve job UNKNOWN do próprio workspace');
select is((select status::text from public.publication_jobs where id=(select job_unknown_admin from gate315_ctx)),'SCHEDULED','NOT_PUBLISHED reprograma estado permitido');
select is((select status::text from public.publication_quota_reservations where publication_job_id=(select job_unknown_admin from gate315_ctx)),'RESERVED','reagendamento conserva reserva de quota');
select lives_ok(format('select public.resolve_unknown_job(%L::uuid,%L,%L::uuid)',(select job_unknown_admin from gate315_ctx),'NOT_PUBLISHED','15100000-0000-0000-0000-000000000026'),'replay idêntico retorna sucesso sem repetir efeitos');
reset role;
select is((select count(*)::integer from public.publication_events where publication_job_id=(select job_unknown_admin from gate315_ctx) and event_type='MANUAL_RESOLUTION'),1,'replay idempotente não duplica evento de auditoria');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"15100000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok(format('select public.resolve_unknown_job(%L::uuid,%L,%L::uuid)',(select job_unknown_editor from gate315_ctx),'PUBLISHED','15100000-0000-0000-0000-000000000027'),'OWNER resolve job do próprio workspace');
select throws_ok(format('select public.resolve_unknown_job(%L::uuid,%L,%L::uuid)',(select job_unknown_editor from gate315_ctx),'NOT_PUBLISHED','15100000-0000-0000-0000-000000000028'),'22023',null,'novo request não repete resolução após transição');
select throws_ok(format('select public.resolve_unknown_job(%L::uuid,%L,%L::uuid)',(select job_unknown_editor from gate315_ctx),'NOT_PUBLISHED','15100000-0000-0000-0000-000000000027'),'22023',null,'request_id reutilizado com payload diferente é rejeitado');
select throws_ok(format('select public.resolve_unknown_job(%L::uuid,%L,null::uuid)',(select job_unknown_service from gate315_ctx),'PUBLISHED'),'22023',null,'request_id nulo é rejeitado');
select set_config('request.jwt.claims','{"sub":"15100000-0000-0000-0000-000000000006","role":"authenticated"}',true);
select throws_ok(format('select public.change_workspace_plan(%L::uuid,%L)',(select workspace_a from gate315_ctx),'not-a-plan'),'22023',null,'operador autorizado não consegue selecionar plano inválido');
reset role;

select set_config('request.jwt.claims','{"role":"authenticated"}',true);
set local role authenticated;
select throws_ok(format('select public.change_workspace_plan(%L::uuid,%L)',(select workspace_a from gate315_ctx),'pro'),'42501',null,'sem auth.uid a mudança de plano é negada');
select throws_ok(format('select public.resolve_unknown_job(%L::uuid,%L,%L::uuid)',(select job_unknown_service from gate315_ctx),'PUBLISHED','15100000-0000-0000-0000-000000000029'),'42501',null,'sem auth.uid a resolução é negada');
reset role;

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok(format('select public.resolve_unknown_job(%L::uuid,%L,%L::uuid)',(select job_unknown_service from gate315_ctx),'PUBLISHED','15100000-0000-0000-0000-000000000030'),'service_role autorizado pode resolver pelo caminho interno');
select is((select status::text from public.publication_jobs where id=(select job_unknown_service from gate315_ctx)),'PUBLISHED','resolução interna confirma estado publicado');
reset role;

select * from finish();
rollback;
