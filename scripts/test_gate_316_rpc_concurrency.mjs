#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectId = `autoclip-g316-${process.pid}`;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "autoclip-g316-"));
const projectDir = path.join(tempRoot, "project");
const supabaseDir = path.join(projectDir, "supabase");
const timeoutMs = 120_000;
let stackMayExist = false;
let restoreStackMayExist = false;
let restoreProjectDir = '';
let restoreProjectId = '';
let assertions = 0;

const ids = {
  owner: "31600000-0000-0000-0000-000000000001",
  outsider: "31600000-0000-0000-0000-000000000002",
  workspaceJob: "31600000-0000-0000-0000-000000000010",
  channel: "31600000-0000-0000-0000-000000000011",
  legacyChannel: "31600000-0000-0000-0000-000000000013",
  media: "31600000-0000-0000-0000-000000000012",
  jobs: [
    "31600000-0000-0000-0000-000000000021",
    "31600000-0000-0000-0000-000000000022",
    "31600000-0000-0000-0000-000000000023",
    "31600000-0000-0000-0000-000000000024",
  ],
  requests: [
    "31600000-0000-0000-0000-000000000031",
    "31600000-0000-0000-0000-000000000032",
    "31600000-0000-0000-0000-000000000033",
    "31600000-0000-0000-0000-000000000034",
    "31600000-0000-0000-0000-000000000035",
  ],
};

function assert(condition, message) {
  assertions++;
  if (!condition) throw new Error(`FAIL: ${message}`);
  process.stdout.write(`ok ${assertions} - ${message}\n`);
}

function run(command, args, { cwd, env, input = "", timeout = timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${timeout}ms`));
    }, timeout);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

async function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function chooseBasePort() {
  const start = 56_000 + (process.pid % 1_000);
  for (let offset = 0; offset < 2_000; offset += 1) {
    const base = start + offset;
    if (base + 7 > 65_535) break;
    const ports = [base, base + 1, base + 2, base + 6];
    const availability = await Promise.all(ports.map(isPortFree));
    if (availability.every(Boolean)) return base;
  }
  throw new Error("could not find a free loopback port range");
}

async function startIsolatedStack() {
  const base = await chooseBasePort();
  fs.mkdirSync(supabaseDir, { recursive: true });
  fs.copyFileSync(path.join(root, "supabase/config.toml"), path.join(supabaseDir, "config.toml"));
  fs.cpSync(path.join(root, "supabase/migrations"), path.join(supabaseDir, "migrations"), { recursive: true });
  fs.cpSync(path.join(root, "supabase/tests"), path.join(supabaseDir, "tests"), { recursive: true });
  const configPath = path.join(supabaseDir, "config.toml");
  let config = fs.readFileSync(configPath, "utf8");
  config = config.replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`);
  config = config.replace(/^port\s*=\s*54321\s*$/m, `port = ${base}`);
  config = config.replace(/^port\s*=\s*54322\s*$/m, `port = ${base + 1}`);
  config = config.replace(/^port\s*=\s*54323\s*$/m, `port = ${base + 2}`);
  config += `\n[analytics]\nenabled = true\nport = ${base + 6}\n`;
  fs.writeFileSync(configPath, config, { mode: 0o600 });

  stackMayExist = true;
  const started = await run("supabase", [
    "start", "--workdir", projectDir,
    "--exclude", "mailpit,studio,logflare,vector,postgres-meta,edge-runtime,storage-api,imgproxy,realtime,supavisor",
  ], { timeout: 180_000 });
  if (started.code !== 0) {
    throw new Error(`isolated Supabase start failed (exit ${started.code}); see local CLI output, which was intentionally suppressed to avoid printing generated credentials`);
  }
  return base + 1;
}

async function startRestoreStack() {
  const base = await chooseBasePort();
  restoreProjectId = `${projectId}-restore`;
  restoreProjectDir = path.join(tempRoot, 'restore-project');
  const restoreSupabaseDir = path.join(restoreProjectDir, 'supabase');
  fs.mkdirSync(restoreSupabaseDir, { recursive: true });
  const configPath = path.join(restoreSupabaseDir, 'config.toml');
  let config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
  config = config.replace(/^project_id\s*=.*$/m, `project_id = "${restoreProjectId}"`);
  config = config.replace(/^port\s*=\s*54321\s*$/m, `port = ${base}`);
  config = config.replace(/^port\s*=\s*54322\s*$/m, `port = ${base + 1}`);
  config = config.replace(/^port\s*=\s*54323\s*$/m, `port = ${base + 2}`);
  config += `\n[analytics]\nenabled = true\nport = ${base + 6}\n`;
  fs.writeFileSync(configPath, config, { mode: 0o600 });
  restoreStackMayExist = true;
  const started = await run('supabase', [
    'start', '--workdir', restoreProjectDir,
    '--exclude', 'mailpit,studio,logflare,vector,postgres-meta,edge-runtime,storage-api,imgproxy,realtime,supavisor',
  ], { timeout: 180_000 });
  if (started.code !== 0) {
    throw new Error(`isolated restore target failed to start (exit ${started.code}); CLI output suppressed to avoid generated credentials`);
  }
  return base + 1;
}

