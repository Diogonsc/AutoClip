#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const container = 'supabase_db_tiktok-saas';
const database = `autoclip_component_audit_test_${randomBytes(4).toString('hex')}`;
const noReadRole = `autoclip_component_no_read_${randomBytes(4).toString('hex')}`;
const dir = dirname(fileURLToPath(import.meta.url));
let created = false;
let noReadRoleCreated = false;

function run(args, { input, allowFailure = false, app = 'autoclip_component_audit_test' } = {}) {
  const p = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  if (p.error) throw p.error;
  if (!allowFailure && p.status !== 0) throw new Error(`${p.stderr || ''}\n${p.stdout || ''}`.trim());
  return { status: p.status, stdout: p.stdout, stderr: p.stderr };
}

function localPsql(sql, { allowFailure = false, app = 'autoclip_component_audit_test', mode = 'local' } = {}) {
  const args = ['exec', '-i', '-e', `PGAPPNAME=${app}`, container, 'psql', '-X', '-q', '-A', '-t',
    '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-v', `component_local_test=${mode === 'local' ? 'true' : 'false'}`];
  if (mode === 'cloud') args.push('-v', 'component_cloud_approved=true', '-v', 'cloud_project_ref=djrwfvcxgpyknmizqumn',
    '-v', 'cloud_host=db.djrwfvcxgpyknmizqumn.supabase.co', '-v', 'cloud_port=5432');
  args.push('-f', '-');
  return run(args,
  { input: sql, allowFailure, app });
}

function jsonLine(text) {
  const rows = text.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length !== 1) throw new Error(`Expected one JSON row; received ${rows.length}.`);
  return JSON.parse(rows[0]);
}

