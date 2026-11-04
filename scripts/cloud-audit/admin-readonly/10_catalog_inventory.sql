\set ON_ERROR_STOP on
\ir _guard.psql
SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='autoclip_cloud_auditor') AS auditor_role_exists
\gset
\if :auditor_role_exists
\else
  \echo 'ABORT: expected auditor role is absent; effective ACL checks cannot be evaluated.'
  \quit 6
\endif

-- Catalog-only inventory. The sole non-catalog read is the migration version
-- ledger, guarded below by relation shape and disabled/non-forced RLS.
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';

\echo 'SECTION server_identity'
SELECT jsonb_build_object(
  'database',current_database(),'session_user',session_user,
  'server_version_num',current_setting('server_version_num'),
  'ssl',s.ssl,'tls_version',s.version,'cipher',s.cipher)
FROM pg_stat_ssl s WHERE s.pid=pg_backend_pid();

\echo 'SECTION schemas_and_acl'
SELECT coalesce(jsonb_agg(jsonb_build_object(
  'schema',n.nspname,'owner',pg_get_userbyid(n.nspowner),
  'acl',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
    'privilege',a.privilege_type,'grantable',a.is_grantable,
    'effective_for_auditor',coalesce(has_schema_privilege('autoclip_cloud_auditor',n.oid,a.privilege_type),false))
    ORDER BY a.grantee,a.privilege_type)
    FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a), '[]'::jsonb)
) ORDER BY n.nspname),'[]'::jsonb) AS schemas
FROM pg_namespace n;

\echo 'SECTION relations_columns_and_acl'
SELECT coalesce(jsonb_agg(jsonb_build_object(
  'schema',n.nspname,'object',c.relname,'kind',c.relkind,
  'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
  'schema_usage_for_auditor',coalesce(has_schema_privilege('autoclip_cloud_auditor',n.oid,'USAGE'),false),
  'columns',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull)
      ORDER BY a.attnum)
    FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb),
  'acl',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
      'privilege',a.privilege_type,'grantable',a.is_grantable,
      'effective_for_auditor',CASE WHEN c.relkind='S'
        THEN coalesce(has_sequence_privilege('autoclip_cloud_auditor',c.oid,a.privilege_type),false)
        ELSE coalesce(has_table_privilege('autoclip_cloud_auditor',c.oid,a.privilege_type),false) END)
      ORDER BY a.grantee,a.privilege_type)
    FROM aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a),'[]'::jsonb)
) ORDER BY n.nspname,c.relname),'[]'::jsonb) AS relations
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind IN ('r','p','v','m','f','S');

\echo 'SECTION constraints'
SELECT coalesce(jsonb_agg(jsonb_build_object(
  'schema',n.nspname,'relation',c.relname,'name',con.conname,
  'type',con.contype,'definition',pg_get_constraintdef(con.oid,true))
  ORDER BY n.nspname,c.relname,con.conname),'[]'::jsonb) AS constraints
FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema');

\echo 'SECTION indexes'
SELECT coalesce(jsonb_agg(jsonb_build_object(
  'schema',n.nspname,'relation',t.relname,'index',i.relname,
  'valid',x.indisvalid,'ready',x.indisready,'definition',pg_get_indexdef(i.oid))
  ORDER BY n.nspname,t.relname,i.relname),'[]'::jsonb) AS indexes
FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid
JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema');

\echo 'SECTION triggers'
SELECT coalesce(jsonb_agg(jsonb_build_object(
  'schema',n.nspname,'relation',c.relname,'trigger',t.tgname,
  'enabled',t.tgenabled,'function_schema',pn.nspname,'function',p.proname,
  'definition',pg_get_triggerdef(t.oid,true))
  ORDER BY n.nspname,c.relname,t.tgname),'[]'::jsonb) AS triggers
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
WHERE NOT t.tgisinternal;

\echo 'SECTION rls_policies'
SELECT coalesce(jsonb_agg(jsonb_build_object(
  'schema',n.nspname,'relation',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
  'policy',p.polname,'command',p.polcmd,'permissive',p.polpermissive,
  'roles',(SELECT jsonb_agg(CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_oid) END ORDER BY role_oid) FROM unnest(p.polroles) role_oid),
  'using_expression',pg_get_expr(p.polqual,p.polrelid),
  'check_expression',pg_get_expr(p.polwithcheck,p.polrelid))
  ORDER BY n.nspname,c.relname,p.polname),'[]'::jsonb) AS policies
FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
JOIN pg_namespace n ON n.oid=c.relnamespace;

\echo 'SECTION routines_security_and_acl'
SELECT coalesce(jsonb_agg(jsonb_build_object(
  'schema',n.nspname,'routine',p.proname,'identity_arguments',pg_get_function_identity_arguments(p.oid),
  'kind',p.prokind,'language',l.lanname,'owner',pg_get_userbyid(p.proowner),
  'security_definer',p.prosecdef,'volatility',p.provolatile,'configuration',p.proconfig,
  'schema_usage_for_auditor',coalesce(has_schema_privilege('autoclip_cloud_auditor',n.oid,'USAGE'),false),
  'execute_for_auditor',coalesce(has_function_privilege('autoclip_cloud_auditor',p.oid,'EXECUTE'),false),
  'acl',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
    'privilege',a.privilege_type,'grantable',a.is_grantable)
    ORDER BY a.grantee,a.privilege_type)
    FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),'[]'::jsonb)
) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb) AS routines
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_language l ON l.oid=p.prolang
WHERE n.nspname NOT IN ('pg_catalog','information_schema');