function psqlArgs(port, applicationName) {
  return [
    "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
    "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres",
    "-c", "SET statement_timeout = '10s'; SELECT 1",
  ];
}

function psqlEnv(applicationName) {
  return {
    ...process.env,
    PGPASSWORD: "postgres", // Supabase CLI's disposable local database only.
    PGPASSFILE: "/dev/null",
    PGAPPNAME: applicationName,
  };
}

async function sql(port, text, applicationName = "gate316-query") {
  return run("psql", [
    "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
    "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres",
  ], { env: psqlEnv(applicationName), input: text });
}

function assertSqlSuccess(result, label) {
  assert(result.code === 0, `${label}${result.code === 0 ? "" : ` (exit ${result.code}; ${result.stderr.trim()})`}`);
}

function psqlSession(port, applicationName) {
  const child = spawn("psql", [
    "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
    "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres",
  ], { env: psqlEnv(applicationName), stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const closed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, closed, get stdout() { return stdout; }, get stderr() { return stderr; } };
}

async function waitForMarker(session, marker, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (session.stdout.includes(marker)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`did not observe synchronization marker ${marker}`);
}

async function waitForLock(port, applicationName) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await sql(port,
      `SELECT count(*) FROM pg_stat_activity WHERE application_name = '${applicationName}' AND wait_event_type = 'Lock';\n`,
      "gate316-barrier-probe");
    if (result.code === 0 && result.stdout.trim() === "1") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`session ${applicationName} never entered a PostgreSQL lock wait`);
}

async function waitForLockCount(port, applicationNamePrefix, expectedCount) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const result = await sql(port,
      `SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE '${applicationNamePrefix}%' AND wait_event_type = 'Lock';\n`,
      'gate3191-many-process-barrier');
    if (result.code === 0 && Number(result.stdout.trim()) === expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`expected ${expectedCount} independent refresh processes waiting on the PostgreSQL row lock`);
}

function authClaims(userId) {
  return JSON.stringify({ sub: userId, role: "authenticated" }).replaceAll("'", "''");
}

function requestSql(jobId, outcome, requestId, userId, appName) {
  const claims = authClaims(userId);
  return `BEGIN;\nSET LOCAL statement_timeout = '8s';\nSET LOCAL ROLE authenticated;\nSELECT set_config('request.jwt.claims', '${claims}', true);\nSELECT public.resolve_unknown_job('${jobId}', '${outcome}', '${requestId}');\nCOMMIT;\n`;
}

async function holdJobRow(port, jobId, sessionName, marker) {
  const session = psqlSession(port, sessionName);
  session.child.stdin.write(`BEGIN;\nSET LOCAL statement_timeout = '12s';\nSELECT id FROM public.publication_jobs WHERE id = '${jobId}' FOR UPDATE;\n\\echo ${marker}\n`);
  await waitForMarker(session, marker);
  return session;
}

async function releaseWithResolution(session, jobId, outcome, requestId, userId, marker) {
  session.child.stdin.write(`SET LOCAL ROLE authenticated;\nSELECT set_config('request.jwt.claims', '${authClaims(userId)}', true);\nSELECT public.resolve_unknown_job('${jobId}', '${outcome}', '${requestId}');\nCOMMIT;\n\\echo ${marker}\n\\q\n`);
  const result = await session.closed;
  assert(result.code === 0 && result.stdout.includes(marker), `lock holder resolved and committed (${marker})`);
}

async function concurrentCase(port, { jobId, firstOutcome, firstRequestId, secondOutcome, secondRequestId, secondUser, appName, expectedSecondError }) {
  const lockMarker = `G316_LOCKED_${appName}`;
  const doneMarker = `G316_DONE_${appName}`;
  const first = await holdJobRow(port, jobId, `${appName}_first`, lockMarker);
  const second = psqlSession(port, `${appName}_second`);
  second.child.stdin.end(requestSql(jobId, secondOutcome, secondRequestId, secondUser));
  try {
    await waitForLock(port, `${appName}_second`);
    await releaseWithResolution(first, jobId, firstOutcome, firstRequestId, ids.owner, doneMarker);
    const result = await second.closed;
    if (expectedSecondError) {
      assert(result.code !== 0 && result.stderr.includes(expectedSecondError),
        `${appName}: waiting request failed safely with ${expectedSecondError}`);
    } else {
      assert(result.code === 0, `${appName}: waiting identical request returned success`);
    }
  } catch (error) {
    first.child.kill("SIGTERM");
    second.child.kill("SIGTERM");
    throw error;
  }
}

