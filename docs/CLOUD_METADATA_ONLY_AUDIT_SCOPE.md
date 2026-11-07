# AutoClipe — escopo de auditoria PostgreSQL metadata-only

**Atualização Gate 3.1: correção fail-closed local; nenhuma conexão ou operação Cloud ocorreu.**

## Escopo e exclusões

A ferramenta consulta somente SQLs estáticos allowlisted em transações `BEGIN READ ONLY`, com timeouts. O escopo cobre metadados visíveis dos catálogos e, se compatível e concedido, identificadores da coluna `version` em `supabase_migrations.schema_migrations`. Não lê linhas de negócio, Auth, OAuth, mídia, Storage, jobs, lotes, quotas ou agendamentos; não executa RPCs nem funções da aplicação. O que estiver inacessível é `NOT VERIFIED`, nunca considerado ausente.

Não criar `autoclip_audit` nem `inventory_summary()`. Nenhum SECURITY DEFINER, broker, grant em tabela de negócio ou mudança global de PUBLIC.

## Role e grants

`autoclip_cloud_auditor`: LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, CONNECTION LIMIT 1, expiração máxima de 14 dias; defaults read-only, timeouts limitados e search_path vazio. Senha fora do SQL. Grants: CONNECT em `postgres`; condicionalmente USAGE em `supabase_migrations` e SELECT só na coluna `version` do ledger textual compatível. O SQL Gate 3.1 verifica privilégios efetivos antes do primeiro GRANT e aborta em estado inesperado. O checker de role inclui leitura/ACL de objetos e CONNECT a outros bancos; exceção de bancos internos existe apenas no harness local.

### TEMP herdado de PUBLIC — risco residual ALTO

A ferramenta recusa TEMP por padrão. A exceção exige `--allow-public-temp-project-ref djrwfvcxgpyknmizqumn` e prova ACL exclusivamente por PUBLIC, sem grant direto, membership, grant option, ownership ou inconsistência. **A role ainda pode criar objetos temporários em outra sessão fora do auditor.** As consultas do auditor usam transações explicitamente READ ONLY; isso não proíbe completamente escrita temporária fora dele. Não revogar TEMP globalmente.

## Destino

O auditor valida project ref, host direto `db.djrwfvcxgpyknmizqumn.supabase.co`, porta 5432, database `postgres`, usuário dedicado, ausência de parâmetros URL e força TLS `verify-full`. Poolers são recusados. Isto é preflight local; não autentica um destino Cloud. Operador futuro deve confirmar host oficial, certificado/hostname TLS, database, usuário e `pg_stat_ssl.ssl=true`. O guard SQL e variável de project ref são apenas controles auxiliares, não prova de host nem autorização.

## Hashes e efeitos

Aprovação individual por arquivo e hash; mudança de bytes invalida aprovações anteriores.

| Arquivo | Efeito | Executor | Risco | SHA-256 |
|---|---|---|---|---|
| `scripts/cloud-audit/sql/_guard.psql` | Valida variáveis, Ref e database informado e conectado; não autentica destino | psql e sessão administrativa | Baixo | `d3a55368c841eeabea364155e27c7799cb6f3d50042bc867aecaff12607b4347` |
| `scripts/cloud-audit/sql/metadata-only/00_create_role.sql` | Cria role, defaults e marcador | CREATEROLE/admin aprovado | Médio | `74a7a95cb411b93942df6e386358f25f8e157e979fd6e0600bd48586063adbf4` |
| `scripts/cloud-audit/sql/metadata-only/01_grant_minimum_permissions.sql` | CONNECT e grant condicional do ledger sem RLS | Grant authority e owner do ledger | Médio | `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796` |
| `scripts/cloud-audit/sql/metadata-only/02_verify_metadata_readonly.sql` | Verificação de catálogo fail-closed READ ONLY | Catálogos visíveis | Baixo | `49d6d2d6a7550f111fa44e762a7474a16dce3071975a65a6c90829c4e53d5637` |
| `scripts/cloud-audit/sql/metadata-only/03_emergency_revoke_metadata_role.sql` | NOLOGIN, REVOKE nomeado e termina sessões autenticadas | Owner/admin aprovado | Alto; ação separada | `ef6a8e0365caafa657fc0e5ccbdc8ee4d250bb6ec92e2220ab5ef2f1c519ac17` |
| `scripts/cloud-audit/sql/metadata-only/04_remove_metadata_role.sql` | Remoção definitiva sem CASCADE após precondições | Owner/admin aprovado | Alto; ação separada | `08da9cff7023f71b3a9205482a4091f0b45dd57f7472729100fece673f1af4bf` |

## Conteúdo SQL exato para revisão

Guard e scripts 00–02 são operações separadas de criação e verificação. Scripts 03–04 são ações futuras separadas de revogação/remoção.

### scripts/cloud-audit/sql/_guard.psql

