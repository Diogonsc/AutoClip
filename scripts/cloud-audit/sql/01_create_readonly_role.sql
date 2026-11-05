\ir _guard.psql

-- Role creation and session defaults are one atomic administrative change.
BEGIN;

-- Creates a restricted login with no password. Cloud password authentication
-- remains unavailable until the administrator sets one interactively with psql
-- \password after reviewing verification output. Never add PASSWORD here.
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=:'audit_role') AS role_exists \gset
\if :role_exists
  \echo 'ABORT: audit role already exists. Do not modify an existing role automatically.'
  \quit 4
\endif
\if :{?audit_role_expiry}
\else
  \echo 'ABORT: provide a short UTC audit_role_expiry.'
  \quit 3
\endif
SELECT (:'audit_role_expiry'::timestamptz > now()
  AND :'audit_role_expiry'::timestamptz <= now()+interval '14 days') AS expiry_valid \gset
\if :expiry_valid
\else
  \echo 'ABORT: role expiry must be in the next 14 days.'
  \quit 3
\endif
SELECT format('CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1 VALID UNTIL %L', :'audit_role', :'audit_role_expiry') \gexec
SELECT format('ALTER ROLE %I SET default_transaction_read_only TO on', :'audit_role') \gexec
SELECT format('ALTER ROLE %I SET statement_timeout TO %L', :'audit_role', '10s') \gexec
SELECT format('ALTER ROLE %I SET lock_timeout TO %L', :'audit_role', '2s') \gexec
SELECT format('ALTER ROLE %I SET idle_in_transaction_session_timeout TO %L', :'audit_role', '15s') \gexec
SELECT format('ALTER ROLE %I SET search_path TO %L', :'audit_role', '') \gexec
SELECT format('ALTER ROLE %I SET application_name TO %L', :'audit_role', 'autoclip-cloud-audit') \gexec

COMMIT;
