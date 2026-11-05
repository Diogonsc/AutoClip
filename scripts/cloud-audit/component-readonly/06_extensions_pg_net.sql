\set ON_ERROR_STOP on
\ir _guard.psql
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
SELECT jsonb_build_object(
  'section','extensions_and_pg_net',
  'extensions',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name',e.extname,'version',e.extversion,'schema',n.nspname)
      ORDER BY e.extname),'[]'::jsonb)
    FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace),
  'pg_net_routines',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'name',p.proname,'identity_arguments',pg_catalog.pg_get_function_identity_arguments(p.oid),
      'owner',pg_catalog.pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'configuration',p.proconfig,
      'public_execute',coalesce(pg_catalog.has_function_privilege('public',p.oid,'EXECUTE'),false),
      'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object(
          'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
          'privilege',a.privilege_type,'grantable',a.is_grantable)
          ORDER BY a.grantee,a.privilege_type),'[]'::jsonb)
        FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a))
      ORDER BY n.nspname,p.proname),'[]'::jsonb)
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('net','extensions') AND (n.nspname='net' OR p.proname ILIKE '%http%')),
  'pg_net_table_catalog',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'relation',c.relname,'kind',c.relkind,'rls',c.relrowsecurity,
      'force_rls',c.relforcerowsecurity,'policy_count',(SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid))
      ORDER BY n.nspname,c.relname),'[]'::jsonb)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('net','extensions') AND c.relkind IN ('r','p','v','m','f')),
  'http_calls_executed',false,'extension_rows_read',false
);
COMMIT;