async function fixture(port) {
  const setup = `
BEGIN;
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
 ('${ids.owner}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','gate316-owner@test.invalid'),
 ('${ids.outsider}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','gate316-outsider@test.invalid');
INSERT INTO public.channels(id, workspace_id, display_name)
SELECT '${ids.channel}', id, 'Gate 3.16 synthetic channel'
FROM public.workspaces WHERE owner_user_id='${ids.owner}';
INSERT INTO public.channels(id, workspace_id, display_name)
SELECT '${ids.legacyChannel}', id, 'Gate 3.19.3 legacy expiry fixture'
FROM public.workspaces WHERE owner_user_id='${ids.owner}';
UPDATE public.channels SET connection_status='CONNECTED' WHERE id='${ids.channel}';
UPDATE public.channels SET connection_status='CONNECTED' WHERE id='${ids.legacyChannel}';
INSERT INTO public.oauth_connections(workspace_id, channel_id, encrypted_access_token, encrypted_refresh_token,
  access_token_expires_at, refresh_token_expires_at, granted_scopes)
SELECT workspace_id, '${ids.channel}', 'synthetic-cipher-access', 'synthetic-cipher-refresh',
       now()-interval '1 minute', now()+interval '30 days', array['user.info.basic']
FROM public.channels WHERE id='${ids.channel}';
INSERT INTO public.oauth_connections(workspace_id, channel_id, encrypted_access_token, encrypted_refresh_token,
  access_token_expires_at, refresh_token_expires_at, granted_scopes)
SELECT workspace_id, '${ids.legacyChannel}', 'synthetic-legacy-access', 'synthetic-legacy-refresh',
       now()-interval '1 minute', NULL, array['user.info.basic']
FROM public.channels WHERE id='${ids.legacyChannel}';
INSERT INTO public.media_assets(
 id, workspace_id, original_filename, storage_key, mime_type, file_size_bytes, status,
 validation_status, checksum_sha256, detected_mime_type, detected_video_codec, validated_at, validator_version
)
SELECT '${ids.media}', id, 'synthetic.mp4', id::text||'/${ids.media}/original.mp4', 'video/mp4', 1024,
 'READY', 'VALIDATED', repeat('d',64), 'video/mp4', 'h264', now(), 'gate316-fixture'
FROM public.workspaces WHERE owner_user_id='${ids.owner}';
INSERT INTO public.publication_jobs(id, workspace_id, channel_id, media_asset_id, status, scheduled_at, music_rights_confirmed, created_by)
SELECT job_id, workspace_id, '${ids.channel}', '${ids.media}', 'UNKNOWN'::public.publication_status,
       now()+interval '1 day', true, '${ids.owner}'
FROM (SELECT id AS workspace_id FROM public.workspaces WHERE owner_user_id='${ids.owner}') w
CROSS JOIN (VALUES ${ids.jobs.map((id) => `('${id}'::uuid)`).join(",")}) jobs(job_id);
COMMIT;
`;
  const result = await sql(port, setup, "gate316-fixture");
  assertSqlSuccess(result, "synthetic local fixture setup");
  const version = await sql(port, "SELECT current_setting('server_version_num')::int >= 170000 AND current_database()='postgres';\n", "gate316-preflight");
  assertSqlSuccess(version, "isolated PostgreSQL preflight query");
  assert(version.stdout.trim() === "t", "tests connected to local PostgreSQL 17 database postgres");
}

function extractFunction(migrationPath, functionName) {
  const sqlText = fs.readFileSync(migrationPath, 'utf8');
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = sqlText.match(new RegExp(`create or replace function public\\.${escaped}\\([\\s\\S]*?\\n\\$\\$;`, 'i'));
  if (!match) throw new Error(`could not locate ${functionName} in its source migration`);
  return match[0];
}

