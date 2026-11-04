import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const apiUrl = process.env.VIDEO_WORKER_API_URL;
const apiSecretFile = process.env.VIDEO_WORKER_API_SECRET_FILE;
const apiSecret = apiSecretFile ? (await readFile(apiSecretFile, 'utf8')).trim() : process.env.VIDEO_WORKER_API_SECRET;
const validatorUrl = process.env.VIDEO_VALIDATOR_URL;
const validatorTokenFile = process.env.VIDEO_VALIDATOR_TOKEN_FILE;
const validatorToken = validatorTokenFile ? (await readFile(validatorTokenFile, 'utf8')).trim() : process.env.VIDEO_VALIDATOR_TOKEN;
const instanceId = process.env.WORKER_INSTANCE_ID ?? randomUUID();
const workerVersion = process.env.WORKER_VERSION ?? '3.6.1';
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? '9781');
const pollIntervalMs = Math.max(500, Math.min(60_000, Number(process.env.VIDEO_WORKER_POLL_MS ?? 5000)));
const once = process.argv.includes('--once');
if (!apiUrl || !apiSecret || Buffer.byteLength(apiSecret) < 32) throw new Error('Configure VIDEO_WORKER_API_URL e VIDEO_WORKER_API_SECRET_FILE (mínimo 32 bytes).');
if (!validatorUrl || !validatorToken || Buffer.byteLength(validatorToken) < 32) throw new Error('Configure VIDEO_VALIDATOR_URL e VIDEO_VALIDATOR_TOKEN_FILE (mínimo 32 bytes).');
const endpoint = new URL(apiUrl);
const localHosts = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'];
if (!localHosts.includes(endpoint.hostname) && (process.env.VIDEO_WORKER_ALLOW_CLOUD !== 'true' || endpoint.protocol !== 'https:')) {
  throw new Error('Worker recusou endpoint remoto: somente HTTPS com opt-in explícito é permitido.');
}

const metrics = { lastBackendSuccessAt: null, lastHeartbeatSuccessAt: null, lastCompletedAt: null, completed: 0, rejected: 0, retries: 0, failed: 0, pending: null, processing: 0, totalDurationMs: 0, timedTasks: 0 };
let stopping = false;
let workerStatus = 'ONLINE';
const health = createServer((req, res) => {
  const now = Date.now();
  const connectivityAge = metrics.lastBackendSuccessAt ? now - Date.parse(metrics.lastBackendSuccessAt) : null;
  const heartbeatAge = metrics.lastHeartbeatSuccessAt ? now - Date.parse(metrics.lastHeartbeatSuccessAt) : null;
  const isReady = !stopping && connectivityAge !== null && connectivityAge < 120_000 && heartbeatAge !== null && heartbeatAge < 120_000;
  const status = {
    live: !stopping, ready: isReady,
    backend: connectivityAge !== null && connectivityAge < 120_000 ? 'connected' : 'stale_or_unavailable',
    heartbeat: heartbeatAge !== null && heartbeatAge < 120_000 ? 'current' : 'stale_or_unavailable',
    lastBackendContactAt: metrics.lastBackendSuccessAt, lastHeartbeatAt: metrics.lastHeartbeatSuccessAt,
    lastCompletedAt: metrics.lastCompletedAt, pending: metrics.pending, processing: metrics.processing,
    completedSinceStart: metrics.completed, rejectedSinceStart: metrics.rejected, retriesSinceStart: metrics.retries,
    failuresSinceStart: metrics.failed, averageValidationMs: metrics.timedTasks ? Math.round(metrics.totalDurationMs / metrics.timedTasks) : null,
    instanceId, version: workerVersion,
  };
  res.writeHead(req.url === '/ready' && !isReady ? 503 : 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(status));
});
health.listen(healthPort, '0.0.0.0');

function hex(buffer) { return Buffer.from(buffer).toString('hex'); }
async function signedRequest(action, fields = {}, timeoutMs = 20_000) {
  const body = JSON.stringify({ action, ...fields });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const path = '/video-worker-api';
  const signature = createHmac('sha256', apiSecret).update(`POST\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`).digest('hex');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-worker-timestamp': timestamp, 'x-worker-nonce': nonce, 'x-worker-signature': signature },
      body, signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error ?? 'WORKER_API_UNAVAILABLE'), { status: response.status, terminal: response.status === 401 || response.status === 403 });
    metrics.lastBackendSuccessAt = new Date().toISOString();
    return payload;
  } catch (error) {
    if (error?.terminal || error?.status) throw error;
    throw Object.assign(new Error('WORKER_API_UNAVAILABLE'), { retryable: true });
  } finally { clearTimeout(timer); }
}

async function validateRemotely(bytes, row) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 130_000);
  try {
    const response = await fetch(`${validatorUrl.replace(/\/$/, '')}/validate`, {
      method: 'POST', headers: {
        'content-type': row.mime_type, 'content-length': String(bytes.byteLength), 'x-validator-token': validatorToken,
        'x-media-id': row.media_id, 'x-claim-token': row.claim_token,
      }, body: bytes, signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error ?? 'VIDEO_VALIDATOR_UNAVAILABLE'), { validationFailure: response.status === 422, retryable: response.status !== 422 });
    return payload;
  } catch (error) {
    if (error?.validationFailure || error?.retryable) throw error;
    throw Object.assign(new Error('VIDEO_VALIDATOR_UNAVAILABLE'), { retryable: true });
  } finally { clearTimeout(timer); }
}

