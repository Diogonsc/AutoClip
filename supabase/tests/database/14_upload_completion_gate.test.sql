begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users(id,instance_id,aud,role,email)
values('99999999-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000000','authenticated','authenticated','upload-gate@test.dev');
create temp table upload_gate_ctx(media_id uuid,workspace_id uuid,owner_id uuid);
insert into upload_gate_ctx
select gen_random_uuid(),id,'99999999-0000-0000-0000-000000000051'
from public.workspaces where owner_user_id='99999999-0000-0000-0000-000000000051';
insert into public.media_assets(id,workspace_id,original_filename,storage_key,mime_type,file_size_bytes,status,validation_status,created_by)
select media_id,workspace_id,'gate.mp4',workspace_id::text||'/'||media_id::text||'/original.mp4',
  'video/mp4',123,'UPLOADING','PENDING',owner_id from upload_gate_ctx;
grant select on upload_gate_ctx to authenticated,service_role;

select ok(not has_function_privilege('authenticated','public.mark_media_upload_completed(uuid)','EXECUTE'),
  'browser cannot complete upload marker');
select ok(has_function_privilege('service_role','public.mark_media_upload_completed(uuid)','EXECUTE'),
  'only trusted backend can complete upload marker');
select is((select count(*)::int from public.media_assets where upload_completed_at is not null),0,
  'new upload has no completion marker before Storage commit');

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select count(*)::int from public.claim_pending_video_validation(10,240)),0,
  'worker cannot claim before completed Storage object marker');
select throws_ok($$select public.mark_media_upload_completed((select media_id from upload_gate_ctx))$$,
  '23514',null,'backend cannot mark missing Storage object complete');
insert into storage.objects(bucket_id,name,metadata)
select 'media-quarantine',workspace_id::text||'/'||media_id::text||'/upload','{"size":"123","mimetype":"video/mp4"}'::jsonb
from upload_gate_ctx;
select lives_ok($$select public.mark_media_upload_completed((select media_id from upload_gate_ctx))$$,
  'backend marks only the persisted object with matching size complete');
select lives_ok($$select public.mark_media_upload_completed((select media_id from upload_gate_ctx))$$,
  'completion marker operation is idempotent');
select is((select count(*)::int from public.claim_pending_video_validation(10,240)),1,
  'worker can claim only after upload completion');
reset role;
select * from finish();
rollback;
