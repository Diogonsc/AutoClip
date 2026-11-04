-- pgTAP: historical Shop jobs stay stored and are ineligible for both claims.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, instance_id, aud, role, email) values
  ('98989898-0000-0000-0000-000000000018', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shop-jobs@test.dev');

create temp table shop_job_ctx (
  workspace_id uuid, channel_id uuid, media_id uuid,
  shop_publish_id uuid, shop_poll_id uuid, login_publish_id uuid
);
insert into shop_job_ctx
select w.id, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
from public.workspaces w where w.owner_user_id = '98989898-0000-0000-0000-000000000018';

update public.workspace_settings
set auto_publish_enabled = true
where workspace_id = (select workspace_id from shop_job_ctx);

insert into public.channels (id, workspace_id, display_name)
select channel_id, workspace_id, 'Synthetic Shop isolation test' from shop_job_ctx;

insert into public.media_assets (
  id, workspace_id, original_filename, storage_key, mime_type, file_size_bytes,
  status, validation_status, checksum_sha256, detected_mime_type,
  detected_video_codec, validated_at, validator_version
)
select media_id, workspace_id, 'synthetic.mp4', workspace_id::text || '/' || media_id::text || '/original.mp4',
       'video/mp4', 100, 'READY', 'VALIDATED', repeat('a',64), 'video/mp4',
       'h264', now(), 'pgTAP fixture'
from shop_job_ctx;

-- These rows model legacy jobs that existed before the disable migration.
-- They carry Shop remote identifiers but no new Shop metadata writes.
insert into public.publication_jobs (
  id, workspace_id, channel_id, media_asset_id, status, scheduled_at,
  remote_publish_id, created_by, music_rights_confirmed
)
select shop_publish_id, workspace_id, channel_id, media_id, 'SCHEDULED'::public.publication_status, now() - interval '1 minute',
       'shop:synthetic-publish', '98989898-0000-0000-0000-000000000018'::uuid, true
from shop_job_ctx
union all
select shop_poll_id, workspace_id, channel_id, media_id, 'PROCESSING'::public.publication_status, now() - interval '2 minutes',
       'shop:synthetic-poll', '98989898-0000-0000-0000-000000000018'::uuid, true
from shop_job_ctx
union all
select login_publish_id, workspace_id, channel_id, media_id, 'SCHEDULED'::public.publication_status, now() - interval '1 minute',
       null, '98989898-0000-0000-0000-000000000018'::uuid, true
from shop_job_ctx;

select is((select count(*) from public.publication_jobs where id in
  ((select shop_publish_id from shop_job_ctx), (select shop_poll_id from shop_job_ctx))),
  2::bigint, 'both legacy Shop jobs remain stored');

select is((select count(*) from public.claim_publication_jobs(20, 'gate3196-pgTAP')),
  1::bigint, 'publication claim returns only the eligible Login Kit job');

select is((select status::text || ':' || attempt_count::text from public.publication_jobs
  where id = (select shop_publish_id from shop_job_ctx)),
  'SCHEDULED:0', 'Shop publish job remains unclaimed with attempt count unchanged');

select is((select count(*) from public.claim_polling_jobs(20, 'gate3196-pgTAP')),
  0::bigint, 'polling claim does not return a Shop job');

select is((select status::text || ':' || coalesce(locked_at::text, 'null') from public.publication_jobs
  where id = (select shop_poll_id from shop_job_ctx)),
  'PROCESSING:null', 'Shop polling job remains preserved and unlocked');

select is((select status::text from public.publication_jobs
  where id = (select login_publish_id from shop_job_ctx)),
  'PROCESSING', 'normal Login Kit job remains eligible for claim');

select throws_ok($$
  update public.publication_jobs
     set shop_product_id = gen_random_uuid(), shop_anchor_title = 'Synthetic'
   where id = (select login_publish_id from shop_job_ctx)
$$, '55000', null, 'trigger rejects Shop metadata on a valid media job');

select * from finish();
rollback;
