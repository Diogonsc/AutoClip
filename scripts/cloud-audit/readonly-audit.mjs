#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readdir, writeFile } from 'node:fs/promises';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDir = join(root, 'supabase/migrations');
export const autoClipProjectRef = 'djrwfvcxgpyknmizqumn';

export function parseArgs(argv) {
  const result = { flags: new Set(), values: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    if (['--execute-read-only', '--i-confirm-read-only-credential', '--local-manifest', '--help'].includes(arg)) result.flags.add(arg);
    else {
      if (!['--audit-scope', '--target-project-ref', '--allow-public-temp-project-ref', '--json', '--markdown'].includes(arg)) throw new Error(`Unsupported option: ${arg}`);
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      result.values.set(arg, value);
    }
  }
  return result;
}

export function validateTarget({ args, databaseUrl }) {
  if (!args.flags.has('--execute-read-only') || !args.flags.has('--i-confirm-read-only-credential')) throw new Error('Remote access requires both explicit read-only confirmation flags.');
  if (args.values.get('--audit-scope') !== 'metadata-only') throw new Error('Select the supported scope explicitly with --audit-scope metadata-only.');
  const projectRef = args.values.get('--target-project-ref') ?? '';
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error('Provide the exact Supabase project ref using --target-project-ref.');
  if (projectRef !== autoClipProjectRef) throw new Error('Project ref does not match the confirmed AutoClip Cloud project; refusing connection.');
  const tempExceptionRef = args.values.get('--allow-public-temp-project-ref');
  if (tempExceptionRef && tempExceptionRef !== projectRef) throw new Error('PUBLIC TEMP exception must be explicitly bound to the same confirmed project ref.');
  if (!databaseUrl) throw new Error('AUTOCLIP_CLOUD_AUDIT_DATABASE_URL is required; no .env file is loaded.');
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Database URL must use PostgreSQL protocol.');
  if (url.hostname !== `db.${projectRef}.supabase.co` || (url.port && url.port !== '5432')) throw new Error('Database host does not exactly match the direct PostgreSQL endpoint for the explicitly confirmed project; poolers and alternate hosts are refused.');
  if (decodeURIComponent(url.username) !== 'autoclip_cloud_auditor' || !url.password || url.pathname !== '/postgres') throw new Error('Use the dedicated autoclip_cloud_auditor identity and database `postgres`.');
  if (url.search || url.hash) throw new Error('Connection URL query parameters and fragments are prohibited; TLS and libpq settings are pinned by the audit tool.');
  return { projectRef, url, allowPublicTempProjectRef: tempExceptionRef, scope: 'metadata-only' };
}

export function psqlEnvironment(url, parent = process.env) {
  const env = { ...parent };
  for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGPASSWORD', 'PGHOSTADDR', 'PGTARGETSESSIONATTRS', 'PGSSLROOTCERT', 'PGSSLCERT', 'PGSSLKEY', 'PGOPTIONS', 'PGAPPNAME', 'DATABASE_URL', 'AUTOCLIP_CLOUD_AUDIT_DATABASE_URL', 'AUTOCLIP_AUDIT_PGPASS_SECRET']) delete env[key];
  env.PGHOST = url.hostname;
  env.PGPORT = url.port || '5432';
  env.PGUSER = decodeURIComponent(url.username);
  env.AUTOCLIP_AUDIT_PGPASS_SECRET = decodeURIComponent(url.password);
  env.PGDATABASE = decodeURIComponent(url.pathname.slice(1) || 'postgres');
  env.PGSSLMODE = 'verify-full';
  env.PGAPPNAME = `autoclip-cloud-audit:${autoClipProjectRef}`;
  env.PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=20000 -c lock_timeout=3000';
  env.PGCONNECT_TIMEOUT = '8';
  return env;
}

