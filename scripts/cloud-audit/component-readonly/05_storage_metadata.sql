\set ON_ERROR_STOP on
\ir _guard.psql
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='storage' AND c.relname='buckets' AND c.relkind IN ('r','p'))
  AND EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='storage' AND c.relname='buckets' AND c.relkind IN ('r','p')
       AND pg_catalog.has_table_privilege(current_user,c.oid,'SELECT')
       AND (SELECT count(DISTINCT a.attname)=5 FROM pg_catalog.pg_attribute a
            WHERE a.attrelid=c.oid AND a.attname IN ('id','name','public','file_size_limit','allowed_mime_types')
              AND a.attnum>0 AND NOT a.attisdropped)) AS bucket_shape_compatible
\gset
\if :bucket_shape_compatible
  SELECT jsonb_build_object('section','storage_bucket_metadata','status','available',
    'buckets',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'name',name,'public',public,'file_size_limit',file_size_limit,
      'allowed_mime_types',allowed_mime_types) ORDER BY id),'[]'::jsonb) FROM storage.buckets),
    'objects_read',false,'signed_urls_created',false);
\else
  SELECT jsonb_build_object('section','storage_bucket_metadata','status','NOT_VERIFIED',
    'reason','storage.buckets missing or expected metadata columns unavailable','objects_read',false);
\endif
COMMIT;
