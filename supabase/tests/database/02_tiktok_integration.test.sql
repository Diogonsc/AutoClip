-- pgTAP: OAuth, fila, lease, recuperação e resolução manual.
-- Rodar com: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

-- ---------------------------------------------------------------------
-- Setup (como postgres)
-- A = OWNER do workspace A | B = estranho | C = VIEWER em A | D = ADMIN em A
-- ---------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.dev'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.dev'),
  ('cccccccc-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@test.dev'),
  ('dddddddd-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@test.dev');

create temp table ctx (wa uuid);
insert into ctx select id from public.workspaces
 where owner_user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
grant select on ctx to authenticated;

create temp table st (state text);
grant all on st to authenticated;

insert into public.workspace_members (workspace_id, user_id, role)
select wa, 'cccccccc-0000-0000-0000-000000000003'::uuid, 'VIEWER'::public.workspace_role from ctx
union all
select wa, 'dddddddd-0000-0000-0000-000000000004'::uuid, 'ADMIN'::public.workspace_role from ctx;

insert into public.channels (id, workspace_id, display_name)
select '10000000-0000-0000-0000-00000000000a'::uuid, wa, 'Canal A' from ctx
union all
select '10000000-0000-0000-0000-00000000000b'::uuid, wa, 'Canal B' from ctx;

insert into public.media_assets (id, workspace_id, original_filename, storage_key, mime_type, file_size_bytes, status)
select '20000000-0000-0000-0000-000000000001', wa, 'a.mp4',
       wa::text || '/20000000-0000-0000-0000-000000000001/original.mp4', 'video/mp4', 1000, 'READY'
from ctx;

insert into public.publication_jobs (id, workspace_id, channel_id, media_asset_id, status, scheduled_at, created_by)
select '30000000-0000-0000-0000-000000000001', wa,
       '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001',
       'SCHEDULED', now() - interval '10 seconds', 'aaaaaaaa-0000-0000-0000-000000000001'
from ctx;

-- ---------------------------------------------------------------------
-- publish_mode: somente OWNER altera
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}', true);

select throws_ok(
  format($q$update public.workspace_settings set publish_mode = 'DIRECT' where workspace_id = %L$q$, (select wa from ctx)),
  '42501', null, 'ADMIN não altera publish_mode');

select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  format($q$update public.workspace_settings set publish_mode = 'DIRECT' where workspace_id = %L$q$, (select wa from ctx)),
  'OWNER altera publish_mode');

-- ---------------------------------------------------------------------
-- OAuth state
-- ---------------------------------------------------------------------
insert into st
select (public.create_oauth_state('10000000-0000-0000-0000-00000000000a', array['user.info.basic']) ->> 'state');

select is((select count(*) from st where length(state) = 64), 1::bigint,
  'state gerado com 256 bits (64 hex)');

select is(
  (select (public.create_oauth_state('10000000-0000-0000-0000-00000000000a', array['user.info.basic']) -> 'scopes') ? 'video.publish'),
  true, 'modo DIRECT pede video.publish');

update public.workspace_settings set publish_mode = 'INBOX' where workspace_id = (select wa from ctx);

select is(
  (select (public.create_oauth_state('10000000-0000-0000-0000-00000000000a', array['user.info.basic']) -> 'scopes') ? 'video.publish'),
  false, 'modo INBOX não pede video.publish');

select is(
  (select (public.create_oauth_state('10000000-0000-0000-0000-00000000000a', array['user.info.basic']) -> 'scopes') ? 'video.upload'),
  true, 'modo INBOX pede video.upload');

select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);

select throws_ok(
  $q$select public.create_oauth_state('10000000-0000-0000-0000-00000000000a', array['user.info.basic'])$q$,
  '42501', null, 'VIEWER não inicia OAuth');

select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);

select throws_ok(
  $q$select public.create_oauth_state('10000000-0000-0000-0000-00000000000a', array['user.info.basic'])$q$,
  '42501', null, 'usuário de outro workspace não inicia OAuth');

select throws_ok($q$select * from public.oauth_states$q$,
  '42501', null, 'usuário não lê oauth_states');

select throws_ok($q$select public.consume_oauth_state('x')$q$,
  '42501', null, 'usuário não consome state');

select throws_ok(
  $q$select public.finish_job('30000000-0000-0000-0000-000000000001', 'PUBLISHED')$q$,
  '42501', null, 'usuário não executa finish_job');

select throws_ok(
  $q$select * from public.claim_polling_jobs(1, 'x')$q$,
  '42501', null, 'usuário não executa claim_polling_jobs');

-- ---------------------------------------------------------------------
-- A partir daqui: backend (postgres/service_role)
-- ---------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);

select is((select public.consume_oauth_state((select state from st))) is not null, true,
  'state válido é consumido');
select is((select public.consume_oauth_state((select state from st))) is null, true,
  'state é de uso único');

