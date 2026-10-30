import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pollJob, processPublish, runWorker, ShopPublishReconciliationError } from '../_shared/worker.ts';
import { CREATOR, err, FakeDb, mkClock, mkDeps, mkTikTok } from './helpers.ts';

const DIRECT_JOB = { privacy_level: 'SELF_ONLY', allow_comment: true, allow_duet: false, allow_stitch: false };

async function claim(db: FakeDb) {
  const j = await db.claimPublishJob();
  assert.ok(j, 'job deveria ser reivindicável');
  return j;
}

// ------------------------------------------------------------------ envio feliz
test('INBOX: baixa, inicia, grava publish_id ANTES do upload e fica PROCESSING aguardando conferência', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock);
  const tk = mkTikTok({
    uploadVideo: () => {
      tk.calls.push('upload');
      // invariante central: o publish_id já está no banco quando o upload começa
      assert.equal(db.job.remote_publish_id, 'pub1');
      return Promise.resolve();
    },
  });
  await processPublish(await claim(db), mkDeps(db, tk, clock));

  assert.deepEqual(tk.calls, ['download', 'init', 'upload']); // INBOX não consulta creator_info
  assert.equal(db.last().status, 'PROCESSING');
  assert.equal(db.last().remoteStatus, 'UPLOADED');
  assert.equal(db.job.remote_publish_id, 'pub1');
  assert.equal(tk.lastInit?.mode, 'INBOX');
});

test('DIRECT: valida opções, aplica restrições do criador e envia post_info', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock, { job: DIRECT_JOB, settings: { publish_mode: 'DIRECT' } });
  const tk = mkTikTok({
    queryCreatorInfo: () => {
      tk.calls.push('creator_info');
      return Promise.resolve({ ...CREATOR, comment_disabled: true });
    },
  });
  await processPublish(await claim(db), mkDeps(db, tk, clock));

  assert.deepEqual(tk.calls.slice(0, 2), ['creator_info', 'download']);
  const post = (tk.lastInit as { postInfo: Record<string, unknown> }).postInfo;
  assert.equal(post.privacy_level, 'SELF_ONLY');
  assert.equal(post.disable_comment, true); // o criador desativou: prevalece sobre allow_comment=true
  assert.equal(post.disable_duet, true);
  assert.equal(db.job.status, 'PROCESSING');
  assert.ok(db.savedCreatorInfo);
});

test('DIRECT PHOTO: cria publicação de carrossel e grava publish_id antes da consulta de status', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock, {
    job: { ...DIRECT_JOB, post_type: 'PHOTO', media_asset_ids: ['media-1'] },
    media: { mime_type: 'image/jpeg', storage_key: 'ws-1/media-1/original.jpg', file_size_bytes: 1024, duration_seconds: null, width: 1080, height: 1350 },
    settings: { publish_mode: 'DIRECT' },
  });
  const tk = mkTikTok({ initPhotoPost: () => { tk.calls.push('photo_init'); return Promise.resolve({ publishId: 'photo-pub1' }); } });
  await processPublish(await claim(db), mkDeps(db, tk, clock));
  assert.ok(tk.calls.includes('photo_init'));
  assert.equal(db.job.remote_publish_id, 'photo-pub1');
  assert.equal(db.last().status, 'PROCESSING');
  assert.ok(db.events.some((event) => event.type === 'PHOTO_SUBMITTED'));
});

test('SHOP: encaminha ao pipeline interno somente o job autorizado, nunca a storage_key', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock, { job: { shop_product_id: 'product-1', shop_anchor_title: 'Produto' } });
  const tk = mkTikTok();
  let received: unknown[] = [];
  await processPublish(await claim(db), mkDeps(db, tk, clock, {
    shop: {
      publish(job) {
        received = Array.from(arguments);
        assert.equal(job.id, 'job-1');
        return Promise.resolve({ videoId: 'shop-video-1' });
      },
      status: () => Promise.resolve({ status: 'PROCESSING' }),
    },
  }));
  assert.equal(received.length, 1, 'nenhum caminho de storage é encaminhado ao endpoint Shop');
  assert.equal(db.job.remote_publish_id, 'shop:shop-video-1');
});