export function isSafePreflight(preflight, { projectRef, allowPublicTempProjectRef, allowLocalTestRole = false } = {}) {
  const flags = preflight?.role_flags ?? {};
  const expiresAt = Date.parse(preflight?.role_valid_until ?? '');
  const expirationWindowMs = expiresAt - Date.now();
  const tempSources = preflight?.temp_acl_sources;
  const noNonPublicTempGrant = tempSources?.direct === false && tempSources?.membership === false;
  const tempSourceMatchesEffective = typeof flags.database_temp === 'boolean' && typeof tempSources?.public === 'boolean'
    && typeof tempSources?.direct === 'boolean' && typeof tempSources?.membership === 'boolean'
    && typeof preflight?.database_owner === 'boolean'
    && flags.database_temp === Boolean(tempSources.public || tempSources.direct || tempSources.membership || preflight.database_owner);
  const publicTempExceptionApplied = flags.database_temp === true && tempSources?.public === true
    && tempSources?.public_grant_option === false && noNonPublicTempGrant && preflight.database_owner === false
    && projectRef === autoClipProjectRef && allowPublicTempProjectRef === autoClipProjectRef;
  const tempSafe = tempSourceMatchesEffective && (flags.database_temp === false
    ? noNonPublicTempGrant && preflight.database_owner === false : publicTempExceptionApplied);
  return Boolean(preflight?.read_only) && preflight?.scope === 'metadata-only'
    && (preflight.database === 'postgres' || (allowLocalTestRole && /^autoclip_audit_test_[a-f0-9]{8}$/.test(preflight.database ?? '')))
    && (preflight.role === 'autoclip_cloud_auditor' || (allowLocalTestRole && /^autoclip_cloud_auditor_test_[a-f0-9]{8}$/.test(preflight.role ?? '')))
    && preflight.role_marker === 'autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn'
    && flags.login === true && preflight.role_defaults?.default_transaction_read_only === 'on'
    && preflight.role_defaults?.statement_timeout === '20s' && preflight.role_defaults?.lock_timeout === '3s'
    && preflight.role_defaults?.idle_in_transaction_session_timeout === '30s'
    && preflight.role_defaults?.search_path === '""'
    && Number.isFinite(expiresAt) && expirationWindowMs > 0 && expirationWindowMs <= 14 * 24 * 60 * 60 * 1000
    && !flags.superuser && !flags.inherit && !flags.create_role && !flags.create_db && !flags.replication && !flags.bypass_rls
    && !flags.database_create && tempSafe && !flags.schema_create && !flags.write_privileges
    && !preflight.elevated_membership && !(preflight.role_memberships ?? []).length
    && preflight.unexpected_function_execute === false && preflight.unapproved_relation_reads === false
    && preflight.unapproved_schema_usage === false
    && preflight.ledger_column_select_scope_safe === true && preflight.unapproved_sequence_access === false
    && preflight.unapproved_large_object_access === false && preflight.unapproved_grant_options === false
    && preflight.unapproved_default_privileges === false && preflight.owned_application_objects === false;
}

export function renderMarkdown(report) {
  const lines = ['# AutoClip — auditoria PostgreSQL metadata-only', '', `- Gerado em: ${report.generatedAt}`, `- Escopo: ${report.scope ?? 'não conectado'}`,
    `- Projeto: ${report.projectRef ? `ref explícita ${report.projectRef}` : 'não conectado'}`, `- Migrations locais: ${report.migrationCount ?? 'n/a'}`, '',
    '## Migrations locais', '', '| Versão | Arquivo |', '|---|---|', ...(report.migrations ?? []).map((item) => `| ${item.version} | ${item.file} |`)];
  if (report.migrationAudit) lines.push('', '## Qualidade da sequência local', '', '```json', JSON.stringify(report.migrationAudit, null, 2), '```');
  if (report.availability) lines.push('', '## Disponibilidade verificada', '', '```json', JSON.stringify(report.availability, null, 2), '```');
  if (report.preflight) lines.push('', '## Identidade e salvaguardas', '', '```json', JSON.stringify(report.preflight, null, 2), '```');
  if (report.sections) for (const [name, value] of Object.entries(report.sections)) lines.push('', `## ${name}`, '', '```json', JSON.stringify(value, null, 2), '```');
  lines.push('', '> O escopo não consulta linhas de negócio, Storage, jobs, quotas, dados pessoais ou funções agregadas. Dados inacessíveis são marcados NÃO VERIFICADO.', '');
  return lines.join('\n');
}

