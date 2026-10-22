-- pgTAP: isolamento entre workspaces, papéis e travas da fila.
-- Rodar com: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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

insert into public.media_assets (id, workspace_id, original_filename, storage_key, mime_type, file_size_bytes, status)
select ma, wa, 'a.mp4', wa::text || '/' || ma::text || '/original.mp4', 'video/mp4', 1000, 'READY' from ctx;

grant select on ctx to authenticated, anon;

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
  format($q$insert into public.publication_jobs (workspace_id, channel_id, media_asset_id, status, created_by)
            values (%L, %L, %L, 'PROCESSING', 'aaaaaaaa-0000-0000-0000-000000000001')$q$,
         (select wa from ctx), (select ca from ctx), (select ma from ctx)),
  '42501', null, 'Usuário não cria job direto em PROCESSING');

select throws_ok(
  $q$select * from public.claim_publication_jobs(1, 'x')$q$,
  '42501', null, 'Usuário não executa o claim da fila');

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
