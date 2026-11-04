\set ON_ERROR_STOP on
\ir ../_guard.psql

-- Verification is read-only. It reports catalog visibility and effective ACLs.
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='3s';
WITH raw AS (
SELECT jsonb_build_object(
  'role', r.rolname,
  'role_marker_matches', shobj_description(r.oid,'pg_authid')='autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn',
  'login', r.rolcanlogin,
  'superuser', r.rolsuper,
  'inherit', r.rolinherit,
  'create_role', r.rolcreaterole,
  'create_db', r.rolcreatedb,
  'replication', r.rolreplication,
  'bypass_rls', r.rolbypassrls,
  'connection_limit', r.rolconnlimit,
  'valid_until', r.rolvaliduntil,
  'role_defaults',coalesce((SELECT jsonb_object_agg(split_part(x,'=',1),substr(x,strpos(x,'=')+1)) FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x WHERE s.setrole=r.oid AND s.setdatabase=0 AND split_part(x,'=',1) IN ('default_transaction_read_only','statement_timeout','lock_timeout','idle_in_transaction_session_timeout','search_path')),'{}'::jsonb),
  'comment', shobj_description(r.oid,'pg_authid'),
  'membership_count',(SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid),
  'database_connect',has_database_privilege(r.rolname,current_database(),'CONNECT'),
  'database_create',has_database_privilege(r.rolname,current_database(),'CREATE'),
  'database_temp',has_database_privilege(r.rolname,current_database(),'TEMP'),
  'temp_acl_sources',(SELECT jsonb_build_object('public',coalesce(bool_or(a.grantee=0),false),'direct',coalesce(bool_or(a.grantee=r.oid),false),'membership',coalesce(bool_or(a.grantee<>0 AND a.grantee<>r.oid AND pg_has_role(r.oid,a.grantee,'MEMBER')),false),'public_grant_option',coalesce(bool_or(a.grantee=0 AND a.is_grantable),false)) FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() AND a.privilege_type='TEMPORARY'),
  'schema_create',EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND has_schema_privilege(r.rolname,n.oid,'CREATE')),
  'business_relation_select',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast','supabase_migrations') AND (has_table_privilege(r.rolname,c.oid,'SELECT') OR has_any_column_privilege(r.rolname,c.oid,'SELECT'))),
  'business_schema_usage',EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast','public','supabase_migrations') AND n.nspname NOT LIKE 'pg_temp_%' AND has_schema_privilege(r.rolname,n.oid,'USAGE')),
  'unapproved_schema_usage',EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast','public','supabase_migrations') AND n.nspname NOT LIKE 'pg_temp_%' AND has_schema_privilege(r.rolname,n.oid,'USAGE')),
  'unapproved_relation_reads',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND (has_table_privilege(r.rolname,c.oid,'SELECT') OR has_any_column_privilege(r.rolname,c.oid,'SELECT')) AND NOT (n.nspname='supabase_migrations' AND c.relname='schema_migrations')) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>'version' AND has_column_privilege(r.rolname,c.oid,a.attnum,'SELECT')),
  'persistent_write',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND (has_table_privilege(r.rolname,c.oid,'INSERT') OR has_table_privilege(r.rolname,c.oid,'UPDATE') OR has_table_privilege(r.rolname,c.oid,'DELETE') OR has_table_privilege(r.rolname,c.oid,'TRUNCATE') OR has_any_column_privilege(r.rolname,c.oid,'INSERT') OR has_any_column_privilege(r.rolname,c.oid,'UPDATE'))),
  'ledger_relation_present',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'),
  'ledger_shape_compatible',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_type t ON t.oid=a.atttypid WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped AND t.typname='text'),
  'ledger_column_select_scope_safe',NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND c.relkind NOT IN ('r','p')) AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND has_table_privilege(r.rolname,c.oid,'SELECT')) AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>'version' AND has_column_privilege(r.rolname,c.oid,a.attnum,'SELECT')),
  'ledger_schema_usage',coalesce((SELECT has_schema_privilege(r.rolname,n.oid,'USAGE') FROM pg_namespace n WHERE n.nspname='supabase_migrations'),false),
  'ledger_version_select',(SELECT has_column_privilege(r.rolname,c.oid,a.attnum,'SELECT') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped),
  'ledger_table_select',(SELECT has_table_privilege(r.rolname,c.oid,'SELECT') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'),
  'database_owner',(SELECT d.datdba=r.oid FROM pg_database d WHERE d.datname=current_database()),
  'executable_application_functions',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND has_schema_privilege(r.rolname,n.oid,'USAGE') AND has_function_privilege(r.rolname,p.oid,'EXECUTE')),
  'large_object_access',EXISTS(SELECT 1 FROM pg_largeobject_metadata l CROSS JOIN LATERAL aclexplode(coalesce(l.lomacl,acldefault('L',l.lomowner))) a WHERE a.grantee IN (0,r.oid) OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER'))),
  'unapproved_sequence_access',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND (has_sequence_privilege(r.rolname,c.oid,'USAGE') OR has_sequence_privilege(r.rolname,c.oid,'SELECT') OR has_sequence_privilege(r.rolname,c.oid,'UPDATE'))),
  'grant_option',EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault((CASE WHEN c.relkind='S' THEN 'S' ELSE 'r' END)::"char",c.relowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_attribute at JOIN pg_class c ON c.oid=at.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(at.attacl) a WHERE at.attacl IS NOT NULL AND at.attnum>0 AND NOT at.attisdropped AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace CROSS JOIN LATERAL aclexplode(coalesce(t.typacl,acldefault('T',t.typowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_largeobject_metadata l CROSS JOIN LATERAL aclexplode(coalesce(l.lomacl,acldefault('L',l.lomowner))) a WHERE a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))),
  'default_privileges_for_public_or_auditor',EXISTS(SELECT 1 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE (d.defaclnamespace=0 OR n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')) AND a.grantee IN (0,r.oid) AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','USAGE','EXECUTE')),
  'owned_objects',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relowner=r.oid AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proowner=r.oid AND n.nspname NOT IN ('pg_catalog','information_schema')) OR EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typowner=r.oid AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')) OR EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspowner=r.oid) OR EXISTS(SELECT 1 FROM pg_largeobject_metadata l WHERE l.lomowner=r.oid)
) AS verification
FROM (VALUES (1)) singleton(dummy) LEFT JOIN pg_roles r ON r.rolname=:'audit_role'
), checks AS (
 SELECT verification,jsonb_build_object(
   'identity',coalesce(verification->>'role'=:'audit_role',false),
   'role_marker',coalesce((verification->>'role_marker_matches')::boolean,false),
   'login',coalesce((verification->>'login')::boolean,false),
   'admin_attributes',coalesce(NOT ((verification->>'superuser')::boolean OR (verification->>'inherit')::boolean OR (verification->>'create_role')::boolean OR (verification->>'create_db')::boolean OR (verification->>'replication')::boolean OR (verification->>'bypass_rls')::boolean),false),
   'connection_limit',coalesce((verification->>'connection_limit')::integer=1,false),
   'expiry',coalesce((verification->>'valid_until')::timestamptz>now() AND (verification->>'valid_until')::timestamptz<=now()+interval '14 days',false),
   'role_defaults',coalesce(verification->'role_defaults'->>'default_transaction_read_only'='on' AND verification->'role_defaults'->>'statement_timeout'='20s' AND verification->'role_defaults'->>'lock_timeout'='3s' AND verification->'role_defaults'->>'idle_in_transaction_session_timeout'='30s' AND verification->'role_defaults'->>'search_path'='""',false),
   'no_memberships',coalesce((verification->>'membership_count')::integer=0,false),
   'database_connect',coalesce((verification->>'database_connect')::boolean,false),
   'no_database_create',coalesce(NOT (verification->>'database_create')::boolean,false),
   'no_schema_create',coalesce(NOT (verification->>'schema_create')::boolean,false),
   'no_business_read',coalesce(NOT (verification->>'business_relation_select')::boolean AND NOT (verification->>'business_schema_usage')::boolean AND NOT (verification->>'unapproved_schema_usage')::boolean AND NOT (verification->>'unapproved_relation_reads')::boolean,false),
   'no_persistent_write',coalesce(NOT (verification->>'persistent_write')::boolean,false),
   'no_custom_function_execute',coalesce(NOT (verification->>'executable_application_functions')::boolean,false),
   'no_sequence_access',coalesce(NOT (verification->>'unapproved_sequence_access')::boolean,false),
   'no_large_object_access',coalesce(NOT (verification->>'large_object_access')::boolean,false),
   'no_grant_option',coalesce(NOT (verification->>'grant_option')::boolean,false),
   'no_unapproved_default_privileges',coalesce(NOT (verification->>'default_privileges_for_public_or_auditor')::boolean,false),
   'no_object_ownership',coalesce(NOT (verification->>'owned_objects')::boolean AND NOT (verification->>'database_owner')::boolean,false),
   'temp_provenance',coalesce(
      (verification->>'database_temp')::boolean=coalesce((verification #>> '{temp_acl_sources,public}')::boolean,false)
      AND NOT (verification #>> '{temp_acl_sources,direct}')::boolean
      AND NOT (verification #>> '{temp_acl_sources,membership}')::boolean
      AND NOT (verification #>> '{temp_acl_sources,public_grant_option}')::boolean
      AND NOT (verification->>'database_owner')::boolean
      AND (NOT (verification->>'database_temp')::boolean OR (verification #>> '{temp_acl_sources,public}')::boolean),false),
   'ledger_scope',coalesce(CASE WHEN (verification->>'ledger_shape_compatible')::boolean
      THEN (verification->>'ledger_schema_usage')::boolean AND (verification->>'ledger_version_select')::boolean AND NOT (verification->>'ledger_table_select')::boolean AND (verification->>'ledger_column_select_scope_safe')::boolean
      ELSE NOT (verification->>'ledger_schema_usage')::boolean AND NOT coalesce((verification->>'ledger_version_select')::boolean,false) AND NOT coalesce((verification->>'ledger_table_select')::boolean,false)
   END,false)
 ) AS checks FROM raw
), classified AS (
 SELECT verification,checks,coalesce((SELECT bool_and(value::boolean) FROM jsonb_each_text(checks)),false) AS verification_safe FROM checks
)
SELECT jsonb_set(jsonb_set(verification,'{verification_checks}',checks),'{verification_safe}',to_jsonb(verification_safe)) AS verification_report,verification_safe FROM classified
\gset
\echo :verification_report
\if :verification_safe
  COMMIT;
  \echo 'METADATA-ONLY PRECHECK PASS.'
\else
  ROLLBACK;
  \echo 'ABORT: dangerous or unexpected effective privilege detected; metadata audit must not run.'
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_guard_blocked'; END $$;
\endif
