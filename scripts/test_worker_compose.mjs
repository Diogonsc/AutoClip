import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = resolve(root, 'deploy/local-worker');
const envFile = process.env.AUTOCLIP_WORKER_ENV_FILE ?? resolve(workerDir, '.env');
const localHostnames = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);
const tempDir = await mkdtemp(resolve(tmpdir(), 'autoclip-compose-smoke-'));
let project = `autoclip-smoke-${process.pid}-${randomBytes(3).toString('hex')}`;
let composeEnv = resolve(tempDir, '.env');
let supabaseUrl; let containerSupabaseUrl; let serviceKey; let instanceId = randomUUID();
let listeningPort;
let interrupted = false;
const activeChildren = new Set();
let edgeProcess;
process.on('SIGINT', () => {
  interrupted = true;
  process.exitCode = 130;
  for (const child of activeChildren) child.kill('SIGTERM');
});

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

function run(command, args, { quiet = false, timeout = 300_000, cleanup = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    activeChildren.add(child);
    const stdout = []; const stderr = [];
    child.stdout.on('data', chunk => { stdout.push(chunk); if (!quiet) process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { stderr.push(chunk); if (!quiet) process.stderr.write(chunk); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('error', error => { clearTimeout(timer); activeChildren.delete(child); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      activeChildren.delete(child);
      if (interrupted && !cleanup) return reject(new Error('Smoke test interrupted by operator'));
      if (code !== 0) reject(new Error(`${command} exited ${code}: ${Buffer.concat(stderr).toString().slice(-1000)}`));
      else resolvePromise(Buffer.concat(stdout).toString());
    });
  });
}

const composeBase = ['compose', '--project-name', project, '--project-directory', workerDir, '-f', resolve(workerDir, 'compose.yaml'), '--env-file', composeEnv];
const compose = (...args) => run('docker', [...composeBase, ...args]);

function parseStatusEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap(line => {
    const index = line.indexOf('=');
    if (index < 0) return [];
    const key = line.slice(0, index);
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    return [[key, value]];
  }));
}

async function waitForEdge(endpoint, deadlineMs = 90_000) {
  const deadline = Date.now() + deadlineMs;
  let lastStatus = 'not ready';
  while (Date.now() < deadline) {
    if (edgeProcess?.exitCode !== null && edgeProcess?.exitCode !== undefined) throw new Error('Supabase local Edge Runtime encerrou durante inicialização');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(1500) });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401 && payload.error === 'worker_request_expired_or_invalid') return;
      lastStatus = `HTTP ${response.status}/${payload.error ?? 'unknown'}`;
    } catch (error) { lastStatus = error.message; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1000));
  }
  throw new Error(`video-worker-api local não ficou disponível: ${lastStatus}`);
}

async function stopEdge() {
  if (!edgeProcess || edgeProcess.exitCode !== null) return;
  const child = edgeProcess; edgeProcess = undefined;
  await new Promise(resolvePromise => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.once('close', () => { clearTimeout(timer); resolvePromise(); });
    child.kill('SIGTERM');
  });
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  await new Promise(resolvePromise => server.close(resolvePromise));
  return port;
}

