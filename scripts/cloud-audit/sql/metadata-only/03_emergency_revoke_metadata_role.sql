\set ON_ERROR_STOP on
\ir ../_guard.psql

-- Emergency action, separately authorized. Disables new logins, removes only this
-- marked role's named grants, commits first, then terminates sessions for it.
BEGIN;
SELECT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=:'audit_role'
  AND shobj_description(r.oid,'pg_authid')='autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn') AS role_marker_matches
\gset
\if :role_marker_matches
\else
  ROLLBACK;
  \echo 'ABORT: auditor role marker missing; refusing emergency revocation.'
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_role_marker_mismatch'; END $$;
\endif
ALTER ROLE :"audit_role" NOLOGIN VALID UNTIL 'epoch';
REVOKE CONNECT ON DATABASE :"audit_database" FROM :"audit_role";
SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='supabase_migrations') AS ledger_schema_exists
\gset
\if :ledger_schema_exists
  REVOKE USAGE ON SCHEMA supabase_migrations FROM :"audit_role";
  SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped) AS ledger_column_exists
  \gset
  \if :ledger_column_exists
    REVOKE SELECT (version) ON TABLE supabase_migrations.schema_migrations FROM :"audit_role";
  \endif
\endif
COMMIT;

SELECT coalesce(bool_and(pg_terminate_backend(pid)),true) AS auditor_sessions_terminated
FROM pg_stat_activity
WHERE pid<>pg_backend_pid() AND usename=:'audit_role'
\gset
\if :auditor_sessions_terminated
  \echo 'EMERGENCY REVOCATION COMPLETE: new logins disabled, named grants revoked, active sessions terminated.'
\else
  \echo 'EMERGENCY REVOCATION PARTIAL: role is NOLOGIN and named grants are revoked, but an active session could not be confirmed terminated.'
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_active_session_termination_failed'; END $$;
\endif
