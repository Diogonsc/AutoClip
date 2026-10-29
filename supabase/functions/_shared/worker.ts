// Núcleo do worker de publicação. Sem dependência de Deno/Supabase: tudo que faz I/O entra
// por WorkerDeps, o que permite testar a máquina de estados com fakes.
//
// Regra de ouro (spec 2.7 / 7): nenhuma falha de rede gera um segundo envio sem antes
// reconciliar o resultado do primeiro.
//   - sem resposta do init                  => UNKNOWN (não reenvia)
//   - publish_id gravado e upload interrompido => confere o status no TikTok (poll)
//   - só reenvia depois que o TikTok confirma FAILED para aquele publish_id
import { isAmbiguous, planChunks, TikTokError } from './tiktok.ts';
import type { PostInfo, TikTokApi } from './tiktok.ts';
import {
  addMinutes,
  addSeconds,
  ALLOWED_MIME,
  backoffMinutes,
  blockedStatusForChannel,
  failReasonMessage,
  mapFailReason,
  MAX_REMOTE_WAIT_MS,
  REQUIRED_SCOPE,
  validateDirect,
} from './logic.ts';
import type { ChannelStatus, Db, FinishArgs, Job, JobStatus } from './types.ts';

export interface WorkerDeps {
  db: Db;
  storage: { download(key: string): Promise<Uint8Array>; signedUrl(key: string, expiresInSeconds: number): Promise<string>; verifiedHost?: string | null };
  tiktok: Pick<TikTokApi, 'queryCreatorInfo' | 'initVideoPost' | 'initPhotoPost' | 'uploadVideo' | 'fetchPublishStatus'>;
  ensureToken(channelId: string, opts?: { force?: boolean }): Promise<string>;
  now(): Date;
  sleep(ms: number): Promise<void>;
  log(msg: string, data?: unknown): void;
}

interface Outcome {
  status: JobStatus;
  code: string;
  message: string;
  /** Não consome tentativa: reagenda em `delayMinutes`. */
  refund?: boolean;
  delayMinutes?: number;
  /** Erro transitório: usa o backoff e o limite de tentativas. */
  retryable?: boolean;
  channelStatus?: ChannelStatus;
}

/** Erro conhecido do TikTok (sem resultado ambíguo) -> decisão. */
function outcomeForError(e: TikTokError): Outcome {
  switch (e.kind) {
    case 'AUTH':
      return {
        status: 'BLOCKED_REAUTH',
        code: e.code,
        message: 'Autorização do TikTok inválida: reconecte o canal.',
        channelStatus: 'REAUTH_REQUIRED',
      };
    case 'SCOPE':
      return {
        status: 'BLOCKED_PERMISSION',
        code: 'SCOPE_NOT_AUTHORIZED',
        message: 'O canal não concedeu a permissão necessária. Reconecte autorizando todas as permissões.',
        channelStatus: 'PERMISSION_BLOCKED',
      };
    case 'APPROVAL':
      return {
        status: 'BLOCKED_APPROVAL',
        code: e.code,
        message:
          'O app TikTok ainda não foi auditado: só é possível publicar em modo privado (SELF_ONLY) ou usar o modo caixa de entrada.',
      };
    case 'PRIVACY':
      return {
        status: 'BLOCKED_PERMISSION',
        code: e.code,
        message: 'A privacidade escolhida não está entre as opções atuais do criador.',
      };
    case 'BANNED':
      return { status: 'BLOCKED_PERMISSION', code: e.code, message: 'A conta está impedida de publicar no TikTok.' };
    case 'QUOTA':
      return { status: 'FAILED', code: e.code, message: 'Limite diário do TikTok atingido. Reagende para outro dia.' };
    case 'APP_QUOTA':
      return {
        status: 'RETRY_WAIT',
        code: e.code,
        message: 'Cota diária do app esgotada; nova tentativa mais tarde.',
        refund: true,
        delayMinutes: 6 * 60,
      };
    case 'RATE_LIMIT':
      return {
        status: 'RETRY_WAIT',
        code: e.code,
        message: 'Limite de requisições do TikTok; nova tentativa em instantes.',
        refund: true,
        delayMinutes: 2,
      };
    case 'SERVER':
    case 'NETWORK':
    case 'MALFORMED':
      return { status: 'FAILED', code: e.code, message: e.message, retryable: true };
    default:
      return { status: 'FAILED', code: e.code, message: e.message };
  }
}

