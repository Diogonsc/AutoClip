-- pgTAP: elegibilidade, lock, dry-run e idempotência da retenção de mídia.
-- Não chama o Storage; a exclusão física é apenas simulada e toda a transação é revertida.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email)
values ('88888888-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cleanup@test.dev');

create temp table cleanup_ctx (
  workspace_id uuid, owner_id uuid, channel_id uuid, media_id uuid,
  published_job_id uuid, unknown_job_id uuid, lock_id uuid
);
insert into cleanup_ctx
select w.id, w.owner_user_id, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
from public.workspaces w where w.owner_user_id = '88888888-0000-0000-0000-000000000008';

update public.workspace_settings
   set auto_delete_media_enabled = true, auto_delete_media_dry_run = true,
       auto_delete_media_grace_hours = 24, auto_delete_media_batch_size = 10
 where workspace_id = (select workspace_id from cleanup_ctx);

insert into public.channels (id, workspace_id, display_name)
select channel_id, workspace_id, 'Canal de retenção' from cleanup_ctx;
insert into public.media_assets (id, workspace_id, original_filename, storage_key, mime_type, file_size_bytes, status, created_by)
select media_id, workspace_id, 'ficticio.mp4', workspace_id::text || '/' || media_id::text || '/original.mp4', 'video/mp4', 1024, 'READY', owner_id from cleanup_ctx;
insert into public.publication_jobs (id, workspace_id, channel_id, media_asset_id, created_by, status, scheduled_at, music_rights_confirmed)
select published_job_id, workspace_id, channel_id, media_id, owner_id, 'PUBLISHED', now() - interval '2 days', true from cleanup_ctx;

-- Simula publicação confirmada há mais de 24h sem chamar TikTok.
set local session_replication_role = replica;
update public.publication_jobs set updated_at = now() - interval '25 hours'
where id = (select published_job_id from cleanup_ctx);
set local session_replication_role = origin;

insert into public.publication_jobs (id, workspace_id, channel_id, media_asset_id, created_by, status, scheduled_at, music_rights_confirmed)
select unknown_job_id, workspace_id, channel_id, media_id, owner_id, 'UNKNOWN', now() - interval '1 day', true from cleanup_ctx;

select is((select count(*) from public.claim_media_cleanup_candidates(10, (select lock_id from cleanup_ctx))), 0::bigint,
  'UNKNOWN impede a limpeza da mídia compartilhada');

delete from public.publication_jobs where id = (select unknown_job_id from cleanup_ctx);

select is((select count(*) from public.claim_media_cleanup_candidates(10, (select lock_id from cleanup_ctx))), 1::bigint,
  'mídia publicada há mais do que o grace period fica elegível');
select ok((select cleanup_lock_token = lock_id from public.media_assets join cleanup_ctx on media_assets.id = cleanup_ctx.media_id),
  'claim aplica lock exclusivo na mídia');

select ok(public.complete_media_cleanup((select media_id from cleanup_ctx), (select lock_id from cleanup_ctx), false, true, null),
  'dry-run finaliza sem apagar o objeto');
select is((select status::text from public.media_assets where id = (select media_id from cleanup_ctx)), 'READY',
  'dry-run mantém a mídia disponível');
select is((select count(*) from public.media_cleanup_audit where media_asset_id = (select media_id from cleanup_ctx) and action = 'DRY_RUN'), 1::bigint,
  'dry-run registra auditoria');

update cleanup_ctx set lock_id = gen_random_uuid();
select is((select count(*) from public.claim_media_cleanup_candidates(10, (select lock_id from cleanup_ctx))), 1::bigint,
  'asset pode ser reivindicado novamente após dry-run');
select ok(public.complete_media_cleanup((select media_id from cleanup_ctx), (select lock_id from cleanup_ctx), true, false, null),
  'finalização física simulada é aceita para um asset travado');
select ok(not public.complete_media_cleanup((select media_id from cleanup_ctx), (select lock_id from cleanup_ctx), true, false, null),
  'repetição com o mesmo lock é idempotente');

select * from finish();
rollback;
