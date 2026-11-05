import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runId = randomUUID().replaceAll('-', '').slice(0, 16);
const projectId = `autoclip-e2e-${runId}`;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autoclip-e2e-disposable-'));
const projectDir = path.join(tempRoot, 'project');
const supabaseDir = path.join(projectDir, 'supabase');
const videoImage = `autoclip-video-validator:e2e-${runId}`;
const safeEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: os.tmpdir() };
let stackMayExist = false;
let imageMayExist = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: options.timeout ?? 900_000, cwd: options.cwd, env: options.env ?? safeEnv, stdio: options.capture === false ? 'inherit' : 'pipe' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const safeOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
      .replace(/(password|secret|token|api[_ -]?key|anon[_ -]?key|service[_ -]?role[_ -]?key)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[REDACTED]')
      .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]')
      .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, '$1[REDACTED]@')
      .split(/\r?\n/).filter(Boolean).slice(-24).join('\n');
    throw new Error(`${command} failed with exit ${result.status ?? 'signal'}${safeOutput ? `:\n${safeOutput}` : '; no diagnostic output'}`);
  }
  return result.stdout ?? '';
}

function envFrom(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return values;
}

async function portFree(port) {
  const server = net.createServer();
  return new Promise((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function chooseBasePort() {
  const seed = 40_000 + (Number.parseInt(runId.slice(0, 4), 16) % 20_000);
  for (let offset = 0; offset < 10_000; offset++) {
    const base = seed + offset;
    if (base + 8 > 65_000) break;
    if ((await Promise.all(Array.from({ length: 9 }, (_, i) => portFree(base + i)))).every(Boolean)) return base;
  }
  throw new Error('No free loopback port range found; disposable E2E was not started.');
}

async function chooseSinglePort() {
  for (let tries = 0; tries < 100; tries++) {
    const port = 30_000 + Math.floor(Math.random() * 20_000);
    if (await portFree(port)) return port;
  }
  throw new Error('No free loopback port found for the E2E frontend.');
}

function verifyDisposablePath() {
  if (!projectDir.startsWith(path.join(os.tmpdir(), 'autoclip-e2e-disposable-')) ||
    !fs.existsSync(path.join(tempRoot, 'project')) ||
    !fs.existsSync(path.join(tempRoot, '.autoclip-e2e-owned'))) {
    throw new Error('Disposable resource ownership check failed.');
  }
}

function removeOwnedVolumes() {
  const listed = run('docker', ['volume', 'ls', '--quiet', '--filter', `label=com.supabase.cli.project=${projectId}`]);
  for (const name of listed.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const owner = run('docker', ['volume', 'inspect', '--format', '{{index .Labels "com.supabase.cli.project"}}', name]).trim();
    if (owner !== projectId || !name.startsWith('supabase_')) {
      throw new Error(`Refusing to remove volume without exact disposable-project ownership: ${name}`);
    }
    run('docker', ['volume', 'rm', name]);
  }
}

async function main() {
  const context = run('docker', ['context', 'show']).trim();
  const endpoint = run('docker', ['context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}']).trim().replace(/^"|"$/g, '');
  if (!endpoint.startsWith('unix:///')) throw new Error('Docker context is not a local Unix socket; disposable E2E refused to start.');
  fs.writeFileSync(path.join(tempRoot, '.autoclip-e2e-owned'), `${projectId}\n`, { mode: 0o600, flag: 'wx' });
  fs.mkdirSync(supabaseDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.autoclip-e2e-disposable'), `${projectId}\n`, { mode: 0o600, flag: 'wx' });
  fs.copyFileSync(path.join(repoRoot, 'supabase/config.toml'), path.join(supabaseDir, 'config.toml'));
  fs.cpSync(path.join(repoRoot, 'supabase/migrations'), path.join(supabaseDir, 'migrations'), { recursive: true });
  const functionsSource = path.join(repoRoot, 'supabase/functions');
  fs.cpSync(functionsSource, path.join(supabaseDir, 'functions'), {
    recursive: true,
    filter(sourcePath) {
      const base = path.basename(sourcePath);
      return base !== '.env' && !(base.startsWith('.env.') && base !== '.env.example') && base !== 'node_modules' && base !== '.git';
    },
  });

  const base = await chooseBasePort();
  let config = fs.readFileSync(path.join(supabaseDir, 'config.toml'), 'utf8');
  config = config.replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`)
    .replace(/^port\s*=\s*54321\s*$/m, `port = ${base}`)
    .replace(/^port\s*=\s*54322\s*$/m, `port = ${base + 1}`)
    .replace(/^port\s*=\s*54323\s*$/m, `port = ${base + 2}`)
    .replace(/^major_version\s*=\s*17\s*$/m, `major_version = 17\nshadow_port = ${base + 7}`);
  config += `\n[db.pooler]\nport = ${base + 8}\n\n[inbucket]\nport = ${base + 3}\nsmtp_port = ${base + 4}\npop3_port = ${base + 5}\n\n[analytics]\nport = ${base + 6}\n`;
  fs.writeFileSync(path.join(supabaseDir, 'config.toml'), config, { mode: 0o600 });

  verifyDisposablePath();
  stackMayExist = true;
  run('supabase', ['start', '--workdir', projectDir], { timeout: 900_000 });
  const status = envFrom(run('supabase', ['status', '-o', 'env', '--workdir', projectDir]));
  const required = ['API_URL', 'DB_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY'];
  if (required.some((key) => !status[key])) throw new Error('Disposable Supabase did not return all local connection values.');
  for (const key of ['API_URL', 'DB_URL']) {
    const host = new URL(status[key]).hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Disposable stack endpoint failed loopback validation.');
  }

  const webPort = await chooseSinglePort();
  const childEnv = {
    PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '',
    E2E_EPHEMERAL: '1', E2E_PROJECT_DIR: projectDir,
    E2E_SUPABASE_URL: status.API_URL, E2E_DB_URL: status.DB_URL,
    E2E_SUPABASE_ANON_KEY: status.ANON_KEY, E2E_SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    E2E_VIDEO_VALIDATOR_IMAGE: videoImage,
    E2E_WEB_PORT: String(webPort), E2E_BASE_URL: `http://127.0.0.1:${webPort}`,
  };
  const e2eArgs = ['e2e/run-local-e2e.mjs', ...process.argv.slice(2)];
  imageMayExist = true;
  run(process.execPath, e2eArgs, { cwd: path.join(repoRoot, 'apps/web'), env: childEnv, timeout: 1_800_000 });
}

try {
  await main();
} finally {
  if (stackMayExist) {
    verifyDisposablePath();
    let stopped = false;
    try {
      run('supabase', ['stop', '--workdir', projectDir, '--project-id', projectId, '--no-backup'], { timeout: 180_000 });
      stopped = true;
    } catch {
      process.stderr.write(`Disposable Supabase cleanup failed for owned project ${projectId}; inspect only containers with that project id.\n`);
      process.exitCode = 1;
    }
    if (stopped) {
      try { removeOwnedVolumes(); }
      catch {
        process.stderr.write(`Disposable volume cleanup failed for owned project ${projectId}; no global Docker cleanup was attempted.\n`);
        process.exitCode = 1;
      }
    }
  }
  if (imageMayExist) {
    const image = spawnSync('docker', ['image', 'inspect', videoImage], { encoding: 'utf8', stdio: 'ignore' });
    if (image.status === 0) {
      try { run('docker', ['image', 'rm', videoImage], { timeout: 60_000 }); }
      catch { process.stderr.write('Owned E2E image cleanup failed; no global Docker cleanup was attempted.\n'); process.exitCode = 1; }
    }
  }
  if (tempRoot.startsWith(path.join(os.tmpdir(), 'autoclip-e2e-disposable-')) && fs.existsSync(path.join(tempRoot, '.autoclip-e2e-owned'))) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
