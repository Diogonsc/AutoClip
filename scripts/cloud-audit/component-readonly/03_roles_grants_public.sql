\set ON_ERROR_STOP on
\ir _guard.psql
BEGIN READ ONLY;
SET LOCAL statement_timeout='25s';
SET LOCAL lock_timeout='2s';
SELECT jsonb_build_object(
  'section','roles_grants_public',
  'roles',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name',r.rolname,'login',r.rolcanlogin,'superuser',r.rolsuper,'create_role',r.rolcreaterole,
      'create_db',r.rolcreatedb,'replication',r.rolreplication,'bypass_rls',r.rolbypassrls,
      'inherit',r.rolinherit,'connection_limit',r.rolconnlimit,'valid_until',r.rolvaliduntil)
      ORDER BY r.rolname),'[]'::jsonb) FROM pg_catalog.pg_roles r),
  'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'granted_role',parent.rolname,'member',member.rolname,
      'admin_option',m.admin_option,'inherit_option',m.inherit_option,'set_option',m.set_option)
      ORDER BY parent.rolname,member.rolname),'[]'::jsonb)
    FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles parent ON parent.oid=m.roleid
      JOIN pg_catalog.pg_roles member ON member.oid=m.member),
  'schema_acls',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
      ORDER BY n.nspname,a.grantee,a.privilege_type),'[]'::jsonb)
    FROM pg_catalog.pg_namespace n CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a),
  'relation_acls',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'object',c.relname,'kind',c.relkind,
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
      ORDER BY n.nspname,c.relname,a.grantee,a.privilege_type),'[]'::jsonb)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
    WHERE c.relkind IN ('r','p','v','m','f','S')),
  'column_acls',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'object',c.relname,'column',col.attname,
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
      ORDER BY n.nspname,c.relname,col.attnum,a.grantee,a.privilege_type),'[]'::jsonb)
    FROM pg_catalog.pg_attribute col JOIN pg_catalog.pg_class c ON c.oid=col.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(col.attacl) a
    WHERE col.attacl IS NOT NULL AND col.attnum>0 AND NOT col.attisdropped),
  'routine_acls',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'routine',p.proname,'identity_arguments',pg_catalog.pg_get_function_identity_arguments(p.oid),
      'security_definer',p.prosecdef,
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
      ORDER BY n.nspname,p.proname,a.grantee),'[]'::jsonb)
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),
  'database_acls',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'database',d.datname,'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
      ORDER BY d.datname,a.grantee,a.privilege_type),'[]'::jsonb)
    FROM pg_catalog.pg_database d CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(d.datacl,pg_catalog.acldefault('d',d.datdba))) a),
  'default_acls',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'grantor',pg_catalog.pg_get_userbyid(d.defaclrole),'schema',n.nspname,'object_type',d.defaclobjtype,
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
      ORDER BY d.defaclrole,n.nspname,d.defaclobjtype,a.grantee,a.privilege_type),'[]'::jsonb)
    FROM pg_catalog.pg_default_acl d LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a),
  'large_object_acls',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'oid',lo.oid,'owner',pg_catalog.pg_get_userbyid(lo.lomowner),
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
      ORDER BY lo.oid,a.grantee,a.privilege_type),'[]'::jsonb)
    FROM pg_catalog.pg_largeobject_metadata lo
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(lo.lomacl,pg_catalog.acldefault('L',lo.lomowner))) a)
);
COMMIT;