async function m10M11InterruptionCompatibility(port) {
  const m10 = extractFunction(path.join(root, 'supabase/migrations/20261103000010_tiktok_refresh_rotation_leases.sql'), 'acquire_tiktok_token_refresh');
  const m11 = extractFunction(path.join(root, 'supabase/migrations/20261103000011_oauth_refresh_legacy_state_guard.sql'), 'acquire_tiktok_token_refresh');
  assert(m10 !== m11, 'M10 and M11 claim functions are distinct revisions');
  const installedM10 = await sql(port, m10, 'gate3193-install-m10-claim');
  assertSqlSuccess(installedM10, 'M10-only claim function installed in disposable DB for interruption simulation');
  const workspace = (await sql(port, `SELECT workspace_id FROM public.channels WHERE id='${ids.legacyChannel}';`, 'gate3193-legacy-workspace')).stdout.trim();
  const m10Claim = await sql(port, `SET ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); SELECT public.acquire_tiktok_token_refresh('${ids.legacyChannel}','${workspace}','31930000-0000-0000-0000-000000000001')->>'state';`, 'gate3193-m10-null-expiry');
  assertSqlSuccess(m10Claim, 'M10 legacy-expiry behavior observed on disposable DB');
  assert(m10Claim.stdout.trim().split(/\r?\n/).at(-1) === 'ACQUIRED', 'M10 alone admits an unknown refresh expiry; do not enable workers between M10 and M11');
  const resetLegacy = await sql(port, `UPDATE public.oauth_connections SET refresh_state='READY',refresh_attempt_id=NULL,refresh_started_at=NULL WHERE channel_id='${ids.legacyChannel}';`, 'gate3193-reset-legacy-state');
  assertSqlSuccess(resetLegacy, 'synthetic M10 claim reset before applying M11 revision');
  const installedM11 = await sql(port, m11, 'gate3193-install-m11-claim');
  assertSqlSuccess(installedM11, 'M11 claim function restored in disposable DB');
  const m11Claim = await sql(port, `SET ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); SELECT public.acquire_tiktok_token_refresh('${ids.legacyChannel}','${workspace}','31930000-0000-0000-0000-000000000002')->>'state';`, 'gate3193-m11-null-expiry');
  assertSqlSuccess(m11Claim, 'M11 legacy-expiry behavior observed on disposable DB');
  assert(m11Claim.stdout.trim().split(/\r?\n/).at(-1) === 'REAUTH_REQUIRED', 'M11 fail-closes unknown refresh expiry during interrupted-rollout recovery');
  const finalState = await sql(port, `SELECT refresh_state||'|'||connection_status::text||'|'||last_error_code FROM public.oauth_connections o JOIN public.channels c ON c.id=o.channel_id WHERE o.channel_id='${ids.legacyChannel}';`, 'gate3193-m11-legacy-final');
  assertSqlSuccess(finalState, 'M11 postcondition read from disposable database');
  assert(finalState.stdout.trim() === 'REAUTH_REQUIRED|REAUTH_REQUIRED|REFRESH_EXPIRY_UNKNOWN', 'legacy row is preserved and marked for reauthorization without inventing expiry');
}

async function backupRestoreRehearsal(port) {
  const dumpPath = path.join(tempRoot, 'gate3193-disposable.dump');
  const dump = await run('pg_dump', ['-Fc', '--no-owner', '--no-acl', '--file', dumpPath, '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres'], { env: psqlEnv('gate3193-backup'), timeout: 120_000 });
  assert(dump.code === 0 && fs.existsSync(dumpPath) && fs.statSync(dumpPath).size > 0, 'custom-format backup created from the disposable database');
  fs.chmodSync(dumpPath, 0o600);
  const restorePort = await startRestoreStack();
  const restored = await run('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-acl', '--exit-on-error', '--dbname', 'postgres', '-h', '127.0.0.1', '-p', String(restorePort), '-U', 'supabase_admin', dumpPath], { env: psqlEnv('gate3193-restore'), timeout: 180_000 });
  assert(restored.code === 0, `custom-format backup restored to postgres in a separate disposable Supabase cluster (exit ${restored.code}): ${restored.stderr.trim().slice(-1600)}`);
  const verify = await run('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(restorePort), '-U', 'supabase_admin', '-d', 'postgres', '-c', `SELECT current_setting('server_version_num')::int/10000||'|'||(SELECT count(*) FROM supabase_migrations.schema_migrations)||'|'||(SELECT count(*) FROM public.oauth_connections)||'|'||(SELECT token_version FROM public.oauth_connections WHERE channel_id='${ids.channel}');`], { env: psqlEnv('gate3193-restore-verify') });
  assertSqlSuccess(verify, 'restored disposable database verification query');
  assert(verify.stdout.trim() === '17|34|2|3', 'restored database retains PG17, full migration ledger, both synthetic OAuth rows, and latest token generation');
}

