-- Teste de contrato da aprovação: executado em ambiente de teste com migrações aplicadas.
BEGIN;
DO $$
DECLARE
  has_approval_required boolean;
  has_approval_status boolean;
  has_links_table boolean;
  has_public_policy boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publication_jobs' AND column_name='approval_required') INTO has_approval_required;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publication_jobs' AND column_name='approval_status') INTO has_approval_status;
  SELECT to_regclass('public.publication_approval_links') IS NOT NULL INTO has_links_table;
  SELECT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='publication_approval_links') INTO has_public_policy;
  IF NOT has_approval_required OR NOT has_approval_status OR NOT has_links_table THEN
    RAISE EXCEPTION 'Client approval migration missing required schema.';
  END IF;
  IF has_public_policy THEN
    RAISE EXCEPTION 'Public approval links must not expose direct table policies; access must go through the Edge Function.';
  END IF;
END $$;
ROLLBACK;
