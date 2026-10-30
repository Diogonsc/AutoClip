-- pgTAP: tokens do TikTok Shop nunca são retornados para clientes autenticados.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, instance_id, aud, role, email) values
  ('eeeeeeee-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shop-owner@test.dev'),
  ('ffffffff-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shop-outsider@test.dev');

create temp table shop_ctx (workspace_id uuid, channel_id uuid, connection_id uuid);
insert into shop_ctx
select w.id, gen_random_uuid(), gen_random_uuid()
from public.workspaces w
where w.owner_user_id = 'eeeeeeee-0000-0000-0000-000000000005';

insert into public.channels (id, workspace_id, display_name)
select channel_id, workspace_id, 'Canal Shop' from shop_ctx;

insert into public.tiktok_shop_connections (
  id, workspace_id, channel_id, connection_status, encrypted_access_token, encrypted_refresh_token
)
select connection_id, workspace_id, channel_id, 'CONNECTED', 'ciphertext-access', 'ciphertext-refresh'
from shop_ctx;

grant select on shop_ctx to authenticated;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}', true);

select throws_ok(
  $q$select * from public.tiktok_shop_connections$q$,
  '42501', null, 'cliente autenticado não lê a tabela que contém tokens'
);

select is(
  (select count(*) from public.list_tiktok_shop_connections((select workspace_id from shop_ctx))),
  1::bigint,
  'cliente autorizado recebe o resumo seguro da conexão'
);

select is(
  (select to_jsonb(s) ? 'encrypted_access_token'
   from public.list_tiktok_shop_connections((select workspace_id from shop_ctx)) s),
  false,
  'o resumo não contém access token cifrado'
);

select is(
  (select to_jsonb(s) ? 'encrypted_refresh_token'
   from public.list_tiktok_shop_connections((select workspace_id from shop_ctx)) s),
  false,
  'o resumo não contém refresh token cifrado'
);

select set_config('request.jwt.claims',
  '{"sub":"ffffffff-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok(
  format($q$select * from public.list_tiktok_shop_connections(%L)$q$, (select workspace_id from shop_ctx)),
  '42501', null, 'usuário de outro workspace não consulta o resumo'
);

select * from finish();
rollback;
