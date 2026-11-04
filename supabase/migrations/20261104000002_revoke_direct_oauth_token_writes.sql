-- Keep service-role reads for server-side token loading and DELETE for an
-- explicit disconnect, but route every token/lease write through the audited
-- SECURITY DEFINER RPCs (save_tiktok_connection and the refresh CAS RPCs).
-- The service_role must not be able to bypass token_version/attempt fencing
-- with direct PostgREST INSERT, UPDATE, UPSERT, or TRUNCATE.
REVOKE INSERT, UPDATE, TRUNCATE ON TABLE public.oauth_connections
  FROM PUBLIC, anon, authenticated, service_role;

-- Supabase grants column-level privileges as well as table-level privileges.
-- Revoke existing column grants too, so they cannot keep a direct write path
-- alive after the table-level privileges are removed.
DO $revoke_oauth_column_writes$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO v_columns
    FROM pg_attribute AS a
   WHERE a.attrelid = 'public.oauth_connections'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped;

  IF v_columns IS NOT NULL THEN
    EXECUTE format(
      'REVOKE INSERT (%1$s), UPDATE (%1$s) ON TABLE public.oauth_connections FROM PUBLIC, anon, authenticated, service_role',
      v_columns
    );
  END IF;
END;
$revoke_oauth_column_writes$;
