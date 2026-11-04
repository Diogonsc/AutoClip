-- pgTAP: grupos por workspace e confirmação atômica/idempotente de lote.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email) values
  ('99999999-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'batch-a@test.dev'),
  ('99999999-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'batch-b@test.dev');
create temp table batch_ctx (wa uuid, wb uuid, ca uuid, cb uuid, ma uuid, mb uuid, ga uuid);
insert into batch_ctx
select (select id from public.workspaces where owner_user_id = '99999999-0000-0000-0000-000000000011'),
       (select id from public.workspaces where owner_user_id = '99999999-0000-0000-0000-000000000012'),
       gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid();
insert into public.channels(id, workspace_id, display_name, connection_status)
select ca, wa, 'A', 'CONNECTED'::public.channel_status from batch_ctx union all select cb, wb, 'B', 'CONNECTED'::public.channel_status from batch_ctx;
insert into public.media_assets(id, workspace_id, original_filename, storage_key, mime_type, file_size_bytes, status, validation_status, checksum_sha256, detected_mime_type, detected_video_codec, validated_at, validator_version)
select ma, wa, 'a.mp4', wa::text || '/' || ma::text || '/original.mp4', 'video/mp4', 10, 'READY'::public.media_status, 'VALIDATED', repeat('a',64), 'video/mp4', 'h264', now(), 'fixture' from batch_ctx union all
select mb, wa, 'b.mp4', wa::text || '/' || mb::text || '/original.mp4', 'video/mp4', 10, 'READY'::public.media_status, 'VALIDATED', repeat('a',64), 'video/mp4', 'h264', now(), 'fixture' from batch_ctx;
insert into public.account_groups(id, workspace_id, name, created_by) select ga, wa, 'Principais', '99999999-0000-0000-0000-000000000011' from batch_ctx;
insert into public.account_group_members(workspace_id, group_id, channel_id) select wa, ga, ca from batch_ctx;
grant select on batch_ctx to authenticated;

select is((select count(*) from public.account_group_members where group_id = (select ga from batch_ctx)), 1::bigint, 'canal pertence ao grupo');
select throws_ok($$insert into public.account_group_members(workspace_id, group_id, channel_id)
  select wa, ga, cb from batch_ctx$$, '23503', null, 'não associa canal de outro workspace ao grupo');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-0000-0000-0000-000000000011","role":"authenticated"}', true);
select is((select count(*) from public.account_groups), 1::bigint, 'RLS mostra apenas grupos do workspace');
select lives_ok($$
  select public.confirm_publication_batch((select wa from batch_ctx), '99999999-0000-0000-0000-000000000099',
    jsonb_build_array(
      jsonb_build_object('channel_id',(select ca from batch_ctx),'media_asset_id',(select ma from batch_ctx),'scheduled_at',(now()+interval '1 day')::text,'timezone','America/Sao_Paulo','caption','A','music_rights_confirmed',true),
      jsonb_build_object('channel_id',(select ca from batch_ctx),'media_asset_id',(select mb from batch_ctx),'scheduled_at',(now()+interval '1 day 30 minutes')::text,'timezone','America/Sao_Paulo','caption','B','music_rights_confirmed',true)),
    '{"strategy":"SEQUENTIAL"}'::jsonb)
$$, 'editor/owner confirma lote válido');
select is((select count(*) from public.publication_jobs where batch_id is not null), 2::bigint, 'lote cria todos os jobs');
select is((select reserved_publications from public.workspace_usage_cycles where workspace_id = (select wa from batch_ctx) order by created_at desc limit 1), 2, 'lote reserva quota para todos os itens');
select is((select (public.confirm_publication_batch((select wa from batch_ctx), '99999999-0000-0000-0000-000000000099', '[]'::jsonb)->>'item_count')::integer), 2, 'mesma chave retorna lote idempotente sem recriar jobs');
select throws_ok($$
  select public.confirm_publication_batch((select wb from batch_ctx), gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('channel_id',(select ca from batch_ctx),'media_asset_id',(select ma from batch_ctx),'scheduled_at',(now()+interval '2 days')::text,'music_rights_confirmed',true)))
$$, '42501', null, 'usuário não confirma lote em outro workspace');
select * from finish();
rollback;