async function verifyState(port, jobId, expectedStatus, expectedReservation, expectedRequestId, expectedEvents = 1) {
  const result = await sql(port, `
SELECT j.status::text || '|' || r.status::text || '|' ||
       (SELECT count(*) FROM public.publication_events e WHERE e.publication_job_id=j.id AND e.event_type='MANUAL_RESOLUTION') || '|' ||
       (SELECT count(*) FROM public.publication_job_manual_resolutions a WHERE a.publication_job_id=j.id) || '|' ||
       (SELECT count(*) FROM public.publication_job_manual_resolutions a WHERE a.publication_job_id=j.id AND a.request_id='${expectedRequestId}')
FROM public.publication_jobs j
JOIN public.publication_quota_reservations r ON r.publication_job_id=j.id
WHERE j.id='${jobId}';
`, "gate316-state-check");
  assertSqlSuccess(result, "read-only state verification");
  const [status, reservation, events, audit, requestRows] = result.stdout.trim().split("|");
  assert(status === expectedStatus, `${jobId} final status is ${expectedStatus}`);
  assert(reservation === expectedReservation, `${jobId} quota reservation is ${expectedReservation}`);
  assert(events === String(expectedEvents), `${jobId} has exactly ${expectedEvents} manual-resolution event(s)`);
  assert(audit === String(expectedEvents), `${jobId} has exactly ${expectedEvents} audit row(s)`);
  assert(requestRows === "1", `${jobId} audit row contains the expected request_id`);
}

async function oauthRefreshConcurrency(port) {
  const channel = ids.channel;
  const workspace = (await sql(port, `SELECT workspace_id FROM public.channels WHERE id='${channel}';`, 'gate316-oauth-workspace')).stdout.trim();
  const first = psqlSession(port, 'gate3191_oauth_first');
  first.child.stdin.write(`BEGIN;\nSET LOCAL statement_timeout='8s';\nSET LOCAL ROLE service_role;\nSELECT set_config('request.jwt.claims','{"role":"service_role"}',true);\nSELECT public.acquire_tiktok_token_refresh('${channel}','${workspace}','31910000-0000-0000-0000-000000000021')->>'state';\n\\echo G3191_OAUTH_FIRST_HELD\n`);
  await waitForMarker(first, 'G3191_OAUTH_FIRST_HELD');
  assert(first.stdout.includes('ACQUIRED'), 'first independent PostgreSQL process acquired refresh lease');
  const second = psqlSession(port, 'gate3191_oauth_second');
  second.child.stdin.end(`BEGIN;\nSET LOCAL statement_timeout='8s';\nSET LOCAL ROLE service_role;\nSELECT set_config('request.jwt.claims','{"role":"service_role"}',true);\nSELECT public.acquire_tiktok_token_refresh('${channel}','${workspace}','31910000-0000-0000-0000-000000000022')->>'state';\nCOMMIT;\n`);
  try {
    await waitForLock(port, 'gate3191_oauth_second');
    first.child.stdin.end("COMMIT;\n\\q\n");
    const [firstDone, secondDone] = await Promise.all([first.closed, second.closed]);
    assert(firstDone.code === 0, 'first independent PostgreSQL process committed its claim');
    assert(secondDone.code === 0 && secondDone.stdout.includes('BUSY'), 'second independent PostgreSQL process did not reuse the refresh token');
  } catch (error) {
    first.child.kill('SIGTERM'); second.child.kill('SIGTERM'); throw error;
  }
  const finalized = await sql(port, `SET ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); SELECT public.complete_tiktok_token_refresh('${channel}','${workspace}','31910000-0000-0000-0000-000000000021',1,'synthetic-access-v2','synthetic-refresh-v2',now()+interval '2 hours',now()+interval '180 days',array['user.info.basic']);`, 'gate3191_oauth-finalize');
  assertSqlSuccess(finalized, 'synthetic rotation finalized in disposable database');
  assert(finalized.stdout.trim().endsWith('t'), 'rotated access/refresh and expiry persisted together');
  const stale = await sql(port, `SET ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); SELECT public.complete_tiktok_token_refresh('${channel}','${workspace}','31910000-0000-0000-0000-000000000021',1,'stale-access','stale-refresh',now()+interval '2 hours',now()+interval '180 days',array[]::text[]);`, 'gate3191_oauth-stale');
  assertSqlSuccess(stale, 'stale completion checked');
  assert(stale.stdout.trim().split(/\r?\n/).at(-1) === 'f', 'old attempt cannot overwrite the committed token generation');

  const legacyAttempt = '31910000-0000-0000-0000-000000000023';
  const legacyClaim = await sql(port, `SET ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); SELECT public.acquire_tiktok_token_refresh('${channel}','${workspace}','${legacyAttempt}')->>'state';`, 'gate3192-legacy-writer-claim');
  assertSqlSuccess(legacyClaim, 'new worker acquired a later generation before compatibility probe');
  assert(legacyClaim.stdout.trim().split(/\r?\n/).at(-1) === 'ACQUIRED', 'compatibility probe has an active new-generation lease');
  const newerCommit = await sql(port, `SET ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); SELECT public.complete_tiktok_token_refresh('${channel}','${workspace}','${legacyAttempt}',2,'fenced-access-v3','fenced-refresh-v3',now()+interval '2 hours',now()+interval '180 days',array['user.info.basic']);`, 'gate3192-legacy-writer-new-commit');
  assertSqlSuccess(newerCommit, 'new fenced generation committed before legacy writer returns');
  assert(newerCommit.stdout.trim().split(/\r?\n/).at(-1) === 't', 'new generation advanced to version 3');
  const legacyWrite = await sql(port, `SET ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); DO $test$ BEGIN UPDATE public.oauth_connections SET encrypted_access_token='legacy-stale-access',encrypted_refresh_token='legacy-stale-refresh',access_token_expires_at=now()+interval '2 hours',refresh_token_expires_at=now()+interval '180 days',granted_scopes=array['user.info.basic'] WHERE channel_id='${channel}'; RAISE EXCEPTION 'direct token write unexpectedly succeeded'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'DIRECT_WRITE_DENIED'; END $test$; SELECT (token_version=3 AND encrypted_refresh_token<>'legacy-stale-refresh')::text FROM public.oauth_connections WHERE channel_id='${channel}';`, 'gate3192-legacy-writer-write');
  assertSqlSuccess(legacyWrite, 'legacy direct token store write was rejected by database grants');
  assert(legacyWrite.stdout.trim().split(/\r?\n/).at(-1) === 'true', `service_role cannot bypass CAS: stale direct UPDATE is denied and the newer token generation remains unchanged (${legacyWrite.stdout.trim().split(/\r?\n/).at(-1) ?? 'no state'})`);
}

