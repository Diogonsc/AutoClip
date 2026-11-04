\set ON_ERROR_STOP on
\ir ../_guard.psql

-- Marco B.1 candidate only. Requires separately approved Cloud admin execution.
-- The password is intentionally absent; set it later through an interactive psql password prompt.
SELECT (:'audit_role_expiry'::timestamptz > now()
  AND :'audit_role_expiry'::timestamptz <= now() + interval '14 days') AS expiry_valid
\gset
\if :expiry_valid
\else
  \echo 'ABORT: role expiry must be in the future and no more than 14 days away.'
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_guard_blocked'; END $$;
\endif

BEGIN;
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=:'audit_role') AS role_absent
\gset
\if :role_absent
\else
  ROLLBACK;
  \echo 'ABORT: role already exists; inspect manually, no role was modified.'
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_guard_blocked'; END $$;
\endif

CREATE ROLE :"audit_role"
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 1 VALID UNTIL :'audit_role_expiry';

ALTER ROLE :"audit_role" SET default_transaction_read_only = 'on';
ALTER ROLE :"audit_role" SET statement_timeout = '20s';
ALTER ROLE :"audit_role" SET lock_timeout = '3s';
ALTER ROLE :"audit_role" SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE :"audit_role" SET search_path = '';
COMMENT ON ROLE :"audit_role" IS 'autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn';
COMMIT;

\echo 'Role created. Before use, set a strong password through an approved interactive psql password prompt; never place it in SQL, arguments, shell history, or logs.'