async function downloadClaim(row) {
  if (typeof row.download_url !== 'string') throw Object.assign(new Error('SIGNED_DOWNLOAD_URL_INVALID'), { validationFailure: true });
  const signed = new URL(row.download_url);
  if (!signed.pathname.startsWith('/storage/v1/object/sign/')) throw Object.assign(new Error('SIGNED_DOWNLOAD_URL_INVALID'), { validationFailure: true });
  // Supabase local returns an internal `kong` origin from Edge Functions. Keep
  // the server-issued path and signature but use the configured reachable API origin.
  const reachableUrl = new URL(`${signed.pathname}${signed.search}`, endpoint.origin);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(reachableUrl, { signal: controller.signal });
    if (!response.ok) throw Object.assign(new Error(response.status === 404 ? 'VALIDATION_OBJECT_MISSING' : 'VALIDATION_STORAGE_TEMPORARY'), { validationFailure: response.status === 404, retryable: response.status !== 404 });
    const declaredLength = Number(response.headers.get('content-length'));
    if (!Number.isSafeInteger(declaredLength) || declaredLength !== Number(row.file_size_bytes) || declaredLength <= 0 || declaredLength > 50 * 1024 * 1024) {
      throw Object.assign(new Error('UPLOAD_SIZE_MISMATCH'), { validationFailure: true });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== declaredLength) throw Object.assign(new Error('UPLOAD_SIZE_MISMATCH'), { validationFailure: true });
    return bytes;
  } catch (error) {
    if (error?.validationFailure || error?.retryable) throw error;
    throw Object.assign(new Error('VALIDATION_STORAGE_TEMPORARY'), { retryable: true });
  } finally { clearTimeout(timer); }
}

async function processClaim(row) {
  const bytes = await downloadClaim(row);
  const expectedHash = createHash('sha256').update(bytes).digest('hex');
  const proof = await validateRemotely(bytes, row);
  if (proof.media_id !== row.media_id || proof.claim_token !== row.claim_token || proof.sha256 !== expectedHash || proof.size !== bytes.byteLength || proof.mime !== row.mime_type || !proof.attestation) {
    throw Object.assign(new Error('VALIDATOR_PROOF_MISMATCH'), { validationFailure: true });
  }
  await signedRequest('complete', { media_id: row.media_id, claim_token: row.claim_token, proof }, 130_000);
}

async function processClaimSafe(row) {
  const startedAt = Date.now();
  metrics.processing += 1;
  const heartbeatTimer = setInterval(() => emitHeartbeat('ONLINE', true).catch(() => {
    workerStatus = 'DEGRADED'; metrics.failed += 1;
    process.stderr.write(JSON.stringify({ event: 'worker_heartbeat_failed', code: 'WORKER_HEARTBEAT_FAILED' }) + '\n');
  }), 15_000);
  heartbeatTimer.unref();
  try {
    await processClaim(row);
    metrics.completed += 1; metrics.lastCompletedAt = new Date().toISOString();
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : 'VIDEO_VALIDATION_RETRYABLE';
    try {
      await signedRequest(error?.validationFailure ? 'reject' : 'retry', { media_id: row.media_id, claim_token: row.claim_token, code });
      if (error?.validationFailure) metrics.rejected += 1; else metrics.retries += 1;
    } catch { metrics.failed += 1; }
    process.stderr.write(JSON.stringify({ event: 'video_validation_failed', media_id: row.media_id, workspace_id: row.workspace_id, code, retryable: !error?.validationFailure }) + '\n');
  } finally {
    metrics.totalDurationMs += Date.now() - startedAt; metrics.timedTasks += 1;
    clearInterval(heartbeatTimer); metrics.processing = Math.max(0, metrics.processing - 1);
  }
}

process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
let heartbeatAt = 0;
async function emitHeartbeat(status = stopping ? 'STOPPING' : 'ONLINE', force = false) {
  const now = Date.now();
  if (!force && now - heartbeatAt < 30_000 && status === 'ONLINE') return true;
  const response = await signedRequest('heartbeat', {
    instance_id: instanceId, version: workerVersion, status,
    metrics: { processing: metrics.processing, errors: metrics.failed + metrics.retries + metrics.rejected,
      average_ms: metrics.timedTasks ? Math.round(metrics.totalDurationMs / metrics.timedTasks) : 0, last_completed_at: metrics.lastCompletedAt },
  });
  metrics.pending = response.pending ?? 0;
  metrics.lastHeartbeatSuccessAt = response.at ?? new Date().toISOString();
  workerStatus = 'ONLINE'; heartbeatAt = now;
  process.stdout.write(JSON.stringify({ event: 'worker_heartbeat', instance_id: instanceId, status, pending: metrics.pending, processing: metrics.processing, completed: metrics.completed }) + '\n');
  return true;
}

do {
  try { await emitHeartbeat(); }
  catch {
    metrics.failed += 1; workerStatus = 'DEGRADED';
    process.stderr.write(JSON.stringify({ event: 'worker_heartbeat_failed', code: 'WORKER_API_UNAVAILABLE' }) + '\n');
    if (once) throw new Error('WORKER_API_UNAVAILABLE');
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    continue;
  }
  let claims;
  try {
    const response = await signedRequest('claim');
    claims = response.claims ?? [];
  } catch {
    metrics.failed += 1; workerStatus = 'DEGRADED';
    process.stderr.write(JSON.stringify({ event: 'worker_poll_failed', code: 'VIDEO_VALIDATION_QUEUE_UNAVAILABLE' }) + '\n');
    if (once) throw new Error('VIDEO_VALIDATION_QUEUE_UNAVAILABLE');
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    continue;
  }
  if (!claims.length) {
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    continue;
  }
  await Promise.all(claims.map(processClaimSafe));
} while (!stopping);
try { await emitHeartbeat('STOPPING', true); } catch { /* shutdown remains best-effort */ }
health.close();
