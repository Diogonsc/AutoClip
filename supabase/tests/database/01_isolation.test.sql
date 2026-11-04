-- pgTAP: isolamento entre workspaces, papéis e travas da fila.
-- Rodar com: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- ---------------------------------------------------------------------
-- Setup (como postgres): 3 usuários. O trigger cria um workspace para cada.
-- A = dono do workspace A | B = dono do workspace B | C = VIEWER no workspace A
-- ---------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.dev'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.dev'),
  ('cccccccc-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@test.dev');

create temp table ctx (wa uuid, wb uuid, ca uuid, cb uuid, ma uuid);
insert into ctx (wa, wb)
select (select id from public.workspaces where owner_user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
       (select id from public.workspaces where owner_user_id = 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.workspace_members (workspace_id, user_id, role)
select wa, 'cccccccc-0000-0000-0000-000000000003', 'VIEWER' from ctx;

update ctx set ca = gen_random_uuid(), cb = gen_random_uuid(), ma = gen_random_uuid();

insert into public.channels (id, workspace_id, display_name)
select ca, wa, 'Canal A' from ctx
union all
select cb, wb, 'Canal B' from ctx;

insert into public.media_assets (id, workspace_id, original_filename, storage_key, mime_type, file_size_bytes, status, validation_status, checksum_sha256, detected_mime_type, detected_video_codec, validated_at, validator_version)
select ma, wa, 'a.mp4', wa::text || '/' || ma::text || '/original.mp4', 'video/mp4', 1000, 'READY', 'VALIDATED', repeat('a',64), 'video/mp4', 'h264', now(), 'fixture' from ctx;

grant select on ctx to authenticated, anon;

select ok(not has_table_privilege('authenticated','public.media_assets','INSERT'), 'cliente não pode criar mídias diretamente');
select ok(not has_function_privilege('authenticated','public.complete_media_validation(uuid,bigint,text,text,integer,integer,numeric,text)','EXECUTE'), 'cliente não pode emitir atestado de validação');
select ok((select not public from storage.buckets where id='media') and (select not public from storage.buckets where id='media-quarantine'), 'buckets final e quarentena são privados');

-- ---------------------------------------------------------------------
-- Como usuário A
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is((select count(*) from public.workspaces), 1::bigint,
  'A enxerga somente o próprio workspace');

select is((select count(*) from public.channels where id = (select cb from ctx)), 0::bigint,
  'A não enxerga canais do workspace B');

select throws_ok(
  format($q$insert into public.channels (workspace_id, display_name) values (%L, 'invasor')$q$, (select wb from ctx)),
  '42501', null, 'A não cria canal no workspace B');

select lives_ok(
  format($q$insert into public.channels (workspace_id, display_name) values (%L, 'Novo canal A')$q$, (select wa from ctx)),
  'A cria canal no próprio workspace');

select throws_ok(
  format($q$update public.channels set connection_status = 'CONNECTED' where id = %L$q$, (select ca from ctx)),
  '42501', null, 'A não consegue forçar connection_status (coluna sem grant)');

select throws_ok(
  $q$select * from public.oauth_connections$q$,
  '42501', null, 'A não lê oauth_connections (tokens)');

select throws_ok(
  format($q$insert into public.publication_jobs (workspace_id, channel_id, media_asset_id, created_by)
            values (%L, %L, %L, 'aaaaaaaa-0000-0000-0000-000000000001')$q$,
         (select wa from ctx), (select cb from ctx), (select ma from ctx)),
  '23503', null, 'Job não pode usar canal de outro workspace (FK composta)');

select throws_ok(
  format($q$insert into public.publication_jobs (workspace_id, channel_id, media_asset_id, status, music_rights_confirmed, created_by)
            values (%L, %L, %L, 'PROCESSING', true, 'aaaaaaaa-0000-0000-0000-000000000001')$q$,
         (select wa from ctx), (select ca from ctx), (select ma from ctx)),
  '42501', null, 'Usuário não cria job direto em PROCESSING');

select throws_ok(
  $q$select * from public.claim_publication_jobs(1, 'x')$q$,
  '42501', null, 'Usuário não executa o claim da fila');

select throws_ok(
  format($q$insert into public.media_assets(workspace_id,original_filename,storage_key,mime_type,file_size_bytes,created_by) values(%L,'bypass.png',%L,'image/png',50,'aaaaaaaa-0000-0000-0000-000000000001')$q$,
    (select wa from ctx), (select wa::text||'/'||gen_random_uuid()::text||'/original.png' from ctx)),
  '42501', null, 'cliente não cria diretamente registros de mídia');
select throws_ok(
  format($q$update public.media_assets set validation_status='VALIDATED',checksum_sha256=%L where id=%L$q$, repeat('b',64), (select ma from ctx)),
  '42501', null, 'cliente não grava atestado de validação');
select ok((public.begin_media_upload((select wa from ctx),'pending.png','image/png',100)->>'media_id') is not null,
  'upload inicia pelo RPC autorizado e permanece pendente');
select is((select validation_status from public.media_assets where original_filename='pending.png'), 'PENDING',
  'upload iniciado não se torna mídia aprovada');
select throws_ok(
  format($q$insert into public.publication_jobs(workspace_id,channel_id,media_asset_id,caption,scheduled_at,timezone,status,created_by,music_rights_confirmed)
    values(%L,%L,(select id from public.media_assets where original_filename='pending.png'),'bypass',now()+interval '1 day','UTC','SCHEDULED','aaaaaaaa-0000-0000-0000-000000000001',true)$q$,
    (select wa from ctx),(select ca from ctx)),
  '23514', null, 'mídia pendente não pode ser agendada pelo backend');
select throws_ok(
  format($q$select public.finalize_media(%L::uuid,null,null,null)$q$,(select ma from ctx)),
  '42501', null, 'cliente não pode executar a antiga RPC de promoção');

-- ---------------------------------------------------------------------
-- Como usuário C (VIEWER no workspace A)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);

select throws_ok(
  format($q$insert into public.channels (workspace_id, display_name) values (%L, 'viewer')$q$, (select wa from ctx)),
  '42501', null, 'VIEWER não cria canal');

select is((select count(*) from public.workspaces), 2::bigint,
  'C enxerga o próprio workspace e o workspace A (membro)');

-- O administrador pode excluir um canal mesmo quando houver publicações;
-- a FK remove o histórico operacional dependente junto com o canal.
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  format($q$
    insert into public.publication_jobs (workspace_id, channel_id, media_asset_id, created_by)
    values (%L, %L, %L, 'aaaaaaaa-0000-0000-0000-000000000001');
    delete from public.channels where id = %L;
  $q$, (select wa from ctx), (select ca from ctx), (select ma from ctx), (select ca from ctx)),
  'A exclui canal com publicação associada');

select is((select count(*) from public.publication_jobs where channel_id = (select ca from ctx)), 0::bigint,
  'exclusão do canal remove publicações associadas');

-- ---------------------------------------------------------------------
-- Como anônimo
-- ---------------------------------------------------------------------
reset role;
set local role anon;

select throws_ok(
  $q$select * from public.workspaces$q$,
  '42501', null, 'anon não acessa nenhuma tabela');

select * from finish();
rollback;
