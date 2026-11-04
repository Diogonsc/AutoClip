\set ON_ERROR_STOP on
\ir ../_guard.psql

-- Definitive removal, separately authorized and only after emergency disable.
BEGIN;
SELECT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=:'audit_role'
  AND shobj_description(r.oid,'pg_authid')='autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn'
  AND NOT r.rolcanlogin AND r.rolvaliduntil<=now()
  AND NOT EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=:'audit_database' AND a.grantee=r.oid AND a.privilege_type='CONNECT')
  AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
  AND NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relowner=r.oid)
  AND NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.proowner=r.oid)
  AND NOT EXISTS(SELECT 1 FROM pg_type t WHERE t.typowner=r.oid)
  AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspowner=r.oid)
  AND NOT EXISTS(SELECT 1 FROM pg_largeobject_metadata l WHERE l.lomowner=r.oid)
  AND NOT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.pid<>pg_backend_pid() AND a.usename=r.rolname)
) AS role_ready_for_removal
\gset
\if :role_ready_for_removal
\else
  ROLLBACK;
  \echo 'ABORT: role marker, disabled state, grant revocation, ownership, membership or session preconditions failed.'
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_role_removal_precondition_failed'; END $$;
\endif

-- DROP ROLE has no CASCADE. PostgreSQL aborts safely if any ACL/dependency remains.
DROP ROLE :"audit_role";
COMMIT;

SELECT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=:'audit_role') AS auditor_role_absent
\gset
\if :auditor_role_absent
  \echo 'ROLE_ABSENT_VERIFIED'
\else
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_role_still_exists'; END $$;
\endif