```sql
\set ON_ERROR_STOP on
\if :{?audit_local_test}
\else
  \echo 'ABORT: define audit_local_test=true only in the isolated local test, or provide explicit cloud approval variables.'
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_guard_blocked'; END $$;
\endif
\if :audit_local_test
  \echo 'LOCAL ISOLATED TEST MODE. This guard does not imply Cloud authorization.'
  SELECT (current_database() ~ '^autoclip_audit_test_[a-f0-9]{8}$'
    AND inet_server_addr() IS NULL AND current_user='supabase_admin') AS local_test_target
\gset
  \if :local_test_target
  \else
    \echo 'ABORT: local test mode is restricted to the isolated local Supabase database over its local socket.'
    DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_guard_blocked'; END $$;
  \endif
\else
  \if :{?cloud_admin_approved}
  \else
    \echo 'ABORT: explicit cloud_admin_approved=true is required for future remote administration.'
    DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_guard_blocked'; END $$;
  \endif
  \if :cloud_admin_approved
  \else
    \echo 'ABORT: remote administrative approval is false.'
    DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_guard_blocked'; END $$;
  \endif
  \if :{?cloud_project_ref}
  \else
    \echo 'ABORT: explicit cloud_project_ref is required.'
    DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_guard_blocked'; END $$;
  \endif
  SELECT (:'cloud_project_ref' = 'djrwfvcxgpyknmizqumn') AS approved_ref_matches
\gset
  \if :approved_ref_matches
  \else
    \echo 'ABORT: project ref does not match the approved AutoClipe project.'
    DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_guard_blocked'; END $$;
  \endif
  \if :{?audit_database}
  \else
    \echo 'ABORT: explicit audit_database=postgres is required for the approved Supabase Cloud target.'
    DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_guard_blocked'; END $$;
  \endif
  SELECT (:'audit_database' = 'postgres') AS approved_database_matches
\gset
  \if :approved_database_matches
  \else
    \echo 'ABORT: administrative SQL is restricted to the Supabase postgres database.'
    DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_guard_blocked'; END $$;
  \endif
  SELECT (current_database() = 'postgres') AS actual_database_matches
\gset
  \if :actual_database_matches
  \else
    \echo 'ABORT: connected database is not the approved postgres database.'
    DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_guard_blocked'; END $$;
  \endif
\endif
\if :{?audit_role}
\else
  \echo 'ABORT: set audit_role explicitly.'
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_guard_blocked'; END $$;
\endif
SELECT (:'audit_role' ~ '^autoclip_cloud_auditor(_test_[a-f0-9]{8})?$') AS audit_role_valid
\gset
\if :audit_role_valid
\else
  \echo 'ABORT: unexpected audit role name.'
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_guard_blocked'; END $$;
\endif
```

### scripts/cloud-audit/sql/metadata-only/00_create_role.sql

```sql
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
```

### scripts/cloud-audit/sql/metadata-only/01_grant_minimum_permissions.sql

