import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const sqlFiles = (await readdir(root)).filter((f) => /^0[0-8]_.*\.sql$/.test(f)).sort();
const forbidden = /^\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE|DO)\b/im;

test('component Cloud SQL package is explicit, guarded, and transactional read-only', async () => {
  assert.equal(sqlFiles.length, 9);
  for (const file of sqlFiles) {
    const sql = await readFile(resolve(root, file), 'utf8');
    assert.match(sql, /^\\ir _guard\.psql$/m, `${file} must include sibling guard`);
    assert.match(sql, /BEGIN READ ONLY;/i, `${file} must use explicit read-only transaction`);
    assert.match(sql, /SET LOCAL statement_timeout=/i, `${file} must bound execution time`);
    assert.match(sql, /SET LOCAL lock_timeout=/i, `${file} must bound lock waits`);
    assert.match(sql, /COMMIT;/i, `${file} must close transaction`);
    assert.doesNotMatch(sql, forbidden, `${file} contains a persistent mutation command`);
    assert.doesNotMatch(sql, /pg_authid|pg_terminate_backend|pg_net\s*\.\s*http_|net\.http_|storage\.objects|auth\.users/i,
      `${file} references a prohibited catalog/data path or side-effect function`);
  }
});

test('component guard pins declared project/database/operator/application and requires active TLS', async () => {
  const guard = await readFile(resolve(root, '_guard.psql'), 'utf8');
  for (const fragment of [
    "'djrwfvcxgpyknmizqumn'", "'db.djrwfvcxgpyknmizqumn.supabase.co'", "'5432'",
    "current_database()='postgres'", "current_user='postgres'", "session_user='postgres'",
    "current_setting('application_name')='autoclip_component_audit'", 'pg_stat_ssl', 'ssl))',
    'component_cloud_approved', 'component_local_test',
  ]) assert.ok(guard.includes(fragment), `missing guard control ${fragment}`);
  assert.match(guard, /SELECT 1\/0;/, 'guard failure must cause psql nonzero with ON_ERROR_STOP');
});

test('catalog queries cover RLS, MAINTAIN-compatible ACL expansion, both membership directions, and avoid row payloads', async () => {
  const policies = await readFile(resolve(root, '02_rls_policies.sql'), 'utf8');
  const grants = await readFile(resolve(root, '03_roles_grants_public.sql'), 'utf8');
  const routines = await readFile(resolve(root, '04_security_definer_functions.sql'), 'utf8');
  const storage = await readFile(resolve(root, '05_storage_metadata.sql'), 'utf8');
  const extensions = await readFile(resolve(root, '06_extensions_pg_net.sql'), 'utf8');
  const jobs = await readFile(resolve(root, '07_jobs_metadata.sql'), 'utf8');
  const ledger = await readFile(resolve(root, '08_migration_ledger.sql'), 'utf8');
  assert.match(policies, /pg_policy/);
  assert.match(policies, /relforcerowsecurity/);
  assert.match(grants, /aclexplode/);
  assert.match(grants, /pg_auth_members/);
  assert.match(grants, /inherit_option/);
  assert.match(grants, /set_option/);
  assert.match(grants, /default_acls/);
  assert.match(routines, /prosecdef/);
  assert.match(routines, /proconfig/);
  assert.match(storage, /FROM storage\.buckets/);
  assert.match(storage, /has_table_privilege\(current_user,c\.oid,'SELECT'\)/);
  assert.match(storage, /objects_read',false/);
  assert.match(extensions, /pg_net_routines/);
  assert.match(extensions, /http_calls_executed',false/);
  assert.match(jobs, /operational_rows_read',false/);
  assert.match(jobs, /cron_command_text_read',false/);
  assert.match(ledger, /ledger_read_shape_compatible/);
  assert.match(ledger, /has_column_privilege\(current_user,c\.oid,'version','SELECT'\)/);
  assert.match(ledger, /read_columns',jsonb_build_array\('version'\)/);
});

test('metadata output deliberately omits function bodies and business rows', async () => {
  const routines = await readFile(resolve(root, '04_security_definer_functions.sql'), 'utf8');
  const storage = await readFile(resolve(root, '05_storage_metadata.sql'), 'utf8');
  const jobs = await readFile(resolve(root, '07_jobs_metadata.sql'), 'utf8');
  assert.match(routines, /definition_bodies_included',false/);
  assert.doesNotMatch(routines, /pg_get_functiondef|prosrc/);
  assert.doesNotMatch(storage, /storage\.objects/);
  assert.doesNotMatch(jobs, /FROM\s+(?:cron\.job|cron\.job_run_details|public\.publication_jobs)\b/i);
});

test('fixed wrapper is an allowlist and never accepts caller-supplied SQL', async () => {
  const wrapper = await readFile(resolve(root, 'run-component-audit.sh'), 'utf8');
  assert.match(wrapper, /case "\$component" in/);
  assert.match(wrapper, /sslmode=verify-full/);
  assert.match(wrapper, /PGPASSFILE=\/dev\/null/);
  assert.match(wrapper, /psql -X -W/);
  assert.match(wrapper, /ON_ERROR_STOP=1/);
  assert.match(wrapper, /mktemp/);
  assert.match(wrapper, /chmod 600/);
  assert.doesNotMatch(wrapper, /psql[^\n]*-c\s+|eval\s+|\$\{?SQL/i);

  const pinned = new Map([
    ['_guard.psql', wrapper.match(/GUARD_HASH='([a-f0-9]{64})'/)?.[1]],
    ...sqlFiles.map((file) => [file, wrapper.match(new RegExp(`${file.replaceAll('.', '\\.')}'.*?expected='([a-f0-9]{64})'`))?.[1]]),
  ]);
  for (const [file, expected] of pinned) {
    assert.ok(expected, `wrapper must pin SHA-256 for ${file}`);
    const actual = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
    assert.equal(actual, expected, `wrapper hash for ${file} must match the current reviewed file`);
  }
});