async function setChannel(d: WorkerDeps, channelId: string, o: Outcome): Promise<void> {
  if (!o.channelStatus) return;
  await d.db.setChannelStatus(channelId, o.channelStatus, o.code, o.message);
}

async function retryOrFail(job: Job, d: WorkerDeps, code: string, message: string): Promise<void> {
  if (job.attempt_count < job.max_attempts) {
    await d.db.finishJob({
      jobId: job.id,
      status: 'RETRY_WAIT',
      errorCode: code,
      errorMessage: message,
      nextAttemptAt: addMinutes(d.now(), backoffMinutes(job.attempt_count)),
      result: 'RETRY_SCHEDULED',
      event: { type: 'RETRY_SCHEDULED', payload: { code, attempt: job.attempt_count } },
    });
    return;
  }
  await d.db.finishJob({
    jobId: job.id,
    status: 'FAILED',
    errorCode: code,
    errorMessage: `${message} (tentativas esgotadas)`,
    result: 'FAILED',
    event: { type: 'MAX_ATTEMPTS', payload: { code } },
  });
}

async function applyOutcome(job: Job, d: WorkerDeps, o: Outcome): Promise<void> {
  await setChannel(d, job.channel_id, o);
  if (o.refund) {
    await d.db.finishJob({
      jobId: job.id,
      status: 'RETRY_WAIT',
      errorCode: o.code,
      errorMessage: o.message,
      nextAttemptAt: addMinutes(d.now(), o.delayMinutes ?? 2),
      result: o.code,
      refundAttempt: true,
      event: { type: 'DEFERRED', payload: { code: o.code } },
    });
    return;
  }
  if (o.retryable) {
    await retryOrFail(job, d, o.code, o.message);
    return;
  }
  await d.db.finishJob({
    jobId: job.id,
    status: o.status,
    errorCode: o.code,
    errorMessage: o.message,
    result: o.status.startsWith('BLOCKED') ? 'BLOCKED' : 'FAILED',
    event: { type: o.status.startsWith('BLOCKED') ? 'BLOCKED' : 'FAILED', payload: { code: o.code } },
  });
}