```sql
\set ON_ERROR_STOP on
\ir ../_guard.psql

-- Gate 3.1: fail closed on effective privileges before any GRANT.
-- The transaction narrows the check/apply window; it cannot serialize with
-- independent administrators changing ACLs. Gate 4 must re-verify.
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='3s';

WITH r AS (SELECT * FROM pg_roles WHERE rolname=:'audit_role'),
d AS (SELECT * FROM pg_database WHERE datname=current_database()),
l AS (
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_type t ON t.oid=a.atttypid
    WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'
      AND c.relkind IN ('r','p') AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
      AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped AND t.typname='text'
  ) AS compatible
),
violations(reason) AS (
  SELECT 'role identity/flags/expiry'::text WHERE NOT EXISTS (
    SELECT 1 FROM r
    WHERE rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls
      AND rolconnlimit=1 AND rolvaliduntil>now()
      AND rolvaliduntil<=now()+interval '14 days'
      AND shobj_description(oid,'pg_authid')='autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn'
  )
  UNION ALL
  SELECT 'role session defaults'::text WHERE NOT EXISTS (
    SELECT 1 FROM r
    WHERE EXISTS (SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x WHERE s.setrole=r.oid AND s.setdatabase=0 AND x='default_transaction_read_only=on')
      AND EXISTS (SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x WHERE s.setrole=r.oid AND s.setdatabase=0 AND x='statement_timeout=20s')
      AND EXISTS (SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x WHERE s.setrole=r.oid AND s.setdatabase=0 AND x='lock_timeout=3s')
      AND EXISTS (SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x WHERE s.setrole=r.oid AND s.setdatabase=0 AND x='idle_in_transaction_session_timeout=30s')
      AND EXISTS (SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x WHERE s.setrole=r.oid AND s.setdatabase=0 AND x='search_path=""')
      AND NOT EXISTS (
        SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x
        WHERE s.setrole=r.oid AND s.setdatabase IN (0,(SELECT oid FROM d))
          AND x NOT IN ('default_transaction_read_only=on','statement_timeout=20s','lock_timeout=3s','idle_in_transaction_session_timeout=30s','search_path=""')
      )
  )
  UNION ALL
  SELECT 'role membership/delegation'::text
  WHERE EXISTS (SELECT 1 FROM r JOIN pg_auth_members m ON m.member=r.oid OR m.roleid=r.oid)
  UNION ALL
  SELECT 'privilege on a non-target database'::text
  WHERE EXISTS (
    SELECT 1 FROM r JOIN pg_database other_db
      ON other_db.oid<>(SELECT oid FROM d) AND other_db.datallowconn
    WHERE (has_database_privilege(r.rolname,other_db.oid,'CONNECT')
        OR has_database_privilege(r.rolname,other_db.oid,'CREATE')
        OR has_database_privilege(r.rolname,other_db.oid,'TEMP'))
      AND NOT (
        :'audit_local_test'::boolean
        AND other_db.datname IN ('postgres','_supabase','storage_vectors','template1')
        AND NOT has_database_privilege(r.rolname,other_db.oid,'CREATE')
        AND NOT EXISTS (
          SELECT 1 FROM pg_database local_db
          CROSS JOIN LATERAL aclexplode(coalesce(local_db.datacl,acldefault('d',local_db.datdba))) acl
          WHERE local_db.oid=other_db.oid
            AND acl.grantee=r.oid
            AND acl.privilege_type IN ('CONNECT','CREATE','TEMPORARY')
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_database local_db
          CROSS JOIN LATERAL aclexplode(coalesce(local_db.datacl,acldefault('d',local_db.datdba))) acl
          WHERE local_db.oid=other_db.oid AND acl.grantee=0
            AND acl.privilege_type IN ('CONNECT','CREATE','TEMPORARY') AND acl.is_grantable
        )
      )
  )
  UNION ALL
  SELECT 'object ownership'::text
  WHERE EXISTS (
    SELECT 1 FROM r JOIN pg_shdepend s ON s.refclassid='pg_authid'::regclass AND s.refobjid=r.oid AND s.deptype='o'
    WHERE s.dbid IN (0,(SELECT oid FROM d))
  )
  UNION ALL
  SELECT 'database CREATE or TEMP provenance'::text
  WHERE EXISTS (
    SELECT 1 FROM r CROSS JOIN d
    WHERE has_database_privilege(r.rolname,d.oid,'CREATE')
      OR has_database_privilege(r.rolname,d.oid,'TEMP') IS DISTINCT FROM EXISTS (
        SELECT 1 FROM pg_database x CROSS JOIN LATERAL aclexplode(coalesce(x.datacl,acldefault('d',x.datdba))) a
        WHERE x.oid=d.oid AND a.grantee=0 AND a.privilege_type='TEMPORARY'
      )
      OR EXISTS (SELECT 1 FROM pg_database x CROSS JOIN LATERAL aclexplode(coalesce(x.datacl,acldefault('d',x.datdba))) a WHERE x.oid=d.oid AND a.grantee=r.oid AND a.privilege_type='TEMPORARY')
      OR EXISTS (SELECT 1 FROM pg_database x CROSS JOIN LATERAL aclexplode(coalesce(x.datacl,acldefault('d',x.datdba))) a WHERE x.oid=d.oid AND a.grantee=0 AND a.privilege_type='TEMPORARY' AND a.is_grantable)
      OR d.datdba=r.oid
  )
  UNION ALL
  SELECT 'unapproved schema USAGE/CREATE'::text
  WHERE EXISTS (
    SELECT 1 FROM r CROSS JOIN l JOIN pg_namespace n ON n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND n.nspname NOT LIKE 'pg_temp_%'
    WHERE has_schema_privilege(r.rolname,n.oid,'CREATE')
      OR (has_schema_privilege(r.rolname,n.oid,'USAGE') AND n.nspname NOT IN ('public','supabase_migrations'))
      OR (has_schema_privilege(r.rolname,n.oid,'USAGE') AND n.nspname='supabase_migrations' AND NOT l.compatible)
  )
  UNION ALL
  SELECT 'unapproved relation read/write privilege'::text
  WHERE EXISTS (
    SELECT 1 FROM r CROSS JOIN l JOIN pg_class c ON c.relkind IN ('r','p','v','m','f')
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND (
      has_table_privilege(r.rolname,c.oid,'INSERT') OR has_table_privilege(r.rolname,c.oid,'UPDATE')
      OR has_table_privilege(r.rolname,c.oid,'DELETE') OR has_table_privilege(r.rolname,c.oid,'TRUNCATE')
      OR has_table_privilege(r.rolname,c.oid,'REFERENCES') OR has_table_privilege(r.rolname,c.oid,'TRIGGER')
      OR has_any_column_privilege(r.rolname,c.oid,'INSERT') OR has_any_column_privilege(r.rolname,c.oid,'UPDATE')
      OR has_table_privilege(r.rolname,c.oid,'SELECT')
      OR (has_any_column_privilege(r.rolname,c.oid,'SELECT') AND NOT (l.compatible AND n.nspname='supabase_migrations' AND c.relname='schema_migrations'))
    )
  )
  UNION ALL
  SELECT 'unapproved ledger column privilege'::text
  WHERE EXISTS (
    SELECT 1 FROM r CROSS JOIN l JOIN pg_class c ON c.relkind IN ('r','p')
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'
      AND has_column_privilege(r.rolname,c.oid,a.attnum,'SELECT')
      AND NOT (l.compatible AND a.attname='version')
  )
  UNION ALL
  SELECT 'unapproved sequence privilege'::text
  WHERE EXISTS (
    SELECT 1 FROM r JOIN pg_class c ON c.relkind='S' JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
      AND (has_sequence_privilege(r.rolname,c.oid,'USAGE') OR has_sequence_privilege(r.rolname,c.oid,'SELECT') OR has_sequence_privilege(r.rolname,c.oid,'UPDATE'))
  )
  UNION ALL
  SELECT 'application routine EXECUTE'::text
  WHERE EXISTS (
    SELECT 1 FROM r JOIN pg_proc p ON p.prokind IN ('f','p','a','w') JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
      AND has_schema_privilege(r.rolname,n.oid,'USAGE') AND has_function_privilege(r.rolname,p.oid,'EXECUTE')
  )
  UNION ALL
  SELECT 'custom type USAGE'::text
  WHERE EXISTS (
    SELECT 1 FROM r JOIN pg_type t ON true JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
      AND t.typacl IS NOT NULL
      AND has_type_privilege(r.rolname,t.oid,'USAGE')
  )
  UNION ALL
  SELECT 'large object privilege'::text
  WHERE EXISTS (
    SELECT 1 FROM r JOIN pg_largeobject_metadata o ON true
    CROSS JOIN LATERAL aclexplode(coalesce(o.lomacl,acldefault('L',o.lomowner))) a
    WHERE a.grantee IN (0,r.oid)
  )
  UNION ALL
  SELECT 'foreign server USAGE'::text
  WHERE EXISTS (SELECT 1 FROM r JOIN pg_foreign_server f ON true WHERE has_server_privilege(r.rolname,f.oid,'USAGE'))
  UNION ALL
  SELECT 'grant option'::text
  WHERE EXISTS (SELECT 1 FROM r JOIN pg_database gd ON true CROSS JOIN LATERAL aclexplode(coalesce(gd.datacl,acldefault('d',gd.datdba))) a WHERE a.grantee IN (0,r.oid) AND a.is_grantable)
    OR EXISTS (SELECT 1 FROM r JOIN pg_class c ON true JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault((CASE WHEN c.relkind='S' THEN 'S' ELSE 'r' END)::"char",c.relowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.grantee IN (0,r.oid) AND a.is_grantable)
    OR EXISTS (SELECT 1 FROM r JOIN pg_attribute at ON at.attacl IS NOT NULL AND at.attnum>0 AND NOT at.attisdropped CROSS JOIN LATERAL aclexplode(at.attacl) a WHERE a.grantee IN (0,r.oid) AND a.is_grantable)
    OR EXISTS (SELECT 1 FROM r JOIN pg_proc p ON true JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND a.grantee IN (0,r.oid) AND a.is_grantable)
    OR EXISTS (SELECT 1 FROM r JOIN pg_type t ON true JOIN pg_namespace n ON n.oid=t.typnamespace CROSS JOIN LATERAL aclexplode(coalesce(t.typacl,acldefault('T',t.typowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.grantee IN (0,r.oid) AND a.is_grantable)
    OR EXISTS (SELECT 1 FROM r JOIN pg_namespace n ON true CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.grantee IN (0,r.oid) AND a.is_grantable)
    OR EXISTS (SELECT 1 FROM r JOIN pg_largeobject_metadata o ON true CROSS JOIN LATERAL aclexplode(coalesce(o.lomacl,acldefault('L',o.lomowner))) a WHERE a.grantee IN (0,r.oid) AND a.is_grantable)
    OR EXISTS (SELECT 1 FROM r JOIN pg_foreign_server f ON f.srvacl IS NOT NULL CROSS JOIN LATERAL aclexplode(f.srvacl) a WHERE a.grantee IN (0,r.oid) AND a.is_grantable)
  UNION ALL
  SELECT 'unapproved default privileges'::text
  WHERE EXISTS (
    SELECT 1 FROM r JOIN pg_default_acl d ON true LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE (d.defaclnamespace=0 OR n.nspname NOT IN ('pg_catalog','information_schema','pg_toast'))
      AND a.grantee IN (0,r.oid)
      AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','USAGE','EXECUTE')
  )
), result AS (SELECT count(*) AS violation_count FROM violations)
SELECT violation_count=0 AS role_preconditions, violation_count,
       (SELECT string_agg(DISTINCT reason, ', ' ORDER BY reason) FROM violations) AS violation_reasons
FROM result
\gset
\if :role_preconditions
\else
  ROLLBACK;
  \echo 'ABORT: pre-grant privilege verification found an unexpected, unprovable, or incompatible state; no grant was applied. Reasons: ' :violation_reasons
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_pregrant_check_blocked'; END $$;
\endif

GRANT CONNECT ON DATABASE :"audit_database" TO :"audit_role";

-- Grant only the version column, and only when the canonical ledger is a
-- regular/partitioned table with version text and RLS/FORCE RLS disabled.
SELECT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_type t ON t.oid=a.atttypid
  WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'
    AND c.relkind IN ('r','p') AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
    AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped AND t.typname='text'
) AS ledger_compatible
\gset
\if :ledger_compatible
  GRANT USAGE ON SCHEMA supabase_migrations TO :"audit_role";
  GRANT SELECT (version) ON TABLE supabase_migrations.schema_migrations TO :"audit_role";
  \echo 'Canonical migration ledger found; only version-column SELECT was granted.'
\else
  \echo 'Canonical migration ledger unavailable or incompatible; no schema or table privilege granted.'
\endif
COMMIT;
```