async function waitForReady(base, deadlineMs = 120_000) {
  const deadline = Date.now() + deadlineMs;
  let lastError = 'not ready';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/ready`, { signal: AbortSignal.timeout(1500) });
      const payload = await response.json();
      if (response.ok && payload.ready && payload.backend === 'connected') return payload;
      lastError = `health=${response.status}/${payload.backend}`;
    } catch (error) { lastError = error.message; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1500));
  }
  throw new Error(`Worker não ficou ready: ${lastError}`);
}

async function getLocalQueueCount() {
  const response = await fetch(`${supabaseUrl}/rest/v1/media_assets?select=id&status=eq.UPLOADING&validation_status=in.(PENDING,VALIDATING)`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, prefer: 'count=exact' },
  });
  if (!response.ok) throw new Error(`Falha consultando fila local (${response.status})`);
  const range = response.headers.get('content-range') ?? '';
  const count = Number(range.split('/').at(-1));
  if (!Number.isSafeInteger(count)) throw new Error('Resposta de contagem da fila local inválida');
  return count;
}

async function writeFixture(path, args) {
  await run('ffmpeg', args(path), { quiet: true, timeout: 60_000 });
}

async function invokeValidator(path, expectValid) {
  const nodeCode = `import{readFile}from'node:fs/promises';const b=await readFile('/input/video');const t=(await readFile('/run/secrets/video_validator_token','utf8')).trim();const r=await fetch('http://validator:9782/validate',{method:'POST',headers:{'content-type':'video/mp4','content-length':String(b.byteLength),'x-validator-token':t,'x-media-id':'11111111-1111-4111-8111-111111111111','x-claim-token':'22222222-2222-4222-8222-222222222222'},body:b});const j=await r.json();if(${expectValid ? 'true' : 'false'} ? !r.ok || j.codec!=='h264' || !j.attestation || !j.sha256 : r.status!==422)process.exit(31);console.log(JSON.stringify({status:r.status,codec:j.codec??null,error:j.error??null,sha256:j.sha256??null,attested:Boolean(j.attestation)}));`;
  return run('docker', [...composeBase, 'run', '--rm', '--no-deps', '-v', `${path}:/input/video:ro`, '--entrypoint', 'node', 'worker', '--input-type=module', '-e', nodeCode], { timeout: 150_000 });
}

async function verifyValidatorRejectsBadToken() {
  const code = `const r=await fetch('http://validator:9782/validate',{method:'POST',headers:{'content-type':'video/mp4','content-length':'4','x-validator-token':'wrong-token'},body:Buffer.from('test')});await r.arrayBuffer();if(r.status!==401)process.exit(32);console.log('unauthorized-rejected');`;
  const output = await run('docker', [...composeBase, 'run', '--rm', '--no-deps', '--entrypoint', 'node', 'worker', '-e', code], { timeout: 30_000 });
  if (!output.includes('unauthorized-rejected')) throw new Error('Validador aceitou token interno inválido');
}

async function verifyContainerIsolation(service, requiredNetwork) {
  const id = (await compose('ps', '-q', service)).trim();
  if (!id) throw new Error(`${service} container não está ativo`);
  const raw = await run('docker', ['inspect', id], { quiet: true });
  const info = JSON.parse(raw)[0];
  if (info.Config.User !== 'node' || !info.HostConfig.ReadonlyRootfs || !info.HostConfig.CapDrop?.includes('ALL') || info.HostConfig.Privileged) {
    throw new Error(`${service} falhou as verificações de usuário/read-only/capabilities`);
  }
  const containerEnv = info.Config.Env ?? [];
  if (containerEnv.some(value => /^(SUPABASE_SERVICE_ROLE_KEY|VIDEO_VALIDATOR_TOKEN|VIDEO_WORKER_API_SECRET|VIDEO_VALIDATION_ATTESTATION_KEY)=/.test(value))) throw new Error(`${service} expôs segredo em variável de ambiente`);
  if (service === 'validator' && containerEnv.some(value => /^SUPABASE_/.test(value))) throw new Error('Validator recebeu configuração Supabase indevida');
  if ((info.Mounts ?? []).some(mount => mount.Source === '/var/run/docker.sock' || mount.Destination === '/var/run/docker.sock')) throw new Error(`${service} montou o Docker socket`);
  const expectedMemory = service === 'worker' ? 2 * 1024 ** 3 : 768 * 1024 ** 2;
  const expectedCpus = service === 'worker' ? 2_000_000_000 : 1_000_000_000;
  const expectedPids = service === 'worker' ? 64 : 48;
  if (info.HostConfig.Memory !== expectedMemory || info.HostConfig.NanoCpus !== expectedCpus || info.HostConfig.PidsLimit !== expectedPids) throw new Error(`${service} não aplicou os limites configurados de memória/CPU/PIDs`);
  const network = info.NetworkSettings.Networks?.[requiredNetwork];
  if (!network) throw new Error(`${service} não está na rede Compose ${requiredNetwork}`);
  if (service === 'validator' && (info.HostConfig.PortBindings && Object.keys(info.HostConfig.PortBindings).length)) throw new Error('Validator expõe porta ao host');
  if (service === 'worker') {
    const binding = info.HostConfig.PortBindings?.['9781/tcp']?.[0];
    if (binding?.HostIp !== '127.0.0.1') throw new Error('Health port do worker não está restrito a loopback');
  }
  return info;
}

try {
  const input = parseEnv(await readFile(envFile, 'utf8'));
  if (!input.VIDEO_WORKER_API_URL || !input.VIDEO_WORKER_API_SECRET_FILE || !input.VIDEO_VALIDATOR_TOKEN_FILE || !input.VIDEO_VALIDATION_ATTESTATION_KEY_FILE) throw new Error('Env local incompleto: configure URL local e caminhos das credenciais específicas do worker.');
  const configuredApi = new URL(input.VIDEO_WORKER_API_URL);
  if (!localHostnames.has(configuredApi.hostname) || configuredApi.protocol !== 'http:' || !configuredApi.pathname.endsWith('/functions/v1/video-worker-api')) throw new Error('Recusa fechada: o smoke test aceita exclusivamente a Edge Function local.');
  if (input.VIDEO_WORKER_ALLOW_CLOUD === 'true') throw new Error('Recusa fechada: VIDEO_WORKER_ALLOW_CLOUD precisa estar false no teste.');
  const resolveSecretPath = value => value.startsWith('/') ? value : resolve(workerDir, value);
  const validatorTokenPath = resolveSecretPath(input.VIDEO_VALIDATOR_TOKEN_FILE);
  const workerApiSecretPath = resolveSecretPath(input.VIDEO_WORKER_API_SECRET_FILE);
  const attestationKeyPath = resolveSecretPath(input.VIDEO_VALIDATION_ATTESTATION_KEY_FILE);
  const workerApiSecret = (await readFile(workerApiSecretPath, 'utf8')).trim();
  const validatorToken = (await readFile(validatorTokenPath, 'utf8')).trim();
  const attestationKey = (await readFile(attestationKeyPath, 'utf8')).trim();
  for (const [label, path, value] of [['worker API secret',workerApiSecretPath,workerApiSecret],['validator token',validatorTokenPath,validatorToken],['validator attestation key',attestationKeyPath,attestationKey]]) {
    const info = await stat(path);
    if (!value || (info.mode & 0o077) !== 0) throw new Error(`Arquivo local de ${label} vazio ou acessível a grupo/outros.`);
  }
  if ([workerApiSecret, validatorToken, attestationKey].some(value => Buffer.byteLength(value) < 32)) throw new Error('As credenciais locais precisam ter pelo menos 32 bytes.');
  const localStatus = parseStatusEnv(execFileSync('supabase', ['status', '-o', 'env'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const localApi = new URL(localStatus.API_URL ?? 'http://invalid');
  if (!localStatus.SERVICE_ROLE_KEY || !localStatus.API_URL || !localHostnames.has(localApi.hostname)
    || (configuredApi.port && configuredApi.port !== localApi.port)) throw new Error('Status local do Supabase não corresponde ao endpoint loopback configurado.');
  serviceKey = localStatus.SERVICE_ROLE_KEY;
  supabaseUrl = new URL(localStatus.API_URL).toString().replace(/\/$/, '');
  const containerParsed = new URL(supabaseUrl);
  containerParsed.hostname = 'host.docker.internal';
  containerSupabaseUrl = containerParsed.toString().replace(/\/$/, '');
  const isolatedWorkerSecretPath = resolve(tempDir, 'video_worker_api_secret');
  const isolatedValidatorTokenPath = resolve(tempDir, 'video_validator_token');
  const isolatedAttestationKeyPath = resolve(tempDir, 'video_validation_attestation_key');
  await writeFile(isolatedWorkerSecretPath, workerApiSecret, { mode: 0o600, flag: 'wx' });
  await writeFile(isolatedValidatorTokenPath, validatorToken, { mode: 0o600, flag: 'wx' });
  await writeFile(isolatedAttestationKeyPath, attestationKey, { mode: 0o600, flag: 'wx' });
  const edgeEnv = resolve(tempDir, 'edge.env');
  await writeFile(edgeEnv, `VIDEO_WORKER_API_SECRET=${workerApiSecret}\nVIDEO_VALIDATION_ATTESTATION_KEY=${attestationKey}\n`, { mode: 0o600, flag: 'wx' });
  listeningPort = await reservePort();
  const generated = {
    ...input,
    VIDEO_WORKER_API_URL: `${containerSupabaseUrl}/functions/v1/video-worker-api`,
    VIDEO_WORKER_API_SECRET_FILE: isolatedWorkerSecretPath,
    VIDEO_VALIDATOR_TOKEN_FILE: isolatedValidatorTokenPath,
    VIDEO_VALIDATION_ATTESTATION_KEY_FILE: isolatedAttestationKeyPath,
    VIDEO_WORKER_ALLOW_CLOUD: 'false',
    WORKER_INSTANCE_ID: instanceId, WORKER_HEALTH_HOST_PORT: String(listeningPort),
  };
  await writeFile(composeEnv, Object.entries(generated).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });

  const edgeEndpoint = `${supabaseUrl}/functions/v1/video-worker-api`;
  const edgeProbe = await fetch(edgeEndpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(1500) }).catch(() => null);
  const edgePayload = await edgeProbe?.json().catch(() => ({}));
  if (edgeProbe?.status !== 401 || edgePayload?.error !== 'worker_request_expired_or_invalid') {
    edgeProcess = spawn('supabase', ['functions', 'serve', '--no-verify-jwt', '--env-file', edgeEnv], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    activeChildren.add(edgeProcess);
    edgeProcess.stdout.on('data', chunk => { if (process.env.WORKER_SMOKE_VERBOSE === 'true') process.stdout.write(chunk); });
    edgeProcess.stderr.on('data', chunk => { if (process.env.WORKER_SMOKE_VERBOSE === 'true') process.stderr.write(chunk); });
    edgeProcess.once('close', () => activeChildren.delete(edgeProcess));
    await waitForEdge(edgeEndpoint);
  }

  const queued = await getLocalQueueCount();
  if (queued !== 0) throw new Error(`Fila local contém ${queued} tarefas. Não iniciarei um worker de teste sobre trabalhos existentes.`);
  await run('docker', ['build', '-t', 'autoclip-video-validator:3.6.1', '-f', resolve(root, 'scripts/video-validator/Dockerfile'), resolve(root, 'scripts/video-validator')], { timeout: 300_000 });
  await run('docker', ['compose', ...composeBase.slice(1), 'config', '--quiet'], { quiet: true });
  await compose('up', '-d', '--build');
  const networkName = `${project}_validation`;
  const internalRaw = await run('docker', ['network', 'inspect', networkName], { quiet: true });
  if (!JSON.parse(internalRaw)[0].Internal) throw new Error('Rede do validador não está marcada internal');
  await verifyContainerIsolation('validator', networkName);
  await verifyContainerIsolation('worker', `${project}_egress`);
  let ready = await waitForReady(`http://127.0.0.1:${listeningPort}`);
  console.log(`PASS worker ready; pending=${ready.pending}; instance=${ready.instanceId}; heartbeat=${ready.lastBackendContactAt}`);
  const heartbeatResponse = await fetch(`${supabaseUrl}/rest/v1/media_validation_workers?instance_id=eq.${instanceId}&select=instance_id,status,worker_version,pending_count`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  if (!heartbeatResponse.ok || (await heartbeatResponse.json()).length !== 1) throw new Error('Heartbeat service-only não persistiu no Supabase local');
  console.log('PASS heartbeat persisted; service_role absent from worker; container user=node; read-only; cap-drop=ALL; no Docker socket; validator on internal network; health bound to loopback');
  await verifyValidatorRejectsBadToken();
  console.log('PASS validator rejects incorrect internal token');

  const validPath = resolve(tempDir, 'fixture-h264.mp4');
  await writeFixture(validPath, path => ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=360x640:rate=25','-f','lavfi','-i','sine=frequency=1000:sample_rate=44100','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-y',path]);
  const validProof = await invokeValidator(validPath, true);
  if (!validProof.includes('"codec":"h264"')) throw new Error('Validator sidecar não atestou H.264');
  console.log('PASS isolated validator HTTP accepts real H.264/AAC fixture');
  const invalidPath = resolve(tempDir, 'invalid.mp4');
  await writeFile(invalidPath, Buffer.from('not a video'), { mode: 0o600, flag: 'wx' });
  const invalidProof = await invokeValidator(invalidPath, false);
  if (!invalidProof.includes('"status":422')) throw new Error('Validator não rejeitou bytes inválidos');
  console.log('PASS isolated validator HTTP rejects forged MIME/content');

  const validatorRaw = await run('docker', ['inspect', (await compose('ps','-q','validator')).trim()], { quiet: true });
  const validator = JSON.parse(validatorRaw)[0];
  if (Object.keys(validator.NetworkSettings.Networks ?? {}).join(',') !== `${project}_validation`) throw new Error('Validator está conectado fora da rede interna');
  await compose('restart', 'worker');
  ready = await waitForReady(`http://127.0.0.1:${listeningPort}`);
  console.log(`PASS worker restart recovered; ready=${ready.ready}`);
  await compose('stop', '--timeout', '150', 'worker');
  await compose('stop', '--timeout', '5', 'validator');
  console.log('PASS graceful Compose stop completed');
  console.log('PASS local Compose smoke; no queued media was processed by the integration fixture');
} catch (error) {
  console.error(`FAIL worker Compose smoke: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { await run('docker', [...composeBase, 'down'], { quiet: true, timeout: 60_000, cleanup: true }); } catch { /* project may not have started */ }
  await stopEdge().catch(() => {});
  await rm(tempDir, { recursive: true, force: true });
}
