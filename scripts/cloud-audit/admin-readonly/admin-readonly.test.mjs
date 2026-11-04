import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dir=resolve('scripts/cloud-audit/admin-readonly');
const read=name=>readFile(resolve(dir,name),'utf8');
const stripComments=sql=>sql.replace(/--[^\n]*/g,'');

test('read-only package uses fixed destination guard and rejects absent approval',async()=>{
  const guard=stripComments(await read('_guard.psql'));
  for(const token of ['cloud_admin_approved','djrwfvcxgpyknmizqumn','postgres','autoclip_cloud_auditor','current_user=\'postgres\'','session_user=\'postgres\'','application_name','pg_stat_ssl','SELECT 1/0;'])assert.ok(guard.includes(token),`guard lacks ${token}`);
  assert.doesNotMatch(guard,/GRANT\b|REVOKE\b|ALTER\b|CREATE\b|DROP\b|INSERT\b|UPDATE\b|DELETE\b|TRUNCATE\b/i);
});

test('read-only SQL contains no persistent DDL/DML or application/extension function calls',async()=>{
  for(const name of ['00_role_containment_diagnostic.sql','10_catalog_inventory.sql','20_removal_preflight.sql']){
    const sql=stripComments(await read(name));
    assert.match(sql,/BEGIN READ ONLY;/i,name);assert.match(sql,/SET LOCAL statement_timeout/i,name);assert.match(sql,/COMMIT;/i,name);
    assert.doesNotMatch(sql,/\b(?:INSERT\s+INTO|UPDATE\s+[\w.]+\s+SET|DELETE\s+FROM|TRUNCATE|CREATE\s+(?:TABLE|FUNCTION|SCHEMA|ROLE|INDEX)|ALTER\s+(?:ROLE|TABLE|SCHEMA)|DROP\s+(?:TABLE|ROLE|SCHEMA)|GRANT\s|REVOKE\s|CALL\s)\b/i,name);
    assert.doesNotMatch(sql,/\b(?:net|cron|storage|public)\.[a-z_][\w]*\s*\(/i,`${name} must not call extension/application routines`);
    assert.doesNotMatch(sql,/\bFROM\s+(?:public\.(?:workspaces|workspace_members|media_assets|publication_jobs|oauth_tokens)|auth\.(?:users|identities)|storage\.(?:objects|buckets)|cron\.(?:job|job_run_details)|net\.(?:http_request_queue|_http_response))\b/i,`${name} must not read operational rows`);
  }
});

test('catalog package reports MAINTAIN, memberships both ways, policies, security properties and extension dependencies',async()=>{
  const sql=await read('10_catalog_inventory.sql');
  assert.match(sql,/has_table_privilege\('autoclip_cloud_auditor',c\.oid,a\.privilege_type\)/);
  assert.match(sql,/aclexplode\(coalesce\(c\.relacl/);
  assert.match(sql,/pg_auth_members[\s\S]*parent\.rolname='autoclip_cloud_auditor' OR member\.rolname='autoclip_cloud_auditor'/);
  assert.match(sql,/pg_policy/);assert.match(sql,/p\.prosecdef/);assert.match(sql,/p\.proconfig/);assert.match(sql,/pg_extension/);assert.match(sql,/pg_depend/);
  assert.match(sql,/n\.nspname IN \('cron','net','storage'\)/);
  assert.match(sql,/NOT c\.relrowsecurity AND NOT c\.relforcerowsecurity/);
  assert.match(sql,/SELECT jsonb_build_object\('status','READ_ONLY_VERSION_METADATA'/);
  assert.match(sql,/FROM supabase_migrations\.schema_migrations/);
  assert.doesNotMatch(sql,/SELECT\s+\*\s+FROM\s+supabase_migrations\.schema_migrations/i);
});

test('containment script is explicitly mutating, narrowly scoped, and stops on partial termination',async()=>{
  const sql=stripComments(await read('30_disable_role_and_terminate_sessions.sql'));
  assert.match(sql,/ALTER ROLE autoclip_cloud_auditor NOLOGIN VALID UNTIL 'epoch'/);
  assert.match(sql,/pg_terminate_backend\(a\.pid\)/);
  assert.match(sql,/a\.usename='autoclip_cloud_auditor'/);
  assert.match(sql,/COMMIT;[\s\S]*pg_terminate_backend/);
  assert.match(sql,/CONTAINMENT PARTIAL[\s\S]*SELECT 1\/0;/);
  assert.doesNotMatch(sql,/\b(?:GRANT|REVOKE)\b|DROP\s+ROLE|CASCADE|PUBLIC/i);
  assert.match(sql,/CONTAINMENT PARTIAL/);
});

test('NOLOGIN-only containment has exact preconditions, one role alteration, and independent post-commit verification',async()=>{
  const source=await read('31_disable_role_nologin.sql');
  const sql=stripComments(source);
  assert.match(sql,/\\ir _guard\.psql/);
  assert.match(sql,/BEGIN;[\s\S]*SET LOCAL statement_timeout='20s'[\s\S]*SET LOCAL lock_timeout='3s'/);
  assert.doesNotMatch(sql,/\bFROM\s+pg_authid\b/i,'Supabase postgres must not require direct pg_authid access');
  assert.match(sql,/FROM pg_roles r[\s\S]*WHERE r\.rolname='autoclip_cloud_auditor'/);
  assert.match(source,/concurrent external role administration[\s\S]*race/i);
  assert.match(sql,/autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn/);
  assert.match(sql,/2026-11-15 00:43:58\+00/);
  assert.match(sql,/m\.admin_option[\s\S]*NOT m\.inherit_option[\s\S]*NOT m\.set_option/);
  assert.match(sql,/pg_shdepend[\s\S]*pg_stat_activity/);
  assert.equal((sql.match(/ALTER ROLE autoclip_cloud_auditor NOLOGIN/g)||[]).length,1);
  assert.match(sql,/COMMIT;[\s\S]*BEGIN READ ONLY;[\s\S]*persisted_nologin_verified/);
  assert.match(sql,/NOLOGIN VERIFIED[\s\S]*no sessions were terminated/);
  assert.doesNotMatch(sql,/^\s*(?:GRANT|REVOKE|DROP|CREATE|UPDATE|DELETE|TRUNCATE)\b|CASCADE|pg_terminate_backend/im);
});

test('documented command pins Direct endpoint, TLS verification, private output, and interactive password',async()=>{
  const readme=await read('README.md');
  assert.match(readme,/host=db\.djrwfvcxgpyknmizqumn\.supabase\.co port=5432 dbname=postgres user=postgres sslmode=verify-full sslrootcert=\/home\/diogo-nascimento\/Documentos\/Atual\/AutoClip\/prod-ca-2021\.crt/);
  assert.match(readme,/umask 077/);assert.match(readme,/chmod 600/);assert.match(readme,/-X -W -q/);
  assert.match(readme,/trap cleanup EXIT/);assert.match(readme,/trap 'exit 129' HUP/);assert.match(readme,/trap 'exit 130' INT/);assert.match(readme,/trap 'exit 143' TERM/);
  assert.match(readme,/-A -t/);assert.match(readme,/PGPASSFILE=\/dev\/null/);assert.match(readme,/trap cleanup EXIT/);assert.match(readme,/jq -s -e/);assert.match(readme,/partial output will be removed/);
  assert.match(readme,/admin-readonly\/_guard\.psql/);assert.match(readme,/sql\/_guard\.psql/);
  assert.match(readme,/NÃO EXECUTAR sem nova autorização específica/);
  assert.doesNotMatch(readme,/PGPASSWORD\s*=|postgresql:\/\/[^\s]*:/i);
});
