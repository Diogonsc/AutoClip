-- Revoke only the explicit grants. Dependencies must be reviewed first.
\ir _guard.psql

-- Fail closed rather than leaving half-revoked privileges if an audit session
-- is still connected. The operator must close sessions and rerun after review.
BEGIN;

SELECT NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename=:'audit_role') AS no_active_audit_sessions \gset
\if :no_active_audit_sessions
\else
  \echo 'ABORT: close audit-role sessions and rerun revocation after review.'
  \quit 6
\endif
\if :{?audit_database}
\else
  \echo 'ABORT: set audit_database explicitly.'
  \quit 3
\endif
SELECT (current_database()=:'audit_database') AS database_matches \gset
\if :database_matches
\else
  \echo 'ABORT: current database does not match audit_database.'
  \quit 3
\endif
\if :{?audit_role}
\else
  \echo 'ABORT: set audit_role explicitly.'
  \quit 3
\endif
REVOKE EXECUTE ON FUNCTION autoclip_audit.inventory_summary() FROM :"audit_role";
REVOKE USAGE ON SCHEMA autoclip_audit FROM :"audit_role";
REVOKE SELECT (version) ON TABLE supabase_migrations.schema_migrations FROM :"audit_role";
REVOKE USAGE ON SCHEMA supabase_migrations FROM :"audit_role";
REVOKE CONNECT ON DATABASE :"audit_database" FROM :"audit_role";
ALTER ROLE :"audit_role" NOLOGIN VALID UNTIL '1970-01-01 00:00:00+00';
DROP ROLE :"audit_role";

COMMIT;
