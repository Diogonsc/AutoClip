\set ON_ERROR_STOP on
\ir _guard.psql
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
SELECT jsonb_build_object(
  'section','rls_policies',
  'relations',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'relation',c.relname,'owner',pg_catalog.pg_get_userbyid(c.relowner),
      'enabled',c.relrowsecurity,'forced',c.relforcerowsecurity,
      'policy_count',(SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid))
      ORDER BY n.nspname,c.relname)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p')),'[]'::jsonb),
  'policies',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'relation',c.relname,'name',p.polname,
      'command',p.polcmd,'permissive',p.polpermissive,
      'roles',(SELECT coalesce(jsonb_agg(CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(role_oid) END),'[]'::jsonb)
               FROM unnest(p.polroles) AS role_oid),
      'using_expression',pg_catalog.pg_get_expr(p.polqual,p.polrelid),
      'check_expression',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))
      ORDER BY n.nspname,c.relname,p.polname)
    FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace),'[]'::jsonb)
);
COMMIT;