### scripts/cloud-audit/sql/metadata-only/02_verify_metadata_readonly.sql

```sql
\set ON_ERROR_STOP on
\ir ../_guard.psql

-- Verification is read-only. It reports catalog visibility and effective ACLs.
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='3s';
WITH raw AS (
SELECT jsonb_build_object(
  'role', r.rolname,
  'role_marker_matches', shobj_description(r.oid,'pg_authid')='autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn',
  'login', r.rolcanlogin,
  'superuser', r.rolsuper,
  'inherit', r.rolinherit,
  'create_role', r.rolcreaterole,
  'create_db', r.rolcreatedb,
  'replication', r.rolreplication,
  'bypass_rls', r.rolbypassrls,
  'connection_limit', r.rolconnlimit,
  'valid_until', r.rolvaliduntil,
  'role_defaults',coalesce((SELECT jsonb_object_agg(split_part(x,'=',1),substr(x,strpos(x,'=')+1)) FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x WHERE s.setrole=r.oid AND s.setdatabase=0 AND split_part(x,'=',1) IN ('default_transaction_read_only','statement_timeout','lock_timeout','idle_in_transaction_session_timeout','search_path')),'{}'::jsonb),
  'comment', shobj_description(r.oid,'pg_authid'),
  'membership_count',(SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid),
  'database_connect',has_database_privilege(r.rolname,current_database(),'CONNECT'),
  'database_create',has_database_privilege(r.rolname,current_database(),'CREATE'),
  'database_temp',has_database_privilege(r.rolname,current_database(),'TEMP'),
  'temp_acl_sources',(SELECT jsonb_build_object('public',coalesce(bool_or(a.grantee=0),false),'direct',coalesce(bool_or(a.grantee=r.oid),false),'membership',coalesce(bool_or(a.grantee<>0 AND a.grantee<>r.oid AND pg_has_role(r.oid,a.grantee,'MEMBER')),false),'public_grant_option',coalesce(bool_or(a.grantee=0 AND a.is_grantable),false)) FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() AND a.privilege_type='TEMPORARY'),
  'schema_create',EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND has_schema_privilege(r.rolname,n.oid,'CREATE')),
  'business_relation_select',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast','supabase_migrations') AND (has_table_privilege(r.rolname,c.oid,'SELECT') OR has_any_column_privilege(r.rolname,c.oid,'SELECT'))),
  'business_schema_usage',EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast','public','supabase_migrations') AND n.nspname NOT LIKE 'pg_temp_%' AND has_schema_privilege(r.rolname,n.oid,'USAGE')),
  'unapproved_schema_usage',EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast','public','supabase_migrations') AND n.nspname NOT LIKE 'pg_temp_%' AND has_schema_privilege(r.rolname,n.oid,'USAGE')),
  'unapproved_relation_reads',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND (has_table_privilege(r.rolname,c.oid,'SELECT') OR has_any_column_privilege(r.rolname,c.oid,'SELECT')) AND NOT (n.nspname='supabase_migrations' AND c.relname='schema_migrations')) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>'version' AND has_column_privilege(r.rolname,c.oid,a.attnum,'SELECT')),
  'persistent_write',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND (has_table_privilege(r.rolname,c.oid,'INSERT') OR has_table_privilege(r.rolname,c.oid,'UPDATE') OR has_table_privilege(r.rolname,c.oid,'DELETE') OR has_table_privilege(r.rolname,c.oid,'TRUNCATE') OR has_any_column_privilege(r.rolname,c.oid,'INSERT') OR has_any_column_privilege(r.rolname,c.oid,'UPDATE'))),
  'ledger_relation_present',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'),
  'ledger_shape_compatible',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_type t ON t.oid=a.atttypid WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped AND t.typname='text'),
  'ledger_column_select_scope_safe',NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND c.relkind NOT IN ('r','p')) AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND has_table_privilege(r.rolname,c.oid,'SELECT')) AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>'version' AND has_column_privilege(r.rolname,c.oid,a.attnum,'SELECT')),
  'ledger_schema_usage',coalesce((SELECT has_schema_privilege(r.rolname,n.oid,'USAGE') FROM pg_namespace n WHERE n.nspname='supabase_migrations'),false),
  'ledger_version_select',(SELECT has_column_privilege(r.rolname,c.oid,a.attnum,'SELECT') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped),
  'ledger_table_select',(SELECT has_table_privilege(r.rolname,c.oid,'SELECT') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'),
  'database_owner',(SELECT d.datdba=r.oid FROM pg_database d WHERE d.datname=current_database()),
  'executable_application_functions',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND has_schema_privilege(r.rolname,n.oid,'USAGE') AND has_function_privilege(r.rolname,p.oid,'EXECUTE')),
  'large_object_access',EXISTS(SELECT 1 FROM pg_largeobject_metadata l CROSS JOIN LATERAL aclexplode(coalesce(l.lomacl,acldefault('L',l.lomowner))) a WHERE a.grantee IN (0,r.oid) OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER'))),
  'unapproved_sequence_access',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND (has_sequence_privilege(r.rolname,c.oid,'USAGE') OR has_sequence_privilege(r.rolname,c.oid,'SELECT') OR has_sequence_privilege(r.rolname,c.oid,'UPDATE'))),
  'grant_option',EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault((CASE WHEN c.relkind='S' THEN 'S' ELSE 'r' END)::"char",c.relowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_attribute at JOIN pg_class c ON c.oid=at.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(at.attacl) a WHERE at.attacl IS NOT NULL AND at.attnum>0 AND NOT at.attisdropped AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace CROSS JOIN LATERAL aclexplode(coalesce(t.typacl,acldefault('T',t.typowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_largeobject_metadata l CROSS JOIN LATERAL aclexplode(coalesce(l.lomacl,acldefault('L',l.lomowner))) a WHERE a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))),
  'default_privileges_for_public_or_auditor',EXISTS(SELECT 1 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE (d.defaclnamespace=0 OR n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')) AND a.grantee IN (0,r.oid) AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','USAGE','EXECUTE')),
  'owned_objects',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relowner=r.oid AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proowner=r.oid AND n.nspname NOT IN ('pg_catalog','information_schema')) OR EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typowner=r.oid AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')) OR EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspowner=r.oid) OR EXISTS(SELECT 1 FROM pg_largeobject_metadata l WHERE l.lomowner=r.oid)
) AS verification
FROM (VALUES (1)) singleton(dummy) LEFT JOIN pg_roles r ON r.rolname=:'audit_role'
), checks AS (
 SELECT verification,jsonb_build_object(
   'identity',coalesce(verification->>'role'=:'audit_role',false),
   'role_marker',coalesce((verification->>'role_marker_matches')::boolean,false),
   'login',coalesce((verification->>'login')::boolean,false),
   'admin_attributes',coalesce(NOT ((verification->>'superuser')::boolean OR (verification->>'inherit')::boolean OR (verification->>'create_role')::boolean OR (verification->>'create_db')::boolean OR (verification->>'replication')::boolean OR (verification->>'bypass_rls')::boolean),false),
   'connection_limit',coalesce((verification->>'connection_limit')::integer=1,false),
   'expiry',coalesce((verification->>'valid_until')::timestamptz>now() AND (verification->>'valid_until')::timestamptz<=now()+interval '14 days',false),
   'role_defaults',coalesce(verification->'role_defaults'->>'default_transaction_read_only'='on' AND verification->'role_defaults'->>'statement_timeout'='20s' AND verification->'role_defaults'->>'lock_timeout'='3s' AND verification->'role_defaults'->>'idle_in_transaction_session_timeout'='30s' AND verification->'role_defaults'->>'search_path'='""',false),
   'no_memberships',coalesce((verification->>'membership_count')::integer=0,false),
   'database_connect',coalesce((verification->>'database_connect')::boolean,false),
   'no_database_create',coalesce(NOT (verification->>'database_create')::boolean,false),
   'no_schema_create',coalesce(NOT (verification->>'schema_create')::boolean,false),
   'no_business_read',coalesce(NOT (verification->>'business_relation_select')::boolean AND NOT (verification->>'business_schema_usage')::boolean AND NOT (verification->>'unapproved_schema_usage')::boolean AND NOT (verification->>'unapproved_relation_reads')::boolean,false),
   'no_persistent_write',coalesce(NOT (verification->>'persistent_write')::boolean,false),
   'no_custom_function_execute',coalesce(NOT (verification->>'executable_application_functions')::boolean,false),
   'no_sequence_access',coalesce(NOT (verification->>'unapproved_sequence_access')::boolean,false),
   'no_large_object_access',coalesce(NOT (verification->>'large_object_access')::boolean,false),
   'no_grant_option',coalesce(NOT (verification->>'grant_option')::boolean,false),
   'no_unapproved_default_privileges',coalesce(NOT (verification->>'default_privileges_for_public_or_auditor')::boolean,false),
   'no_object_ownership',coalesce(NOT (verification->>'owned_objects')::boolean AND NOT (verification->>'database_owner')::boolean,false),
   'temp_provenance',coalesce(
      (verification->>'database_temp')::boolean=coalesce((verification #>> '{temp_acl_sources,public}')::boolean,false)
      AND NOT (verification #>> '{temp_acl_sources,direct}')::boolean
      AND NOT (verification #>> '{temp_acl_sources,membership}')::boolean
      AND NOT (verification #>> '{temp_acl_sources,public_grant_option}')::boolean
      AND NOT (verification->>'database_owner')::boolean
      AND (NOT (verification->>'database_temp')::boolean OR (verification #>> '{temp_acl_sources,public}')::boolean),false),
   'ledger_scope',coalesce(CASE WHEN (verification->>'ledger_shape_compatible')::boolean
      THEN (verification->>'ledger_schema_usage')::boolean AND (verification->>'ledger_version_select')::boolean AND NOT (verification->>'ledger_table_select')::boolean AND (verification->>'ledger_column_select_scope_safe')::boolean
      ELSE NOT (verification->>'ledger_schema_usage')::boolean AND NOT coalesce((verification->>'ledger_version_select')::boolean,false) AND NOT coalesce((verification->>'ledger_table_select')::boolean,false)
   END,false)
 ) AS checks FROM raw
), classified AS (
 SELECT verification,checks,coalesce((SELECT bool_and(value::boolean) FROM jsonb_each_text(checks)),false) AS verification_safe FROM checks
)
SELECT jsonb_set(jsonb_set(verification,'{verification_checks}',checks),'{verification_safe}',to_jsonb(verification_safe)) AS verification_report,verification_safe FROM classified
\gset
\echo :verification_report
\if :verification_safe
  COMMIT;
  \echo 'METADATA-ONLY PRECHECK PASS.'
\else
  ROLLBACK;
  \echo 'ABORT: dangerous or unexpected effective privilege detected; metadata audit must not run.'
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_guard_blocked'; END $$;
\endif
```

