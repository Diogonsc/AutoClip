\set ON_ERROR_STOP on
\ir _guard.psql

-- Mutating, owner-authorized operation. Disables new logins only.
-- No grants, memberships, sessions, PUBLIC privileges, or application objects are changed.
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='3s';

-- Supabase's postgres role may manage roles without SELECT on pg_authid.
-- pg_roles is the supported, password-redacted view used for all state checks below.
-- It cannot provide a row lock here; concurrent external role administration
-- remains a race and is explicitly treated as a residual operational risk.

-- Accept only the exact Gate 3.9 identity and observed membership edge.
-- Any unknown ownership/dependency, additional membership, or active session blocks.
SELECT coalesce((
  SELECT
    shobj_description(r.oid,'pg_authid')='autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn'
    AND NOT r.rolsuper
    AND NOT r.rolcreatedb
    AND NOT r.rolcreaterole
    AND NOT r.rolreplication
    AND NOT r.rolbypassrls
    AND NOT r.rolinherit
    AND r.rolconnlimit=1
    AND r.rolvaliduntil=timestamptz '2026-11-15 00:43:58+00'
    AND NOT EXISTS (
      SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid
    )
    AND (SELECT count(*)=1
      FROM pg_auth_members m
      JOIN pg_roles member ON member.oid=m.member
      WHERE m.roleid=r.oid
        AND member.rolname='postgres'
        AND m.admin_option
        AND NOT m.inherit_option
        AND NOT m.set_option)
    AND NOT EXISTS (
      SELECT 1 FROM pg_shdepend d
      WHERE d.refclassid='pg_authid'::regclass AND d.refobjid=r.oid
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_stat_activity a
      WHERE a.usename=r.rolname AND a.pid<>pg_backend_pid()
    )
  FROM pg_roles r
  WHERE r.rolname='autoclip_cloud_auditor'
),false) AS containment_preconditions_ok
\gset

\if :containment_preconditions_ok
\else
  ROLLBACK;
  \echo 'ABORT: role identity/state, membership, dependencies, or active-session precondition failed; no change committed.'
  SELECT 1/0;
\endif

SELECT rolcanlogin AS login_was_enabled
FROM pg_roles
WHERE rolname='autoclip_cloud_auditor'
\gset

\if :login_was_enabled
  ALTER ROLE autoclip_cloud_auditor NOLOGIN;
\else
  \echo 'Role already has NOLOGIN; no role change needed.'
\endif

SELECT coalesce((
  SELECT NOT r.rolcanlogin
    AND shobj_description(r.oid,'pg_authid')='autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn'
    AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
    AND NOT r.rolreplication AND NOT r.rolbypassrls AND NOT r.rolinherit
    AND r.rolconnlimit=1
    AND r.rolvaliduntil=timestamptz '2026-11-15 00:43:58+00'
    AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
    AND (SELECT count(*)=1 FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member
      WHERE m.roleid=r.oid AND member.rolname='postgres' AND m.admin_option
        AND NOT m.inherit_option AND NOT m.set_option)
    AND NOT EXISTS (SELECT 1 FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass AND d.refobjid=r.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.usename=r.rolname AND a.pid<>pg_backend_pid())
  FROM pg_roles r WHERE r.rolname='autoclip_cloud_auditor'
),false) AS no_login_postcondition_ok
\gset

\if :no_login_postcondition_ok
\else
  ROLLBACK;
  \echo 'ABORT: NOLOGIN postcondition failed before commit.'
  SELECT 1/0;
\endif

COMMIT;

-- Independent persisted-state confirmation; no session is terminated.
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='3s';
SELECT coalesce((
  SELECT NOT r.rolcanlogin
    AND shobj_description(r.oid,'pg_authid')='autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn'
    AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
    AND NOT r.rolreplication AND NOT r.rolbypassrls AND NOT r.rolinherit
    AND r.rolconnlimit=1
    AND r.rolvaliduntil=timestamptz '2026-11-15 00:43:58+00'
    AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
    AND (SELECT count(*)=1 FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member
      WHERE m.roleid=r.oid AND member.rolname='postgres' AND m.admin_option
        AND NOT m.inherit_option AND NOT m.set_option)
    AND NOT EXISTS (SELECT 1 FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass AND d.refobjid=r.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.usename=r.rolname AND a.pid<>pg_backend_pid())
  FROM pg_roles r WHERE r.rolname='autoclip_cloud_auditor'
),false) AS persisted_nologin_verified
\gset
\if :persisted_nologin_verified
\else
  ROLLBACK;
  \echo 'POST-COMMIT VERIFICATION FAILED: NOLOGIN may be committed; stop and reconcile with a new read-only diagnostic.'
  SELECT 1/0;
\endif
COMMIT;
\echo 'NOLOGIN VERIFIED: new role logins are disabled; no sessions were terminated.'
