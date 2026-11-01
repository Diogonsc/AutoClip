-- pgTAP: reservas de quota são transacionais e preservam o histórico do job.
-- Rodar com: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, instance_id, aud, role, email)
values ('77777777-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'saas@test.dev');

create temp table saas_ctx (workspace_id uuid, channel_id uuid, media_id uuid, job_id uuid, job2_id uuid);
insert into saas_ctx (workspace_id, channel_id, media_id, job_id, job2_id)
select id, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
from public.workspaces where owner_user_id = '77777777-0000-0000-0000-000000000007';

select is((select status::text from public.workspace_subscriptions where workspace_id = (select workspace_id from saas_ctx)), 'TRIALING',
  'novo workspace recebe período de teste');

insert into public.channels (id, workspace_id, display_name)
select channel_id, workspace_id, 'Canal SaaS' from saas_ctx;
insert into public.media_assets (id, workspace_id, original_filename, storage_key, mime_type, file_size_bytes, status)
select media_id, workspace_id, 'quota.mp4', workspace_id::text || '/' || media_id::text || '/original.mp4', 'video/mp4', 1000, 'READY' from saas_ctx;

insert into public.publication_jobs (id, workspace_id, channel_id, media_asset_id, created_by, status, scheduled_at, music_rights_confirmed)
select job_id, workspace_id, channel_id, media_id, '77777777-0000-0000-0000-000000000007', 'SCHEDULED', now() + interval '1 day', true from saas_ctx;

select is((select status::text from public.publication_quota_reservations where publication_job_id = (select job_id from saas_ctx)), 'RESERVED',
  'agendamento reserva uma publicação');
select is((select reserved_publications from public.workspace_usage_cycles where workspace_id = (select workspace_id from saas_ctx) order by created_at desc limit 1), 1,
  'reserva atualiza o ciclo');

update public.publication_jobs set status = 'PUBLISHED' where id = (select job_id from saas_ctx);
select is((select status::text from public.publication_quota_reservations where publication_job_id = (select job_id from saas_ctx)), 'CONSUMED',
  'publicação confirmada converte reserva em consumo');

insert into public.publication_jobs (id, workspace_id, channel_id, media_asset_id, created_by, status, scheduled_at, music_rights_confirmed)
select job2_id, workspace_id, channel_id, media_id, '77777777-0000-0000-0000-000000000007', 'SCHEDULED', now() + interval '2 day', true from saas_ctx;
update public.publication_jobs set scheduled_at = scheduled_at + interval '1 hour' where id = (select job2_id from saas_ctx);
select is((select count(*) from public.publication_quota_reservations where publication_job_id = (select job2_id from saas_ctx)), 1::bigint,
  'reagendamento do mesmo job não cria reserva duplicada');
update public.publication_jobs set status = 'FAILED' where id = (select job2_id from saas_ctx);
select is((select status::text from public.publication_quota_reservations where publication_job_id = (select job2_id from saas_ctx)), 'RELEASED',
  'falha definitiva libera a reserva');

select * from finish();
rollback;