### scripts/cloud-audit/sql/metadata-only/03_emergency_revoke_metadata_role.sql

```sql
\set ON_ERROR_STOP on
\ir ../_guard.psql

-- Emergency action, separately authorized. Disables new logins, removes only this
-- marked role's named grants, commits first, then terminates sessions for it.
BEGIN;
SELECT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=:'audit_role'
  AND shobj_description(r.oid,'pg_authid')='autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn') AS role_marker_matches
\gset
\if :role_marker_matches
\else
  ROLLBACK;
  \echo 'ABORT: auditor role marker missing; refusing emergency revocation.'
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_role_marker_mismatch'; END $$;
\endif
ALTER ROLE :"audit_role" NOLOGIN VALID UNTIL 'epoch';
REVOKE CONNECT ON DATABASE :"audit_database" FROM :"audit_role";
SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='supabase_migrations') AS ledger_schema_exists
\gset
\if :ledger_schema_exists
  REVOKE USAGE ON SCHEMA supabase_migrations FROM :"audit_role";
  SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped) AS ledger_column_exists
  \gset
  \if :ledger_column_exists
    REVOKE SELECT (version) ON TABLE supabase_migrations.schema_migrations FROM :"audit_role";
  \endif
\endif
COMMIT;

SELECT coalesce(bool_and(pg_terminate_backend(pid)),true) AS auditor_sessions_terminated
FROM pg_stat_activity
WHERE pid<>pg_backend_pid() AND usename=:'audit_role'
\gset
\if :auditor_sessions_terminated
  \echo 'EMERGENCY REVOCATION COMPLETE: new logins disabled, named grants revoked, active sessions terminated.'
\else
  \echo 'EMERGENCY REVOCATION PARTIAL: role is NOLOGIN and named grants are revoked, but an active session could not be confirmed terminated.'
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_active_session_termination_failed'; END $$;
\endif
```

