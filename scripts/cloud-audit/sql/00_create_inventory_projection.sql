\ir _guard.psql

-- Keep the schema/function install atomic; connection loss or any failed
-- precondition rolls back both objects and the ACL changes below.
BEGIN;

-- ADMINISTRATIVE DDL. Never run in Cloud under the read-only audit authorization.
-- Requires a separately approved, trusted database administrator. This projection
-- returns global aggregates only; it never returns row IDs, paths, captions, users,
-- OAuth credentials, tokens, product data, or workspace identifiers.
DO $$
BEGIN
  IF NOT (current_user = 'postgres' OR coalesce((SELECT rolsuper FROM pg_roles WHERE rolname=current_user),false)
      OR pg_has_role(current_user,'postgres','MEMBER')) THEN
    RAISE EXCEPTION 'projection_install_requires_trusted_database_administrator';
  END IF;
  IF to_regnamespace('autoclip_audit') IS NOT NULL THEN
    RAISE EXCEPTION 'autoclip_audit_schema_already_exists_review_manually';
  END IF;
END;
$$;

-- Verify every relation/column referenced by the fixed projection before any
-- object is created. This is metadata-only and fails closed on schema drift.
DO $$
DECLARE invalid_relations text;
DECLARE invalid_columns text;
BEGIN
  -- SECURITY DEFINER must never bind to a view, materialized view, or foreign
  -- table supplied in place of an expected Supabase base table. Expected
  -- owners are pinned to the local, reviewed Supabase schema; any Cloud drift
  -- stops installation for manual review.
  WITH required(schema_name,table_name,owner_name) AS (VALUES
    ('storage','buckets','supabase_storage_admin'),
    ('storage','objects','supabase_storage_admin'),
    ('public','media_assets','postgres'),
    ('public','publication_jobs','postgres'),
    ('public','publication_quota_reservations','postgres')
  )
  SELECT string_agg(format('%I.%I (kind=%s, owner=%I)',r.schema_name,r.table_name,
      coalesce(c.relkind::text,'missing'),coalesce(owner.rolname,'missing')),
      ', ' ORDER BY r.schema_name,r.table_name)
  INTO invalid_relations
  FROM required r
  LEFT JOIN pg_namespace n ON n.nspname=r.schema_name
  LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=r.table_name
  LEFT JOIN pg_roles owner ON owner.oid=c.relowner
  WHERE c.oid IS NULL OR c.relkind NOT IN ('r','p') OR owner.rolname<>r.owner_name;
  IF invalid_relations IS NOT NULL THEN
    RAISE EXCEPTION 'projection_dependency_mismatch_relation_kind_or_owner: %',invalid_relations;
  END IF;

  -- Pin every referenced column to the reviewed schema type. This prevents a
  -- SECURITY DEFINER body from invoking an unexpected user-defined output or
  -- cast implementation after schema drift or object substitution.
  WITH required(schema_name,table_name,column_name,type_schema,type_name) AS (VALUES
    ('storage','buckets','id','pg_catalog','text'),
    ('storage','buckets','public','pg_catalog','bool'),
    ('storage','buckets','file_size_limit','pg_catalog','int8'),
    ('storage','buckets','allowed_mime_types','pg_catalog','_text'),
    ('storage','objects','bucket_id','pg_catalog','text'),
    ('storage','objects','name','pg_catalog','text'),
    ('storage','objects','metadata','pg_catalog','jsonb'),
    ('storage','objects','created_at','pg_catalog','timestamptz'),
    ('public','media_assets','id','pg_catalog','uuid'),
    ('public','media_assets','workspace_id','pg_catalog','uuid'),
    ('public','media_assets','status','public','media_status'),
    ('public','media_assets','validation_status','pg_catalog','text'),
    ('public','media_assets','mime_type','pg_catalog','text'),
    ('public','media_assets','file_size_bytes','pg_catalog','int8'),
    ('public','media_assets','checksum_sha256','pg_catalog','text'),
    ('public','media_assets','storage_key','pg_catalog','text'),
    ('public','publication_jobs','workspace_id','pg_catalog','uuid'),
    ('public','publication_jobs','media_asset_id','pg_catalog','uuid'),
    ('public','publication_jobs','media_asset_ids','pg_catalog','_uuid'),
    ('public','publication_jobs','status','public','publication_status'),
    ('public','publication_jobs','scheduled_at','pg_catalog','timestamptz'),
    ('public','publication_jobs','locked_at','pg_catalog','timestamptz'),
    ('public','publication_quota_reservations','status','public','quota_reservation_status')
  )
  SELECT string_agg(format('%I.%I.%I (expected %I.%I, found %s)',r.schema_name,r.table_name,r.column_name,
      r.type_schema,r.type_name,coalesce(format('%I.%I',tn.nspname,t.typname),'missing')),
      ', ' ORDER BY r.schema_name,r.table_name,r.column_name)
  INTO invalid_columns
  FROM required r
  LEFT JOIN pg_namespace n ON n.nspname=r.schema_name
  LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=r.table_name
  LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname=r.column_name AND a.attnum>0 AND NOT a.attisdropped
  LEFT JOIN pg_type t ON t.oid=a.atttypid
  LEFT JOIN pg_namespace tn ON tn.oid=t.typnamespace
  WHERE a.attnum IS NULL OR tn.nspname<>r.type_schema OR t.typname<>r.type_name;
  IF invalid_columns IS NOT NULL THEN
    RAISE EXCEPTION 'projection_dependency_mismatch_column_types: %',invalid_columns;
  END IF;
