\ir _guard.psql

\if :audit_local_test
\else
  \echo 'ABORT: negative privilege tests are allowed only in the isolated local test database.'
  \quit 5
\endif

BEGIN;
SET LOCAL default_transaction_read_only = off;
-- SET SESSION AUTHORIZATION simulates an actual login identity. SET ROLE would
-- leave supabase_admin as session_user and let that superuser escalate in tests.
SET LOCAL SESSION AUTHORIZATION :"audit_role";

DO $$
DECLARE
  persistent_insert_denied boolean := false;
  persistent_update_denied boolean := false;
  persistent_delete_denied boolean := false;
  persistent_truncate_denied boolean := false;
  persistent_create_denied boolean := false;
  alter_denied boolean := false;
  drop_denied boolean := false;
  function_create_denied boolean := false;
  sensitive_select_denied boolean := false;
  admin_rpc_denied boolean := false;
  set_role_denied boolean := false;
  grant_denied boolean := false;
  revoke_denied boolean := false;
  create_policy_denied boolean := false;
  alter_role_denied boolean := false;
  alter_database_denied boolean := false;
  temp_created boolean := false;
BEGIN
  BEGIN EXECUTE 'INSERT INTO public.autoclip_sensitive_fixture VALUES (2)'; EXCEPTION WHEN insufficient_privilege THEN persistent_insert_denied := true; END;
  BEGIN EXECUTE 'UPDATE public.autoclip_sensitive_fixture SET value=2'; EXCEPTION WHEN insufficient_privilege THEN persistent_update_denied := true; END;
  BEGIN EXECUTE 'DELETE FROM public.autoclip_sensitive_fixture'; EXCEPTION WHEN insufficient_privilege THEN persistent_delete_denied := true; END;
  BEGIN EXECUTE 'TRUNCATE public.autoclip_sensitive_fixture'; EXCEPTION WHEN insufficient_privilege THEN persistent_truncate_denied := true; END;
  BEGIN EXECUTE 'CREATE TABLE public.autoclip_forbidden_table(id integer)'; EXCEPTION WHEN insufficient_privilege THEN persistent_create_denied := true; END;
  BEGIN EXECUTE 'ALTER TABLE public.autoclip_sensitive_fixture ADD COLUMN forbidden integer'; EXCEPTION WHEN insufficient_privilege THEN alter_denied := true; END;
  BEGIN EXECUTE 'DROP TABLE public.autoclip_sensitive_fixture'; EXCEPTION WHEN insufficient_privilege THEN drop_denied := true; END;
  BEGIN EXECUTE 'CREATE FUNCTION autoclip_audit.forbidden() RETURNS integer LANGUAGE sql AS ''SELECT 1'''; EXCEPTION WHEN insufficient_privilege THEN function_create_denied := true; END;
  BEGIN EXECUTE 'SELECT secret FROM public.autoclip_sensitive_fixture'; EXCEPTION WHEN insufficient_privilege THEN sensitive_select_denied := true; END;
  BEGIN EXECUTE 'SELECT public.autoclip_sensitive_admin_rpc()'; EXCEPTION WHEN insufficient_privilege THEN admin_rpc_denied := true; END;
  BEGIN EXECUTE 'SET ROLE postgres'; EXCEPTION WHEN insufficient_privilege THEN set_role_denied := true; END;
  BEGIN EXECUTE 'GRANT SELECT ON public.autoclip_sensitive_fixture TO PUBLIC'; EXCEPTION WHEN insufficient_privilege THEN grant_denied := true; END;
  BEGIN EXECUTE 'REVOKE SELECT ON public.autoclip_sensitive_fixture FROM PUBLIC'; EXCEPTION WHEN insufficient_privilege THEN revoke_denied := true; END;
  BEGIN EXECUTE 'CREATE POLICY forbidden_audit_policy ON public.autoclip_sensitive_fixture USING (true)'; EXCEPTION WHEN insufficient_privilege THEN create_policy_denied := true; END;
  BEGIN EXECUTE 'ALTER ROLE postgres SET application_name = ''forbidden'''; EXCEPTION WHEN insufficient_privilege THEN alter_role_denied := true; END;
  BEGIN EXECUTE format('ALTER DATABASE %I SET application_name = %L',current_database(),'forbidden'); EXCEPTION WHEN insufficient_privilege THEN alter_database_denied := true; END;
  BEGIN EXECUTE 'CREATE TEMP TABLE autoclip_temp_probe(id integer)'; temp_created := true; EXECUTE 'DROP TABLE autoclip_temp_probe'; EXCEPTION WHEN insufficient_privilege THEN temp_created := false; END;

  RAISE NOTICE 'AUDIT_ROLE_NEGATIVE_RESULTS %', jsonb_build_object(
    'insert_denied',persistent_insert_denied,'update_denied',persistent_update_denied,
    'delete_denied',persistent_delete_denied,'truncate_denied',persistent_truncate_denied,
    'create_table_denied',persistent_create_denied,'alter_denied',alter_denied,
    'drop_denied',drop_denied,'create_function_denied',function_create_denied,
    'sensitive_select_denied',sensitive_select_denied,'admin_rpc_denied',admin_rpc_denied,'set_role_denied',set_role_denied,
    'grant_denied',grant_denied,'revoke_denied',revoke_denied,'create_policy_denied',create_policy_denied,
    'alter_role_denied',alter_role_denied,'alter_database_denied',alter_database_denied,
    'temp_create_allowed',temp_created
  );
END;
$$;

ROLLBACK;