// Static SELECT statements only. No business-table row reads and no callable
// application functions. Metadata visibility limitations are reported, never bypassed.
export const auditQueries = {
  preflight: `SELECT jsonb_build_object(
    'scope','metadata-only','database',current_database(),'role',current_user,
    'role_marker',shobj_description(r.oid,'pg_authid'),
    'read_only',current_setting('transaction_read_only')='on','role_valid_until',r.rolvaliduntil,
    'role_defaults',coalesce((SELECT jsonb_object_agg(name,value) FROM (SELECT DISTINCT ON (split_part(x,'=',1)) split_part(x,'=',1) AS name,substr(x,strpos(x,'=')+1) AS value FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) x WHERE s.setrole=r.oid AND s.setdatabase IN (0,(SELECT oid FROM pg_database WHERE datname=current_database())) AND split_part(x,'=',1) IN ('default_transaction_read_only','statement_timeout','lock_timeout','idle_in_transaction_session_timeout','search_path') ORDER BY split_part(x,'=',1),s.setdatabase DESC) settings),'{}'::jsonb),
    'role_flags',jsonb_build_object('login',r.rolcanlogin,'superuser',r.rolsuper,'inherit',r.rolinherit,'create_role',r.rolcreaterole,'create_db',r.rolcreatedb,'replication',r.rolreplication,'bypass_rls',r.rolbypassrls,
      'database_create',has_database_privilege(current_user,current_database(),'CREATE'),'database_temp',has_database_privilege(current_user,current_database(),'TEMP'),
      'schema_create',EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND has_schema_privilege(current_user,n.oid,'CREATE')),
      'write_privileges',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND (has_table_privilege(current_user,c.oid,'INSERT') OR has_table_privilege(current_user,c.oid,'UPDATE') OR has_table_privilege(current_user,c.oid,'DELETE') OR has_table_privilege(current_user,c.oid,'TRUNCATE') OR has_any_column_privilege(current_user,c.oid,'INSERT') OR has_any_column_privilege(current_user,c.oid,'UPDATE'))) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND (has_sequence_privilege(current_user,c.oid,'USAGE') OR has_sequence_privilege(current_user,c.oid,'UPDATE')))),
    'unapproved_relation_reads',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND (has_table_privilege(current_user,c.oid,'SELECT') OR has_any_column_privilege(current_user,c.oid,'SELECT')) AND NOT (n.nspname='supabase_migrations' AND c.relname='schema_migrations')) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>'version' AND has_column_privilege(current_user,c.oid,a.attnum,'SELECT')),
    'unapproved_schema_usage',EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast','public','supabase_migrations') AND n.nspname NOT LIKE 'pg_temp_%' AND has_schema_privilege(current_user,n.oid,'USAGE')),
    'ledger_column_select_scope_safe',NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND c.relkind NOT IN ('r','p')) AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND has_table_privilege(current_user,c.oid,'SELECT')) AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>'version' AND has_column_privilege(current_user,c.oid,a.attnum,'SELECT')),
    'ledger_catalog_present',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'),
    'unapproved_sequence_access',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND (has_sequence_privilege(current_user,c.oid,'USAGE') OR has_sequence_privilege(current_user,c.oid,'SELECT') OR has_sequence_privilege(current_user,c.oid,'UPDATE'))),
    'unapproved_grant_options',EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault((CASE WHEN c.relkind='S' THEN 'S' ELSE 'r' END)::"char",c.relowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_attribute at JOIN pg_class c ON c.oid=at.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(at.attacl) a WHERE at.attacl IS NOT NULL AND at.attnum>0 AND NOT at.attisdropped AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace CROSS JOIN LATERAL aclexplode(coalesce(t.typacl,acldefault('T',t.typowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_largeobject_metadata l CROSS JOIN LATERAL aclexplode(coalesce(l.lomacl,acldefault('L',l.lomowner))) a WHERE a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))) OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.is_grantable AND (a.grantee=0 OR a.grantee=r.oid OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER')))),
    'unapproved_large_object_access',EXISTS(SELECT 1 FROM pg_largeobject_metadata l CROSS JOIN LATERAL aclexplode(coalesce(l.lomacl,acldefault('L',l.lomowner))) a WHERE a.grantee IN (0,r.oid) OR (a.grantee<>0 AND pg_has_role(r.oid,a.grantee,'MEMBER'))),
    'unapproved_default_privileges',EXISTS(SELECT 1 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE (d.defaclnamespace=0 OR n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')) AND a.grantee IN (0,r.oid) AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','USAGE','EXECUTE')),
    'database_owner',(SELECT d.datdba=r.oid FROM pg_database d WHERE d.datname=current_database()),
    'temp_acl_sources',(SELECT jsonb_build_object('public',coalesce(bool_or(a.grantee=0),false),'direct',coalesce(bool_or(a.grantee=r.oid),false),'membership',coalesce(bool_or(a.grantee<>0 AND a.grantee<>r.oid AND pg_has_role(r.oid,a.grantee,'MEMBER')),false),'public_grant_option',coalesce(bool_or(a.grantee=0 AND a.is_grantable),false)) FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() AND a.privilege_type='TEMPORARY'),
    'role_memberships',coalesce((SELECT jsonb_agg(parent.rolname ORDER BY parent.rolname) FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles child ON child.oid=m.member WHERE child.rolname=current_user),'[]'::jsonb),
    'elevated_membership',coalesce((SELECT bool_or(pg_has_role(current_user,e.rolname,'MEMBER')) FROM pg_roles e WHERE e.rolname IN ('postgres','service_role','supabase_admin')),false),
    'unexpected_function_execute',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p','a','w') AND n.nspname NOT IN ('pg_catalog','information_schema') AND has_schema_privilege(current_user,n.oid,'USAGE') AND has_function_privilege(current_user,p.oid,'EXECUTE')),
    'owned_application_objects',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND c.relowner=r.oid) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.proowner=r.oid) OR EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND t.typowner=r.oid) OR EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspowner=r.oid) OR EXISTS(SELECT 1 FROM pg_largeobject_metadata l WHERE l.lomowner=r.oid)
  ) FROM pg_roles r WHERE r.rolname=current_user`,
  availability: `SELECT jsonb_build_object('server_version_num',current_setting('server_version_num'),'database',current_database(),'role',current_user,'transaction_read_only',current_setting('transaction_read_only')='on','ledger_relation_in_catalog',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'),'ledger_row_security',coalesce((SELECT c.relrowsecurity OR c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations'),false),'ledger_version_column_in_catalog',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_type t ON t.oid=a.atttypid WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped AND t.typname='text'),'ledger_schema_usage',coalesce((SELECT has_schema_privilege(current_user,n.oid,'USAGE') FROM pg_namespace n WHERE n.nspname='supabase_migrations'),false),'ledger_version_select',coalesce((SELECT has_column_privilege(current_user,c.oid,a.attnum,'SELECT') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped),false))`,
  server: `SELECT jsonb_build_object('server_version',current_setting('server_version'),'server_version_num',current_setting('server_version_num'),'database',current_database(),'role',current_user,'transaction_read_only',current_setting('transaction_read_only')='on')`,
  schemas: `SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'owner',r.rolname,'usage',has_schema_privilege(current_user,n.oid,'USAGE'),'create',has_schema_privilege(current_user,n.oid,'CREATE')) ORDER BY n.nspname),'[]'::jsonb) FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'`,
  relations: `SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'owner',r.rolname,'rls_enabled',c.relrowsecurity,'rls_forced',c.relforcerowsecurity) ORDER BY n.nspname,c.relname),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'`,
  columns: `SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'relation',c.relname,'column',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'nullable',NOT a.attnotnull,'has_default',d.adbin IS NOT NULL) ORDER BY n.nspname,c.relname,a.attnum),'[]'::jsonb) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'`,
  constraints: `SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',con.conname,'type',con.contype,'definition',pg_get_constraintdef(con.oid)) ORDER BY n.nspname,c.relname,con.conname),'[]'::jsonb) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')`,
  indexes: `SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',t.relname,'name',i.relname,'definition',pg_get_indexdef(i.oid),'valid',ix.indisvalid,'unique',ix.indisunique) ORDER BY n.nspname,t.relname,i.relname),'[]'::jsonb) FROM pg_index ix JOIN pg_class i ON i.oid=ix.indexrelid JOIN pg_class t ON t.oid=ix.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')`,
  policies: `SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',(SELECT coalesce(jsonb_agg(r.rolname ORDER BY r.rolname),'[]'::jsonb) FROM unnest(p.polroles) x(role_oid) LEFT JOIN pg_roles r ON r.oid=x.role_oid),'using_expression',pg_get_expr(p.polqual,p.polrelid),'check_expression',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY n.nspname,c.relname,p.polname),'[]'::jsonb) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')`,
  routines: `SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity_arguments',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'kind',p.prokind,'security_definer',p.prosecdef,'volatility',p.provolatile,'owner',r.rolname,'search_path_configured',coalesce(array_position(p.proconfig,'search_path=""')>0,false)) ORDER BY n.nspname,p.proname),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname NOT IN ('pg_catalog','information_schema')`,
  triggers: `SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'internal',t.tgisinternal,'definition',pg_get_triggerdef(t.oid)) ORDER BY n.nspname,c.relname,t.tgname),'[]'::jsonb) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')`,
  grants: `SELECT coalesce(jsonb_agg(item ORDER BY item->>'schema',item->>'object',item->>'grantee',item->>'privilege'),'[]'::jsonb) FROM (
    SELECT jsonb_build_object('schema',n.nspname,'object',c.relname,'kind',c.relkind,'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,'privilege',a.privilege_type,'grantable',a.is_grantable) AS item
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault((CASE WHEN c.relkind='S' THEN 'S' ELSE 'r' END)::"char",c.relowner))) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
    UNION ALL
    SELECT jsonb_build_object('schema',n.nspname,'object',c.relname||'.'||at.attname,'kind','column','grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,'privilege',a.privilege_type,'grantable',a.is_grantable)
    FROM pg_attribute at JOIN pg_class c ON c.oid=at.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(at.attacl) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee
    WHERE at.attacl IS NOT NULL AND at.attnum>0 AND NOT at.attisdropped AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
    UNION ALL
    SELECT jsonb_build_object('schema',n.nspname,'object','<schema>','kind','schema','grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,'privilege',a.privilege_type,'grantable',a.is_grantable)
    FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
    UNION ALL
    SELECT jsonb_build_object('schema',n.nspname,'object',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')','kind','routine','grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,'privilege',a.privilege_type,'grantable',a.is_grantable)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee
    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
    UNION ALL
    SELECT jsonb_build_object('schema',NULL,'object',d.datname,'kind','database','grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,'privilege',a.privilege_type,'grantable',a.is_grantable)
    FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee WHERE d.datname=current_database()
    UNION ALL
    SELECT jsonb_build_object('schema',case when d.defaclnamespace=0 then NULL else n.nspname end,'object','<default>','kind',d.defaclobjtype,'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,'privilege',a.privilege_type,'grantable',a.is_grantable)
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee
    UNION ALL
    SELECT jsonb_build_object('schema',n.nspname,'object',t.typname,'kind','type','grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,'privilege',a.privilege_type,'grantable',a.is_grantable)
    FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace CROSS JOIN LATERAL aclexplode(coalesce(t.typacl,acldefault('T',t.typowner))) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
    UNION ALL
    SELECT jsonb_build_object('schema',NULL,'object',l.oid::text,'kind','large_object','grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,'privilege',a.privilege_type,'grantable',a.is_grantable)
    FROM pg_largeobject_metadata l CROSS JOIN LATERAL aclexplode(coalesce(l.lomacl,acldefault('L',l.lomowner))) a LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee
  ) acl_rows(item)`,
  migrationVersions: `SELECT coalesce(jsonb_agg(version::text ORDER BY version),'[]'::jsonb) FROM supabase_migrations.schema_migrations`,
};

