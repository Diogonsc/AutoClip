begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select ok(not has_function_privilege('authenticated','public.claim_pending_video_validation(integer,integer)','EXECUTE'),'usuário não pode reivindicar fila de validação');
select ok(has_function_privilege('service_role','public.claim_pending_video_validation(integer,integer)','EXECUTE'),'worker pode reivindicar fila de validação');
select ok(not has_function_privilege('authenticated','public.complete_legacy_media_revalidation(uuid,uuid,bigint,text,text,text,numeric,integer,integer,text)','EXECUTE'),'cliente não pode atestar mídia legada');
select ok(not has_function_privilege('authenticated','public.complete_video_media_validation(uuid,uuid,bigint,text,text,text,numeric,integer,integer,text)','EXECUTE'),'cliente não pode atestar vídeo');

insert into auth.users(id,instance_id,aud,role,email) values ('99999999-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000000','authenticated','authenticated','video-validation@test.dev');
create temp table video_ctx(w uuid,c uuid,new_media uuid,legacy uuid);
insert into video_ctx select id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid() from public.workspaces where owner_user_id='99999999-0000-0000-0000-000000000041';
insert into public.channels(id,workspace_id,display_name,connection_status)
select c,w,'Video validator fixture','CONNECTED'::public.channel_status from video_ctx;
insert into public.media_assets(id,workspace_id,original_filename,storage_key,mime_type,file_size_bytes,status,created_by,validation_status,upload_completed_at)
select new_media,w,'pending.mp4',w::text||'/'||new_media::text||'/original.mp4','video/mp4',100,'UPLOADING','99999999-0000-0000-0000-000000000041','PENDING',now() from video_ctx;
insert into public.media_assets(id,workspace_id,original_filename,storage_key,mime_type,file_size_bytes,status,created_by,validation_status)
select legacy,w,'legacy.mp4',w::text||'/'||legacy::text||'/original.mp4','video/mp4',100,'READY','99999999-0000-0000-0000-000000000041','UNVERIFIED' from video_ctx;
grant select on video_ctx to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"99999999-0000-0000-0000-000000000041","role":"authenticated"}',true);
select throws_ok($$select public.begin_media_upload((select w from video_ctx),'legacy.mov','video/quicktime',100)$$,'22023',null,'MIME MOV não é aceito na nova quarentena');
select throws_ok($$select public.confirm_publication_batch((select w from video_ctx),'99999999-0000-0000-0000-000000000042',jsonb_build_array(jsonb_build_object('channel_id',(select c from video_ctx),'media_asset_id',(select legacy from video_ctx),'scheduled_at',(now()+interval '1 day')::text,'timezone','UTC','caption','unverified media','music_rights_confirmed',true)),'{"strategy":"SEQUENTIAL"}'::jsonb)$$,'23514',null,'mídia legada UNVERIFIED não pode ser agendada');
select throws_ok($$update public.media_assets set status='READY',validation_status='VALIDATED',file_size_bytes=100,checksum_sha256=repeat('a',64),detected_mime_type='video/mp4',detected_video_codec='h264',duration_seconds=2,width=360,height=640,validated_at=now(),validator_version='forged' where id=(select legacy from video_ctx)$$,'42501',null,'cliente não pode forjar atestado completo de mídia legada');
select throws_ok($$select public.claim_legacy_media_revalidation((select legacy from video_ctx))$$,'42501',null,'usuário autenticado não pode reivindicar validação legada');
reset role;

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select count(*)::int from public.claim_pending_video_validation(10,240)),1,'worker reivindica vídeo pendente com lease');
select is((select validation_status from public.media_assets where id=(select new_media from video_ctx)),'VALIDATING','estado persistido durante validação');
select is((select count(*)::int from public.claim_pending_video_validation(10,240)),0,'claim repetido não duplica processamento');
select lives_ok($$select public.release_media_validation_claim((select new_media from video_ctx),(select validation_claim_token from public.media_assets where id=(select new_media from video_ctx)),'TEST_RETRY')$$,'claim recuperável após erro transitório');
select is((select status::text||':'||validation_status from public.media_assets where id=(select new_media from video_ctx)),'UPLOADING:PENDING','falha transitória não promove mídia');
select is((select count(*)::int from public.claim_legacy_media_revalidation((select legacy from video_ctx))),1,'worker reivindica legado sem alterar seu ID');
select is((select status::text||':'||validation_status from public.media_assets where id=(select legacy from video_ctx)),'READY:VALIDATING','revalidação mantém registro histórico e não o torna elegível');
update public.media_assets set validation_locked_until=now()-interval '1 second' where id=(select legacy from video_ctx);
select is((select count(*)::int from public.claim_legacy_media_revalidation((select legacy from video_ctx))),1,'claim legado expirado pode ser recuperado');
select is((select validation_attempt_count::int from public.media_assets where id=(select legacy from video_ctx)),2,'lease recuperada incrementa tentativa sem trocar o registro');
select throws_ok($$select public.complete_video_media_validation((select legacy from video_ctx),(select validation_claim_token from public.media_assets where id=(select legacy from video_ctx)),100,repeat('a',64),'video/mp4','mpeg4',1,360,640,'test')$$,'22023',null,'RPC recusa codec de vídeo incompatível');
reset role;
select * from finish();
rollback;