### scripts/cloud-audit/sql/metadata-only/04_remove_metadata_role.sql

```sql
\set ON_ERROR_STOP on
\ir ../_guard.psql

-- Definitive removal, separately authorized and only after emergency disable.
BEGIN;
SELECT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=:'audit_role'
  AND shobj_description(r.oid,'pg_authid')='autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn'
  AND NOT r.rolcanlogin AND r.rolvaliduntil<=now()
  AND NOT EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=:'audit_database' AND a.grantee=r.oid AND a.privilege_type='CONNECT')
  AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
  AND NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relowner=r.oid)
  AND NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.proowner=r.oid)
  AND NOT EXISTS(SELECT 1 FROM pg_type t WHERE t.typowner=r.oid)
  AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspowner=r.oid)
  AND NOT EXISTS(SELECT 1 FROM pg_largeobject_metadata l WHERE l.lomowner=r.oid)
  AND NOT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.pid<>pg_backend_pid() AND a.usename=r.rolname)
) AS role_ready_for_removal
\gset
\if :role_ready_for_removal
\else
  ROLLBACK;
  \echo 'ABORT: role marker, disabled state, grant revocation, ownership, membership or session preconditions failed.'
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_role_removal_precondition_failed'; END $$;
\endif

-- DROP ROLE has no CASCADE. PostgreSQL aborts safely if any ACL/dependency remains.
DROP ROLE :"audit_role";
COMMIT;

SELECT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=:'audit_role') AS auditor_role_absent
\gset
\if :auditor_role_absent
  \echo 'ROLE_ABSENT_VERIFIED'
\else
  DO $$ BEGIN RAISE EXCEPTION 'metadata_audit_role_still_exists'; END $$;
\endif
```

