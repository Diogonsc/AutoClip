-- pgTAP: fundação local de persistência do Seller OAuth.
-- Executar somente contra Supabase local descartável: supabase test db.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users (id, instance_id, aud, role, email) values
  ('19000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seller-owner-a@test.invalid'),
  ('19000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seller-owner-b@test.invalid'),
  ('19000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seller-viewer@test.invalid');

create temporary table seller_ctx (
  workspace_a uuid,
  workspace_b uuid,
  state_a uuid,
  state_failed uuid,
  connection_a uuid
);

insert into seller_ctx(workspace_a, workspace_b)
select
  (select id from public.workspaces where owner_user_id = '19000000-0000-0000-0000-000000000001'),
  (select id from public.workspaces where owner_user_id = '19000000-0000-0000-0000-000000000002');

insert into public.workspace_members(workspace_id, user_id, role)
select workspace_a, '19000000-0000-0000-0000-000000000003', 'VIEWER'::public.workspace_role
from seller_ctx;
grant select on seller_ctx to authenticated, anon, service_role;
grant update on seller_ctx to authenticated, service_role;

select ok(has_function_privilege('authenticated', 'public.create_seller_oauth_state(uuid,text,uuid)', 'EXECUTE'),
  'usuário autenticado pode iniciar state, sujeito a can_edit');
select ok(not has_function_privilege('authenticated', 'public.claim_seller_oauth_state(text)', 'EXECUTE'),
  'usuário autenticado não pode fazer claim de state');
select ok(not has_function_privilege('anon', 'public.create_seller_oauth_state(uuid,text,uuid)', 'EXECUTE'),
  'anon não pode iniciar state');
select ok(not has_function_privilege('authenticated', 'public.save_seller_connection_metadata(uuid,text,text,text,text[])', 'EXECUTE'),
  'usuário autenticado não persiste metadados Seller');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"19000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
update seller_ctx
set state_a = public.create_seller_oauth_state(workspace_a, repeat('a', 64));
select ok((select state_a is not null from seller_ctx), 'OWNER cria state associado ao próprio workspace');
select throws_ok(
  format('select public.create_seller_oauth_state(%L::uuid, %L)', (select workspace_b from seller_ctx), repeat('b', 64)),
  '42501', null, 'OWNER não cria state para outro workspace');
select throws_ok('select * from public.seller_oauth_states', '42501', null,
  'state OAuth não é legível diretamente pelo usuário autenticado');
reset role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  format('select public.claim_seller_oauth_state(%L)', repeat('a', 64)),
  'service_role faz claim atômico do state pendente');
select is((select status::text from public.seller_oauth_states where id = (select state_a from seller_ctx)), 'CLAIMED',
  'claim altera o state para CLAIMED');
select throws_ok(
  format('select public.claim_seller_oauth_state(%L)', repeat('a', 64)),
  '42501', null, 'replay do claim é rejeitado');
select lives_ok(
  format('update seller_ctx set connection_a = public.complete_seller_oauth_state(%L::uuid, %L, %L, %L, array[%L])',
    (select state_a from seller_ctx), 'seller-open-a', 'Seller A', 'BR', 'seller.product.basic'),
  'state claimed pode ser concluído pelo backend privilegiado');
select is((select status::text from public.seller_oauth_states where id = (select state_a from seller_ctx)), 'COMPLETED',
  'conclusão deixa state em terminal COMPLETED');
select throws_ok(
  format('select public.complete_seller_oauth_state(%L::uuid, %L, %L, %L, array[%L])',
    (select state_a from seller_ctx), 'seller-open-a', 'Seller A', 'BR', 'seller.product.basic'),
  '42501', null, 'state concluído não pode ser reutilizado');

insert into public.seller_oauth_states(workspace_id, initiated_by, state_hash, expires_at)
select workspace_a, '19000000-0000-0000-0000-000000000001', repeat('f', 64), now() + interval '10 minutes'
from seller_ctx;
select lives_ok(format('select public.claim_seller_oauth_state(%L)', repeat('f', 64)),
  'claim antecede conclusão atômica com credenciais cifradas');
select lives_ok(format($q$select public.complete_seller_oauth_authorization(
  (select id from public.seller_oauth_states where state_hash=%L),
  '20000000-0000-0000-0000-000000000002'::uuid, 'seller-open-atomic', 'Atomic', 'BR',
  array['seller.product.basic'], 'v1:iv:cipher-access', 'v1:iv:cipher-refresh',
  now()+interval '1 day', now()+interval '2 days', 1::smallint)$q$, repeat('f', 64)),
  'metadados, credenciais e state são concluídos pela RPC atômica');
select is((select status::text from public.seller_oauth_states where state_hash = repeat('f', 64)), 'COMPLETED',
  'conclusão atômica fecha o state');
select is((select count(*) from public.seller_credentials where connection_id = '20000000-0000-0000-0000-000000000002'), 1::bigint,
  'conclusão atômica persiste uma credencial ciphertext');