async function oauthWorkerCrashRecovery(port) {
  const channel = ids.channel;
  const workspace = (await sql(port, `SELECT workspace_id FROM public.channels WHERE id='${channel}';`, 'gate3192-crash-workspace')).stdout.trim();
  const reauth = await sql(port, `SET ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); SELECT public.save_tiktok_connection('${channel}','oauth-recovery-user',array['user.info.basic'],'synthetic-recovery-access','synthetic-recovery-refresh',now()+interval '2 hours',now()+interval '180 days'); SELECT token_version FROM public.oauth_connections WHERE channel_id='${channel}';`, 'gate3192-crash-reauth');
  assertSqlSuccess(reauth, 'synthetic explicit reauthorization prepared crash-recovery fixture');
  const version = Number(reauth.stdout.trim().split(/\r?\n/).at(-1));
  assert(Number.isSafeInteger(version) && version > 0, 'synthetic OAuth generation is available for crash-recovery test');

  const crashedAttempt = '31920000-0000-0000-0000-000000000031';
  const crashed = await sql(port, `BEGIN; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',true); SELECT public.acquire_tiktok_token_refresh('${channel}','${workspace}','${crashedAttempt}')->>'state'; ROLLBACK;`, 'gate3192-crash-claim-rollback');
  assertSqlSuccess(crashed, 'worker crash before provider I/O rolled back its uncommitted lease');
  assert(crashed.stdout.trim().split(/\r?\n/).at(-1) === 'ACQUIRED', 'worker acquired a lease before simulated interruption');

  const resumedAttempt = '31920000-0000-0000-0000-000000000032';
  const resumed = await sql(port, `BEGIN; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',true); SELECT public.acquire_tiktok_token_refresh('${channel}','${workspace}','${resumedAttempt}')->>'state'; COMMIT;`, 'gate3192-worker-resume');
  assertSqlSuccess(resumed, 'resumed worker claimed a lease after transaction rollback');
  assert(resumed.stdout.trim().split(/\r?\n/).at(-1) === 'ACQUIRED', 'lease from interrupted pre-I/O worker did not strand the connection');

  const completed = await sql(port, `SET ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); SELECT public.complete_tiktok_token_refresh('${channel}','${workspace}','${resumedAttempt}',${version},'synthetic-recovered-access','synthetic-recovered-refresh',now()+interval '2 hours',now()+interval '180 days',array['user.info.basic']);`, 'gate3192-worker-resume-complete');
  assertSqlSuccess(completed, 'resumed worker completed the current lease through CAS');
  assert(completed.stdout.trim().split(/\r?\n/).at(-1) === 't', 'resumed worker persisted one current token generation through CAS');
}