END;
$$;

CREATE SCHEMA autoclip_audit AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA autoclip_audit FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION autoclip_audit.inventory_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET default_transaction_read_only = 'on'
SET statement_timeout = '10s'
SET lock_timeout = '2s'
BEGIN ATOMIC
  SELECT jsonb_build_object(
    'projection_version', 'autoclip-cloud-audit-v1',
    'storage_buckets', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'bucket', b.id,
        'private', NOT b.public,
        'file_size_limit', b.file_size_limit,
        'allowed_mime_types', b.allowed_mime_types
      ) ORDER BY b.id), '[]'::jsonb)
      FROM storage.buckets b
    ),
    'storage_objects', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'bucket', x.bucket_id,
        'objects', x.object_count,
        'bytes_estimated', x.bytes_estimated,
        'mime_types', x.mime_types,
        'first_created_at', x.first_created_at,
        'last_created_at', x.last_created_at
      ) ORDER BY x.bucket_id), '[]'::jsonb)
      FROM (
        SELECT o.bucket_id,
          count(*) AS object_count,
          coalesce(sum(CASE
            WHEN coalesce(o.metadata->>'size','') ~ '^[0-9]{1,18}$'
              THEN (o.metadata->>'size')::bigint
            ELSE 0
          END),0) AS bytes_estimated,
          coalesce(jsonb_agg(DISTINCT o.metadata->>'mimetype') FILTER (WHERE o.metadata->>'mimetype' IS NOT NULL),'[]'::jsonb) AS mime_types,
          min(o.created_at) AS first_created_at,
          max(o.created_at) AS last_created_at
        FROM storage.objects o
        GROUP BY o.bucket_id
      ) x
    ),
    'media', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'status', x.status,
        'validation_status', x.validation_status,
        'mime_type', x.mime_type,
        'assets', x.asset_count,
        'bytes_estimated', x.bytes_estimated,
        'with_hash', x.with_hash
      ) ORDER BY x.status,x.validation_status,x.mime_type), '[]'::jsonb)
      FROM (
        SELECT m.status::text AS status, m.validation_status, m.mime_type,
          count(*) AS asset_count,
          coalesce(sum(m.file_size_bytes),0) AS bytes_estimated,
          count(*) FILTER (WHERE m.checksum_sha256 IS NOT NULL) AS with_hash
        FROM public.media_assets m
        GROUP BY m.status,m.validation_status,m.mime_type
      ) x
    ),
    'media_missing_final_object_count', (
      SELECT count(*) FROM public.media_assets m
      WHERE m.status::text='READY' AND m.storage_key IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='media' AND o.name=m.storage_key)
    ),
    'unreferenced_final_object_count', (
      SELECT count(*) FROM storage.objects o
      WHERE o.bucket_id='media'
        AND NOT EXISTS (SELECT 1 FROM public.media_assets m WHERE m.storage_key=o.name)
    ),
    'jobs', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'status', x.status,
        'jobs', x.job_count,
        'future_scheduled', x.future_scheduled,
        'expired_locks', x.expired_locks,
        'unknown', x.unknown_count,
        'sent_to_inbox', x.sent_to_inbox_count
      ) ORDER BY x.status), '[]'::jsonb)
      FROM (
        SELECT j.status::text AS status,
          count(*) AS job_count,
          count(*) FILTER (WHERE j.status::text='SCHEDULED' AND j.scheduled_at>now()) AS future_scheduled,
          count(*) FILTER (WHERE j.locked_at IS NOT NULL AND j.locked_at<now()-interval '10 minutes') AS expired_locks,
          count(*) FILTER (WHERE j.status::text='UNKNOWN') AS unknown_count,
          count(*) FILTER (WHERE j.status::text='SENT_TO_INBOX') AS sent_to_inbox_count
        FROM public.publication_jobs j
        GROUP BY j.status
      ) x
    ),
    'jobs_with_unvalidated_media_count', (
      SELECT count(*) FROM public.publication_jobs j
      WHERE j.status::text IN ('SCHEDULED','READY','RETRY_WAIT')
        AND (
          NOT EXISTS (SELECT 1 FROM public.media_assets m WHERE m.id=j.media_asset_id
            AND m.workspace_id=j.workspace_id AND m.status::text='READY'
            AND m.validation_status='VALIDATED' AND m.checksum_sha256 IS NOT NULL)
          OR EXISTS (
            SELECT 1 FROM unnest(coalesce(j.media_asset_ids,'{}'::uuid[])) AS required(media_id)
            WHERE NOT EXISTS (SELECT 1 FROM public.media_assets m WHERE m.id=required.media_id
              AND m.workspace_id=j.workspace_id AND m.status::text='READY'
              AND m.validation_status='VALIDATED' AND m.checksum_sha256 IS NOT NULL)
          )
        )
    ),
    'quota_reservations', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('status',x.status,'reservations',x.reservation_count)
        ORDER BY x.status),'[]'::jsonb)
      FROM (SELECT r.status::text AS status,count(*) AS reservation_count
        FROM public.publication_quota_reservations r GROUP BY r.status) x
    )
  );