## Execução e revogação

1. Aprovar Project Ref, operador, janela, arquivo/hash, ação e autenticação.
2. Confirmar endpoint oficial direto, TLS/hostname, database e identidade por canal confiável.
3. Executar somente 00; definir senha em ação interativa separadamente aprovada.
4. Executar somente 01; parar.
5. Executar 02; qualquer falha, timeout ou saída parcial é NO-GO.
6. Marco C exige autorização independente.
7. Revogação emergencial 03 e remoção definitiva 04 exigem autorizações distintas.

O ciclo não é atomicamente reversível. Em falha parcial, parar. Emergência encerra sessões apenas por `usename` autenticado, nunca por `application_name` falsificável. Remoção não usa CASCADE nem DROP OWNED e aborta diante de dependências.

## Limitações

Visibilidade de catálogos depende de versão/ownership e pode ser parcial. Ledger com RLS habilitado não recebe grants e suas versões ficam NOT VERIFIED. Auditoria não cobre Storage, Auth administrativa, Edge Functions, Vercel ou dados operacionais. PostgreSQL local 17.6 não prova configuração Cloud. O guard valida o banco conectado, mas variável Project Ref não prova identidade do servidor; a verificação do endpoint oficial/TLS continua sendo tarefa do operador. TEMP fora da ferramenta continua risco alto. Nenhuma conexão Cloud ocorreu.

