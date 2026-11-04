\set ON_ERROR_STOP on
\ir ../_guard.psql

-- Gate 3.1: fail closed on effective privileges before any GRANT.
-- The transaction narrows the check/apply window; it cannot serialize with
-- independent administrators changing ACLs. Gate 4 must re-verify.
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='3s';

WITH r AS (SELECT * FROM pg_roles WHERE rolname=:'audit_role'),
d AS (SELECT * FROM pg_database WHERE datname=current_database()),
l AS (
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_type t ON t.oid=a.atttypid
    WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'
      AND c.relkind IN ('r','p') AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
      AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped AND t.typname='text'
  ) AS compatible
),
violations(reason) AS (
  SELECT 'role identity/flags/expiry'::text WHERE NOT EXISTS (
    SELECT 1 FROM r
    WHERE rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls
      AND rolconnlimit=1 AND rolvaliduntil>now()
      AND rolvaliduntil<=now()+interval '14 days'
      AND shobj_description(oid,'pg_authid')='autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn'
  )
  UNION ALL
  SELECT 'role session defaults'::text WHERE NOT EXISTS (
    SELECT 1 FROM r
    WHERE EXISTS (SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x WHERE s.setrole=r.oid AND s.setdatabase=0 AND x='default_transaction_read_only=on')
      AND EXISTS (SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x WHERE s.setrole=r.oid AND s.setdatabase=0 AND x='statement_timeout=20s')
      AND EXISTS (SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x WHERE s.setrole=r.oid AND s.setdatabase=0 AND x='lock_timeout=3s')
      AND EXISTS (SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x WHERE s.setrole=r.oid AND s.setdatabase=0 AND x='idle_in_transaction_session_timeout=30s')
      AND EXISTS (SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x WHERE s.setrole=r.oid AND s.setdatabase=0 AND x='search_path=""')
      AND NOT EXISTS (
        SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x
        WHERE s.setrole=r.oid AND s.setdatabase IN (0,(SELECT oid FROM d))
          AND x NOT IN ('default_transaction_read_only=on','statement_timeout=20s','lock_timeout=3s','idle_in_transaction_session_timeout=30s','search_path=""')
      )
  )
  UNION ALL
  SELECT 'role membership/delegation'::text
  WHERE EXISTS (SELECT 1 FROM r JOIN pg_auth_members m ON m.member=r.oid OR m.roleid=r.oid)
  UNION ALL
  SELECT 'privilege on a non-target database'::text
  WHERE EXISTS (
    SELECT 1 FROM r JOIN pg_database other_db
      ON other_db.oid<>(SELECT oid FROM d) AND other_db.datallowconn
    WHERE (has_database_privilege(r.rolname,other_db.oid,'CONNECT')
        OR has_database_privilege(r.rolname,other_db.oid,'CREATE')
        OR has_database_privilege(r.rolname,other_db.oid,'TEMP'))
      AND NOT (
        :'audit_local_test'::boolean
        AND other_db.datname IN ('postgres','_supabase','storage_vectors','template1')
        AND NOT has_database_privilege(r.rolname,other_db.oid,'CREATE')
        AND NOT EXISTS (
          SELECT 1 FROM pg_database local_db
          CROSS JOIN LATERAL aclexplode(coalesce(local_db.datacl,acldefault('d',local_db.datdba))) acl
          WHERE local_db.oid=other_db.oid
            AND acl.grantee=r.oid
            AND acl.privilege_type IN ('CONNECT','CREATE','TEMPORARY')
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_database local_db
          CROSS JOIN LATERAL aclexplode(coalesce(local_db.datacl,acldefault('d',local_db.datdba))) acl
          WHERE local_db.oid=other_db.oid AND acl.grantee=0
            AND acl.privilege_type IN ('CONNECT','CREATE','TEMPORARY') AND acl.is_grantable
        )
      )
  )
  UNION ALL
  SELECT 'object ownership'::text
  WHERE EXISTS (
    SELECT 1 FROM r JOIN pg_shdepend s ON s.refclassid='pg_authid'::regclass AND s.refobjid=r.oid AND s.deptype='o'
    WHERE s.dbid IN (0,(SELECT oid FROM d))
  )
  UNION ALL
  SELECT 'database CREATE or TEMP provenance'::text
  WHERE EXISTS (
    SELECT 1 FROM r CROSS JOIN d
    WHERE has_database_privilege(r.rolname,d.oid,'CREATE')
      OR has_database_privilege(r.rolname,d.oid,'TEMP') IS DISTINCT FROM EXISTS (
        SELECT 1 FROM pg_database x CROSS JOIN LATERAL aclexplode(coalesce(x.datacl,acldefault('d',x.datdba))) a
        WHERE x.oid=d.oid AND a.grantee=0 AND a.privilege_type='TEMPORARY'
      )
      OR EXISTS (SELECT 1 FROM pg_database x CROSS JOIN LATERAL aclexplode(coalesce(x.datacl,acldefault('d',x.datdba))) a WHERE x.oid=d.oid AND a.grantee=r.oid AND a.privilege_type='TEMPORARY')
      OR EXISTS (SELECT 1 FROM pg_database x CROSS JOIN LATERAL aclexplode(coalesce(x.datacl,acldefault('d',x.datdba))) a WHERE x.oid=d.oid AND a.grantee=0 AND a.privilege_type='TEMPORARY' AND a.is_grantable)
      OR d.datdba=r.oid
  )
  UNION ALL
  SELECT 'unapproved schema USAGE/CREATE'::text
  WHERE EXISTS (
    SELECT 1 FROM r CROSS JOIN l JOIN pg_namespace n ON n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND n.nspname NOT LIKE 'pg_temp_%'
    WHERE has_schema_privilege(r.rolname,n.oid,'CREATE')
      OR (has_schema_privilege(r.rolname,n.oid,'USAGE') AND n.nspname NOT IN ('public','supabase_migrations'))
      OR (has_schema_privilege(r.rolname,n.oid,'USAGE') AND n.nspname='supabase_migrations' AND NOT l.compatible)
  )
  UNION ALL
  SELECT 'unapproved relation read/write privilege'::text
  WHERE EXISTS (
    SELECT 1 FROM r CROSS JOIN l JOIN pg_class c ON c.relkind IN ('r','p','v','m','f')
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND (
      has_table_privilege(r.rolname,c.oid,'INSERT') OR has_table_privilege(r.rolname,c.oid,'UPDATE')
      OR has_table_privilege(r.rolname,c.oid,'DELETE') OR has_table_privilege(r.rolname,c.oid,'TRUNCATE')
      OR has_table_privilege(r.rolname,c.oid,'REFERENCES') OR has_table_privilege(r.rolname,c.oid,'TRIGGER')
      OR has_any_column_privilege(r.rolname,c.oid,'INSERT') OR has_any_column_privilege(r.rolname,c.oid,'UPDATE')
      OR has_table_privilege(r.rolname,c.oid,'SELECT')
      OR (has_any_column_privilege(r.rolname,c.oid,'SELECT') AND NOT (l.compatible AND n.nspname='supabase_migrations' AND c.relname='schema_migrations'))
    )
  )
  UNION ALL
  SELECT 'unapproved ledger column privilege'::text
  WHERE EXISTS (
    SELECT 1 FROM r CROSS JOIN l JOIN pg_class c ON c.relkind IN ('r','p')
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'
      AND has_column_privilege(r.rolname,c.oid,a.attnum,'SELECT')
      AND NOT (l.compatible AND a.attname='version')
  )
  UNION ALL
  SELECT 'unapproved sequence privilege'::text
  WHERE EXISTS (
    SELECT 1 FROM r JOIN pg_class c ON c.relkind='S' JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
      AND (has_sequence_privilege(r.rolname,c.oid,'USAGE') OR has_sequence_privilege(r.rolname,c.oid,'SELECT') OR has_sequence_privilege(r.rolname,c.oid,'UPDATE'))
  )
  UNION ALL
  SELECT 'application routine EXECUTE'::text
  WHERE EXISTS (
    SELECT 1 FROM r JOIN pg_proc p ON p.prokind IN ('f','p','a','w') JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
      AND has_schema_privilege(r.rolname,n.oid,'USAGE') AND has_function_privilege(r.rolname,p.oid,'EXECUTE')
  )
  UNION ALL
  SELECT 'custom type USAGE'::text
  WHERE EXISTS (
    SELECT 1 FROM r JOIN pg_type t ON true JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
      AND t.typacl IS NOT NULL
      AND has_type_privilege(r.rolname,t.oid,'USAGE')
  )
  UNION ALL
  SELECT 'large object privilege'::text
  WHERE EXISTS (
    SELECT 1 FROM r JOIN pg_largeobject_metadata o ON true
    CROSS JOIN LATERAL aclexplode(coalesce(o.lomacl,acldefault('L',o.lomowner))) a
    WHERE a.grantee IN (0,r.oid)
  )
  UNION ALL
  SELECT 'foreign server USAGE'::text
  WHERE EXISTS (SELECT 1 FROM r JOIN pg_foreign_server f ON true WHERE has_server_privilege(r.rolname,f.oid,'USAGE'))
  UNION ALL
  SELECT 'grant option'::text
  WHERE EXISTS (SELECT 1 FROM r JOIN pg_database gd ON true CROSS JOIN LATERAL aclexplode(coalesce(gd.datacl,acldefault('d',gd.datdba))) a WHERE a.grantee IN (0,r.oid) AND a.is_grantable)
    OR EXISTS (SELECT 1 FROM r JOIN pg_class c ON true JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault((CASE WHEN c.relkind='S' THEN 'S' ELSE 'r' END)::"char",c.relowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.grantee IN (0,r.oid) AND a.is_grantable)
    OR EXISTS (SELECT 1 FROM r JOIN pg_attribute at ON at.attacl IS NOT NULL AND at.attnum>0 AND NOT at.attisdropped CROSS JOIN LATERAL aclexplode(at.attacl) a WHERE a.grantee IN (0,r.oid) AND a.is_grantable)
    OR EXISTS (SELECT 1 FROM r JOIN pg_proc p ON true JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND a.grantee IN (0,r.oid) AND a.is_grantable)
    OR EXISTS (SELECT 1 FROM r JOIN pg_type t ON true JOIN pg_namespace n ON n.oid=t.typnamespace CROSS JOIN LATERAL aclexplode(coalesce(t.typacl,acldefault('T',t.typowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.grantee IN (0,r.oid) AND a.is_grantable)
    OR EXISTS (SELECT 1 FROM r JOIN pg_namespace n ON true CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.grantee IN (0,r.oid) AND a.is_grantable)
    OR EXISTS (SELECT 1 FROM r JOIN pg_largeobject_metadata o ON true CROSS JOIN LATERAL aclexplode(coalesce(o.lomacl,acldefault('L',o.lomowner))) a WHERE a.grantee IN (0,r.oid) AND a.is_grantable)
    OR EXISTS (SELECT 1 FROM r JOIN pg_foreign_server f ON f.srvacl IS NOT NULL CROSS JOIN LATERAL aclexplode(f.srvacl) a WHERE a.grantee IN (0,r.oid) AND a.is_grantable)
  UNION ALL
  SELECT 'unapproved default privileges'::text
  WHERE EXISTS (
    SELECT 1 FROM r JOIN pg_default_acl d ON true LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE (d.defaclnamespace=0 OR n.nspname NOT IN ('pg_catalog','information_schema','pg_toast'))
      AND a.grantee IN (0,r.oid)
      AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','USAGE','EXECUTE')
  )
), result AS (SELECT count(*) AS violation_count FROM violations)
SELECT violation_count=0 AS role_preconditions, violation_count,
       (SELECT string_agg(DISTINCT reason, ', ' ORDER BY reason) FROM violations) AS violation_reasons
FROM result
\gset
\if :role_preconditions
\else
  ROLLBACK;
  \echo 'ABORT: pre-grant privilege verification found an unexpected, unprovable, or incompatible state; no grant was applied. Reasons: ' :violation_reasons
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_pregrant_check_blocked'; END $$;
\endif

GRANT CONNECT ON DATABASE :"audit_database" TO :"audit_role";

-- Grant only the version column, and only when the canonical ledger is a
-- regular/partitioned table with version text and RLS/FORCE RLS disabled.
SELECT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_type t ON t.oid=a.atttypid
  WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'
    AND c.relkind IN ('r','p') AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
    AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped AND t.typname='text'
) AS ledger_compatible
\gset
\if :ledger_compatible
  GRANT USAGE ON SCHEMA supabase_migrations TO :"audit_role";
  GRANT SELECT (version) ON TABLE supabase_migrations.schema_migrations TO :"audit_role";
  \echo 'Canonical migration ledger found; only version-column SELECT was granted.'
\else
  \echo 'Canonical migration ledger unavailable or incompatible; no schema or table privilege granted.'
\endif
COMMIT;
