\ir _guard.psql

-- Explicit read grants are atomic and limited to the audit projection/ledger.
BEGIN;

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

-- Required for the local and Cloud migration ledger only.
GRANT CONNECT ON DATABASE :"audit_database" TO :"audit_role";
GRANT USAGE ON SCHEMA supabase_migrations TO :"audit_role";
GRANT SELECT (version) ON TABLE supabase_migrations.schema_migrations TO :"audit_role";

-- This grants exactly one reviewed, no-argument aggregate projection. It does
-- not grant SELECT on public business tables or Storage object paths.
GRANT USAGE ON SCHEMA autoclip_audit TO :"audit_role";
GRANT EXECUTE ON FUNCTION autoclip_audit.inventory_summary() TO :"audit_role";

COMMIT;
