\set ON_ERROR_STOP on
\ir _guard.psql
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
SELECT coalesce((
  SELECT c.relkind IN ('r','p') AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
    AND pg_catalog.has_column_privilege(current_user,c.oid,'version','SELECT')
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
      WHERE a.attrelid=c.oid AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped AND t.typname='text')
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'
),false) AS ledger_read_shape_compatible
\gset
\if :ledger_read_shape_compatible
  SELECT jsonb_build_object('section','migration_ledger','status','available',
    'versions',(SELECT coalesce(jsonb_agg(version::text ORDER BY version::text),'[]'::jsonb)
      FROM supabase_migrations.schema_migrations),
    'read_columns',jsonb_build_array('version'));
\else
  SELECT jsonb_build_object('section','migration_ledger','status','NOT_VERIFIED',
    'reason','ledger missing, incompatible, or protected by RLS/FORCE RLS; no ledger rows read');
\endif
COMMIT;