try {
  const context = run(['context', 'show']).stdout.trim();
  const endpoint = run(['context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}']).stdout.trim();
  if (!endpoint.startsWith('"unix://')) throw new Error('Refusing component audit harness: Docker endpoint is not a local Unix socket.');
  const identity = run(['inspect', container, '--format', '{{.Name}}|{{index .Config.Labels "com.supabase.cli.project"}}']).stdout.trim();
  if (identity !== '/supabase_db_tiktok-saas|tiktok-saas') throw new Error(`Unexpected local DB container identity: ${identity}`);
  const version = Number(run(['exec', container, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-Atc', "SELECT current_setting('server_version_num')::int"]).stdout.trim());
  if (version < 170000 || version >= 180000) throw new Error(`PostgreSQL 17 required, got ${version}.`);
  run(['exec', container, 'createdb', '-U', 'supabase_admin', database]);
  created = true;

  run(['exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: `
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets(id text PRIMARY KEY,name text NOT NULL,public boolean NOT NULL,file_size_limit bigint,allowed_mime_types text[]);
      INSERT INTO storage.buckets VALUES ('synthetic-media','synthetic-media',false,52428800,ARRAY['video/mp4']);
      CREATE TABLE public.publication_jobs(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,status text NOT NULL);
      ALTER TABLE public.publication_jobs ENABLE ROW LEVEL SECURITY;
      CREATE POLICY synthetic_workspace_policy ON public.publication_jobs FOR SELECT USING (true);
      CREATE SCHEMA cron;
      CREATE TABLE cron.job(jobid bigint PRIMARY KEY,command text);
      CREATE SCHEMA net;
      CREATE TABLE net.http_request_queue(id bigint PRIMARY KEY,request jsonb);
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
      INSERT INTO supabase_migrations.schema_migrations VALUES ('synthetic-local-version');
    `,
  });
  run(['exec', container, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE ROLE ${noReadRole} NOLOGIN`]);
  noReadRoleCreated = true;

  const localGuard = `\\set ON_ERROR_STOP on
SELECT (current_database() ~ '^autoclip_component_audit_test_[a-f0-9]{8}$'
    AND inet_server_addr() IS NULL
    AND current_user='supabase_admin' AND session_user='supabase_admin'
    AND current_setting('application_name')='autoclip_component_audit_test') AS component_guard_ok
\\gset
\\if :component_guard_ok
\\else
  SELECT 1/0;
\\endif
`;
  const cloudGuard = await readFile(resolve(dir, '_guard.psql'), 'utf8');
  const files = (await readdir(dir)).filter((f) => /^0[0-8]_.*\.sql$/.test(f)).sort();
  if (files.length !== 9) throw new Error(`Expected 9 component scripts; got ${files.length}.`);
  const before = localPsql('SELECT jsonb_build_object(\'bucket_count\',(SELECT count(*) FROM storage.buckets),\'job_count\',(SELECT count(*) FROM public.publication_jobs));').stdout.trim();
  const outputs = new Map();
  for (const file of files) {
    const source = await readFile(resolve(dir, file), 'utf8');
    const expanded = source.replace('\\ir _guard.psql', '');
    let result;
    try { result = localPsql(expanded); }
    catch (error) { throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`); }
    const object = jsonLine(result.stdout);
    if (object.section === 'storage_bucket_metadata') {
      if (object.status !== 'available' || object.objects_read !== false || object.buckets.length !== 1) throw new Error('Storage catalog fixture did not produce the restricted metadata shape.');
    }
    if (object.section === 'rls_policies' && !object.policies.some((p) => p.name === 'synthetic_workspace_policy')) throw new Error('RLS catalog fixture was not inventoried.');
    if (object.section === 'jobs_and_queue_catalog_shape' && !object.relations.some((r) => r.schema === 'public' && r.name === 'publication_jobs')) throw new Error('Job relation shape fixture was not inventoried.');
    if (object.section === 'migration_ledger' && (object.status !== 'available' || object.versions.join() !== 'synthetic-local-version')) throw new Error('Migration ledger version-only fixture did not match.');
    outputs.set(file, object.section);
  }
  for (const [file, expectedSection, expectedStatus] of [
    ['05_storage_metadata.sql', 'storage_bucket_metadata', 'NOT_VERIFIED'],
    ['08_migration_ledger.sql', 'migration_ledger', 'NOT_VERIFIED'],
  ]) {
    const source = (await readFile(resolve(dir, file), 'utf8'))
      .replace('\\ir _guard.psql', '')
      .replace('BEGIN READ ONLY;', `SET SESSION AUTHORIZATION ${noReadRole};\nBEGIN READ ONLY;`)
      .replace(/COMMIT;\s*$/, 'COMMIT;\nRESET SESSION AUTHORIZATION;');
    const result = localPsql(source);
    const object = jsonLine(result.stdout);
    if (object.section !== expectedSection || object.status !== expectedStatus) {
      throw new Error(`${file}: insufficient SELECT must produce ${expectedStatus}, got ${JSON.stringify(object)}`);
    }
  }
  const after = localPsql('SELECT jsonb_build_object(\'bucket_count\',(SELECT count(*) FROM storage.buckets),\'job_count\',(SELECT count(*) FROM public.publication_jobs));').stdout.trim();
  if (before !== after) throw new Error('Read-only inventory changed fixture table contents.');

  const preflight = await readFile(resolve(dir, '00_environment_preflight.sql'), 'utf8');
  const wrongApp = localPsql(localGuard, { allowFailure: true, app: 'wrong_application_name' });
  if (wrongApp.status === 0) throw new Error('Guard accepted the wrong local application_name.');
  const wrongTarget = localPsql(cloudGuard, { allowFailure: true, mode: 'cloud' });
  if (wrongTarget.status === 0) throw new Error('Cloud-mode guard unexpectedly accepted the local fixture as the Cloud target.');

  console.log(JSON.stringify({ status: 'COMPONENT_READONLY_LOCAL_PASSED', database, postgresVersion: version, scripts: [...outputs], cloudConnection: false }));
} finally {
  if (noReadRoleCreated) run(['exec', container, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `DROP ROLE IF EXISTS ${noReadRole}`], { allowFailure: true });
  if (created) run(['exec', container, 'dropdb', '-U', 'supabase_admin', '--if-exists', database], { allowFailure: true });
}
