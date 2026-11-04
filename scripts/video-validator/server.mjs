import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const tokenFile = process.env.VIDEO_VALIDATOR_TOKEN_FILE;
const token = process.env.VIDEO_VALIDATOR_TOKEN ?? (tokenFile ? (await readFile(tokenFile, 'utf8')).trim() : null);
const attestationFile = process.env.VIDEO_VALIDATION_ATTESTATION_KEY_FILE;
const attestationKey = attestationFile ? (await readFile(attestationFile, 'utf8')).trim() : null;
const port = Number(process.env.VIDEO_VALIDATOR_PORT ?? '9782');
const maxBytes = 50 * 1024 * 1024;
if (!token || Buffer.byteLength(token) < 32) throw new Error('VIDEO_VALIDATOR_TOKEN must contain at least 32 bytes');
if (!attestationKey || Buffer.byteLength(attestationKey) < 32) throw new Error('VIDEO_VALIDATION_ATTESTATION_KEY must contain at least 32 bytes');

function canonicalProof(proof) {
  return [proof.media_id, proof.claim_token, proof.sha256, proof.size, proof.mime, proof.codec,
    proof.audioCodec ?? '', proof.duration ?? '', proof.width, proof.height, proof.frameRate ?? '', proof.validatorVersion].join('\n');
}

function safeEqual(a, b) {
  const left = Buffer.from(a ?? ''); const right = Buffer.from(b ?? '');
  return left.length === right.length && timingSafeEqual(left, right);
}

function respond(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function validate(file, mime) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['/opt/validator/validate.mjs', file, mime], {
      shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp' },
    });
    const stdout = []; const stderr = []; let outSize = 0; let errSize = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), 125_000);
    child.stdout.on('data', (chunk) => { outSize += chunk.length; if (outSize > 64 * 1024) child.kill('SIGKILL'); else stdout.push(chunk); });
    child.stderr.on('data', (chunk) => { errSize += chunk.length; if (errSize <= 4096) stderr.push(chunk.subarray(0, 4096 - (errSize - chunk.length))); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(Object.assign(new Error(Buffer.concat(stderr).toString().trim().split(/\s+/).at(-1) || 'VIDEO_VALIDATION_FAILED'), { invalid: true }));
      try { resolve(JSON.parse(Buffer.concat(stdout).toString())); }
      catch { reject(new Error('VIDEO_VALIDATOR_RESPONSE_INVALID')); }
    });
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/live') return respond(res, 200, { status: 'live' });
  if (req.method !== 'POST' || req.url !== '/validate') return respond(res, 404, { error: 'not_found' });
  if (!safeEqual(req.headers['x-validator-token'], token)) return respond(res, 401, { error: 'unauthorized' });
  const mime = req.headers['content-type'];
  const mediaId = req.headers['x-media-id'];
  const claimToken = req.headers['x-claim-token'];
  if (!/^[0-9a-f-]{36}$/i.test(mediaId ?? '') || !/^[0-9a-f-]{36}$/i.test(claimToken ?? '')) {
    req.resume(); return respond(res, 400, { error: 'validation_claim_required' });
  }
  const length = Number(req.headers['content-length']);
  if (!['video/mp4', 'image/jpeg', 'image/png', 'image/webp'].includes(mime) || !Number.isSafeInteger(length) || length <= 0 || length > maxBytes) {
    req.resume(); return respond(res, 413, { error: 'media_size_or_type_invalid' });
  }
  const dir = await mkdtemp(join(tmpdir(), 'autoclip-validator-'));
  const file = join(dir, randomUUID());
  try {
    let received = 0;
    req.on('data', (chunk) => { received += chunk.length; if (received > maxBytes) req.destroy(new Error('request_too_large')); });
    await pipeline(req, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
    if (received !== length) return respond(res, 400, { error: 'content_length_mismatch' });
    const result = await validate(file, mime);
    const proof = {
      ...result,
      media_id: mediaId,
      claim_token: claimToken,
      size: received,
      sha256: createHash('sha256').update(await readFile(file)).digest('hex'),
    };
    proof.attestation = createHmac('sha256', attestationKey).update(canonicalProof(proof)).digest('hex');
    return respond(res, 200, proof);
  } catch (error) {
    const code = error?.message && /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : 'VIDEO_VALIDATION_FAILED';
    return respond(res, error?.invalid ? 422 : 503, { error: code });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(port, '0.0.0.0', () => process.stdout.write(JSON.stringify({ event: 'validator_ready', port }) + '\n'));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