test('SHOP: publicação possivelmente concluída sem ID remoto confirmado fica UNKNOWN e não é reenviada', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock, { job: { shop_product_id: 'product-1', shop_anchor_title: 'Produto' } });
  const tk = mkTikTok();
  await processPublish(await claim(db), mkDeps(db, tk, clock, {
    shop: {
      publish: () => Promise.reject(new ShopPublishReconciliationError()),
      status: () => Promise.resolve({ status: 'PROCESSING' }),
    },
  }));
  assert.equal(db.job.status, 'UNKNOWN');
  assert.equal(db.last().errorCode, 'SHOP_PUBLISH_RECONCILIATION_REQUIRED');
  assert.equal(await db.claimPublishJob(), null);
});

// ------------------------------------------------------------------ bloqueios (nada vai ao TikTok)
test('DIRECT: privacidade fora das opções do criador => BLOCKED_PERMISSION, sem init', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock, {
    job: { ...DIRECT_JOB, privacy_level: 'FOLLOWER_OF_CREATOR' },
    settings: { publish_mode: 'DIRECT' },
  });
  const tk = mkTikTok();
  await processPublish(await claim(db), mkDeps(db, tk, clock));
  assert.equal(db.last().status, 'BLOCKED_PERMISSION');
  assert.equal(db.last().errorCode, 'PRIVACY_MISMATCH');
  assert.ok(!tk.calls.includes('init'));
});

test('DIRECT: opções de interação não definidas => bloqueia (não assume padrão)', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock, { job: { privacy_level: 'SELF_ONLY' }, settings: { publish_mode: 'DIRECT' } });
  const tk = mkTikTok();
  await processPublish(await claim(db), mkDeps(db, tk, clock));
  assert.equal(db.last().status, 'BLOCKED_PERMISSION');
  assert.equal(db.last().errorCode, 'MISSING_POST_OPTIONS');
  assert.ok(!tk.calls.includes('init'));
});

test('canal não conectado => BLOCKED_REAUTH sem nenhuma chamada ao TikTok', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock, { channel: { connection_status: 'PENDING_AUTH' } });
  const tk = mkTikTok();
  await processPublish(await claim(db), mkDeps(db, tk, clock));
  assert.equal(db.last().status, 'BLOCKED_REAUTH');
  assert.deepEqual(tk.calls, []);
});

test('escopo ausente => BLOCKED_PERMISSION', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock, { channel: { granted_scopes: ['user.info.basic'] } });
  const tk = mkTikTok();
  await processPublish(await claim(db), mkDeps(db, tk, clock));
  assert.equal(db.last().status, 'BLOCKED_PERMISSION');
  assert.equal(db.last().errorCode, 'SCOPE_MISSING');
  assert.deepEqual(tk.calls, []);
});

test('publicação automática desligada: devolve a tentativa e não envia', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock, { settings: { auto_publish_enabled: false } });
  const tk = mkTikTok();
  await processPublish(await claim(db), mkDeps(db, tk, clock));
  assert.equal(db.job.status, 'RETRY_WAIT');
  assert.equal(db.job.attempt_count, 0);
  assert.deepEqual(tk.calls, []);
});

// ------------------------------------------------------------------ erros explícitos no init
test('app não auditado => BLOCKED_APPROVAL', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock);
  const tk = mkTikTok({
    initVideoPost: () => Promise.reject(err('APPROVAL', 'unaudited_client_can_only_post_to_private_accounts', 403)),
  });
  await processPublish(await claim(db), mkDeps(db, tk, clock));
  assert.equal(db.last().status, 'BLOCKED_APPROVAL');
});

test('rate limit no init: reagenda sem consumir tentativa', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock);
  const tk = mkTikTok({ initVideoPost: () => Promise.reject(err('RATE_LIMIT', 'rate_limit_exceeded', 429)) });
  await processPublish(await claim(db), mkDeps(db, tk, clock));
  assert.equal(db.job.status, 'RETRY_WAIT');
  assert.equal(db.job.attempt_count, 0);
  assert.equal(db.nextAt!.getTime() - clock.t, 2 * 60_000);
});

test('5xx no init: tenta de novo com backoff e, esgotadas as tentativas, falha', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock);
  const tk = mkTikTok({ initVideoPost: () => Promise.reject(err('SERVER', 'http_503', 503)) });
  const deps = mkDeps(db, tk, clock);

  await processPublish(await claim(db), deps);
  assert.equal(db.job.status, 'RETRY_WAIT');
  assert.equal(db.nextAt!.getTime() - clock.t, 2 * 60_000);

  clock.advance(3 * 60_000);
  await processPublish(await claim(db), deps);
  assert.equal(db.nextAt!.getTime() - clock.t, 10 * 60_000);

  clock.advance(11 * 60_000);
  await processPublish(await claim(db), deps);
  assert.equal(db.job.status, 'FAILED'); // 3ª tentativa de 3
  assert.match(String(db.last().errorMessage), /esgotadas/);
});

