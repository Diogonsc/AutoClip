\set ON_ERROR_STOP on
\ir _guard.psql

-- MUTATING ADMIN ACTION. Requires a separate, exact owner authorization.
-- It changes only the marked auditor role, does not alter grants or PUBLIC,
-- and commits NOLOGIN/expiry before attempting to terminate existing sessions.
BEGIN;
SELECT EXISTS(SELECT 1 FROM pg_roles r
  WHERE r.rolname='autoclip_cloud_auditor'
    AND shobj_description(r.oid,'pg_authid')='autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn') AS marker_matches
\gset
\if :marker_matches
\else
  ROLLBACK;
  \echo 'ABORT: auditor role missing or marker mismatch; no containment change committed.'
  SELECT 1/0;
\endif
ALTER ROLE autoclip_cloud_auditor NOLOGIN VALID UNTIL 'epoch';
COMMIT;

SELECT coalesce(bool_and(pg_terminate_backend(a.pid)),true) AS sessions_terminated
FROM pg_stat_activity a
WHERE a.pid<>pg_backend_pid() AND a.usename='autoclip_cloud_auditor'
\gset
\if :sessions_terminated
  \echo 'CONTAINMENT COMPLETE: new logins disabled; observed role sessions terminated.'
\else
  \echo 'CONTAINMENT PARTIAL: NOLOGIN/expiry committed, but one or more observed sessions remain; stop and investigate.'
  SELECT 1/0;
\endif