export function runPsql(query, env, { binary = 'psql', timeoutMs = 30_000 } = {}) {
  if (!Object.values(auditQueries).some((statement) => statement.trim() === String(query).trim())) throw new Error('Refusing SQL not present in the static audit query allowlist.');
  const wrapped = `BEGIN READ ONLY; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='3s'; ${query}; COMMIT;`;
  const childEnv = { ...env };
  const password = childEnv.AUTOCLIP_AUDIT_PGPASS_SECRET;
  delete childEnv.AUTOCLIP_AUDIT_PGPASS_SECRET;
  delete childEnv.PGPASSWORD;
  let passDir;
  let result;
  try {
    if (password !== undefined) {
      passDir = mkdtempSync(join(tmpdir(), 'autoclip-cloud-audit-')); chmodSync(passDir, 0o700);
      const escaped = (value) => String(value).replace(/[\\:]/g, '\\$&');
      const passfile = join(passDir, 'pgpass');
      writeFileSync(passfile, `${[childEnv.PGHOST,childEnv.PGPORT,childEnv.PGDATABASE,childEnv.PGUSER,password].map(escaped).join(':')}\n`, { mode: 0o600 });
      chmodSync(passfile, 0o600); childEnv.PGPASSFILE = passfile;
    }
    result = spawnSync(binary, ['-X','-v','ON_ERROR_STOP=1','-A','-t','-c',wrapped], { env: childEnv, encoding:'utf8', timeout:timeoutMs, maxBuffer:12*1024*1024 });
  } finally { if (passDir) rmSync(passDir,{recursive:true,force:true}); }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `psql exited ${result.status}`).trim().slice(0,800));
  const line = result.stdout.trim().split(/\r?\n/).at(-1);
  return line ? JSON.parse(line) : null;
}

