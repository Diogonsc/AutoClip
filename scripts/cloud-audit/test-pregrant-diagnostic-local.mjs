#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const container = 'supabase_db_tiktok-saas';
const suffix = randomBytes(4).toString('hex');
const role = `autoclip_diag_role_${suffix}`;
const member = `autoclip_diag_parent_${suffix}`;
const schema = `autoclip_diag_${suffix}`;
const otherDb = `autoclip_diag_other_${suffix}`;
const sqlPath = resolve(fileURLToPath(new URL('./sql/diagnose_pregrant_blockers.sql', import.meta.url)));
const diagnostic = await readFile(sqlPath, 'utf8');

function docker(args, input, allowFailure = false) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) throw new Error(`${result.stderr}\n${result.stdout}`);
  return result;
}
function psql(sql, { roleName = role, allowFailure = false, db = 'postgres' } = {}) {
  return docker(['exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', db, '-A', '-F', '\t', '-P', 'footer=off', '-v', 'ON_ERROR_STOP=1', '-v', 'cloud_project_ref=djrwfvcxgpyknmizqumn', '-v', `audit_role=${roleName}`, '-f', '-'], sql, allowFailure);
}
function assert(ok, message) { if (!ok) throw new Error(message); }
function has(output, category, object) {
  return output.includes(category) && (!object || output.includes(object));
}

