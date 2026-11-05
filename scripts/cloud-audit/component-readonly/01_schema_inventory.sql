\set ON_ERROR_STOP on
\ir _guard.psql
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
SELECT jsonb_build_object(
  'section','schema_inventory',
  'schemas',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'name',n.nspname,'owner',pg_catalog.pg_get_userbyid(n.nspowner),
      'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
        'privilege',a.privilege_type,'grantable',a.is_grantable)
        ORDER BY a.grantee,a.privilege_type),'[]'::jsonb)
        FROM pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a),
      'object_count',(SELECT count(*) FROM pg_catalog.pg_class c WHERE c.relnamespace=n.oid))
      ORDER BY n.nspname)
    FROM pg_catalog.pg_namespace n),'[]'::jsonb),
  'relations',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'name',c.relname,'kind',c.relkind,
      'owner',pg_catalog.pg_get_userbyid(c.relowner),'row_security',c.relrowsecurity,
      'force_row_security',c.relforcerowsecurity,
      'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object(
          'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull)
          ORDER BY a.attnum),'[]'::jsonb)
        FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
      'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object(
          'name',con.conname,'type',con.contype,'definition',pg_catalog.pg_get_constraintdef(con.oid,true))
          ORDER BY con.conname),'[]'::jsonb) FROM pg_catalog.pg_constraint con WHERE con.conrelid=c.oid),
      'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object(
          'name',ix.relname,'valid',i.indisvalid,'ready',i.indisready,'definition',pg_catalog.pg_get_indexdef(i.indexrelid))
          ORDER BY ix.relname),'[]'::jsonb)
        FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid WHERE i.indrelid=c.oid),
      'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object(
          'name',t.tgname,'enabled',t.tgenabled,'function_schema',pn.nspname,'function',p.proname,
          'definition',pg_catalog.pg_get_triggerdef(t.oid,true))
          ORDER BY t.tgname),'[]'::jsonb)
        FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
          JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
        WHERE t.tgrelid=c.oid AND NOT t.tgisinternal))
      ORDER BY n.nspname,c.relname)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p','v','m','f','S')),'[]'::jsonb)
);
COMMIT;