\echo 'SECTION database_column_type_large_object_and_default_acls'
SELECT jsonb_build_object(
  'databases',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'database',d.datname,'owner',pg_get_userbyid(d.datdba),
    'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
    'privilege',a.privilege_type,'grantable',a.is_grantable,
    'effective_for_auditor',coalesce(has_database_privilege('autoclip_cloud_auditor',d.oid,a.privilege_type),false))
    ORDER BY d.datname,a.grantee,a.privilege_type)
    FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a),'[]'::jsonb),
  'column_acls',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'schema',n.nspname,'relation',c.relname,'column',at.attname,
    'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
    'privilege',a.privilege_type,'grantable',a.is_grantable,
    'effective_for_auditor',coalesce(has_column_privilege('autoclip_cloud_auditor',c.oid,at.attnum,a.privilege_type),false))
    ORDER BY n.nspname,c.relname,at.attnum,a.grantee,a.privilege_type)
    FROM pg_attribute at JOIN pg_class c ON c.oid=at.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(at.attacl) a
    WHERE at.attacl IS NOT NULL AND at.attnum>0 AND NOT at.attisdropped
      AND n.nspname NOT IN ('pg_catalog','information_schema')),'[]'::jsonb),
  'custom_type_acls',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'schema',n.nspname,'type',t.typname,
    'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
    'privilege',a.privilege_type,'grantable',a.is_grantable,
    'effective_for_auditor',coalesce(has_type_privilege('autoclip_cloud_auditor',t.oid,a.privilege_type),false))
    ORDER BY n.nspname,t.typname,a.grantee,a.privilege_type)
    FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(t.typacl,acldefault('T',t.typowner))) a
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')),'[]'::jsonb),
  'large_object_acls',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'oid',l.oid,'owner',pg_get_userbyid(l.lomowner),
    'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
    'privilege',a.privilege_type,'grantable',a.is_grantable)
    ORDER BY l.oid,a.grantee,a.privilege_type)
    FROM pg_largeobject_metadata l
    CROSS JOIN LATERAL aclexplode(coalesce(l.lomacl,acldefault('L',l.lomowner))) a),'[]'::jsonb),
  'default_privileges',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'grantor',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'object_type',d.defaclobjtype,
    'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
    'privilege',a.privilege_type,'grantable',a.is_grantable)
    ORDER BY pg_get_userbyid(d.defaclrole),n.nspname,d.defaclobjtype,a.grantee,a.privilege_type)
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a),'[]'::jsonb)
) AS other_acl_inventory;

\echo 'SECTION memberships_both_directions'
SELECT coalesce(jsonb_agg(jsonb_build_object(
  'granted_role',parent.rolname,'member',member.rolname,
  'admin_option',m.admin_option,'inherit_option',m.inherit_option,'set_option',m.set_option)
  ORDER BY parent.rolname,member.rolname),'[]'::jsonb) AS memberships
FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid
JOIN pg_roles member ON member.oid=m.member
WHERE parent.rolname='autoclip_cloud_auditor' OR member.rolname='autoclip_cloud_auditor';

\echo 'SECTION extension_membership'
SELECT coalesce(jsonb_agg(jsonb_build_object(
  'extension',e.extname,'version',e.extversion,'schema',n.nspname,
  'object',pg_describe_object(d.classid,d.objid,d.objsubid),'dependency_type',d.deptype)
  ORDER BY e.extname,pg_describe_object(d.classid,d.objid,d.objsubid)),'[]'::jsonb) AS extension_objects
FROM pg_depend d JOIN pg_extension e
  ON d.refclassid='pg_extension'::regclass AND d.refobjid=e.oid
LEFT JOIN pg_namespace n ON n.oid=e.extnamespace
WHERE d.classid IN ('pg_class'::regclass,'pg_proc'::regclass,'pg_type'::regclass,'pg_namespace'::regclass);

\echo 'SECTION cron_net_storage_catalog_only'
SELECT coalesce(jsonb_agg(jsonb_build_object(
  'schema',n.nspname,'object',c.relname,'kind',c.relkind,
  'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
  'column_count',(SELECT count(*) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'policy_count',(SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid))
  ORDER BY n.nspname,c.relname),'[]'::jsonb) AS operational_object_catalog
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('cron','net','storage');

\echo 'SECTION migration_ledger_compatibility'
SELECT coalesce((
  SELECT c.relkind IN ('r','p') AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
    AND EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid
      WHERE a.attrelid=c.oid AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped AND t.typname='text')
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'
),false) AS ledger_read_shape_compatible
\gset
\if :ledger_read_shape_compatible
  SELECT jsonb_build_object('status','READ_ONLY_VERSION_METADATA','versions',coalesce(jsonb_agg(version::text ORDER BY version::text),'[]'::jsonb)) AS migration_ledger
  FROM supabase_migrations.schema_migrations;
\else
  \echo 'migration_ledger: NOT VERIFIED (missing, incompatible, or RLS-protected; no ledger rows read)'
\endif

COMMIT;
