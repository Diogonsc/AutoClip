\set ON_ERROR_STOP on
\if :{?cloud_project_ref}
\else
  \echo 'ABORT: cloud_project_ref must be supplied explicitly.'
  SELECT 1/0 AS abort_gate;
\endif
\if :{?audit_role}
\else
  \echo 'ABORT: audit_role must be supplied explicitly.'
  SELECT 1/0 AS abort_gate;
\endif
SELECT (:'cloud_project_ref'='djrwfvcxgpyknmizqumn' AND current_database()='postgres') AS diagnostic_target_ok
\gset
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=:'audit_role') AS diagnostic_role_exists
\gset
\if :diagnostic_role_exists
\else
  \echo 'ABORT: requested audit role does not exist in this database.'
  SELECT 1/0 AS abort_gate;
\endif
\if :diagnostic_target_ok
\else
  \echo 'ABORT: project reference or connected database does not match the approved diagnostic target.'
  SELECT 1/0 AS abort_gate;
\endif

BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='3s';
SET LOCAL idle_in_transaction_session_timeout='30s';

WITH target AS (
  SELECT r.oid AS role_oid, r.rolname, d.oid AS database_oid, d.datname
  FROM pg_roles r CROSS JOIN pg_database d
  WHERE r.rolname=:'audit_role' AND d.datname=current_database()
),
ledger AS (
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_type t ON t.oid=a.atttypid
    WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'
      AND c.relkind IN ('r','p') AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
      AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped AND t.typname='text'
  ) AS compatible,
  EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='supabase_migrations') AS schema_exists,
  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations') AS relation_exists
),
issues(category,database_name,schema_name,object_name,privilege,origin,evidence,assessment) AS (
  SELECT 'role membership/delegation',NULL::text,NULL::text,
    CASE WHEN m.member=t.role_oid THEN parent.rolname ELSE member.rolname END,
    CASE WHEN m.member=t.role_oid THEN 'member of role' ELSE 'role granted to member' END,
    CASE WHEN m.admin_option THEN 'MEMBERSHIP WITH ADMIN OPTION' ELSE 'MEMBERSHIP' END,
    format('pg_auth_members member=%s roleid=%s admin_option=%s inherit_option=%s set_option=%s',member.rolname,parent.rolname,m.admin_option,m.inherit_option,m.set_option),
    'REQUIRES_INVESTIGATION'
  FROM target t JOIN pg_auth_members m ON m.member=t.role_oid OR m.roleid=t.role_oid
  JOIN pg_roles member ON member.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid

  UNION ALL
  SELECT 'privilege on a non-target database',d.datname,NULL,NULL,p.privilege,
    CASE WHEN d.datdba=t.role_oid THEN 'OWNERSHIP'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=t.role_oid AND a.privilege_type=p.privilege) THEN 'DIRECT'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0 AND a.privilege_type=p.privilege) THEN 'PUBLIC'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE a.privilege_type=p.privilege AND a.grantee<>0 AND a.grantee<>t.role_oid AND pg_has_role(t.role_oid,a.grantee,'MEMBER')) THEN 'MEMBERSHIP'
      ELSE 'EFFECTIVE SOURCE UNATTRIBUTED'
    END,
    format('pg_database datallowconn=%s; has_database_privilege=%s; ACL=%s',d.datallowconn,has_database_privilege(t.role_oid,d.oid,p.privilege),coalesce(d.datacl::text,'DEFAULT')),
    CASE WHEN (p.privilege='CONNECT' AND EXISTS (SELECT 1 FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0 AND a.privilege_type='CONNECT'))
         OR (p.privilege='TEMP' AND EXISTS (SELECT 1 FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0 AND a.privilege_type='TEMPORARY'))
      THEN 'COMMON_POSTGRES_PUBLIC_ACL_BUT_OUT_OF_TARGET_SCOPE; INVESTIGATE'
      ELSE 'REQUIRES_INVESTIGATION' END
  FROM target t JOIN pg_database d ON d.oid<>t.database_oid AND d.datallowconn
  CROSS JOIN LATERAL (VALUES ('CONNECT'::text),('CREATE'::text),('TEMPORARY'::text)) p(privilege)
  WHERE has_database_privilege(t.role_oid,d.oid,p.privilege)

  UNION ALL
  SELECT 'database CREATE or TEMP provenance',t.datname,NULL,NULL,p.privilege,
    CASE WHEN d.datdba=t.role_oid THEN 'OWNERSHIP'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=t.role_oid AND a.privilege_type=p.acl_priv) THEN 'DIRECT'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0 AND a.privilege_type=p.acl_priv) THEN 'PUBLIC'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE a.privilege_type=p.acl_priv AND a.grantee<>0 AND a.grantee<>t.role_oid AND pg_has_role(t.role_oid,a.grantee,'MEMBER')) THEN 'MEMBERSHIP'
      ELSE 'EFFECTIVE SOURCE UNATTRIBUTED' END,
    format('pg_database ACL=%s; effective=%s',coalesce(d.datacl::text,'DEFAULT'),has_database_privilege(t.role_oid,d.oid,p.privilege)),
    CASE WHEN p.privilege='TEMP' AND EXISTS (SELECT 1 FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0 AND a.privilege_type='TEMPORARY')
      THEN 'KNOWN_PUBLIC_TEMP_RESIDUAL_HIGH_RISK; NOT A SECURITY APPROVAL'
      ELSE 'REQUIRES_INVESTIGATION' END
  FROM target t JOIN pg_database d ON d.oid=t.database_oid
  CROSS JOIN LATERAL (VALUES ('CREATE'::text,'CREATE'::text),('TEMP'::text,'TEMPORARY'::text)) p(privilege,acl_priv)
  WHERE has_database_privilege(t.role_oid,d.oid,p.privilege)
     OR (p.privilege='TEMP' AND (
          has_database_privilege(t.role_oid,d.oid,'TEMP') IS DISTINCT FROM EXISTS (
            SELECT 1 FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0 AND a.privilege_type='TEMPORARY')
          OR EXISTS (SELECT 1 FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=t.role_oid AND a.privilege_type='TEMPORARY')
          OR EXISTS (SELECT 1 FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0 AND a.privilege_type='TEMPORARY' AND a.is_grantable)))

  UNION ALL
  SELECT 'unapproved schema USAGE/CREATE',t.datname,n.nspname,NULL,p.privilege,
    CASE WHEN n.nspowner=t.role_oid THEN 'OWNERSHIP'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE a.grantee=t.role_oid AND a.privilege_type=p.acl_priv) THEN 'DIRECT'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE a.grantee=0 AND a.privilege_type=p.acl_priv) THEN 'PUBLIC'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE a.privilege_type=p.acl_priv AND a.grantee<>0 AND a.grantee<>t.role_oid AND pg_has_role(t.role_oid,a.grantee,'MEMBER')) THEN 'MEMBERSHIP'
      ELSE 'EFFECTIVE SOURCE UNATTRIBUTED' END,
    format('pg_namespace nspowner=%s; nspacl=%s; effective=%s',pg_get_userbyid(n.nspowner),coalesce(n.nspacl::text,'DEFAULT'),has_schema_privilege(t.role_oid,n.oid,p.privilege)),
    CASE WHEN n.nspname='public' AND p.privilege='USAGE' AND EXISTS (SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE a.grantee=0 AND a.privilege_type='USAGE')
      THEN 'COMMON_PUBLIC_SCHEMA_BASELINE; REVIEW OBJECT ACLS SEPARATELY'
      ELSE 'REQUIRES_INVESTIGATION' END
  FROM target t JOIN pg_namespace n ON n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND n.nspname NOT LIKE 'pg_temp_%'
  CROSS JOIN LATERAL (VALUES ('USAGE'::text,'USAGE'::text),('CREATE'::text,'CREATE'::text)) p(privilege,acl_priv)
  CROSS JOIN ledger l
  WHERE has_schema_privilege(t.role_oid,n.oid,p.privilege)
    AND (p.privilege='CREATE' OR n.nspname NOT IN ('public','supabase_migrations') OR (n.nspname='supabase_migrations' AND NOT l.compatible))

  UNION ALL
  SELECT 'unapproved relation read/write privilege',t.datname,n.nspname,c.relname,p.privilege,
    CASE WHEN c.relowner=t.role_oid THEN 'OWNERSHIP'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault((CASE WHEN c.relkind='S' THEN 'S' ELSE 'r' END)::"char",c.relowner))) a WHERE a.grantee=t.role_oid AND a.privilege_type=p.privilege) THEN 'DIRECT'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault((CASE WHEN c.relkind='S' THEN 'S' ELSE 'r' END)::"char",c.relowner))) a WHERE a.grantee=0 AND a.privilege_type=p.privilege) THEN 'PUBLIC'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault((CASE WHEN c.relkind='S' THEN 'S' ELSE 'r' END)::"char",c.relowner))) a WHERE a.privilege_type=p.privilege AND a.grantee<>0 AND a.grantee<>t.role_oid AND pg_has_role(t.role_oid,a.grantee,'MEMBER')) THEN 'MEMBERSHIP'
      ELSE 'EFFECTIVE SOURCE UNATTRIBUTED' END,
    format('pg_class relkind=%s relrowsecurity=%s relforcerowsecurity=%s ACL=%s; has_table_privilege=%s',c.relkind,c.relrowsecurity,c.relforcerowsecurity,coalesce(c.relacl::text,'DEFAULT'),has_table_privilege(t.role_oid,c.oid,p.privilege)),
    CASE WHEN n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND p.privilege='SELECT' AND l.compatible
      THEN 'LEDGER TABLE-LEVEL SELECT IS BROADER THAN APPROVED VERSION-COLUMN SELECT'
      ELSE 'REQUIRES_INVESTIGATION' END
  FROM target t CROSS JOIN ledger l JOIN pg_class c ON c.relkind IN ('r','p','v','m','f')
  JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN LATERAL (VALUES ('SELECT'::text),('INSERT'::text),('UPDATE'::text),('DELETE'::text),('TRUNCATE'::text),('REFERENCES'::text),('TRIGGER'::text)) p(privilege)
  WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
    AND has_table_privilege(t.role_oid,c.oid,p.privilege)
    AND NOT (p.privilege='SELECT' AND l.compatible AND n.nspname='supabase_migrations' AND c.relname='schema_migrations')

  UNION ALL
  SELECT 'unapproved relation read/write privilege',t.datname,n.nspname,c.relname||'.'||a.attname,'COLUMN '||p.privilege,
    CASE WHEN c.relowner=t.role_oid THEN 'OWNERSHIP'
      WHEN EXISTS (SELECT 1 FROM aclexplode(a.attacl) x WHERE x.grantee=t.role_oid AND x.privilege_type=p.acl_priv) THEN 'DIRECT COLUMN ACL'
      WHEN EXISTS (SELECT 1 FROM aclexplode(a.attacl) x WHERE x.grantee=0 AND x.privilege_type=p.acl_priv) THEN 'PUBLIC COLUMN ACL'
      WHEN EXISTS (SELECT 1 FROM aclexplode(a.attacl) x WHERE x.privilege_type=p.acl_priv AND x.grantee<>0 AND x.grantee<>t.role_oid AND pg_has_role(t.role_oid,x.grantee,'MEMBER')) THEN 'MEMBERSHIP COLUMN ACL'
      ELSE 'EFFECTIVE COLUMN PRIVILEGE; SOURCE UNATTRIBUTED' END,
    format('pg_attribute attnum=%s attacl=%s; has_column_privilege=%s',a.attnum,coalesce(a.attacl::text,'NONE'),has_column_privilege(t.role_oid,c.oid,a.attnum,p.privilege)),
    CASE WHEN n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND a.attname='version' AND p.privilege='SELECT' AND l.compatible
      THEN 'ALLOWLISTED LEDGER VERSION COLUMN'
      WHEN n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND p.privilege='SELECT'
      THEN 'LEDGER COLUMN OUTSIDE APPROVED SCOPE OR INCOMPATIBLE LEDGER'
      ELSE 'REQUIRES_INVESTIGATION' END
  FROM target t CROSS JOIN ledger l JOIN pg_class c ON c.relkind IN ('r','p','v','m','f')
  JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
  CROSS JOIN LATERAL (VALUES ('SELECT'::text,'SELECT'::text),('INSERT'::text,'INSERT'::text),('UPDATE'::text,'UPDATE'::text)) p(privilege,acl_priv)
  WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
    AND has_column_privilege(t.role_oid,c.oid,a.attnum,p.privilege)
    AND NOT has_table_privilege(t.role_oid,c.oid,p.privilege)
    AND NOT (p.privilege='SELECT' AND l.compatible AND n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND a.attname='version')

  UNION ALL
  SELECT 'unapproved sequence privilege',t.datname,n.nspname,c.relname,p.privilege,
    CASE WHEN c.relowner=t.role_oid THEN 'OWNERSHIP'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('S',c.relowner))) a WHERE a.grantee=t.role_oid AND a.privilege_type=p.acl_priv) THEN 'DIRECT'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('S',c.relowner))) a WHERE a.grantee=0 AND a.privilege_type=p.acl_priv) THEN 'PUBLIC'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('S',c.relowner))) a WHERE a.privilege_type=p.acl_priv AND a.grantee<>0 AND a.grantee<>t.role_oid AND pg_has_role(t.role_oid,a.grantee,'MEMBER')) THEN 'MEMBERSHIP'
      ELSE 'EFFECTIVE SOURCE UNATTRIBUTED' END,
    format('pg_class relkind=S ACL=%s; has_sequence_privilege=%s',coalesce(c.relacl::text,'DEFAULT'),has_sequence_privilege(t.role_oid,c.oid,p.privilege)),
    'REQUIRES_INVESTIGATION'
  FROM target t JOIN pg_class c ON c.relkind='S' JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN LATERAL (VALUES ('USAGE'::text,'USAGE'::text),('SELECT'::text,'SELECT'::text),('UPDATE'::text,'UPDATE'::text)) p(privilege,acl_priv)
  WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND has_sequence_privilege(t.role_oid,c.oid,p.privilege)

  UNION ALL
  SELECT 'application routine EXECUTE',t.datname,n.nspname,p.proname||'('||pg_get_function_identity_arguments(p.oid)||')','EXECUTE',
    CASE WHEN p.proowner=t.role_oid THEN 'OWNERSHIP'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=t.role_oid AND a.privilege_type='EXECUTE') THEN 'DIRECT'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') THEN 'PUBLIC'
      WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>0 AND a.grantee<>t.role_oid AND pg_has_role(t.role_oid,a.grantee,'MEMBER')) THEN 'MEMBERSHIP'
      ELSE 'EFFECTIVE SOURCE UNATTRIBUTED' END,
    format('pg_proc prokind=%s prosecdef=%s proowner=%s ACL=%s; effective EXECUTE=true',p.prokind,p.prosecdef,pg_get_userbyid(p.proowner),coalesce(p.proacl::text,'DEFAULT')),
    CASE WHEN p.prosecdef THEN 'SECURITY DEFINER ROUTINE; HIGH PRIORITY REVIEW' ELSE 'REQUIRES_INVESTIGATION' END
  FROM target t JOIN pg_proc p ON p.prokind IN ('f','p','a','w') JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND has_schema_privilege(t.role_oid,n.oid,'USAGE') AND has_function_privilege(t.role_oid,p.oid,'EXECUTE')

  UNION ALL
  SELECT 'large object privilege',t.datname,NULL,'large object OID '||o.oid::text,a.privilege_type,
    CASE WHEN o.lomowner=t.role_oid THEN 'OWNERSHIP'
      WHEN a.grantee=t.role_oid THEN 'DIRECT'
      WHEN a.grantee=0 THEN 'PUBLIC'
      WHEN pg_has_role(t.role_oid,a.grantee,'MEMBER') THEN 'MEMBERSHIP'
      ELSE 'ACL SOURCE' END,
    format('pg_largeobject_metadata lomowner=%s lomacl=%s',pg_get_userbyid(o.lomowner),coalesce(o.lomacl::text,'DEFAULT')),
    'REQUIRES_INVESTIGATION'
  FROM target t JOIN pg_largeobject_metadata o ON true
  CROSS JOIN LATERAL aclexplode(coalesce(o.lomacl,acldefault('L',o.lomowner))) a
  WHERE a.grantee IN (0,t.role_oid) OR pg_has_role(t.role_oid,a.grantee,'MEMBER')

  UNION ALL
  SELECT 'unapproved default privileges',t.datname,coalesce(n.nspname,'<all schemas>'),
    'default ACL owner '||pg_get_userbyid(d.defaclrole),a.privilege_type,
    CASE WHEN a.grantee=t.role_oid THEN 'DIRECT DEFAULT ACL' WHEN a.grantee=0 THEN 'PUBLIC DEFAULT ACL' ELSE 'MEMBERSHIP DEFAULT ACL' END,
    format('pg_default_acl defaclobjtype=%s defaclnamespace=%s grantable=%s ACL=%s',d.defaclobjtype,d.defaclnamespace,a.is_grantable,d.defaclacl),
    'REQUIRES_INVESTIGATION'
  FROM target t JOIN pg_default_acl d ON true LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE (d.defaclnamespace=0 OR n.nspname NOT IN ('pg_catalog','information_schema','pg_toast'))
    AND a.grantee IN (0,t.role_oid)
    AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','USAGE','EXECUTE')

  UNION ALL
  SELECT 'object ownership',t.datname,NULL,
    coalesce(CASE
      WHEN s.classid='pg_class'::regclass THEN (SELECT n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=s.objid)
      WHEN s.classid='pg_proc'::regclass THEN (SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=s.objid)
      WHEN s.classid='pg_type'::regclass THEN (SELECT n.nspname||'.'||y.typname FROM pg_type y JOIN pg_namespace n ON n.oid=y.typnamespace WHERE y.oid=s.objid)
      WHEN s.classid='pg_namespace'::regclass THEN (SELECT nspname FROM pg_namespace WHERE oid=s.objid)
      WHEN s.classid='pg_database'::regclass THEN (SELECT datname FROM pg_database WHERE oid=s.objid)
      WHEN s.classid='pg_largeobject_metadata'::regclass THEN 'large object OID '||s.objid::text
      WHEN s.classid='pg_foreign_server'::regclass THEN (SELECT srvname FROM pg_foreign_server WHERE oid=s.objid)
      WHEN s.classid='pg_foreign_data_wrapper'::regclass THEN (SELECT fdwname FROM pg_foreign_data_wrapper WHERE oid=s.objid)
      WHEN s.classid='pg_tablespace'::regclass THEN (SELECT spcname FROM pg_tablespace WHERE oid=s.objid)
    END,s.classid::regclass::text||' OID '||s.objid::text),
    'OWNER','OWNERSHIP',format('pg_shdepend classid=%s objid=%s objsubid=%s deptype=%s dbid=%s',s.classid::regclass,s.objid,s.objsubid,s.deptype,s.dbid),
    'REQUIRES_INVESTIGATION'
  FROM target t JOIN pg_shdepend s ON s.refclassid='pg_authid'::regclass AND s.refobjid=t.role_oid AND s.deptype='o'
  WHERE s.dbid IN (0,t.database_oid)

  UNION ALL
  SELECT 'grant option',t.datname,'<database>',d.datname,a.privilege_type,
    CASE WHEN a.grantee=t.role_oid THEN 'DIRECT' WHEN a.grantee=0 THEN 'PUBLIC' ELSE 'MEMBERSHIP' END,
    format('pg_database ACL grant_option=true ACL=%s',coalesce(d.datacl::text,'DEFAULT')),'REQUIRES_INVESTIGATION'
  FROM target t JOIN pg_database d ON true CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
  WHERE a.grantee IN (0,t.role_oid) AND a.is_grantable

  UNION ALL
  SELECT 'grant option',t.datname,n.nspname,c.relname,a.privilege_type,
    CASE WHEN a.grantee=t.role_oid THEN 'DIRECT' WHEN a.grantee=0 THEN 'PUBLIC' ELSE 'MEMBERSHIP' END,
    format('pg_class ACL grant_option=true relkind=%s ACL=%s',c.relkind,coalesce(c.relacl::text,'DEFAULT')),'REQUIRES_INVESTIGATION'
  FROM target t JOIN pg_class c ON true JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault((CASE WHEN c.relkind='S' THEN 'S' ELSE 'r' END)::"char",c.relowner))) a
  WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.grantee IN (0,t.role_oid) AND a.is_grantable

  UNION ALL
  SELECT 'grant option',t.datname,n.nspname,p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',a.privilege_type,
    CASE WHEN a.grantee=t.role_oid THEN 'DIRECT' WHEN a.grantee=0 THEN 'PUBLIC' ELSE 'MEMBERSHIP' END,
    format('pg_proc ACL grant_option=true prosecdef=%s ACL=%s',p.prosecdef,coalesce(p.proacl::text,'DEFAULT')),'REQUIRES_INVESTIGATION'
  FROM target t JOIN pg_proc p ON true JOIN pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND a.grantee IN (0,t.role_oid) AND a.is_grantable

  UNION ALL
  SELECT 'grant option',t.datname,n.nspname,NULL,a.privilege_type,
    CASE WHEN a.grantee=t.role_oid THEN 'DIRECT' WHEN a.grantee=0 THEN 'PUBLIC' ELSE 'MEMBERSHIP' END,
    format('pg_namespace ACL grant_option=true ACL=%s',coalesce(n.nspacl::text,'DEFAULT')),'REQUIRES_INVESTIGATION'
  FROM target t JOIN pg_namespace n ON true CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
  WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.grantee IN (0,t.role_oid) AND a.is_grantable

  UNION ALL
  SELECT 'grant option',t.datname,n.nspname,c.relname||'.'||att.attname,'COLUMN '||a.privilege_type,
    CASE WHEN a.grantee=t.role_oid THEN 'DIRECT' WHEN a.grantee=0 THEN 'PUBLIC' ELSE 'MEMBERSHIP' END,
    format('pg_attribute ACL grant_option=true attnum=%s ACL=%s',att.attnum,att.attacl),'REQUIRES_INVESTIGATION'
  FROM target t JOIN pg_attribute att ON att.attnum>0 AND NOT att.attisdropped
  JOIN pg_class c ON c.oid=att.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN LATERAL aclexplode(att.attacl) a
  WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.grantee IN (0,t.role_oid) AND a.is_grantable

  UNION ALL
  SELECT 'grant option',t.datname,n.nspname,y.typname,a.privilege_type,
    CASE WHEN a.grantee=t.role_oid THEN 'DIRECT' WHEN a.grantee=0 THEN 'PUBLIC' ELSE 'MEMBERSHIP' END,
    format('pg_type ACL grant_option=true ACL=%s',y.typacl),'REQUIRES_INVESTIGATION'
  FROM target t JOIN pg_type y ON y.typacl IS NOT NULL JOIN pg_namespace n ON n.oid=y.typnamespace
  CROSS JOIN LATERAL aclexplode(y.typacl) a
  WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.grantee IN (0,t.role_oid) AND a.is_grantable

  UNION ALL
  SELECT 'grant option',t.datname,NULL,'large object OID '||lo.oid::text,a.privilege_type,
    CASE WHEN a.grantee=t.role_oid THEN 'DIRECT' WHEN a.grantee=0 THEN 'PUBLIC' ELSE 'MEMBERSHIP' END,
    format('pg_largeobject_metadata grant_option=true ACL=%s',lo.lomacl),'REQUIRES_INVESTIGATION'
  FROM target t JOIN pg_largeobject_metadata lo ON true CROSS JOIN LATERAL aclexplode(coalesce(lo.lomacl,acldefault('L',lo.lomowner))) a
  WHERE a.grantee IN (0,t.role_oid) AND a.is_grantable

  UNION ALL
  SELECT 'grant option',t.datname,NULL,fs.srvname,a.privilege_type,
    CASE WHEN a.grantee=t.role_oid THEN 'DIRECT' WHEN a.grantee=0 THEN 'PUBLIC' ELSE 'MEMBERSHIP' END,
    format('pg_foreign_server ACL grant_option=true ACL=%s',fs.srvacl),'REQUIRES_INVESTIGATION'
  FROM target t JOIN pg_foreign_server fs ON true CROSS JOIN LATERAL aclexplode(coalesce(fs.srvacl,acldefault('s',fs.srvowner))) a
  WHERE a.grantee IN (0,t.role_oid) AND a.is_grantable
),
ledger_state AS (
  SELECT CASE WHEN NOT relation_exists THEN 'NOT PRESENT'
    WHEN compatible THEN 'COMPATIBLE; version column can be considered for allowlist'
    ELSE 'PRESENT BUT INCOMPATIBLE, RLS-PROTECTED, OR NOT VISIBLE AS EXPECTED' END AS state
  FROM ledger
)
SELECT category,database_name,schema_name,object_name,privilege,origin,evidence,assessment
FROM issues
UNION ALL
SELECT 'migration ledger metadata',current_database(),'supabase_migrations','schema_migrations','version SELECT',
  CASE WHEN compatible THEN 'SHAPE CHECK ONLY; ACL NOT IMPLIED' ELSE 'NOT VERIFIED' END,
  format('schema_exists=%s relation_exists=%s shape_compatible=%s (checks relation kind, text version, and RLS/FORCE RLS)',schema_exists,relation_exists,compatible),
  (SELECT state FROM ledger_state)
FROM ledger
ORDER BY category,database_name NULLS FIRST,schema_name NULLS FIRST,object_name NULLS FIRST,privilege;

COMMIT;