test('token inválido no init: renova uma vez (force) e repete', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock);
  let first = true;
  const tk = mkTikTok({
    initVideoPost: () => {
      tk.calls.push('init');
      if (first) {
        first = false;
        return Promise.reject(err('AUTH', 'access_token_invalid', 401));
      }
      return Promise.resolve({ publishId: 'pub1', uploadUrl: 'https://u' });
    },
  });
  const tokenCalls: string[] = [];
  await processPublish(await claim(db), mkDeps(db, tk, clock, { tokenCalls }));
  assert.deepEqual(tokenCalls, ['normal', 'force']);
  assert.equal(db.job.status, 'PROCESSING');
});

// ------------------------------------------------------------------ resultado incerto: NUNCA reenviar
test('init sem resposta (rede) => UNKNOWN, e o job não pode ser reivindicado de novo', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock);
  let inits = 0;
  const tk = mkTikTok({
    initVideoPost: () => {
      inits++;
      return Promise.reject(err('NETWORK', 'network_error'));
    },
  });
  await processPublish(await claim(db), mkDeps(db, tk, clock));
  assert.equal(db.job.status, 'UNKNOWN');
  assert.equal(db.last().errorCode, 'INIT_AMBIGUOUS');
  assert.equal(await db.claimPublishJob(), null);
  clock.advance(24 * 3600_000); // mesmo muito tempo depois, nada reenvia sozinho
  assert.equal(await db.claimPublishJob(), null);
  assert.equal(inits, 1);
});

test('init com 200 malformado => UNKNOWN (ambíguo)', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock);
  const tk = mkTikTok({ initVideoPost: () => Promise.reject(err('MALFORMED', 'malformed_init', 200)) });
  await processPublish(await claim(db), mkDeps(db, tk, clock));
  assert.equal(db.job.status, 'UNKNOWN');
});

test('upload interrompido: mantém publish_id, confere o status e só reenvia após o TikTok confirmar FAILED', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock);
  let publishCount = 0;
  const tk = mkTikTok({
    initVideoPost: () => {
      publishCount++;
      return Promise.resolve({ publishId: `pub${publishCount}`, uploadUrl: 'https://u' });
    },
    uploadVideo: () => Promise.reject(err('NETWORK', 'network_error')),
    fetchPublishStatus: () => Promise.resolve({ status: 'FAILED', failReason: 'internal', publicPostIds: [] }),
  });
  const deps = mkDeps(db, tk, clock);

  await processPublish(await claim(db), deps);
  assert.equal(db.job.status, 'PROCESSING');
  assert.equal(db.job.remote_publish_id, 'pub1');
  assert.equal(db.last().errorCode, 'UPLOAD_INTERRUPTED');
  // enquanto o resultado não é conferido, nenhum novo envio pode começar
  assert.equal(await db.claimPublishJob(), null);

  clock.advance(61_000);
  const polled = await db.claimPollingJob();
  assert.ok(polled);
  await pollJob(polled, deps); // TikTok confirma FAILED/internal => seguro tentar de novo
  assert.equal(db.job.status, 'RETRY_WAIT');
  assert.equal(db.job.remote_publish_id, null);

  clock.advance(3 * 60_000);
  await processPublish(await claim(db), deps);
  assert.equal(publishCount, 2);
});

test('upload recusado definitivamente (4xx) => FAILED', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock);
  const tk = mkTikTok({ uploadVideo: () => Promise.reject(err('INVALID', 'upload_http_400', 400)) });
  await processPublish(await claim(db), mkDeps(db, tk, clock));
  assert.equal(db.job.status, 'FAILED');
  assert.equal(db.last().event?.type, 'UPLOAD_REJECTED');
});

test('job reivindicado já com publish_id: reconcilia, nunca inicia outro envio', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock, { job: { remote_publish_id: 'pub-antigo' } });
  const tk = mkTikTok({
    fetchPublishStatus: () => Promise.resolve({ status: 'PUBLISH_COMPLETE', failReason: null, publicPostIds: ['1'] }),
  });
  await processPublish(await claim(db), mkDeps(db, tk, clock));
  assert.ok(!tk.calls.includes('init'));
  assert.equal(db.job.status, 'PUBLISHED');
});

