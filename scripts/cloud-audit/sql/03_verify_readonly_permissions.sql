\ir _guard.psql

BEGIN READ ONLY;

\if :{?audit_role}
\else
  \echo 'ABORT: set audit_role explicitly.'
  \quit 3
\endif

WITH r AS (
  SELECT * FROM pg_roles WHERE rolname=:'audit_role'
), accessible_functions AS (
  SELECT count(*) AS non_trigger_exec_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prokind IN ('f','p','a','w')
    AND p.prorettype NOT IN ('trigger'::regtype,'event_trigger'::regtype)
    AND n.nspname NOT IN ('pg_catalog','information_schema')
    AND has_schema_privilege(:'audit_role',n.oid,'USAGE')
    AND has_function_privilege(:'audit_role',p.oid,'EXECUTE')
    AND NOT (n.nspname='autoclip_audit' AND p.proname='inventory_summary' AND p.pronargs=0)
), table_writes AS (
  SELECT count(*) AS writable_relation_count
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','f')
    AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
    AND (has_table_privilege(:'audit_role',c.oid,'INSERT')
      OR has_table_privilege(:'audit_role',c.oid,'UPDATE')
      OR has_table_privilege(:'audit_role',c.oid,'DELETE')
      OR has_table_privilege(:'audit_role',c.oid,'TRUNCATE')
      OR has_any_column_privilege(:'audit_role',c.oid,'INSERT')
      OR has_any_column_privilege(:'audit_role',c.oid,'UPDATE'))
), writable_sequences AS (
  SELECT count(*) AS writable_sequence_count
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='S' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
    AND (has_sequence_privilege(:'audit_role',c.oid,'USAGE') OR has_sequence_privilege(:'audit_role',c.oid,'UPDATE'))
), result AS (
  SELECT jsonb_build_object(
    'role_exists', r.rolname IS NOT NULL,
    'login', r.rolcanlogin,
    'superuser', r.rolsuper,
    'inherit', r.rolinherit,
    'create_role', r.rolcreaterole,
    'create_db', r.rolcreatedb,
    'replication', r.rolreplication,
    'bypass_rls', r.rolbypassrls,
    'expires_at', r.rolvaliduntil,
    'role_memberships', coalesce((SELECT jsonb_agg(parent.rolname ORDER BY parent.rolname)
      FROM pg_auth_members am JOIN pg_roles parent ON parent.oid=am.roleid
      JOIN pg_roles child ON child.oid=am.member WHERE child.rolname=:'audit_role'),'[]'::jsonb),
    'owned_application_objects', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relowner=r.oid AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast'))
      + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE p.proowner=r.oid AND n.nspname NOT IN ('pg_catalog','information_schema'))
      + (SELECT count(*) FROM pg_namespace n WHERE n.nspowner=r.oid AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast'))
      + (SELECT count(*) FROM pg_database d WHERE d.datdba=r.oid)
      + (SELECT count(*) FROM pg_extension e WHERE e.extowner=r.oid),
    'database_connect', has_database_privilege(:'audit_role',current_database(),'CONNECT'),
    'database_create', has_database_privilege(:'audit_role',current_database(),'CREATE'),
    'database_temp', has_database_privilege(:'audit_role',current_database(),'TEMP'),
    'database_temp_acl', (SELECT coalesce(array_to_string(d.datacl,','),'(default ACL)') FROM pg_database d WHERE d.datname=current_database()),
    'database_owner', (SELECT d.datdba=r.oid FROM pg_database d WHERE d.datname=current_database()),
    'temp_acl_sources', (SELECT jsonb_build_object(
      'public',coalesce(bool_or(a.grantee=0),false),
      'direct',coalesce(bool_or(a.grantee=r.oid),false),
      'membership',coalesce(bool_or(a.grantee<>0 AND a.grantee<>r.oid AND pg_has_role(r.oid,a.grantee,'MEMBER')),false),
      'public_grant_option',coalesce(bool_or(a.grantee=0 AND a.is_grantable),false))
      FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
      WHERE d.datname=current_database() AND a.privilege_type='TEMPORARY'),
    'public_schema_usage', has_schema_privilege(:'audit_role','public','USAGE'),
    'public_schema_create', has_schema_privilege(:'audit_role','public','CREATE'),
    'storage_schema_usage', coalesce(has_schema_privilege(:'audit_role','storage','USAGE'),false),
    'autoclip_audit_schema_create', has_schema_privilege(:'audit_role','autoclip_audit','CREATE'),
    'non_trigger_executable_functions_except_projection', accessible_functions.non_trigger_exec_count,
    'writable_relations_or_sequences', table_writes.writable_relation_count+writable_sequences.writable_sequence_count,
    'unapproved_relation_reads', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
        AND (has_table_privilege(:'audit_role',c.oid,'SELECT') OR has_any_column_privilege(:'audit_role',c.oid,'SELECT'))
        AND NOT (n.nspname='supabase_migrations' AND c.relname='schema_migrations')),
    'ledger_column_select_scope_safe', has_column_privilege(:'audit_role','supabase_migrations.schema_migrations','version','SELECT')
      AND NOT has_table_privilege(:'audit_role','supabase_migrations.schema_migrations','SELECT')
      AND NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations'
        AND c.relname='schema_migrations' AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>'version'
        AND has_column_privilege(:'audit_role',c.oid,a.attnum,'SELECT')),
    'unapproved_sequence_access', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind='S' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
        AND (has_sequence_privilege(:'audit_role',c.oid,'USAGE') OR has_sequence_privilege(:'audit_role',c.oid,'SELECT')
          OR has_sequence_privilege(:'audit_role',c.oid,'UPDATE'))),
    'unapproved_grant_options',
      EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) acl
        WHERE d.datname=current_database() AND acl.is_grantable
          AND (acl.grantee=0 OR acl.grantee=r.oid OR (acl.grantee<>0 AND pg_has_role(r.oid,acl.grantee,'MEMBER'))))
      OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
        WHERE c.relkind<>'S' AND ns.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND acl.is_grantable
          AND (acl.grantee=0 OR acl.grantee=r.oid OR (acl.grantee<>0 AND pg_has_role(r.oid,acl.grantee,'MEMBER'))))
      OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('S',c.relowner))) acl
        WHERE c.relkind='S' AND ns.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND acl.is_grantable
          AND (acl.grantee=0 OR acl.grantee=r.oid OR (acl.grantee<>0 AND pg_has_role(r.oid,acl.grantee,'MEMBER'))))
      OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        WHERE ns.nspname NOT IN ('pg_catalog','information_schema') AND acl.is_grantable
          AND (acl.grantee=0 OR acl.grantee=r.oid OR (acl.grantee<>0 AND pg_has_role(r.oid,acl.grantee,'MEMBER'))))
      OR EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(a.attacl) acl
        WHERE a.attacl IS NOT NULL AND a.attnum>0 AND NOT a.attisdropped AND ns.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
          AND acl.is_grantable AND (acl.grantee=0 OR acl.grantee=r.oid
            OR (acl.grantee<>0 AND pg_has_role(r.oid,acl.grantee,'MEMBER'))))
      OR EXISTS(SELECT 1 FROM pg_namespace ns CROSS JOIN LATERAL aclexplode(coalesce(ns.nspacl,acldefault('n',ns.nspowner))) acl
        WHERE ns.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND acl.is_grantable
          AND (acl.grantee=0 OR acl.grantee=r.oid OR (acl.grantee<>0 AND pg_has_role(r.oid,acl.grantee,'MEMBER'))))
      OR EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
        WHERE acl.is_grantable AND (acl.grantee=0 OR acl.grantee=r.oid
          OR (acl.grantee<>0 AND pg_has_role(r.oid,acl.grantee,'MEMBER')))),
    'migration_ledger_select', has_column_privilege(:'audit_role','supabase_migrations.schema_migrations','version','SELECT'),
    'projection_execute', has_function_privilege(:'audit_role','autoclip_audit.inventory_summary()','EXECUTE'),
    'projection_security_definer', (SELECT p.prosecdef FROM pg_proc p WHERE p.oid=to_regprocedure('autoclip_audit.inventory_summary()')),
    'projection_stable', (SELECT p.provolatile='s' FROM pg_proc p WHERE p.oid=to_regprocedure('autoclip_audit.inventory_summary()')),
    'projection_owner', (SELECT owner.rolname FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner WHERE p.oid=to_regprocedure('autoclip_audit.inventory_summary()')),
    'projection_owner_bypass_rls', (SELECT owner.rolbypassrls OR owner.rolsuper FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner WHERE p.oid=to_regprocedure('autoclip_audit.inventory_summary()')),
    'projection_config', (SELECT p.proconfig FROM pg_proc p WHERE p.oid=to_regprocedure('autoclip_audit.inventory_summary()')),
    'projection_definition_sha256', (SELECT encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')
      FROM pg_proc p WHERE p.oid=to_regprocedure('autoclip_audit.inventory_summary()')),
    'projection_unapproved_execute_grantees', coalesce((SELECT jsonb_agg(
        CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END ORDER BY acl.grantee)
      FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee
      WHERE p.oid=to_regprocedure('autoclip_audit.inventory_summary()')
        AND acl.privilege_type='EXECUTE' AND acl.grantee NOT IN (p.proowner,r.oid)), '[]'::jsonb),
    'projection_schema_unapproved_grantees', coalesce((SELECT jsonb_agg(
        CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END ORDER BY acl.grantee)
      FROM pg_namespace ns CROSS JOIN LATERAL aclexplode(coalesce(ns.nspacl,acldefault('n',ns.nspowner))) acl
      LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee
      WHERE ns.nspname='autoclip_audit' AND acl.grantee NOT IN (ns.nspowner,r.oid)), '[]'::jsonb),
    'default_read_only', (SELECT setting FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) setting
      WHERE s.setrole=r.oid AND s.setdatabase=0 AND setting LIKE 'default_transaction_read_only=%' LIMIT 1),
    'statement_timeout', (SELECT setting FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) setting
      WHERE s.setrole=r.oid AND s.setdatabase=0 AND setting LIKE 'statement_timeout=%' LIMIT 1),
    'function_default_acl_overrides', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'owner', owner.rolname,
        'schema', CASE WHEN d.defaclnamespace=0 THEN null ELSE n.nspname END,
        'acl', d.defaclacl::text
      ) ORDER BY owner.rolname, n.nspname)
      FROM pg_default_acl d JOIN pg_roles owner ON owner.oid=d.defaclrole
      LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
      WHERE d.defaclobjtype='f'), '[]'::jsonb)
  ) AS verification
  FROM r CROSS JOIN accessible_functions CROSS JOIN table_writes CROSS JOIN writable_sequences
)
SELECT verification FROM result;

COMMIT;