async function tenProcessRefreshConcurrency(port, channel, workspace) {
  const prefix = 'gate3191_ten_';
  const tokenVersion = Number((await sql(port, `SELECT token_version FROM public.oauth_connections WHERE channel_id='${channel}';`, 'gate3191-ten-version')).stdout.trim());
  if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 1) throw new Error('invalid synthetic OAuth token_version before ten-process test');
  const holder = psqlSession(port, 'gate3191_ten_lock_holder');
  holder.child.stdin.write(`BEGIN;\nSET LOCAL statement_timeout='15s';\nSELECT id FROM public.channels WHERE id='${channel}' FOR UPDATE;\n\\echo G3191_TEN_LOCKED\n`);
  await waitForMarker(holder, 'G3191_TEN_LOCKED');
  const attempts = Array.from({ length: 10 }, () => crypto.randomUUID());
  const contenders = attempts.map((_, index) => psqlSession(port, `${prefix}${index}`));
  for (let index = 0; index < contenders.length; index += 1) {
    contenders[index].child.stdin.end(`BEGIN;\nSET LOCAL statement_timeout='12s';\nSET LOCAL ROLE service_role;\nSELECT set_config('request.jwt.claims','{"role":"service_role"}',true);\nSELECT public.acquire_tiktok_token_refresh('${channel}','${workspace}','${attempts[index]}')->>'state';\nCOMMIT;\n`);
  }
  try {
    await waitForLockCount(port, prefix, 10);
    holder.child.stdin.end('COMMIT;\\q\n');
    const results = await Promise.all(contenders.map((session) => session.closed));
    assert(results.every((result) => result.code === 0), 'all ten independent PostgreSQL clients completed without timeout');
    const acquired = results.map((result, index) => result.stdout.includes('ACQUIRED') ? index : -1).filter((index) => index >= 0);
    const busyCount = results.filter((result) => result.stdout.includes('BUSY')).length;
    assert(acquired.length === 1, 'exactly one of ten independent processes acquired the refresh lease');
    assert(busyCount === 9, 'the other nine independent processes observed BUSY and did not reuse the old refresh token');
    const released = await sql(port, `SET ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); SELECT public.fail_tiktok_token_refresh('${channel}','${workspace}','${attempts[acquired[0]]}',${tokenVersion},'REFRESH_OUTCOME_UNKNOWN');`, 'gate3191-ten-cleanup');
    assertSqlSuccess(released, 'synthetic ten-process lease cleanup checked');
    assert(released.stdout.trim().endsWith('t'), 'only the winning current attempt could close its lease');
  } catch (error) {
    holder.child.kill('SIGTERM');
    for (const session of contenders) session.child.kill('SIGTERM');
    throw error;
  }
}