export async function localManifest() {
  const files=(await readdir(migrationsDir)).filter((name)=>name.endsWith('.sql')).sort();
  const names=files.filter((name)=>/^\d{14}_[a-z0-9_]+\.sql$/.test(name)); const versions=names.map((name)=>name.slice(0,14));
  const functions=(await readdir(join(root,'supabase/functions'),{withFileTypes:true})).filter((e)=>e.isDirectory()&&!e.name.startsWith('_')).map((e)=>e.name).sort();
  return {generatedAt:new Date().toISOString(),source:'repository only; no Cloud connection',migrationCount:names.length,
    migrationAudit:{invalidSqlFilenames:files.filter((n)=>!/^\d{14}_[a-z0-9_]+\.sql$/.test(n)),duplicateVersions:[...new Set(versions.filter((v,i)=>versions.indexOf(v)!==i))],chronologicalOrderValid:versions.every((v,i)=>i===0||v>versions[i-1])},migrations:names.map((file)=>({version:file.slice(0,14),file})),functions};
}

async function writeReport(path,data){if(!path)return;const out=resolve(path);await mkdir(dirname(out),{recursive:true});await writeFile(out,`${JSON.stringify(data,null,2)}\n`,{mode:0o600});await chmod(out,0o600);}
async function writeMarkdownReport(path,report){if(!path)return;const out=resolve(path);await mkdir(dirname(out),{recursive:true});await writeFile(out,renderMarkdown(report),{mode:0o600});await chmod(out,0o600);}
function summary(report){return {generatedAt:report.generatedAt,scope:report.scope,projectConfirmed:Boolean(report.projectRef),migrationCount:report.migrationCount,sectionNames:Object.keys(report.sections??{}),availability:report.availability};}
function queryFailure(error){
  const message=String(error?.message??error).slice(0,800);
  const kind=/permission denied|insufficient privilege|not permitted/i.test(message)?'PERMISSION_DENIED':/does not exist|undefined (table|column|function)|cache lookup failed/i.test(message)?'MISSING_OR_INCOMPATIBLE':/timed out|timeout|ETIMEDOUT/i.test(message)?'TIMEOUT':'QUERY_FAILED';
  return {status:'NOT_VERIFIED',reason:kind,message};
}

