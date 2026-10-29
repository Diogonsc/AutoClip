import { createClient } from 'jsr:@supabase/supabase-js@2';
import { env, envOptional } from '../_shared/env.ts';
import { corsHeaders, json, parseOrigins } from '../_shared/http.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };
const url = env('SUPABASE_URL');
const service = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map((b) => b.toString(16).padStart(2, '0')).join('');
const token = () => { const b = crypto.getRandomValues(new Uint8Array(32)); return Array.from(b).map((v) => v.toString(16).padStart(2, '0')).join(''); };

Deno.serve(async (req) => {
  const origins = parseOrigins(envOptional('WEB_URL'));
  const cors = corsHeaders(req.headers.get('origin'), origins);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'create') {
      const auth = req.headers.get('authorization') ?? '';
      const jwt = auth.replace(/^Bearer\s+/i, '');
      if (!jwt) return json({ error: 'unauthorized', message: 'Entre na sua conta para criar o link.' }, 401, cors);
      const { data: authData, error: authError } = await service.auth.getUser(jwt);
      const user = authData.user;
      if (authError || !user) return json({ error: 'unauthorized' }, 401, cors);
      const jobId = String(body.publication_job_id ?? '');
      const { data: job, error: jobError } = await service.from('publication_jobs').select('id,workspace_id,status,scheduled_at,caption,channel_id').eq('id', jobId).maybeSingle();
      if (jobError || !job) return json({ error: 'not_found', message: 'Publicação não encontrada.' }, 404, cors);
      const { data: membership } = await service.from('workspace_members').select('role').eq('workspace_id', job.workspace_id).eq('user_id', user.id).maybeSingle();
      if (!membership || !['OWNER','ADMIN','EDITOR'].includes(membership.role)) return json({ error: 'forbidden' }, 403, cors);
      const raw = token();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error: insertError } = await service.from('publication_approval_links').insert({ workspace_id: job.workspace_id, publication_job_id: job.id, token_hash: await sha256(raw), expires_at: expiresAt, created_by: user.id });
      if (insertError) throw insertError;
      const { error: updateError } = await service.from('publication_jobs').update({ approval_required: true, approval_status: 'PENDING', status: ['SCHEDULED','READY'].includes(job.status) ? 'BLOCKED_APPROVAL' : job.status }).eq('id', job.id);
      if (updateError) throw updateError;
      const webUrl = parseOrigins(envOptional('WEB_URL'))[0] ?? req.headers.get('origin') ?? '';
      return json({ url: `${webUrl.replace(/\/$/, '')}/aprovar/${raw}`, expires_at: expiresAt }, 200, cors);
    }

    const raw = String(body.token ?? '');
    if (!/^[a-f0-9]{64}$/.test(raw)) return json({ error: 'invalid_token', message: 'Link inválido.' }, 400, cors);
    const hash = await sha256(raw);
    const { data: link, error: linkError } = await service.from('publication_approval_links').select('id,workspace_id,publication_job_id,expires_at,decision,reviewer_name,reviewer_note,decided_at').eq('token_hash', hash).maybeSingle();
    if (linkError) throw linkError;
    if (!link) return json({ error: 'not_found', message: 'Link inválido ou removido.' }, 404, cors);
    if (new Date(link.expires_at).getTime() <= Date.now() && link.decision === 'PENDING') {
      await service.from('publication_approval_links').update({ decision: 'EXPIRED' }).eq('id', link.id);
      return json({ error: 'expired', message: 'Este link expirou. Solicite um novo ao responsável pela publicação.' }, 410, cors);
    }
    if (action === 'view') {
      const { data: job, error: jobError } = await service.from('publication_jobs').select('id,caption,scheduled_at,timezone,status,media_asset_id,channel_id').eq('id', link.publication_job_id).maybeSingle();
      if (jobError || !job) return json({ error: 'not_found' }, 404, cors);
      const { data: channel } = await service.from('channels').select('display_name').eq('id', job.channel_id).maybeSingle();
      const { data: media } = await service.from('media_assets').select('original_filename,storage_key,mime_type,duration_seconds,width,height').eq('id', job.media_asset_id).maybeSingle();
      let preview_url: string | null = null;
      if (media?.storage_key) { const { data } = await service.storage.from('media').createSignedUrl(media.storage_key, 300); preview_url = data?.signedUrl ?? null; }
      return json({ decision: link.decision, expires_at: link.expires_at, decided_at: link.decided_at, reviewer_name: link.reviewer_name, reviewer_note: link.reviewer_note, publication: { caption: job.caption, scheduled_at: job.scheduled_at, timezone: job.timezone, status: job.status, channel_name: channel?.display_name ?? 'Canal TikTok', media: media ? { filename: media.original_filename, mime_type: media.mime_type, duration_seconds: media.duration_seconds, width: media.width, height: media.height, preview_url } : null } }, 200, cors);
    }
    if (action === 'decide') {
      if (link.decision !== 'PENDING') return json({ error: 'already_decided', message: 'Este link já foi respondido.' }, 409, cors);
      const decision = body.decision === 'APPROVED' ? 'APPROVED' : body.decision === 'REJECTED' ? 'REJECTED' : '';
      const reviewer = String(body.reviewer_name ?? '').trim().slice(0, 120);
      const note = String(body.reviewer_note ?? '').trim().slice(0, 1000);
      if (!decision) return json({ error: 'invalid_decision', message: 'Escolha aprovar ou solicitar alterações.' }, 400, cors);
      const { data: changed, error: updateLinkError } = await service.from('publication_approval_links').update({ decision, reviewer_name: reviewer || null, reviewer_note: note || null, decided_at: new Date().toISOString() }).eq('id', link.id).eq('decision', 'PENDING').select('id').maybeSingle();
      if (updateLinkError) throw updateLinkError;
      if (!changed) return json({ error: 'already_decided', message: 'Este link já foi respondido.' }, 409, cors);
      const { data: job } = await service.from('publication_jobs').select('id,status,scheduled_at').eq('id', link.publication_job_id).maybeSingle();
      if (job) {
        const nextStatus = decision === 'REJECTED' ? 'DRAFT' : job.scheduled_at && new Date(job.scheduled_at).getTime() > Date.now() ? 'SCHEDULED' : 'DRAFT';
        const { error: updateJobError } = await service.from('publication_jobs').update({ approval_status: decision, approved_at: decision === 'APPROVED' ? new Date().toISOString() : null, approval_note: note || null, status: nextStatus }).eq('id', job.id);
        if (updateJobError) throw updateJobError;
      }
      return json({ ok: true, decision, message: decision === 'APPROVED' ? 'Aprovação registrada.' : 'Solicitação de alterações registrada.' }, 200, cors);
    }
    return json({ error: 'invalid_action', message: 'Ação não reconhecida.' }, 400, cors);
  } catch (error) {
    console.error('client-approval error', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'internal_error', message: 'Não foi possível processar a aprovação. Tente novamente.' }, 500, cors);
  }
});