/** Executa `fn` com o token; se o TikTok disser que o token é inválido, renova uma vez e repete. */
async function withToken<T>(
  d: WorkerDeps,
  channelId: string,
  tk: { token: string },
  fn: (token: string) => Promise<T>,
): Promise<T> {
  try {
    return await fn(tk.token);
  } catch (e) {
    if (e instanceof TikTokError && e.kind === 'AUTH') {
      tk.token = await d.ensureToken(channelId, { force: true });
      return await fn(tk.token);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------
export async function processPublish(job: Job, d: WorkerDeps): Promise<void> {
  const fin = (a: Omit<FinishArgs, 'jobId'>) => d.db.finishJob({ jobId: job.id, ...a });
  let initStarted = false;
  let remoteId: string | null = null;
  // true só depois que o publish_id foi gravado no banco. Antes disso nenhum byte foi enviado
  // (o upload só começa depois), então reagendar é seguro; depois, só a conferência de status.
  let idSaved = false;

  try {
    // Defesa: job reivindicado já com publish_id (ex.: reagendado após bloqueio).
    // Nunca inicia outro envio: primeiro reconcilia o anterior.
    if (job.remote_publish_id) {
      await d.db.addEvent(job.id, 'RECONCILE_ON_CLAIM', { publish_id: job.remote_publish_id });
      await pollJob(job, d);
      return;
    }

    const settings = await d.db.getSettings(job.workspace_id);
    if (!settings || !settings.auto_publish_enabled) {
      await fin({
        status: 'RETRY_WAIT',
        errorCode: 'AUTO_PUBLISH_OFF',
        errorMessage: 'Publicação automática desligada.',
        nextAttemptAt: addMinutes(d.now(), 1),
        result: 'RELEASED',
        refundAttempt: true,
      });
      return;
    }
    const mode = settings.publish_mode;

    const channel = await d.db.getChannel(job.channel_id);
    if (!channel) {
      await fin({ status: 'FAILED', errorCode: 'CHANNEL_NOT_FOUND', errorMessage: 'Canal não encontrado.', result: 'FAILED' });
      return;
    }

    const blocked = blockedStatusForChannel(channel.connection_status);
    if (blocked) {
      await fin({
        status: blocked,
        errorCode: `CHANNEL_${channel.connection_status}`,
        errorMessage:
          blocked === 'BLOCKED_REAUTH'
            ? 'O canal não está conectado ao TikTok: conecte ou reconecte o canal.'
            : 'O canal está com permissão bloqueada ou em erro.',
        result: 'BLOCKED',
        event: { type: 'BLOCKED', payload: { channel_status: channel.connection_status } },
      });
      return;
    }

    const need = REQUIRED_SCOPE[mode];
    if (!channel.granted_scopes.includes(need)) {
      await fin({
        status: 'BLOCKED_PERMISSION',
        errorCode: 'SCOPE_MISSING',
        errorMessage: `Permissão "${need}" não concedida. Reconecte o canal autorizando-a.`,
        result: 'BLOCKED',
        event: { type: 'BLOCKED', payload: { missing_scope: need } },
      });
      return;
    }

    const postType = job.post_type ?? 'VIDEO';
    const mediaIds = Array.isArray(job.media_asset_ids) && job.media_asset_ids.length ? job.media_asset_ids : [job.media_asset_id];
    const assets = await d.db.getMediaAssets(mediaIds);
    const orderedMedia = mediaIds.map((id) => assets.find((asset) => asset.id === id));
    if (orderedMedia.some((m) => !m || m.status !== 'READY' || m.workspace_id !== job.workspace_id)) {
      await fin({ status: 'FAILED', errorCode: 'MEDIA_UNAVAILABLE', errorMessage: 'Uma ou mais mídias estão indisponíveis.', result: 'FAILED' });
      return;
    }
    const mediaList = orderedMedia as NonNullable<typeof orderedMedia[number]>[];
    const media = mediaList[0];
    if (postType === 'PHOTO') {
      if (mediaList.length > 35 || mediaList.some((m) => !['image/jpeg', 'image/png', 'image/webp'].includes(m.mime_type) || m.file_size_bytes > 20 * 1024 * 1024 || (m.width != null && (m.width < 360 || m.width > 4096)) || (m.height != null && (m.height < 360 || m.height > 4096)))) {
        await fin({ status: 'FAILED', errorCode: 'INVALID_PHOTO_SET', errorMessage: 'O carrossel precisa ter de 1 a 35 imagens compatíveis.', result: 'FAILED' });
        return;
      }
      if (mode !== 'DIRECT') {
        await fin({ status: 'FAILED', errorCode: 'PHOTO_REQUIRES_DIRECT_POST', errorMessage: 'Fotos e carrosséis exigem o modo Publicação direta; o modo caixa de entrada só está disponível para vídeos.', result: 'FAILED' });
        return;
      }
    } else if (mediaList.length !== 1 || !ALLOWED_MIME.includes(media.mime_type)) {
      await fin({ status: 'FAILED', errorCode: 'UNSUPPORTED_MIME', errorMessage: `Formato ${media.mime_type} não suportado para vídeo.`, result: 'FAILED' });
      return;
    }

    const tk = { token: await d.ensureToken(channel.id) };

    // Direct Post: valida contra as opções ATUAIS do criador (consulta obrigatória por postagem).
    let postInfo: PostInfo | undefined;
    if (mode === 'DIRECT') {
      const info = await withToken(d, channel.id, tk, (t) => d.tiktok.queryCreatorInfo(t));
      await d.db.saveCreatorInfo(channel.id, info);
      const v = validateDirect(job, media, info);
      if (!v.ok) {
        await fin({
          status: v.status,
          errorCode: v.code,
          errorMessage: v.message,
          result: v.status.startsWith('BLOCKED') ? 'BLOCKED' : 'FAILED',
          event: { type: v.status.startsWith('BLOCKED') ? 'BLOCKED' : 'FAILED', payload: { code: v.code } },
        });
        return;
      }
      postInfo = v.postInfo;
    }

    if (postType === 'PHOTO') {
      // O TikTok busca as imagens por HTTPS. As URLs assinadas são criadas apenas no servidor.
      if (!d.storage.verifiedHost) {
        await fin({ status: 'FAILED', errorCode: 'PHOTO_MEDIA_DOMAIN_NOT_CONFIGURED', errorMessage: 'Configure um domínio HTTPS próprio e verificado no portal de desenvolvedores do TikTok para hospedar as imagens; a publicação foi bloqueada antes de enviar qualquer coisa.', result: 'FAILED' });
        return;
      }
      const imageUrls: string[] = [];
      for (const asset of mediaList) imageUrls.push(await d.storage.signedUrl(asset.storage_key, 3600));
      if (imageUrls.some((url) => new URL(url).hostname.toLowerCase() !== d.storage.verifiedHost!.toLowerCase())) {
        await fin({ status: 'FAILED', errorCode: 'PHOTO_MEDIA_DOMAIN_MISMATCH', errorMessage: 'O domínio das URLs das imagens não corresponde ao domínio verificado no TikTok. Configure a URL do Supabase/Storage com seu domínio próprio verificado.', result: 'FAILED' });
        return;
      }
      await d.db.addEvent(job.id, 'PHOTO_INIT_REQUEST', { mode, image_count: imageUrls.length });
      initStarted = true;
      const init = await withToken(d, channel.id, tk, (t) => d.tiktok.initPhotoPost(t, { imageUrls, postInfo: postInfo!, coverIndex: 0 }));
      remoteId = init.publishId;
      let saved = false;
      for (let i = 1; i <= 3 && !saved; i++) {
        try { await d.db.recordRemoteId(job.id, init.publishId); saved = true; }
        catch (e) { d.log('record_remote_id.failed', { attempt: i, error: e instanceof Error ? e.message : String(e) }); if (i < 3) await d.sleep(300 * i); }
      }
      if (!saved) throw new Error('Não foi possível gravar o publish_id da publicação de fotos.');
      idSaved = true;
      await fin({ status: 'PROCESSING', errorCode: null, errorMessage: null, nextAttemptAt: addSeconds(d.now(), 15), result: 'PHOTO_SUBMITTED', remoteStatus: 'PROCESSING', event: { type: 'PHOTO_SUBMITTED', payload: { publish_id: init.publishId, image_count: imageUrls.length, mode } } });
      return;
    }

    // Baixa o arquivo ANTES do init: falhas aqui não criam nada no TikTok.
    const bytes = await d.storage.download(media.storage_key);
    if (bytes.length !== media.file_size_bytes) {
      await fin({ status: 'FAILED', errorCode: 'MEDIA_SIZE_MISMATCH', errorMessage: 'O arquivo no armazenamento não confere com o registrado.', result: 'FAILED' });
      return;
    }
    const plan = planChunks(bytes.length);
    await d.db.addEvent(job.id, 'INIT_REQUEST', { mode });
    initStarted = true;
    const init = await withToken(d, channel.id, tk, (t) => d.tiktok.initVideoPost(t, { mode, postInfo, plan }));
    remoteId = init.publishId;
    let saved = false;
    for (let i = 1; i <= 3 && !saved; i++) {
      try { await d.db.recordRemoteId(job.id, init.publishId); saved = true; }
      catch (e) { d.log('record_remote_id.failed', { attempt: i, error: e instanceof Error ? e.message : String(e) }); if (i < 3) await d.sleep(300 * i); }
    }
    if (!saved) throw new Error('Não foi possível gravar o publish_id.');
    idSaved = true;
    try { await d.tiktok.uploadVideo(init.uploadUrl, bytes, media.mime_type, plan); }
    catch (e) {
      if (e instanceof TikTokError && e.kind === 'INVALID') {
        await fin({ status: 'FAILED', errorCode: e.code, errorMessage: 'O TikTok recusou o upload do vídeo.', result: 'FAILED', event: { type: 'UPLOAD_REJECTED', payload: { code: e.code, publish_id: init.publishId } } });
        return;
      }
      d.log('upload.interrupted', { job: job.id, error: e instanceof Error ? e.message : String(e) });
      await fin({ status: 'PROCESSING', errorCode: 'UPLOAD_INTERRUPTED', errorMessage: 'Upload interrompido; aguardando conferência do TikTok.', nextAttemptAt: addSeconds(d.now(), 60), result: 'UPLOAD_INTERRUPTED', event: { type: 'UPLOAD_INTERRUPTED', payload: { publish_id: init.publishId } } });
      return;
    }
    await fin({ status: 'PROCESSING', errorCode: null, errorMessage: null, nextAttemptAt: addSeconds(d.now(), 15), result: 'UPLOADED', remoteStatus: 'UPLOADED', event: { type: 'UPLOAD_OK', payload: { publish_id: init.publishId, mode } } });
  } catch (e) {
    try {
      if (e instanceof TikTokError) {
        if (!initStarted) {
          await applyOutcome(job, d, outcomeForError(e)); // nada foi criado: seguro decidir
        } else if (!remoteId) {
          if (isAmbiguous(e.kind)) {
            await fin({
              status: 'UNKNOWN',
              errorCode: 'INIT_AMBIGUOUS',
              errorMessage:
                'Não foi possível confirmar se o TikTok recebeu o envio. Confira no TikTok antes de reenviar.',
              result: 'UNKNOWN',
              event: { type: 'UNKNOWN', payload: { reason: e.code } },
            });
          } else {
            await applyOutcome(job, d, outcomeForError(e)); // erro explícito: o init não criou envio
          }
        } else if (!idSaved) {
          await retryOrFail(job, d, 'REMOTE_ID_NOT_SAVED', e.message); // nada foi enviado ainda
        } else {
          await fin({
            status: 'PROCESSING',
            errorCode: 'POST_INIT_ERROR',
            errorMessage: e.message,
            nextAttemptAt: addSeconds(d.now(), 60),
            result: 'ERROR',
          });
        }
        return;
      }

      // Erro inesperado (bug, banco indisponível...).
      d.log('process_publish.unexpected', { job: job.id, error: e instanceof Error ? e.message : String(e) });
      const msg = e instanceof Error ? e.message : 'Erro inesperado.';
      if (remoteId && !idSaved) {
        // O publish_id não foi gravado e o upload não começou: sem risco de duplicar.
        await retryOrFail(job, d, 'REMOTE_ID_NOT_SAVED', msg);
      } else if (remoteId) {
        await fin({
          status: 'PROCESSING',
          errorCode: 'INTERNAL_ERROR',
          errorMessage: msg,
          nextAttemptAt: addSeconds(d.now(), 60),
          result: 'ERROR',
        });
      } else if (initStarted) {
        await fin({
          status: 'UNKNOWN',
          errorCode: 'UNEXPECTED_AFTER_INIT',
          errorMessage: 'Erro inesperado após iniciar o envio. Confira no TikTok antes de reenviar.',
          result: 'UNKNOWN',
          event: { type: 'UNKNOWN', payload: { reason: 'unexpected_after_init' } },
        });
      } else {
        await retryOrFail(job, d, 'INTERNAL_ERROR', msg);
      }
    } catch (inner) {
      // Se nem o registro do erro funcionou, o job fica travado e a recuperação do banco assume.
      d.log('process_publish.finish_failed', { job: job.id, error: inner instanceof Error ? inner.message : String(inner) });
    }
  }
}

// ---------------------------------------------------------------------
// Conferência de status (job já enviado ao TikTok)
// ---------------------------------------------------------------------
export async function pollJob(job: Job, d: WorkerDeps): Promise<void> {
  const fin = (a: Omit<FinishArgs, 'jobId'>) => d.db.finishJob({ jobId: job.id, ...a });
  const remoteId = job.remote_publish_id;
  if (!remoteId) {
    await fin({ status: 'UNKNOWN', errorCode: 'NO_PUBLISH_ID', errorMessage: 'Job sem publish_id para conferir.', result: 'UNKNOWN' });
    return;
  }

  let ageMs = 0;
  const waitOrUnknown = async (code: string, message: string) => {
    if (ageMs > MAX_REMOTE_WAIT_MS) {
      await fin({
        status: 'UNKNOWN',
        errorCode: 'REMOTE_STATUS_TIMEOUT',
        errorMessage: 'O TikTok não concluiu o processamento a tempo. Confira no TikTok antes de reenviar.',
        result: 'UNKNOWN',
        event: { type: 'UNKNOWN', payload: { reason: code, publish_id: remoteId } },
      });
      return;
    }
    await fin({
      status: 'PROCESSING',
      errorCode: code,
      errorMessage: message,
      nextAttemptAt: addMinutes(d.now(), code === 'PENDING' ? 1 : 2),
      result: 'PENDING',
    });
  };

  try {
    const startedAt = await d.db.getLatestAttemptStart(job.id);
    ageMs = startedAt ? d.now().getTime() - startedAt.getTime() : 0;

    const channel = await d.db.getChannel(job.channel_id);
    if (!channel) {
      await fin({ status: 'UNKNOWN', errorCode: 'CHANNEL_NOT_FOUND', errorMessage: 'Canal não encontrado.', result: 'UNKNOWN' });
      return;
    }

    const tk = { token: await d.ensureToken(channel.id) };
    const st = await withToken(d, channel.id, tk, (t) => d.tiktok.fetchPublishStatus(t, remoteId));

    switch (st.status) {
      case 'PUBLISH_COMPLETE':
        await fin({
          status: 'PUBLISHED',
          errorCode: null,
          errorMessage: null,
          result: 'PUBLISHED',
          remoteStatus: st.status,
          event: { type: 'PUBLISH_COMPLETE', payload: { publish_id: remoteId, public_post_ids: st.publicPostIds } },
        });
        return;

      case 'SEND_TO_USER_INBOX':
        await fin({
          status: 'SENT_TO_INBOX',
          errorCode: null,
          errorMessage: null,
          result: 'SENT_TO_INBOX',
          remoteStatus: st.status,
          event: { type: 'SENT_TO_INBOX', payload: { publish_id: remoteId } },
        });
        return;

      case 'FAILED': {
        const map = mapFailReason(st.failReason);
        const message = failReasonMessage(st.failReason);
        if (map.channelStatus) {
          await d.db.setChannelStatus(channel.id, map.channelStatus, st.failReason, message);
        }
        if (map.retryable && job.attempt_count < job.max_attempts) {
          // O TikTok confirmou que ESTE envio falhou: agora é seguro tentar de novo.
          await fin({
            status: 'RETRY_WAIT',
            errorCode: st.failReason ?? 'REMOTE_FAILED',
            errorMessage: message,
            clearRemote: true,
            nextAttemptAt: addMinutes(d.now(), backoffMinutes(job.attempt_count)),
            result: 'REMOTE_FAILED',
            remoteStatus: st.status,
            event: { type: 'REMOTE_FAILED_RETRY', payload: { publish_id: remoteId, fail_reason: st.failReason } },
          });
          return;
        }
        await fin({
          status: map.status,
          errorCode: st.failReason ?? 'REMOTE_FAILED',
          errorMessage: message,
          result: 'REMOTE_FAILED',
          remoteStatus: st.status,
          event: { type: 'REMOTE_FAILED', payload: { publish_id: remoteId, fail_reason: st.failReason } },
        });
        return;
      }

      default:
        // PROCESSING_UPLOAD / PROCESSING_DOWNLOAD / desconhecido: continua aguardando.
        await d.db.addEvent(job.id, 'POLL', { publish_id: remoteId, status: st.status });
        await waitOrUnknown('PENDING', `Status no TikTok: ${st.status}.`);
        return;
    }
  } catch (e) {
    try {
      if (e instanceof TikTokError) {
        switch (e.kind) {
          case 'AUTH':
          case 'SCOPE': {
            // Mantém o publish_id: ao reagendar, o claim reconcilia antes de qualquer reenvio.
            const o = outcomeForError(e);
            await setChannel(d, job.channel_id, o);
            await fin({
              status: o.status,
              errorCode: o.code,
              errorMessage: o.message,
              result: 'BLOCKED',
              event: { type: 'BLOCKED', payload: { code: o.code, publish_id: remoteId } },
            });
            return;
          }
          case 'INVALID':
          case 'OTHER':
            await fin({
              status: 'UNKNOWN',
              errorCode: 'STATUS_QUERY_REJECTED',
              errorMessage: 'O TikTok recusou a consulta de status. Confira no TikTok antes de reenviar.',
              result: 'UNKNOWN',
              event: { type: 'UNKNOWN', payload: { reason: e.code, publish_id: remoteId } },
            });
            return;
          default: // RATE_LIMIT, SERVER, NETWORK, MALFORMED, QUOTA...
            await waitOrUnknown(e.code, 'Não foi possível consultar o TikTok agora; uma nova consulta será tentada automaticamente.');
            return;
        }
      }
      d.log('poll.unexpected', { job: job.id, error: e instanceof Error ? e.message : String(e) });
      await waitOrUnknown('INTERNAL_ERROR', 'Não foi possível consultar o TikTok agora; uma nova consulta será tentada automaticamente.');
    } catch (inner) {
      d.log('poll.finish_failed', { job: job.id, error: inner instanceof Error ? inner.message : String(inner) });
    }
  }
}

// ---------------------------------------------------------------------
// Laço principal de uma execução
// ---------------------------------------------------------------------
export async function runWorker(
  d: WorkerDeps,
  o: { workerId: string; budgetMs: number; maxPolls?: number; shouldContinue?: () => boolean },
): Promise<{ polled: number; handled: number }> {
  const start = d.now().getTime();
  const inBudget = () => d.now().getTime() - start < o.budgetMs && (o.shouldContinue?.() ?? true);
  let polled = 0;
  let handled = 0;

  // 1) Conferência de envios em andamento (rápida e idempotente).
  while (inBudget() && polled < (o.maxPolls ?? 50)) {
    const job = await d.db.claimPollingJob(o.workerId);
    if (!job) break;
    if (!inBudget()) {
      await d.db.finishJob({
        jobId: job.id,
        status: 'PROCESSING',
        errorCode: null,
        errorMessage: null,
        nextAttemptAt: d.now(),
        result: 'RELEASED',
      });
      break;
    }
    polled++;
    await pollJob(job, d);
  }

  // 2) Novos envios, um por vez: cada claim só trava o job que será processado de imediato.
  while (inBudget()) {
    const job = await d.db.claimPublishJob(o.workerId);
    if (!job) break;
    if (!inBudget()) {
      await d.db.finishJob({
        jobId: job.id,
        status: 'RETRY_WAIT',
        errorCode: null,
        errorMessage: null,
        nextAttemptAt: d.now(),
        result: 'RELEASED',
        refundAttempt: true,
      });
      break;
    }
    handled++;
    await processPublish(job, d);
  }

  return { polled, handled };
}
