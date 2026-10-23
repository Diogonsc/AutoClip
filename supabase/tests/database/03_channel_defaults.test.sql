-- pgTAP: idioma, país e legenda/hashtags padrão do canal.
-- Rodar com: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- A = OWNER do workspace A | B = estranho | C = VIEWER em A
insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.dev'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.dev'),
  ('cccccccc-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@test.dev');

create temp table ctx (wa uuid, ca uuid);
insert into ctx select id, gen_random_uuid() from public.workspaces
 where owner_user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
grant select on ctx to authenticated;

insert into public.workspace_members (workspace_id, user_id, role)
select wa, 'cccccccc-0000-0000-0000-000000000003', 'VIEWER' from ctx;

insert into public.channels (id, workspace_id, display_name)
select ca, wa, 'Canal A' from ctx;

-- Como dono (A)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  format($q$update public.channels
            set language = 'pt-BR', country = 'BR',
                default_caption = 'Boa noite.', default_hashtags = '#fe #motivacao'
            where id = %L$q$, (select ca from ctx)),
  'dono edita idioma, país, legenda e hashtags padrão');

select is((select country from public.channels where id = (select ca from ctx)), 'BR',
  'país gravado');

select is((select default_hashtags from public.channels where id = (select ca from ctx)), '#fe #motivacao',
  'hashtags gravadas');

select throws_ok(
  format($q$update public.channels set country = 'brasil' where id = %L$q$, (select ca from ctx)),
  '23514', null, 'país fora do padrão ISO (2 letras maiúsculas) é recusado');

select throws_ok(
  format($q$update public.channels set language = 'português do brasil' where id = %L$q$, (select ca from ctx)),
  '23514', null, 'idioma fora do padrão é recusado');

select throws_ok(
  format($q$update public.channels set default_caption = repeat('a', 2201) where id = %L$q$, (select ca from ctx)),
  '23514', null, 'legenda padrão acima de 2200 caracteres é recusada');

select throws_ok(
  format($q$update public.channels set default_hashtags = repeat('#', 501) where id = %L$q$, (select ca from ctx)),
  '23514', null, 'hashtags acima de 500 caracteres são recusadas');

select lives_ok(
  format($q$update public.channels set language = null, country = null where id = %L$q$, (select ca from ctx)),
  'idioma e país podem ser limpos');

-- Como leitor (C): não edita
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);

update public.channels set default_caption = 'invasor' where id = (select ca from ctx);

select is((select default_caption from public.channels where id = (select ca from ctx)), 'Boa noite.',
  'leitor não altera a legenda padrão (RLS: o update não afeta nenhuma linha)');

-- Como estranho (B): não vê o canal
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is((select count(*) from public.channels where id = (select ca from ctx)), 0::bigint,
  'estranho não enxerga o canal nem os padrões dele');

select * from finish();
rollback;
