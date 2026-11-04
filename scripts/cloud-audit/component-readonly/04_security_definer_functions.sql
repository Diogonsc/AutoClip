\set ON_ERROR_STOP on
\ir _guard.psql
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
SELECT jsonb_build_object(
  'section','security_definer_functions',
  'routines',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'name',p.proname,'identity_arguments',pg_catalog.pg_get_function_identity_arguments(p.oid),
      'kind',p.prokind,'language',l.lanname,'owner',pg_catalog.pg_get_userbyid(p.proowner),
      'security_definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,
      'configuration',p.proconfig,
      'public_execute',EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
                              WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),
      'anon_execute',coalesce(pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),false),
      'authenticated_execute',coalesce(pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),false))
      ORDER BY n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid))
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang
    WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')),'[]'::jsonb),
  'definition_bodies_included',false,
  'note','Routine source text is intentionally omitted; review definitions from versioned local migrations.'
);
COMMIT;