async function main(){
  const args=parseArgs(process.argv.slice(2));
  if(args.flags.has('--help')){process.stdout.write('Local: node scripts/cloud-audit/readonly-audit.mjs --local-manifest [--json path] [--markdown path]\nRemote (separately authorized): --audit-scope metadata-only --execute-read-only --i-confirm-read-only-credential --target-project-ref <ref>; requires AUTOCLIP_CLOUD_AUDIT_DATABASE_URL. PUBLIC TEMP requires project-bound opt-in.\n');return;}
  if(args.flags.has('--local-manifest')){const report=await localManifest();await writeReport(args.values.get('--json'),report);await writeMarkdownReport(args.values.get('--markdown'),report);process.stdout.write(JSON.stringify(report,null,2));return;}
  if(!args.values.get('--json'))throw new Error('Remote audit requires --json <private report path>; raw inventory is not written to stdout.');
  const target=validateTarget({args,databaseUrl:process.env.AUTOCLIP_CLOUD_AUDIT_DATABASE_URL});const env=psqlEnvironment(target.url);
  const preflight=runPsql(auditQueries.preflight,env);
  if(!isSafePreflight(preflight,{projectRef:target.projectRef,allowPublicTempProjectRef:target.allowPublicTempProjectRef}))throw new Error('Credential failed the metadata-only privilege preflight; audit aborted before inventory.');
  preflight.public_temp_exception_applied=Boolean(preflight.role_flags?.database_temp);
  const local=await localManifest();
  const report={generatedAt:new Date().toISOString(),projectRef:target.projectRef,scope:'metadata-only',mode:'read-only PostgreSQL transaction',preflight,migrationCount:local.migrationCount,
    localMigrations:{count:local.migrationCount,versions:local.migrations.map(m=>m.version),migrationAudit:local.migrationAudit},
    dataVisibility:{status:'NOT_VERIFIED',scope:'PostgreSQL catalogs visible to this role only',note:'No business rows, Storage objects, jobs, quotas, OAuth data, or aggregate projection are queried.'},availability:{},sections:{}};
  try{report.availability=runPsql(auditQueries.availability,env);}catch(error){report.availability=queryFailure(error);}
  const sections=[['server',auditQueries.server],['schemas',auditQueries.schemas],['relations',auditQueries.relations],['columns',auditQueries.columns],['constraints',auditQueries.constraints],['indexes',auditQueries.indexes],['policies',auditQueries.policies],['routines',auditQueries.routines],['triggers',auditQueries.triggers],['grants',auditQueries.grants]];
  for(const [name,query] of sections){try{report.sections[name]={status:'QUERY_SUCCEEDED',coverage:'visible_catalog_rows_only; completeness is not established by query success',result:runPsql(query,env)}}catch(error){report.sections[name]=queryFailure(error);}}
  if(report.availability.ledger_relation_in_catalog&&report.availability.ledger_version_column_in_catalog&&!report.availability.ledger_row_security&&report.availability.ledger_schema_usage&&report.availability.ledger_version_select){try{
    const remoteVersions=runPsql(auditQueries.migrationVersions,env);
    report.sections.migrationVersions={status:'VERIFIED',result:remoteVersions,comparison:{localMissingRemotely:local.migrations.map(m=>m.version).filter(v=>!remoteVersions.includes(v)),remoteOnly:remoteVersions.filter(v=>!local.migrations.some(m=>m.version===v)),sameVersions:local.migrations.map(m=>m.version).filter(v=>remoteVersions.includes(v)).length}};
  }catch(error){report.sections.migrationVersions=queryFailure(error);}}
  else report.sections.migrationVersions={status:'NOT_VERIFIED',reason:report.availability.ledger_row_security?'Ledger row security is enabled; full version visibility is not established.':'Ledger relation, compatible version column, schema USAGE or column SELECT was not verified; no fallback or broader grant attempted.'};
  report.sections.operationalData={status:'NOT_VERIFIED',reason:'Intentionally excluded from metadata-only scope.'};
  await writeReport(args.values.get('--json'),report);await writeMarkdownReport(args.values.get('--markdown'),report);process.stdout.write(`${JSON.stringify(summary(report),null,2)}\n`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(`Cloud audit stopped: ${error.message}\n`);process.exitCode=2;});
