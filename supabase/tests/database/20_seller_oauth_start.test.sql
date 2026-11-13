begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, instance_id, aud, role, email) values
  ('29000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seller-start-a@test.invalid'),
  ('29000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seller-start-b@test.invalid');

create temporary table start_ctx (workspace_a uuid, workspace_b uuid);
insert into start_ctx
select
  (select id from public.workspaces where owner_user_id = '29000000-0000-0000-0000-000000000001'),
  (select id from public.workspaces where owner_user_id = '29000000-0000-0000-0000-000000000002');
grant select on start_ctx to authenticated, anon;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"29000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  format('select public.create_seller_oauth_state(%L::uuid, %L)', (select workspace_a from start_ctx), repeat('a', 64)),
  'membro editor cria um único state hash válido'
);
select throws_ok(
  format('select public.create_seller_oauth_state(%L::uuid, %L)', (select workspace_a from start_ctx), repeat('b', 64)),
  '23505', 'seller authorization already pending', 'segundo state ativo do mesmo usuário/workspace é bloqueado'
);
select throws_ok(
  format('select public.create_seller_oauth_state(%L::uuid, %L)', (select workspace_b from start_ctx), repeat('c', 64)),
  '42501', 'forbidden', 'usuário não enumera/cria state em outro workspace'
);
select throws_ok(
  format('select public.create_seller_oauth_state(%L::uuid, %L)', (select workspace_a from start_ctx), 'not-a-sha256'),
  '22023', 'invalid state hash', 'hash inválido é rejeitado'
);
reset role;

set local role anon;
select throws_ok(
  format('select public.create_seller_oauth_state(%L::uuid, %L)', (select workspace_a from start_ctx), repeat('d', 64)),
  '42501', 'permission denied for function create_seller_oauth_state', 'anon não inicia OAuth Seller'
);
reset role;

select * from finish();
rollback;