async function main() {
  fs.mkdirSync(supabaseDir, { recursive: true });
  const port = await startIsolatedStack();
  const pgTap = await run("supabase", ["test", "db", "--local", "--workdir", projectDir], { timeout: 180_000 });
  const pgTapOutput = `${pgTap.stdout}\n${pgTap.stderr}`
    .replace(/eyJ[A-Za-z0-9_=-]+\.[A-Za-z0-9_.=-]+/g, "[redacted-token]")
    .replace(/(password|secret|token)\s*[=:]\s*\S+/gi, "$1=[redacted]");
  const pgTapFailure = pgTap.code === 0 ? "" : `; local output: ${pgTapOutput.split(/\r?\n/).filter(Boolean).slice(-12).join(" | ")}`;
  assert(pgTap.code === 0, `fresh isolated migration chain and pgTAP suite passed (exit ${pgTap.code}${pgTapFailure})`);
  const pgTapSummary = `${pgTap.stdout}\n${pgTap.stderr}`.split(/\r?\n/)
    .filter((line) => /Files\s*[=:]|Tests\s*[=:]|All tests passed|PASS/i.test(line))
    .slice(-6);
  if (pgTapSummary.length) process.stdout.write(`${pgTapSummary.join("\n")}\n`);
  const dbLint = await run("supabase", ["db", "lint", "--local", "--schema", "public,private,storage", "--fail-on", "error", "--workdir", projectDir], { timeout: 180_000 });
  assert(dbLint.code === 0, `fresh isolated database lint has no blocking errors (exit ${dbLint.code})`);
  const lintWarnings = `${dbLint.stdout}\n${dbLint.stderr}`.split(/\r?\n/).filter((line) => /warning/i.test(line));
  process.stdout.write(`Fresh isolated DB lint: no blocking errors; ${lintWarnings.length} warning line(s).\n`);
  const ready = await run("psql", psqlArgs(port, "gate316-ready"), { env: psqlEnv("gate316-ready") });
  assertSqlSuccess(ready, "local PostgreSQL listener is ready");
  await fixture(port);
  await m10M11InterruptionCompatibility(port);
  await oauthRefreshConcurrency(port);
  await oauthWorkerCrashRecovery(port);
  const oauthWorkspace = (await sql(port, `SELECT workspace_id FROM public.channels WHERE id='${ids.channel}';`, 'gate3191-ten-workspace')).stdout.trim();
  await tenProcessRefreshConcurrency(port, ids.channel, oauthWorkspace);

  await concurrentCase(port, {
    jobId: ids.jobs[0], firstOutcome: "PUBLISHED", firstRequestId: ids.requests[0],
    secondOutcome: "PUBLISHED", secondRequestId: ids.requests[0], secondUser: ids.owner,
    appName: "gate316_same", expectedSecondError: null,
  });
  const repeat = await sql(port, requestSql(ids.jobs[0], "PUBLISHED", ids.requests[0], ids.owner), "gate316_repeat");
  assertSqlSuccess(repeat, "same request_id replay after commit is successful");
  await verifyState(port, ids.jobs[0], "PUBLISHED", "CONSUMED", ids.requests[0]);

  const changedPayload = await sql(port, requestSql(ids.jobs[0], "NOT_PUBLISHED", ids.requests[0], ids.owner), "gate316_changed_payload");
  assert(changedPayload.code !== 0 && changedPayload.stderr.includes("request id already used"),
    "same request_id with a different outcome is rejected");

  await concurrentCase(port, {
    jobId: ids.jobs[1], firstOutcome: "PUBLISHED", firstRequestId: ids.requests[1],
    secondOutcome: "NOT_PUBLISHED", secondRequestId: ids.requests[2], secondUser: ids.owner,
    appName: "gate316_different", expectedSecondError: "job is not UNKNOWN",
  });
  await verifyState(port, ids.jobs[1], "PUBLISHED", "CONSUMED", ids.requests[1]);

  await concurrentCase(port, {
    jobId: ids.jobs[2], firstOutcome: "PUBLISHED", firstRequestId: ids.requests[3],
    secondOutcome: "PUBLISHED", secondRequestId: ids.requests[3], secondUser: ids.outsider,
    appName: "gate316_authz", expectedSecondError: "job not found",
  });
  await verifyState(port, ids.jobs[2], "PUBLISHED", "CONSUMED", ids.requests[3]);

  const notPublished = await sql(port, requestSql(ids.jobs[3], "NOT_PUBLISHED", ids.requests[4], ids.owner), "gate316_not_published");
  assertSqlSuccess(notPublished, "authorized NOT_PUBLISHED resolution completes");
  await verifyState(port, ids.jobs[3], "SCHEDULED", "RESERVED", ids.requests[4]);
  const quota = await sql(port, `SELECT reserved_publications >= 1 AND consumed_publications >= 3 FROM public.workspace_usage_cycles WHERE workspace_id=(SELECT id FROM public.workspaces WHERE owner_user_id='${ids.owner}') ORDER BY period_ends_at DESC LIMIT 1;\n`, "gate316-quota-check");
  assertSqlSuccess(quota, "quota aggregate read-only check");
  assert(quota.stdout.trim() === "t", "published jobs consume quota while NOT_PUBLISHED keeps its reservation");

  if (process.env.AUTOCLIP_SKIP_SYNTHETIC_RESTORE === '1') {
    process.stdout.write('SKIP: synthetic pg_dump/pg_restore rehearsal disabled; compatibility conflicts in managed Supabase schemas are tracked separately.\n');
  } else {
    await backupRestoreRehearsal(port);
  }

  process.stdout.write(`Gate 3.16 concurrency tests passed: ${assertions} assertions.\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (restoreStackMayExist) {
    const stopped = await run('supabase', [
      'stop', '--workdir', restoreProjectDir, '--project-id', restoreProjectId, '--no-backup',
    ], { timeout: 60_000 }).catch(() => ({ code: 1 }));
    if (stopped.code !== 0) {
      process.stderr.write('WARNING: disposable restore stack stop reported an error; inspect only containers with the unique restore project id.\n');
      process.exitCode = 1;
    }
  }
  if (stackMayExist) {
    const stopped = await run("supabase", [
      "stop", "--workdir", projectDir, "--project-id", projectId, "--no-backup",
    ], { timeout: 60_000 }).catch(() => ({ code: 1 }));
    if (stopped.code !== 0) {
      process.stderr.write("WARNING: disposable Supabase stack stop reported an error; inspect local Docker containers for the unique project id.\n");
      process.exitCode = 1;
    }
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
