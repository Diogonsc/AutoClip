\set ON_ERROR_STOP on
\ir _guard.psql
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
SELECT jsonb_build_object(
  'section','environment_preflight',
  'database',current_database(),
  'session_user',session_user,
  'current_user',current_user,
  'server_version_num',current_setting('server_version_num'),
  'application_name',current_setting('application_name'),
  'tls',(SELECT jsonb_build_object('active',ssl,'protocol',version,'cipher',cipher)
         FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()),
  'project_ref_validation','external_wrapper_and_owner_confirmation_required',
  'host_validation','fixed_Direct_conninfo_and_verify_full_required'
);
COMMIT;