// ------------------------------------------------------------------ falha do banco após o init
test('falha ao gravar o publish_id: nada foi enviado, então não pode ficar preso em PROCESSING', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock);
  db.recordFails = 3;
  const tk = mkTikTok();
  await processPublish(await claim(db), mkDeps(db, tk, clock));
  assert.ok(!tk.calls.includes('upload'), 'sem publish_id gravado, o upload não pode acontecer');
  assert.notEqual(db.job.status, 'PROCESSING', 'job não pode ficar preso sem publish_id para conferir');
  assert.equal(db.job.status, 'RETRY_WAIT');
});

// ------------------------------------------------------------------ conferência de status
test('poll: PUBLISH_COMPLETE => PUBLISHED; SEND_TO_USER_INBOX => SENT_TO_INBOX', async () => {
  for (const [remote, expected] of [
    ['PUBLISH_COMPLETE', 'PUBLISHED'],
    ['SEND_TO_USER_INBOX', 'SENT_TO_INBOX'],
  ] as const) {
    const clock = mkClock();
    const db = new FakeDb(clock, { job: { status: 'PROCESSING', remote_publish_id: 'p1' } });
    const tk = mkTikTok({ fetchPublishStatus: () => Promise.resolve({ status: remote, failReason: null, publicPostIds: [] }) });
    await pollJob(db.job, mkDeps(db, tk, clock));
    assert.equal(db.job.status, expected);
  }
});

test('poll: ainda processando => continua; passando de 2 h => UNKNOWN', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock, { job: { status: 'PROCESSING', remote_publish_id: 'p1' } });
  const tk = mkTikTok({ fetchPublishStatus: () => Promise.resolve({ status: 'PROCESSING_UPLOAD', failReason: null, publicPostIds: [] }) });
  const deps = mkDeps(db, tk, clock);

  await pollJob(db.job, deps);
  assert.equal(db.job.status, 'PROCESSING');
  assert.equal(db.nextAt!.getTime() - clock.t, 60_000);

  clock.advance(2 * 3600_000 + 1000);
  await pollJob(db.job, deps);
  assert.equal(db.job.status, 'UNKNOWN');
  assert.equal(db.last().errorCode, 'REMOTE_STATUS_TIMEOUT');
});

test('poll: falhas não retentáveis do TikTok => FAILED; auth_removed => BLOCKED_REAUTH + canal REVOKED', async () => {
  const run = async (failReason: string) => {
    const clock = mkClock();
    const db = new FakeDb(clock, { job: { status: 'PROCESSING', remote_publish_id: 'p1' } });
    const tk = mkTikTok({ fetchPublishStatus: () => Promise.resolve({ status: 'FAILED', failReason, publicPostIds: [] }) });
    await pollJob(db.job, mkDeps(db, tk, clock));
    return db;
  };
  assert.equal((await run('file_format_check_failed')).job.status, 'FAILED');
  const revoked = await run('auth_removed');
  assert.equal(revoked.job.status, 'BLOCKED_REAUTH');
  assert.equal(revoked.channel!.connection_status, 'REVOKED');
});

test('poll: erro de rede preserva o publish_id e reagenda nova consulta', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock, { job: { status: 'PROCESSING', remote_publish_id: 'p1' } });
  const tk = mkTikTok({ fetchPublishStatus: () => Promise.reject(err('NETWORK', 'network_error')) });
  const deps = mkDeps(db, tk, clock);

  await pollJob(db.job, deps);
  assert.equal(db.job.status, 'PROCESSING');
  assert.equal(db.job.remote_publish_id, 'p1');
  assert.equal(db.nextAt!.getTime() - clock.t, 2 * 60_000);
  assert.equal(await db.claimPollingJob(), null, 'aguarda o intervalo de retry');

  clock.advance(2 * 60_000);
  assert.ok(await db.claimPollingJob(), 'volta a ser reivindicável sem intervenção manual');
});

// ------------------------------------------------------------------ laço principal
test('runWorker: confere os envios em andamento antes de iniciar novos', async () => {
  const clock = mkClock();
  const db = new FakeDb(clock, { job: { status: 'PROCESSING', remote_publish_id: 'p1' } });
  const tk = mkTikTok({
    fetchPublishStatus: () => Promise.resolve({ status: 'PUBLISH_COMPLETE', failReason: null, publicPostIds: [] }),
  });
  const r = await runWorker(mkDeps(db, tk, clock), { workerId: 'w', budgetMs: 60_000 });
  assert.deepEqual(r, { polled: 1, handled: 0 });
  assert.equal(db.job.status, 'PUBLISHED');
});