insert into public.oauth_states (state, workspace_id, channel_id, user_id, required_scopes, expires_at)
select 'expired', wa, '10000000-0000-0000-0000-00000000000a',
       'aaaaaaaa-0000-0000-0000-000000000001', '{}', now() - interval '1 minute'
from ctx;
select is((select public.consume_oauth_state('expired')) is null, true, 'state expirado é rejeitado');

-- ---------------------------------------------------------------------
-- Conexão OAuth
-- ---------------------------------------------------------------------
select is(
  public.save_tiktok_connection('10000000-0000-0000-0000-00000000000a', 'open_1', array['video.upload'],
    'enc_a', 'enc_r', now() + interval '1 day', now() + interval '365 days'),
  'ok', 'conexão salva');

select is((select connection_status::text from public.channels where id = '10000000-0000-0000-0000-00000000000a'),
  'CONNECTED', 'canal fica CONNECTED');

select is(
  public.save_tiktok_connection('10000000-0000-0000-0000-00000000000b', 'open_1', array['video.upload'],
    'enc_a', 'enc_r', now() + interval '1 day', now() + interval '365 days'),
  'duplicate', 'mesma conta TikTok em outro canal do workspace é rejeitada');

select is((select count(*) from public.oauth_connections where channel_id = '10000000-0000-0000-0000-00000000000b'),
  0::bigint, 'duplicado não grava tokens');

-- ---------------------------------------------------------------------
-- Lease do worker
-- ---------------------------------------------------------------------
select is(public.acquire_worker_lease('w', '00000000-0000-0000-0000-00000000000a', 60), true, 'lease adquirido');
select is(public.acquire_worker_lease('w', '00000000-0000-0000-0000-00000000000b', 60), false, 'segundo worker não adquire');
update public.worker_leases set expires_at = now() - interval '1 second';
select is(public.acquire_worker_lease('w', '00000000-0000-0000-0000-00000000000b', 60), true, 'lease expirado é tomado');
select public.release_worker_lease('w', '00000000-0000-0000-0000-00000000000b');
select is((select count(*) from public.worker_leases), 0::bigint, 'lease liberado');

-- ---------------------------------------------------------------------
-- Fila: claim, refund, polling
-- ---------------------------------------------------------------------
select is((select count(*) from public.claim_publication_jobs(5, 'w1')), 0::bigint,
  'com publicação automática desligada nada é reivindicado');

update public.workspace_settings set auto_publish_enabled = true where workspace_id = (select wa from ctx);

select is((select count(*) from public.claim_publication_jobs(5, 'w1')), 1::bigint, 'job vencido é reivindicado');

select public.finish_job(
  p_job := '30000000-0000-0000-0000-000000000001', p_status := 'RETRY_WAIT',
  p_error_code := 'RATE_LIMIT', p_next_attempt_at := now() - interval '1 second',
  p_refund := true, p_result := 'RATE_LIMITED');

select is(
  (select attempt_count from public.publication_jobs where id = '30000000-0000-0000-0000-000000000001')
  + (select count(*) from public.publication_attempts where publication_job_id = '30000000-0000-0000-0000-000000000001')::int,
  0, 'refund devolve a tentativa (contador e histórico)');

select is((select count(*) from public.claim_publication_jobs(5, 'w1')), 1::bigint,
  'RETRY_WAIT vencido é reivindicado de novo');

select public.finish_job(
  p_job := '30000000-0000-0000-0000-000000000001', p_status := 'PROCESSING',
  p_remote_id := 'pub_1', p_next_attempt_at := now() - interval '1 second', p_result := 'UPLOADED');

select is((select count(*) from public.claim_polling_jobs(5, 'w1')), 1::bigint,
  'job com publish_id entra no polling');
select is((select count(*) from public.claim_polling_jobs(5, 'w2')), 0::bigint,
  'job em polling não é reivindicado duas vezes');

select public.finish_job(
  p_job := '30000000-0000-0000-0000-000000000001', p_status := 'PUBLISHED',
  p_result := 'PUBLISHED', p_remote_status := 'PUBLISH_COMPLETE',
  p_event_type := 'PUBLISH_COMPLETE');

select is((select result from public.publication_attempts
            where publication_job_id = '30000000-0000-0000-0000-000000000001' and attempt_number = 1),
  'PUBLISHED', 'tentativa encerrada com o resultado');

select ok((select count(*) from public.notifications where type = 'JOB_PUBLISHED') >= 1,
  'publicação gera notificação');

-- ---------------------------------------------------------------------
-- Recuperação de jobs presos
-- ---------------------------------------------------------------------
insert into public.publication_jobs (id, workspace_id, channel_id, media_asset_id, status, scheduled_at,
                                     remote_publish_id, locked_at, attempt_count, created_by)
select '30000000-0000-0000-0000-000000000002'::uuid, wa, '10000000-0000-0000-0000-00000000000a'::uuid,
       '20000000-0000-0000-0000-000000000001'::uuid, 'PROCESSING'::public.publication_status, now() - interval '2 hours',
       'pub_x', now() - interval '1 hour', 1, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid
