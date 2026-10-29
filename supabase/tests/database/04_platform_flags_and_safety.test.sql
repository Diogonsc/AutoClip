-- pgTAP: flags de auditoria e proteções de agendamento.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select has_table('public', 'platform_flags', 'há configuração global de auditoria');
select has_function('public', 'get_platform_flags', array[]::text[], 'há RPC de flags para o frontend');
select is((public.get_platform_flags() ->> 'tiktok_audited')::boolean, false,
  'o app começa como não auditado por segurança');
select is((public.get_platform_flags() ->> 'test_mode')::boolean, true,
  'o modo de teste fica ligado até aprovação explícita');

insert into auth.users (id, instance_id, aud, role, email) values
  ('dddddddd-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@test.dev');
create temp table safety_ctx as
select w.id as workspace_id, gen_random_uuid() as channel_id, gen_random_uuid() as media_id
from public.workspaces w where w.owner_user_id = 'dddddddd-0000-0000-0000-000000000004';
insert into public.channels (id, workspace_id, display_name)
select channel_id, workspace_id, 'Canal teste' from safety_ctx;
insert into public.media_assets (id, workspace_id, original_filename, storage_key, mime_type, file_size_bytes, status)
select media_id, workspace_id, 'teste.mp4', workspace_id::text || '/' || media_id::text || '/original.mp4', 'video/mp4', 1024, 'READY'
from safety_ctx;

select throws_ok(
  format($q$insert into public.publication_jobs (workspace_id, channel_id, media_asset_id, status, scheduled_at, created_by)
    select workspace_id, channel_id, media_id, 'SCHEDULED', now() + interval '1 day', 'dddddddd-0000-0000-0000-000000000004' from safety_ctx$q$),
  '23514', null,
  'não permite agendar sem confirmar direitos/consentimento do áudio');

select * from finish();
rollback;