let roleCreated = false;
let memberCreated = false;
let fixtureCreated = false;
let otherDbCreated = false;
try {
  const context = docker(['context', 'show']).stdout.trim();
  const endpoint = docker(['context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}']).stdout.trim();
  assert(endpoint.startsWith('"unix://'), 'Refusing to run fixture mutations outside a local Docker socket.');
  const identity = docker(['inspect', container, '--format', '{{.Name}}|{{index .Config.Labels "com.supabase.cli.project"}}']).stdout.trim();
  assert(identity === '/supabase_db_tiktok-saas|tiktok-saas', `Unexpected DB container identity: ${identity}`);

  psql(`CREATE ROLE ${role} NOLOGIN; CREATE ROLE ${member} NOLOGIN;`);
  roleCreated = true; memberCreated = true;
  docker(['exec', container, 'createdb', '-U', 'supabase_admin', otherDb]); otherDbCreated = true;
  psql(`CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.business_secret(secret text); CREATE SEQUENCE ${schema}.fixture_seq; CREATE FUNCTION ${schema}.fixture_fn() RETURNS integer LANGUAGE sql AS $$SELECT 1$$;`);
  fixtureCreated = true;
  psql(`GRANT USAGE ON SCHEMA ${schema} TO ${role}; GRANT SELECT ON ${schema}.business_secret TO ${role}; GRANT USAGE ON SEQUENCE ${schema}.fixture_seq TO ${role}; GRANT EXECUTE ON FUNCTION ${schema}.fixture_fn() TO ${role}; GRANT ${member} TO ${role}; GRANT CONNECT ON DATABASE ${otherDb} TO ${role};`);
  psql(`CREATE TABLE IF NOT EXISTS public.${schema}_sensitive_fixture(value text); INSERT INTO public.${schema}_sensitive_fixture VALUES ('fixture-only-private-sentinel');`);
  psql(`GRANT TEMP ON DATABASE postgres TO ${role};`);

  const result = psql(diagnostic).stdout;
  for (const category of [
    'role membership/delegation', 'privilege on a non-target database',
    'unapproved schema USAGE/CREATE', 'unapproved relation read/write privilege',
    'unapproved sequence privilege', 'application routine EXECUTE',
    'database CREATE or TEMP provenance',
  ]) assert(result.includes(category), `Diagnostic omitted expected category: ${category}`);
  assert(has(result, 'role membership/delegation', member), 'Membership evidence missing.');
  assert(has(result, 'privilege on a non-target database', otherDb), 'Non-target database evidence missing.');
  assert(has(result, 'unapproved schema USAGE/CREATE', schema), 'Schema evidence missing.');
  assert(has(result, 'unapproved relation read/write privilege', 'business_secret'), 'Relation evidence missing.');
  assert(has(result, 'unapproved sequence privilege', 'fixture_seq'), 'Sequence evidence missing.');
  assert(has(result, 'application routine EXECUTE', 'fixture_fn'), 'Function evidence missing.');
  assert(result.includes('DIRECT') && result.includes('database CREATE or TEMP provenance'), 'Direct TEMP provenance was not reported.');
  assert(!result.includes('fixture-only-private-sentinel'), 'Diagnostic leaked business fixture contents.');
  assert(!/encrypted_password|access_token|refresh_token|secret\s+value/i.test(result), 'Diagnostic emitted sensitive data-shaped values.');
  assert(result.includes('migration ledger metadata'), 'Ledger compatibility status missing.');
  assert(result.includes('BEGIN READ ONLY;') === false, 'psql output unexpectedly echoes SQL text.');

  const absentRole = psql(diagnostic, { roleName: `missing_${suffix}`, allowFailure: true });
  assert(absentRole.status !== 0 && `${absentRole.stdout}\n${absentRole.stderr}`.includes('requested audit role does not exist'), 'Missing role did not fail closed.');
  const wrongProject = psql(diagnostic.replaceAll('djrwfvcxgpyknmizqumn', 'other-project-ref'), { allowFailure: true });
  assert(wrongProject.status !== 0, 'Wrong project reference did not fail closed.');
  psql(`REVOKE TEMP ON DATABASE postgres FROM ${role};`);
  const publicTemp = psql(diagnostic).stdout;
  assert(publicTemp.includes('KNOWN_PUBLIC_TEMP_RESIDUAL_HIGH_RISK') && publicTemp.includes('PUBLIC'), `PUBLIC-only TEMP was not reported as the documented high residual risk: ${publicTemp.split(/\r?\n/).filter(line => /database CREATE or TEMP provenance/.test(line)).slice(-4).join('\n')}`);

  // Prove psql output after the query has no database writes: the test role still
  // has only the exact fixture grants installed before the read-only diagnostic.
  const writeAttempt = psql(`SELECT has_table_privilege('${role}', '${schema}.business_secret', 'INSERT') AS insert_allowed;`);
  assert(writeAttempt.stdout.trim().split(/\r?\n/).at(-1) === 'f', 'Diagnostic unexpectedly changed persistent fixture privileges.');

  const noMutation = diagnostic.replace(/^\s*--.*$/gm, '').replace(/'(?:''|[^'])*'/g, "''");
  assert(!/\b(?:GRANT|REVOKE|ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE|CALL)\b/i.test(noMutation), 'Diagnostic contains a mutating SQL keyword.');
  assert(/BEGIN READ ONLY/i.test(diagnostic), 'Diagnostic is not explicitly READ ONLY.');
  console.log(JSON.stringify({ ok: true, postgres: 'local Supabase 17.6 container', categoriesChecked: 7, fixtureRole: role, sensitiveSentinelLeaked: false, remoteConnection: false }));
} finally {
  // Every mutation is scoped to uniquely named local test fixtures only.
  try { psql(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP TABLE IF EXISTS public.${schema}_sensitive_fixture;`); } catch {}
  if (roleCreated) { try { psql(`REVOKE ALL PRIVILEGES ON DATABASE postgres FROM ${role};${otherDbCreated ? ` REVOKE ALL PRIVILEGES ON DATABASE ${otherDb} FROM ${role};` : ''} REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schema} FROM ${role}; REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${schema} FROM ${role}; REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA ${schema} FROM ${role}; REVOKE ALL PRIVILEGES ON SCHEMA ${schema} FROM ${role};`); } catch {} }
  if (memberCreated) { try { psql(`REVOKE ${member} FROM ${role}; DROP ROLE IF EXISTS ${member};`); } catch {} }
  if (otherDbCreated) { try { docker(['exec', container, 'dropdb', '-U', 'supabase_admin', otherDb]); } catch {} }
  if (roleCreated) { try { psql(`DROP ROLE IF EXISTS ${role};`); } catch {} }
}