from ctx
union all
select '30000000-0000-0000-0000-000000000003'::uuid, wa, '10000000-0000-0000-0000-00000000000a'::uuid,
       '20000000-0000-0000-0000-000000000001'::uuid, 'PROCESSING'::public.publication_status, now() - interval '2 hours',
       null::text, now() - interval '1 hour', 1, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid
from ctx;

insert into public.publication_attempts (workspace_id, publication_job_id, attempt_number)
select wa, '30000000-0000-0000-0000-000000000003', 1 from ctx;

select is(private.recover_stale_jobs(), 2, 'recuperação trata os dois jobs presos');

select is(
  (select status::text || ':' || (locked_at is null)::text from public.publication_jobs
    where id = '30000000-0000-0000-0000-000000000002'),
  'PROCESSING:true', 'com publish_id: libera para conferência de status');

select ok((select next_attempt_at <= now() from public.publication_jobs
            where id = '30000000-0000-0000-0000-000000000002'),
  'job recuperado fica pronto para polling automático');

select is((select status::text from public.publication_jobs where id = '30000000-0000-0000-0000-000000000003'),
  'UNKNOWN', 'sem publish_id: vira UNKNOWN (nunca reenvia sozinho)');

-- ---------------------------------------------------------------------
-- Resolução manual de UNKNOWN
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);

select throws_ok(
  $q$select public.resolve_unknown_job('30000000-0000-0000-0000-000000000003', 'NOT_PUBLISHED')$q$,
  '42501', null, 'VIEWER não resolve job UNKNOWN');

select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $q$select public.resolve_unknown_job('30000000-0000-0000-0000-000000000003', 'NOT_PUBLISHED')$q$,
  'EDITOR+ resolve como NOT_PUBLISHED');

select throws_ok(
  $q$select public.resolve_unknown_job('30000000-0000-0000-0000-000000000003', 'NOT_PUBLISHED')$q$,
  '22023', null, 'só resolve job que está UNKNOWN');

reset role;
select set_config('request.jwt.claims', '', true);
select is((select status::text from public.publication_jobs where id = '30000000-0000-0000-0000-000000000003'),
  'SCHEDULED', 'NOT_PUBLISHED reagenda o job');

-- ---------------------------------------------------------------------
-- Reagendamento manual zera tentativas; legenda limitada
-- ---------------------------------------------------------------------
insert into public.publication_jobs (id, workspace_id, channel_id, media_asset_id, status, scheduled_at,
                                     attempt_count, last_error_code, created_by)
select '30000000-0000-0000-0000-000000000005', wa, '10000000-0000-0000-0000-00000000000a',
       '20000000-0000-0000-0000-000000000001', 'BLOCKED_REAUTH', now() - interval '1 hour',
       2, 'REAUTH', 'aaaaaaaa-0000-0000-0000-000000000001'
from ctx;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

update public.publication_jobs
   set status = 'SCHEDULED', scheduled_at = now() + interval '1 day'
 where id = '30000000-0000-0000-0000-000000000005';

select throws_ok(
  format($q$insert into public.publication_jobs (workspace_id, channel_id, media_asset_id, caption, created_by)
            values (%L, '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001',
                    repeat('x', 2201), 'aaaaaaaa-0000-0000-0000-000000000001')$q$, (select wa from ctx)),
  '23514', null, 'legenda acima de 2200 caracteres é rejeitada');

reset role;
select set_config('request.jwt.claims', '', true);
select is((select attempt_count::text || ':' || coalesce(last_error_code, 'null')
             from public.publication_jobs where id = '30000000-0000-0000-0000-000000000005'),
  '0:null', 'reagendar um job bloqueado zera tentativas e erro');

-- ---------------------------------------------------------------------
-- attempt_number segue o histórico, não o contador
-- ---------------------------------------------------------------------
insert into public.publication_jobs (id, workspace_id, channel_id, media_asset_id, status, scheduled_at,
                                     attempt_count, created_by)
select '30000000-0000-0000-0000-000000000006', wa, '10000000-0000-0000-0000-00000000000a',
       '20000000-0000-0000-0000-000000000001', 'DRAFT', now() - interval '1 hour',
       0, 'aaaaaaaa-0000-0000-0000-000000000001'
from ctx;
update public.publication_jobs set status = 'RETRY_WAIT' where id = '30000000-0000-0000-0000-000000000006';
insert into public.publication_attempts (workspace_id, publication_job_id, attempt_number, finished_at, result)
select wa, '30000000-0000-0000-0000-000000000006', n, now(), 'FAILED' from ctx, generate_series(1, 2) n;

select is((select count(*) from public.claim_publication_jobs(1, 'w3')), 1::bigint, 'job com histórico é reivindicado');
select is((select max(attempt_number) from public.publication_attempts
            where publication_job_id = '30000000-0000-0000-0000-000000000006'),
  3, 'nova tentativa recebe o próximo número do histórico');

select * from finish();
rollback;