insert into public.seller_oauth_states(workspace_id, initiated_by, state_hash, expires_at)
select workspace_a, '19000000-0000-0000-0000-000000000001', repeat('g', 64), now() + interval '10 minutes'
from seller_ctx;
select lives_ok(format('select public.claim_seller_oauth_state(%L)', repeat('g', 64)),
  'state de falha é claimed antes da validação de payload');
select throws_ok(format($q$select public.complete_seller_oauth_authorization(
  (select id from public.seller_oauth_states where state_hash=%L),
  '20000000-0000-0000-0000-000000000003'::uuid, 'seller-open-invalid', 'Invalid', 'BR',
  array['seller.product.basic'], '', 'v1:iv:cipher-refresh',
  now()+interval '1 day', now()+interval '2 days', 1::smallint)$q$, repeat('g', 64)),
  '22023', null, 'payload de credencial inválido não cria conexão parcial');
select is((select count(*) from public.seller_connections where seller_open_id = 'seller-open-invalid'), 0::bigint,
  'falha de conclusão não persiste conexão parcial');

insert into public.seller_oauth_states(workspace_id, initiated_by, state_hash, expires_at, created_at)
select workspace_a, '19000000-0000-0000-0000-000000000001', repeat('c', 64), now() - interval '1 minute', now() - interval '2 minutes'
from seller_ctx;
select throws_ok(format('select public.claim_seller_oauth_state(%L)', repeat('c', 64)), '42501', null,
  'state expirado é rejeitado');

insert into public.seller_oauth_states(workspace_id, initiated_by, state_hash, expires_at)
select workspace_a, '19000000-0000-0000-0000-000000000001', repeat('d', 64), now() + interval '10 minutes'
from seller_ctx;
select lives_ok(format('select public.claim_seller_oauth_state(%L)', repeat('d', 64)), 'claim do state que será marcado como falho');
update seller_ctx set state_failed = (select id from public.seller_oauth_states where state_hash = repeat('d', 64));
select lives_ok(format('select public.fail_seller_oauth_state(%L::uuid)', (select state_failed from seller_ctx)),
  'falha após claim é registrada');
select throws_ok(format('select public.claim_seller_oauth_state(%L)', repeat('d', 64)), '42501', null,
  'state FAILED não é reaberto após falha');
select throws_ok(
  format('update public.seller_oauth_states set status = %L where id = %L::uuid', 'PENDING', (select state_failed from seller_ctx)),
  '42501', null, 'trigger impede reabertura de state terminal');

select lives_ok(
  format($q$select public.upsert_seller_authorized_shops(%L::uuid, %L::uuid,
    '[{"shop_id":"7495028847767946451","shop_cipher":"sanitized","shop_name":"Sandbox","region":"BR"}]'::jsonb)$q$,
    (select workspace_a from seller_ctx), (select connection_a from seller_ctx)),
  'backend persiste loja autorizada com conexão do mesmo workspace');
select throws_ok(
  format($q$insert into public.seller_shops(workspace_id, connection_id, shop_id, shop_cipher)
    values (%L::uuid, %L::uuid, 'cross-workspace', 'cipher')$q$,
    (select workspace_b from seller_ctx), (select connection_a from seller_ctx)),
  '23503', null, 'FK composta impede loja em workspace diferente da conexão');
select throws_ok(
  format($q$insert into public.seller_audit_events(workspace_id, connection_id, event_type, metadata)
    values (%L::uuid, %L::uuid, 'OAUTH_STARTED', '{"access_token":"forbidden"}'::jsonb)$q$,
    (select workspace_a from seller_ctx), (select connection_a from seller_ctx)),
  '23514', null, 'constraint impede segredo em evento de auditoria');
select is((public.acquire_seller_credential_refresh(
  '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002'
) ->> 'state'), 'ACQUIRED', 'primeiro worker adquire lease Seller');
select is((public.acquire_seller_credential_refresh(
  '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003'
) ->> 'state'), 'BUSY', 'segundo worker não adquire lease ativo');
select ok((public.read_seller_refresh_credential(
  '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 1
) ->> 'refresh_ciphertext') is not null, 'somente service_role lê ciphertext sob lease válido');
select is(public.complete_seller_credential_refresh(
  '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 0, 1,
  'v1:iv:new-access', 'v1:iv:new-refresh', now()+interval '1 day', now()+interval '2 days'
), false, 'fencing token antigo não sobrescreve credencial');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"19000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.seller_connections), 0::bigint,
  'membro de outro workspace não vê conexões Seller');
select is((select count(*) from public.seller_shops), 0::bigint,
  'membro de outro workspace não vê lojas Seller');
select throws_ok('select * from public.seller_credentials', '42501', null,
  'credenciais cifradas não são legíveis por authenticated');
reset role;

set local role anon;
select throws_ok('select * from public.seller_connections', '42501', null,
  'anon não acessa metadados Seller');
reset role;

select * from finish();
rollback;