## Gate 3.1: pre-grant ACL allowlist e evidência final local

A versão candidata atual de `01_grant_minimum_permissions.sql` consulta privilégios efetivos via `has_*_privilege` e catálogos de membership/ownership/ACL/default ACL, com checks antes do primeiro `GRANT`. A transação `SERIALIZABLE` agrupa precheck e grants, mas não é garantia permanente nem elimina por completo alterações simultâneas feitas por administradores independentes. Um estado inesperado ou não verificável executa `ROLLBACK` e erro não zero. Não há reparo/revogação automática.

Privilégios aceitos: CONNECT somente ao database alvo, USAGE apenas no schema canônico do ledger quando compatível, SELECT somente na coluna textual `version` se não houver RLS/FORCE RLS, e a capacidade TEMP exclusivamente herdada de PUBLIC sob aceite expresso (risco ALTO). USAGE padrão de tipos customizados herdado de PUBLIC sem ACL explícita é tratado como comportamento normal do PostgreSQL, sem leitura de dados. CONNECT efetivo a banco Cloud não alvo, escrita, leitura de negócio, schema usage fora do escopo, routine EXECUTE customizado, sequence, large object, grant option, membership, ownership, ACL/default ACL explícitos ou dúvida de catálogo bloqueiam.

O harness local isolado possui exceção somente de teste para os bancos internos locais `postgres`, `_supabase` e `storage_vectors`; a branch Cloud não tem essa exceção. O teste Cloud-strict simulado provou bloqueio de CONNECT herdado de PUBLIC a bancos fora do alvo. Esse resultado deve ser reavaliado se o Cloud apresentar o mesmo padrão, sem revogar PUBLIC globalmente nem ampliar a allowlist.

Execução final local: `node --test scripts/cloud-audit/readonly-audit.test.mjs` — 18/18, 0 falhas, 0 skips; `node scripts/cloud-audit/test-readonly-role-local.mjs` — `LOCAL_METADATA_ONLY_ROLE_TESTS_PASSED`, PostgreSQL local 17.6, 30 cenários negativos, incluindo 15 estados bloqueados antes de qualquer GRANT e erro após GRANT com rollback confirmado; reexecução com grants allowlisted preexistentes aceita. Foram corrigidas falhas intermediárias do harness (escape de `\\gset`, isolamento do erro transacional) e sincronização de aprovação/documentação; ambos os comandos foram reexecutados com sucesso. Nenhuma conexão Cloud ocorreu.

Hash antigo de `01_grant_minimum_permissions.sql`: `4db6b51292a8b1a2311979fcd92acba130c4aa34cc9aeaac4be211968ff463c6` — **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. Hash atual é candidato local, sem aprovação Cloud; qualquer mudança futura invalida novamente a revisão.


O candidato anterior do Gate 3.1, hash `f19ab0675df9434413799baf8c7d1c2349280d5a85aa230c638b900c9ec6c386`, também está **SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO**. O hash candidato vigente é `6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796`; esta revisão não autoriza sua execução remota.
