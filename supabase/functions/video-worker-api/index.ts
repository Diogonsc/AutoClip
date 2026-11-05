import { createClient } from 'jsr:@supabase/supabase-js@2';
import { copyToArrayBuffer } from '../_shared/bytes.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const workerSecret = Deno.env.get('VIDEO_WORKER_API_SECRET') ?? '';
const attestationSecret = Deno.env.get('VIDEO_VALIDATION_ATTESTATION_KEY') ?? '';
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const encoder = new TextEncoder();
const maxClockSkewSeconds = 60;

async function digestHex(value: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', copyToArrayBuffer(value)))].map((n) => n.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function equalHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b) || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

function canonicalProof(proof: Record<string, unknown>): string {
  return [
    proof.media_id, proof.claim_token, proof.sha256, proof.size, proof.mime, proof.codec,
    proof.audioCodec ?? '', proof.duration ?? '', proof.width, proof.height, proof.frameRate ?? '', proof.validatorVersion,
  ].join('\n');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (workerSecret.length < 32 || attestationSecret.length < 32) return json({ error: 'worker_api_not_configured' }, 503);

  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.length > 32_768) return json({ error: 'request_too_large' }, 413);
  const timestampText = req.headers.get('x-worker-timestamp') ?? '';
  const nonceText = req.headers.get('x-worker-nonce') ?? '';
  const signature = req.headers.get('x-worker-signature') ?? '';
  const timestamp = Number(timestampText);
  const nonce = nonceText.toLowerCase();
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > maxClockSkewSeconds || !/^[0-9a-f-]{36}$/.test(nonce)) {
    return json({ error: 'worker_request_expired_or_invalid' }, 401);
  }
  const route = new URL(req.url).pathname.split('/').filter(Boolean).at(-1);
  if (route !== 'video-worker-api') return json({ error: 'worker_route_invalid' }, 404);
  const path = '/video-worker-api';
  const expected = await hmacHex(workerSecret, `${req.method}\n${path}\n${timestampText}\n${nonce}\n${await digestHex(raw)}`);
  if (!equalHex(signature, expected)) return json({ error: 'worker_authentication_failed' }, 401);
  const { data: nonceAccepted, error: nonceError } = await service.rpc('consume_video_worker_api_nonce', {
    p_nonce: nonce, p_expires_at: new Date(Date.now() + 120_000).toISOString(),
  });
  if (nonceError || nonceAccepted !== true) return json({ error: 'worker_request_replayed' }, 401);

  let body: Record<string, unknown>;
  try { body = JSON.parse(new TextDecoder().decode(raw)); }
  catch { return json({ error: 'invalid_json' }, 400); }
  const action = body.action;

  if (action === 'heartbeat') {
    const { count, error: countError } = await service.from('media_assets').select('id', { count: 'exact', head: true })
      .eq('status', 'UPLOADING').in('validation_status', ['PENDING', 'VALIDATING']);
    if (countError) return json({ error: 'queue_status_unavailable' }, 503);
    const metrics = body.metrics as Record<string, unknown>;
    const { error } = await service.rpc('media_validation_worker_heartbeat', {
      p_instance_id: body.instance_id, p_version: body.version, p_status: body.status,
      p_pending_count: count ?? 0, p_processing_count: metrics?.processing ?? 0,
      p_error_count: metrics?.errors ?? 0, p_average_validation_ms: metrics?.average_ms ?? 0,
      p_last_completed_at: metrics?.last_completed_at ?? null,
    });
    return error ? json({ error: 'heartbeat_rejected' }, 503) : json({ pending: count ?? 0, at: new Date().toISOString() });
  }

  if (action === 'claim') {
    const { data, error } = await service.rpc('claim_pending_video_validation', { p_limit: 1, p_lease_seconds: 240 });
    if (error) return json({ error: 'claim_failed' }, 503);
    const claims = [];
    for (const row of data ?? []) {
      const key = `${row.workspace_id}/${row.media_id}/upload`;
      const { data: signed, error: signedError } = await service.storage.from(row.storage_source).createSignedUrl(key, 60);
      if (signedError || !signed?.signedUrl) {
        await service.rpc('release_media_validation_claim', { p_media_id: row.media_id, p_claim_token: row.claim_token, p_error_code: 'SIGNED_DOWNLOAD_FAILED' });
        continue;
      }
      claims.push({ ...row, download_url: signed.signedUrl });
    }
    return json({ claims });
  }

  if (action === 'complete') {
    const proof = body.proof as Record<string, unknown>;
    if (!proof || typeof body.media_id !== 'string' || typeof body.claim_token !== 'string') return json({ error: 'proof_missing' }, 400);
    const { data: media, error: mediaError } = await service.from('media_assets')
      .select('id,workspace_id,storage_key,mime_type,file_size_bytes,status,validation_status,validation_claim_token,validation_locked_until,storage_deleted_at,checksum_sha256')
      .eq('id', body.media_id).maybeSingle();
    if (mediaError || !media) return json({ error: 'task_not_found' }, 404);
    if (proof.media_id !== media.id || proof.claim_token !== body.claim_token || proof.mime !== media.mime_type
      || !Number.isSafeInteger(proof.size) || proof.size !== Number(media.file_size_bytes)
      || typeof proof.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(proof.sha256)
      || typeof proof.attestation !== 'string') return json({ error: 'attestation_claim_mismatch' }, 422);
    const expectedAttestation = await hmacHex(attestationSecret, canonicalProof(proof));
    if (!equalHex(proof.attestation, expectedAttestation)) return json({ error: 'validator_attestation_invalid' }, 422);
    if (media.status === 'READY' && media.validation_status === 'VALIDATED' && media.checksum_sha256 === proof.sha256) {
      return json({ status: 'READY', media_id: media.id, sha256: proof.sha256, idempotent: true });
    }
    if (!['UPLOADING', 'READY'].includes(media.status)) return json({ error: 'task_state_invalid' }, 409);
    if (media.validation_status !== 'VALIDATING' || media.validation_claim_token !== body.claim_token
      || !media.validation_locked_until || Date.parse(media.validation_locked_until) <= Date.now() || media.storage_deleted_at) {
      return json({ error: 'claim_stale' }, 409);
    }

    const bucket = media.status === 'READY' ? 'media' : 'media-quarantine';
    const objectKey = media.status === 'READY' ? media.storage_key : `${media.workspace_id}/${media.id}/upload`;
    const { data: source, error: downloadError } = await service.storage.from(bucket).download(objectKey);
    if (downloadError || !source) return json({ error: 'validation_source_missing' }, 409);
    const bytes = new Uint8Array(await source.arrayBuffer());
    if (source.size !== proof.size || bytes.byteLength !== proof.size || await digestHex(bytes) !== proof.sha256) {
      return json({ error: 'validated_object_changed' }, 409);
    }

    if (media.status !== 'READY') {
      const { error: promotionError } = await service.storage.from('media').upload(media.storage_key, bytes, {
        contentType: media.mime_type, upsert: false, cacheControl: 'private, max-age=0',
      });
      if (promotionError) {
        const { data: existing } = await service.storage.from('media').download(media.storage_key);
        if (!existing || existing.size !== proof.size) return json({ error: 'promotion_failed_or_mismatched' }, 409);
        const existingBytes = new Uint8Array(await existing.arrayBuffer());
        if (existingBytes.byteLength !== proof.size || await digestHex(existingBytes) !== proof.sha256) {
          return json({ error: 'promotion_failed_or_mismatched' }, 409);
        }
      }
    }

    const rpc = media.status === 'READY' ? 'complete_legacy_media_revalidation' : 'complete_video_media_validation';
    const args = {
      p_media_id: media.id, p_claim_token: body.claim_token, p_size: proof.size, p_sha256: proof.sha256,
      p_mime: proof.mime, p_codec: proof.codec, p_duration: proof.duration,
      p_width: proof.width, p_height: proof.height, p_validator_version: proof.validatorVersion,
    };
    const { error: completeError } = await service.rpc(rpc, args);
    if (completeError) return json({ error: 'validation_commit_failed' }, completeError.code === '40001' ? 409 : 503);
    if (media.status !== 'READY') await service.storage.from('media-quarantine').remove([`${media.workspace_id}/${media.id}/upload`]);
    return json({ status: 'READY', media_id: media.id, sha256: proof.sha256 });
  }

  if (action === 'reject' || action === 'retry') {
    if (typeof body.media_id !== 'string' || typeof body.claim_token !== 'string') return json({ error: 'claim_missing' }, 400);
    const code = typeof body.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(body.code) ? body.code : 'VIDEO_VALIDATION_FAILED';
    const rpc = action === 'reject' ? 'reject_video_media_validation' : 'release_media_validation_claim';
    const args = action === 'reject'
      ? { p_media_id: body.media_id, p_claim_token: body.claim_token, p_code: code }
      : { p_media_id: body.media_id, p_claim_token: body.claim_token, p_error_code: code };
    const { error } = await service.rpc(rpc, args);
    return error ? json({ error: error.code === '40001' ? 'claim_stale' : 'task_update_failed' }, error.code === '40001' ? 409 : 503) : json({ status: action === 'reject' ? 'REJECTED' : 'RETRY_SCHEDULED' });
  }
  return json({ error: 'action_not_allowed' }, 400);
});
