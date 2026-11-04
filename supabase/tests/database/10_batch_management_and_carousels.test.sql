-- pgTAP: carrossel, cancelamento/reagendamento idempotentes e agregados de lote.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);
insert into auth.users(id,instance_id,aud,role,email) values ('99999999-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000000','authenticated','authenticated','batch-ops@test.dev');
create temp table ops_ctx(w uuid,c uuid,v uuid,p1 uuid,p2 uuid);
insert into ops_ctx select id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid() from public.workspaces where owner_user_id='99999999-0000-0000-0000-000000000021';
insert into public.channels(id,workspace_id,display_name,connection_status,creator_info) select c,w,'Ops','CONNECTED'::public.channel_status,'{"privacy_level_options":["SELF_ONLY","PUBLIC_TO_EVERYONE"],"comment_disabled":false,"duet_disabled":false,"stitch_disabled":false}'::jsonb from ops_ctx;
update public.workspace_settings set publish_mode='DIRECT' where workspace_id=(select w from ops_ctx);
insert into public.media_assets(id,workspace_id,original_filename,storage_key,mime_type,file_size_bytes,status,validation_status,checksum_sha256,detected_mime_type,detected_video_codec,validated_at,validator_version)
select v,w,'video.mp4',w::text||'/'||v::text||'/original.mp4','video/mp4',10,'READY'::public.media_status,'VALIDATED',repeat('a',64),'video/mp4','h264',now(),'fixture' from ops_ctx union all
select p1,w,'one.jpg',w::text||'/'||p1::text||'/original.jpg','image/jpeg',10,'READY'::public.media_status,'VALIDATED',repeat('a',64),'image/jpeg',null,now(),'fixture' from ops_ctx union all
select p2,w,'two.jpg',w::text||'/'||p2::text||'/original.jpg','image/jpeg',10,'READY'::public.media_status,'VALIDATED',repeat('a',64),'image/jpeg',null,now(),'fixture' from ops_ctx;
grant select on ops_ctx to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"99999999-0000-0000-0000-000000000021","role":"authenticated"}',true);
insert into public.account_groups(workspace_id,name,created_by) select w,'Ops group','99999999-0000-0000-0000-000000000021' from ops_ctx;
insert into public.account_group_members(workspace_id,group_id,channel_id) select w,(select id from public.account_groups where name='Ops group' and workspace_id=ops_ctx.w),c from ops_ctx;
select lives_ok($$
  select public.confirm_publication_batch((select w from ops_ctx),'99999999-0000-0000-0000-000000000031',jsonb_build_array(jsonb_build_object('channel_id',(select c from ops_ctx),'media_asset_id',(select p1 from ops_ctx),'media_asset_ids',jsonb_build_array((select p1::text from ops_ctx),(select p2::text from ops_ctx)),'post_type','PHOTO','scheduled_at',(now()+interval '1 day')::text,'timezone','UTC','caption','photos','privacy_level','SELF_ONLY','allow_comment',true,'allow_duet',null,'allow_stitch',null,'brand_content',false,'brand_organic',false,'music_rights_confirmed',true)),'{"strategy":"ALL_TO_ALL"}'::jsonb)
$$,'confirma carrossel sem expor Storage');
select is((select post_type from public.publication_jobs limit 1),'PHOTO','job preserva tipo PHOTO');
select is((select cardinality(media_asset_ids) from public.publication_jobs limit 1),2,'job preserva ordem/quantidade das imagens');
select lives_ok($$
  select public.confirm_publication_batch((select w from ops_ctx),'99999999-0000-0000-0000-000000000032',jsonb_build_array(jsonb_build_object('channel_id',(select c from ops_ctx),'media_asset_id',(select v from ops_ctx),'post_type','VIDEO','scheduled_at',(now()+interval '2 days')::text,'timezone','UTC','caption','video','privacy_level','SELF_ONLY','allow_comment',true,'allow_duet',false,'allow_stitch',false,'brand_content',false,'brand_organic',false,'music_rights_confirmed',true)),'{"strategy":"SEQUENTIAL"}'::jsonb)
$$,'confirma vídeo para operações posteriores');
reset role;
update public.publication_batches set created_at=now()-interval '1 day' where id=(select batch_id from public.publication_jobs where post_type='PHOTO' limit 1);
set local role authenticated;
select lives_ok($$
  select public.reschedule_publication_batch_items((select w from ops_ctx),jsonb_build_array(jsonb_build_object('job_id',(select id from public.publication_jobs where post_type='VIDEO'),'original_scheduled_at',(select scheduled_at::text from public.publication_jobs where post_type='VIDEO'),'scheduled_at',(now()+interval '3 days')::text,'timezone','UTC')),'99999999-0000-0000-0000-000000000033')
$$,'reagenda item elegível');
select is((select count(*)::int from public.publication_quota_reservations r join public.publication_jobs j on j.id=r.publication_job_id where j.workspace_id=(select w from ops_ctx) and r.status='RESERVED'),2,'reagendamento não altera reservas de quota');
select is((public.reschedule_publication_batch_items((select w from ops_ctx),jsonb_build_array(jsonb_build_object('job_id',(select id from public.publication_jobs where post_type='VIDEO'),'scheduled_at',(now()+interval '4 days')::text,'timezone','UTC')),'99999999-0000-0000-0000-000000000033')->>'rescheduled')::int,1,'repetir a chave de idempotência não duplica a operação');
select throws_ok($$select public.reschedule_publication_batch_items((select w from ops_ctx),jsonb_build_array(jsonb_build_object('job_id',(select id from public.publication_jobs where post_type='VIDEO'),'original_scheduled_at',(now()+interval '2 days')::text,'scheduled_at',(now()+interval '5 days')::text,'timezone','UTC')),'99999999-0000-0000-0000-000000000038')$$,'40001',null,'RPC rejeita reagendamento baseado em estado desatualizado');
select lives_ok($$
  select public.cancel_publication_batch_items((select w from ops_ctx),array[(select id from public.publication_jobs where post_type='VIDEO')],'99999999-0000-0000-0000-000000000034')
$$,'cancela item elegível');
select is((select status::text from public.publication_jobs where post_type='VIDEO'),'CANCELLED','cancelamento atualiza máquina de estados');
select is((select count(*)::int from public.publication_quota_reservations r join public.publication_jobs j on j.id=r.publication_job_id where j.workspace_id=(select w from ops_ctx) and r.status='RESERVED'),1,'cancelar libera somente a reserva do item');
select is((select (public.list_publication_batches((select w from ops_ctx),25,0,null,null)->>'total')::int),2,'consulta paginada agrega lotes no workspace');
select is((public.list_publication_batches(p_workspace=>(select w from ops_ctx),p_status=>'CANCELLED')->>'total')::int,1,'status é filtrado no banco antes da paginação');
select is((public.list_publication_batches(p_workspace=>(select w from ops_ctx),p_status=>'SCHEDULED',p_limit=>1)->>'total')::int,1,'filtro encontra lote correspondente além da página global');
select is((public.list_publication_batches(p_workspace=>(select w from ops_ctx),p_created_from=>current_date-1,p_created_to=>current_date)->>'total')::int,2,'período de criação é filtrado no PostgreSQL');
select is((public.list_publication_batches(p_workspace=>(select w from ops_ctx),p_batch=>(select batch_id::text from public.publication_jobs where post_type='VIDEO' limit 1))->>'total')::int,1,'filtro por identificador exato do lote');
select is((public.list_publication_batches(p_workspace=>(select w from ops_ctx),p_channel=>(select c from ops_ctx),p_group=>(select id from public.account_groups where name='Ops group'),p_status=>'SCHEDULED')->>'total')::int,1,'filtros combinados por conta, grupo e status');
select is((public.list_publication_batches(p_workspace=>(select w from ops_ctx),p_status=>'UNKNOWN')->>'total')::int,0,'status sem correspondência retorna total zero');
select is((public.list_publication_batches(p_workspace=>(select w from ops_ctx),p_limit=>1)->'rows'->0->>'id'),(select batch_id::text from public.publication_jobs where post_type='VIDEO' limit 1),'a primeira página global contém somente o lote mais recente');
select is((public.list_publication_batches(p_workspace=>(select w from ops_ctx),p_status=>'SCHEDULED',p_limit=>1)->'rows'->0->>'id'),(select batch_id::text from public.publication_jobs where post_type='PHOTO' limit 1),'filtro encontra status em lote posterior à primeira página global');
select throws_ok($$select public.list_publication_batches(p_workspace=>(select w from ops_ctx),p_status=>'NOT_A_STATUS')$$,'22023',null,'RPC rejeita status inválido');
select throws_ok($$select public.confirm_publication_batch((select w from ops_ctx),'99999999-0000-0000-0000-000000000035',jsonb_build_array(jsonb_build_object('channel_id',(select c from ops_ctx),'media_asset_id',(select v from ops_ctx),'post_type','VIDEO','scheduled_at',(now()+interval '4 days')::text,'caption','bad privacy','privacy_level','PUBLIC_TO_EVERYONE','allow_comment',true,'allow_duet',false,'allow_stitch',false,'brand_content',false,'brand_organic',false,'music_rights_confirmed',true)),'{}'::jsonb)$$,'23514',null,'RPC rejeita privacidade fora das capacidades cacheadas');
select throws_ok($$select public.confirm_publication_batch((select w from ops_ctx),'99999999-0000-0000-0000-000000000036',jsonb_build_array(jsonb_build_object('channel_id',(select c from ops_ctx),'media_asset_id',(select v from ops_ctx),'post_type','VIDEO','scheduled_at',(now()+interval '4 days')::text,'caption','missing interactions','privacy_level','SELF_ONLY','allow_comment',true,'brand_content',false,'brand_organic',false,'music_rights_confirmed',true)),'{}'::jsonb)$$,'22023',null,'RPC exige interações tipadas para vídeo');
select throws_ok($$select public.confirm_publication_batch((select w from ops_ctx),'99999999-0000-0000-0000-000000000037',jsonb_build_array(jsonb_build_object('channel_id',(select c from ops_ctx),'media_asset_id',(select p1 from ops_ctx),'media_asset_ids',jsonb_build_array((select p1::text from ops_ctx)),'post_type','PHOTO','scheduled_at',(now()+interval '4 days')::text,'caption','unsupported photo interaction','privacy_level','SELF_ONLY','allow_comment',true,'allow_duet',false,'allow_stitch',null,'brand_content',false,'brand_organic',false,'music_rights_confirmed',true)),'{}'::jsonb)$$,'22023',null,'RPC rejeita duet/stitch em foto');
select * from finish();
rollback;
