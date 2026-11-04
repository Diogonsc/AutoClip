\set ON_ERROR_STOP on
\ir _guard.psql
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
SELECT jsonb_build_object(
  'section','jobs_and_queue_catalog_shape',
  'extension_versions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion)
      ORDER BY e.extname),'[]'::jsonb) FROM pg_catalog.pg_extension e WHERE e.extname IN ('pg_cron','pg_net')),
  'relations',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'name',c.relname,'kind',c.relkind,'owner',pg_catalog.pg_get_userbyid(c.relowner),
      'row_security',c.relrowsecurity,'force_row_security',c.relforcerowsecurity,
      'column_count',(SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
      'policy_count',(SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid))
      ORDER BY n.nspname,c.relname),'[]'::jsonb)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE (n.nspname IN ('cron','net') AND c.relkind IN ('r','p','v','m','f'))
       OR (n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
           AND c.relname ~* '(job|queue|batch|quota|reservation|worker|attempt|cleanup)')),
  'operational_rows_read',false,'cron_command_text_read',false,'jobs_dispatched',false
);
COMMIT;