END;

ALTER FUNCTION autoclip_audit.inventory_summary() OWNER TO postgres;
REVOKE ALL ON FUNCTION autoclip_audit.inventory_summary() FROM PUBLIC, anon, authenticated, service_role;

-- Do not assume the four standard Supabase roles are the only recipients in
-- inherited default ACLs. Any unexpected grant stops the entire transaction.
DO $$
DECLARE unexpected text;
BEGIN
  SELECT string_agg(format('%I (%s)',grantee.rolname,acl.privilege_type),', ')
  INTO unexpected
  FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
  LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee
  WHERE p.oid='autoclip_audit.inventory_summary()'::regprocedure
    AND acl.grantee<>p.proowner AND acl.privilege_type='EXECUTE';
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'projection_unexpected_execute_grants: %',unexpected;
  END IF;

  SELECT string_agg(format('%I (%s)',coalesce(grantee.rolname,'PUBLIC'),acl.privilege_type),', ')
  INTO unexpected
  FROM pg_namespace ns CROSS JOIN LATERAL aclexplode(coalesce(ns.nspacl,acldefault('n',ns.nspowner))) acl
  LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee
  WHERE ns.nspname='autoclip_audit' AND acl.grantee<>ns.nspowner;
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'projection_unexpected_schema_grants: %',unexpected;
  END IF;
END;
$$;

COMMIT;
