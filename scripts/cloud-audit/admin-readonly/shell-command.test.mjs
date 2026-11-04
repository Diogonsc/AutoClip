import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve('.');
const readme = await readFile(resolve(repo, 'scripts/cloud-audit/admin-readonly/README.md'), 'utf8');
const blocks = [...readme.matchAll(/```bash\n([\s\S]*?)\n```/g)].map(match => match[1]);
assert.ok(blocks.length >= 2, 'runner and summary commands were not found');
const command = blocks[0];
const summaryCommand = blocks[1];
const json = JSON.stringify({
  role_present: true, role: 'autoclip_cloud_auditor', marker_matches: true,
  can_login: true, valid_until: null, connection_limit: 1,
  superuser: false, inherit: false, create_role: false, create_db: false,
  replication: false, bypass_rls: false, database_privileges: { connect: true, create: false, temporary: true },
  membership_edges: [], effective_memberships: [], active_session_count: 0,
  active_sessions: [], shared_dependencies: [],
});

async function fixture({ psqlMode = 'success', jqMode = 'real' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'autoclip-gate39-shell-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  await mkdir(home, { mode: 0o700 });
  await mkdir(bin, { mode: 0o700 });
  const psql = `#!/bin/bash
set -eu
out=''
previous=''
for arg in "$@"; do
  if [ "$previous" = '-o' ]; then out="$arg"; fi
  previous="$arg"
done
[ -n "$out" ]
[ "\${PGPASSFILE-}" = '/dev/null' ]
[ -z "\${PGPASSWORD-}" ]
printf '%s\\n' "$*" > "\${MOCK_ARGS_FILE}"
case "\${MOCK_PSQL_MODE}" in
  success) printf '%s\\n' '\${JSON_FIXTURE}' > "$out" ;;
  empty) : > "$out" ;;
  invalid) printf '%s\\n' 'not-json' > "$out" ;;
  multiple) printf '%s\\n%s\\n' '\${JSON_FIXTURE}' '\${JSON_FIXTURE}' > "$out" ;;
  partial-fail) printf '%s\\n' 'partial' > "$out"; exit 23 ;;
  auth-fail) printf '%s\\n' 'simulated authentication failure' >&2; exit 2 ;;
  wait) : > "\${MOCK_STARTED_FILE}"; exec /bin/sleep 60 ;;
  *) exit 99 ;;
esac
`;
  const jq = jqMode === 'fail'
    ? '#!/bin/bash\nexit 42\n'
    : '#!/bin/bash\nexec /usr/bin/jq "$@"\n';
  await writeFile(join(bin, 'psql'), psql.replaceAll('${JSON_FIXTURE}', json), { mode: 0o700 });
  await writeFile(join(bin, 'jq'), jq, { mode: 0o700 });
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${bin}:/usr/bin:/bin`,
    MOCK_PSQL_MODE: psqlMode,
    MOCK_JQ_MODE: jqMode,
    MOCK_ARGS_FILE: join(root, 'psql-args.txt'),
    MOCK_STARTED_FILE: join(root, 'psql-started'),
  };
  for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGPASSWORD', 'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGSSLMODE', 'PGSSLROOTCERT', 'PGOPTIONS']) delete env[key];
  return { root, home, env };
}

async function runCase(options) {
  const f = await fixture(options);
  const result = spawnSync('/bin/bash', ['-c', command], { cwd: repo, env: f.env, encoding: 'utf8', timeout: 8_000 });
  const files = await readdir(f.home);
  return { ...f, result, files };
}

test('documented runner retains only one valid JSON report with mode 0600', async t => {
  const { root, home, result } = await runCase();
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(result.status, 0, result.stderr);
  const path = result.stdout.match(/^Protected JSON output: (.+)$/m)?.[1];
  assert.ok(path, result.stdout);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).role, 'autoclip_cloud_auditor');
  const args = await readFile(join(root, 'psql-args.txt'), 'utf8');
  for (const value of ['-X -W -q -A -t', 'sslmode=verify-full', 'db.djrwfvcxgpyknmizqumn.supabase.co', '00_role_containment_diagnostic.sql']) assert.ok(args.includes(value), `psql args lack ${value}`);
  assert.equal((await readdir(home)).length, 1);
});

test('documented jq summary matches real diagnostic JSON and omits raw session/dependency details', async t => {
  const { root, home, result } = await runCase();
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = result.stdout.match(/^Protected JSON output: (.+)$/m)?.[1];
  assert.ok(path, result.stdout);
  const summary = summaryCommand.replace('$HOME/autoclip-admin-readonly.REPLACE_WITH_SUFFIX', path);
  const parsed = spawnSync('/bin/bash', ['-c', summary], { cwd: repo, env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  const value = JSON.parse(parsed.stdout);
  assert.equal(value.role, 'autoclip_cloud_auditor');
  assert.equal(value.active_session_count, 0);
  assert.ok(Array.isArray(value.active_session_states));
  assert.ok(Array.isArray(value.dependency_counts));
  assert.equal('active_sessions' in value, false);
  assert.equal('shared_dependencies' in value, false);
});

for (const [label, options] of [
  ['psql failure', { psqlMode: 'partial-fail' }],
  ['authentication failure', { psqlMode: 'auth-fail' }],
  ['invalid JSON', { psqlMode: 'invalid' }],
  ['empty JSON output', { psqlMode: 'empty' }],
  ['multiple JSON objects', { psqlMode: 'multiple' }],
  ['jq failure', { jqMode: 'fail' }],
]) {
  test(`documented runner removes partial output on ${label}`, async t => {
    const { root, home, result, files } = await runCase(options);
    t.after(() => rm(root, { recursive: true, force: true }));
    assert.notEqual(result.status, 0, result.stdout);
    if (options.psqlMode === 'partial-fail') assert.equal(result.status, 23, 'runner must preserve psql exit status');
    assert.doesNotMatch(result.stdout, /Protected JSON output:/);
    assert.equal(files.length, 0, `leftover HOME files: ${files.join(',')}`);
  });
}

test('TERM during psql exits nonzero and cleans the temporary report', async t => {
  const f = await fixture({ psqlMode: 'wait' });
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const child = spawn('/bin/bash', ['-c', command], { cwd: repo, env: f.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  for (let i = 0; i < 100; i++) {
    try { await stat(f.env.MOCK_STARTED_FILE); break; } catch { await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  await stat(f.env.MOCK_STARTED_FILE);
  process.kill(-child.pid, 'SIGTERM');
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(exit.code, 143, `TERM should remain a nonzero termination status; ${stdout} ${stderr}`);
  assert.doesNotMatch(stdout, /Protected JSON output:/);
  assert.equal((await readdir(f.home)).length, 0, 'signal left a partial report');
});
