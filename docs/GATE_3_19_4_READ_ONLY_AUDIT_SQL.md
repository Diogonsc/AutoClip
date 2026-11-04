# Gate 3.19.4 — consultas de auditoria SQL read-only

As consultas abaixo são preparadas, **não executadas**. Rodar somente com identidade autorizada de leitura, em staging isolado primeiro. Não substituir por `postgres` ou `service_role`; não usar comandos de escrita. Nenhuma consulta retorna conteúdo de tokens, e-mails, mídias ou linhas identificáveis.

Executar o arquivo numa sessão cuja transação esteja explicitamente read-only; interromper se o servidor negar a configuração. Usar statement timeout curto no cliente/sessão e não salvar saída bruta em logs públicos.

```sql
BEGIN READ ONLY;

-- Confirma banco, papel efetivo e versão PostgreSQL (sem connection string).
SELECT current_database() AS database_name,
       current_user AS effective_role,
       current_setting('server_version') AS server_version;

-- Ledger: versões aplicadas, sem migration bodies ou dados de negócio.
SELECT version
FROM supabase_migrations.schema_migrations
ORDER BY version;

-- Inventário de relações de aplicação/Storage e estado RLS.
SELECT n.nspname AS schema_name, c.relname AS relation_name,
       c.relkind AS relation_kind, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'storage', 'auth')
  AND c.relkind IN ('r', 'p', 'v', 'm')
ORDER BY n.nspname, c.relname;

-- Policies declaradas em tabelas de aplicação e Storage.
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname IN ('public', 'storage', 'auth')
ORDER BY schemaname, tablename, policyname;

-- RPCs expostas: assinatura, SECURITY DEFINER/config e privilégios efetivos.
SELECT n.nspname AS schema_name, p.proname AS function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.prosecdef AS security_definer, p.proconfig AS function_settings,
       pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'storage')
ORDER BY n.nspname, p.proname, identity_arguments;

-- Grants explícitos em tabelas de aplicação/Storage.
SELECT table_schema, table_name, grantee, privilege_type, is_grantable
FROM information_schema.role_table_grants
WHERE table_schema IN ('public', 'storage')
ORDER BY table_schema, table_name, grantee, privilege_type;

-- Grants de sequência, quando houver.
SELECT n.nspname AS sequence_schema, c.relname AS sequence_name,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee,
       acl.privilege_type, acl.is_grantable
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(
  coalesce(c.relacl, pg_catalog.acldefault('S', c.relowner))
) AS acl
LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
WHERE c.relkind = 'S'
  AND n.nspname IN ('public', 'storage')
ORDER BY n.nspname, c.relname, grantee;

-- Privilégios efetivos por papel sobre tabelas/views de aplicação/Storage.
SELECT n.nspname AS schema_name, c.relname AS relation_name,
       role_name.role_name,
       pg_catalog.has_table_privilege(role_name.role_name, c.oid, 'SELECT') AS can_select,
       pg_catalog.has_table_privilege(role_name.role_name, c.oid, 'INSERT') AS can_insert,
       pg_catalog.has_table_privilege(role_name.role_name, c.oid, 'UPDATE') AS can_update,
       pg_catalog.has_table_privilege(role_name.role_name, c.oid, 'DELETE') AS can_delete
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS role_name(role_name)
WHERE n.nspname IN ('public', 'storage')
  AND c.relkind IN ('r', 'p', 'v', 'm')
ORDER BY n.nspname, c.relname, role_name.role_name;

-- Apenas limites/visibilidade dos buckets; não enumera objetos.
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
ORDER BY id;

-- Triggers não internos: nomes e destinos, sem texto de função ou payload.
SELECT trigger_ns.nspname AS schema_name, relation.relname AS table_name,
       trigger.tgname AS trigger_name, function_ns.nspname AS function_schema,
       function_proc.proname AS function_name, trigger.tgenabled AS enabled_mode
FROM pg_catalog.pg_trigger AS trg
JOIN pg_catalog.pg_class AS relation ON relation.oid = trg.tgrelid
JOIN pg_catalog.pg_namespace AS trigger_ns ON trigger_ns.oid = relation.relnamespace
JOIN pg_catalog.pg_proc AS function_proc ON function_proc.oid = trg.tgfoid
JOIN pg_catalog.pg_namespace AS function_ns ON function_ns.oid = function_proc.pronamespace
WHERE NOT trg.tgisinternal
  AND (trigger_ns.nspname IN ('public', 'storage', 'auth') OR function_ns.nspname IN ('public', 'storage', 'auth'))
ORDER BY trigger_ns.nspname, relation.relname, trg.tgname;

-- Somente agregados operacionais, sem IDs/chaves/nomes de objeto.
SELECT status, count(*) AS media_count
FROM public.media_assets
GROUP BY status
ORDER BY status;

-- Somente executar depois de confirmar que M04 criou validation_status.
SELECT status, validation_status, count(*) AS media_count
FROM public.media_assets
GROUP BY status, validation_status
ORDER BY status, validation_status;

SELECT status, count(*) AS job_count
FROM public.publication_jobs
GROUP BY status
ORDER BY status;

SELECT connection_status, count(*) AS channel_count
FROM public.channels
GROUP BY connection_status
ORDER BY connection_status;

-- Executar após confirmar por information_schema que M10 já existe.
-- Não retorna token/attempt IDs.
SELECT refresh_state, count(*) AS connection_count
FROM public.oauth_connections
GROUP BY refresh_state
ORDER BY refresh_state;

-- Para Shop, somente agregados; essa tabela será lida se existir no staging.
SELECT connection_status, refresh_state, count(*) AS shop_connection_count
FROM public.tiktok_shop_connections
GROUP BY connection_status, refresh_state
ORDER BY connection_status, refresh_state;

ROLLBACK;
```

Consulta opcional para `pg_cron` — execute separadamente, somente após confirmar
que `cron.job` existe. Não consulta a coluna `command`:

```sql
BEGIN READ ONLY;
SELECT jobid, schedule, active, database, username
FROM cron.job
ORDER BY jobid;
ROLLBACK;
```

Se `cron.job` não existir, não execute esse bloco. A confirmação de existência
pode ser feita com `SELECT to_regclass('cron.job') IS NOT NULL;` fora da transação
principal.

## Notas de segurança e execução

- `role_usage_grants` pode variar por versão de PostgreSQL; se a consulta de sequências não compilar na versão instalada, registrar a falha e usar `information_schema.role_sequences`/catálogos compatíveis após revisão. Não substituir por `SELECT *`.
- Se a tabela de ledger, Shop, `refresh_state` ou `cron.job` não existir, não adaptar silenciosamente; registrar versão/schema e executar apenas os blocos aplicáveis depois de aprovação.
- A auditoria de RLS exige depois testes sintéticos por role A/B; metadata de policy não comprova isolamento em runtime.
- `pg_policies.qual`/`with_check` são expressões de política, não dados de usuário; manter a saída protegida por revelar a lógica de autorização.
- Não consultar `oauth_connections` ou `tiktok_shop_connections` com `SELECT *`; somente agregados de estado, sem refresh token/token_version/attempt.
