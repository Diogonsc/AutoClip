import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { join } from 'node:path';

const fixture = JSON.parse(readFileSync(process.env.E2E_FIXTURE_FILE!, 'utf8'));
async function login(page, credentials = fixture.ownerA) {
  await page.addInitScript((workspaceId) => localStorage.setItem('tiktok-saas:workspace', workspaceId), credentials.workspaceId);
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const email = page.getByRole('textbox', { name: 'E-mail' });
  await expect(email).toBeVisible();
  await email.fill(credentials.email);
  await page.getByLabel('Senha').fill(fixture.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/app/);
}
function futureLocalInput(daysAhead = 3, hour = 14) {
  const date=new Date(Date.now()+daysAhead*24*60*60_000);
  date.setHours(hour,0,0,0);
  const local=new Date(date.getTime()-date.getTimezoneOffset()*60_000);
  return local.toISOString().slice(0,16);
}
async function userClientFor(email=fixture.ownerA.email) {
  const client=createClient(fixture.apiUrl,fixture.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const loginResult=await client.auth.signInWithPassword({email,password:fixture.password});
  expect(loginResult.error).toBeNull();
  const token=loginResult.data.session!.access_token;
  return createClient(fixture.apiUrl,fixture.anonKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
}

test('protege rota, autentica pela interface e encerra sessão', async ({ page }) => {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/login/);
  await login(page);
  await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible();
  if (test.info().project.name.startsWith('mobile')) {
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    await expect(page.getByRole('heading', { name: 'Menu' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login/);
});

test('rejeita login inválido sem criar sessão', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const email = page.getByRole('textbox', { name: 'E-mail' });
  await expect(email).toBeVisible();
  await email.fill(fixture.ownerA.email);
  await page.getByLabel('Senha').fill('senha-incorreta');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('[role=alert]')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('Shop: rota direta e endpoints recusam acesso sem chamar integrações', async ({ page }) => {
  await page.goto('/shop', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('body')).not.toContainText(/TikTok Shop e Afiliados|Conectar TikTok Shop|Produto afiliado/);

  const base = `${fixture.apiUrl}/functions/v1`;
  const responses = await Promise.all([
    page.request.post(`${base}/tiktok-shop`, { data: 'not-json', headers: { 'content-type': 'application/json' } }),
    page.request.get(`${base}/tiktok-shop-oauth-callback?state=synthetic&code=synthetic`),
    page.request.post(`${base}/tiktok-shop-publish`, { data: 'not-json', headers: { 'content-type': 'application/json' } }),
  ]);
  for (const response of responses) {
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: 'feature_unavailable' });
  }
});

test('abre dashboard, biblioteca, canais e lotes em desktop/mobile sem erros JS', async ({ page }) => {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`));
  await login(page);
  for (const [path, title] of [['/app', 'Painel'], ['/biblioteca', 'Biblioteca'], ['/canais', 'Canais TikTok'], ['/lotes', 'Histórico de lotes']] as const) {
    await page.goto(path);
    await expect(page.locator('h1').filter({ hasText: title }).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Application error');
    if (path === '/lotes') await page.screenshot({ path: test.info().outputPath('homologated-batches.png'), fullPage: true });
  }
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('grupo e prévia de lote funcionam sem criar jobs nem reservar quota', async ({ page }) => {
  await login(page);
  const auth = createClient(fixture.apiUrl, fixture.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await auth.auth.signInWithPassword({ email: fixture.ownerA.email, password: fixture.password });
  const userClient = createClient(fixture.apiUrl, fixture.anonKey, { global: { headers: { Authorization: `Bearer ${signedIn.data.session!.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const beforeJobs = await userClient.from('publication_jobs').select('id', { count: 'exact', head: true }).eq('workspace_id', fixture.ownerA.workspaceId);
  const beforeReservations = await userClient.from('publication_quota_reservations').select('id', { count: 'exact', head: true }).eq('workspace_id', fixture.ownerA.workspaceId);
  await page.goto('/canais');
  await expect(page.getByText(`E2E fixture ${fixture.fixture}`)).toBeVisible();
  await page.getByRole('checkbox', { name: `Selecionar E2E fixture ${fixture.fixture}` }).check();
  await page.getByRole('button', { name: 'Organizar grupos' }).click();
  await page.getByRole('button', { name: 'Novo grupo' }).click();
  const groupName = `E2E criado ${fixture.fixture} ${test.info().project.name}`;
  await page.getByLabel('Novo grupo').fill(groupName);
  await page.getByRole('button', { name: 'Criar grupo' }).click();
  await expect(page.getByRole('button', { name: new RegExp(groupName) })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(groupName) }).click();
  await page.getByRole('button', { name: new RegExp('Adicionar selecionadas') }).click();
  await expect(page.getByText(`E2E fixture ${fixture.fixture}`).last()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/publicacoes');
  await page.getByRole('button', { name: 'Agendamento em lote' }).click();
  await expect(page.getByRole('heading', { name: 'Agendamento em lote' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(groupName) }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Carrossel de fotos' }).click();
  await page.getByRole('checkbox', { name: new RegExp(fixture.fixtureMediaFilename) }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  const start = new Date(Date.now() + 3 * 60 * 60_000);
  const local = new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.getByLabel('Início').fill(local);
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText(/Quota necessária/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar lote' })).toBeVisible();
  const afterJobs = await userClient.from('publication_jobs').select('id', { count: 'exact', head: true }).eq('workspace_id', fixture.ownerA.workspaceId);
  const afterReservations = await userClient.from('publication_quota_reservations').select('id', { count: 'exact', head: true }).eq('workspace_id', fixture.ownerA.workspaceId);
  expect(afterJobs.count).toBe(beforeJobs.count);
  expect(afterReservations.count).toBe(beforeReservations.count);
});

test('membro viewer não vê gestão e políticas isolam workspace estrangeiro', async ({ page }) => {
  await login(page, fixture.viewer);
  await expect(page.getByRole('link', { name: 'Membros' })).toHaveCount(0);
  const client = createClient(fixture.apiUrl, fixture.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: fixture.viewer.email, password: fixture.password });
  expect(error).toBeNull();
  const userClient = createClient(fixture.apiUrl, fixture.anonKey, { global: { headers: { Authorization: `Bearer ${data.session!.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const foreign = await userClient.from('channels').select('id,display_name').eq('id', fixture.foreignChannelId);
  expect(foreign.error).toBeNull();
  expect(foreign.data).toEqual([]);
});

test('faz upload de imagem binária real pelo fluxo da biblioteca', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto('/biblioteca', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Biblioteca de mídia' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar mídia' })).toBeVisible();
  const input = page.locator('input[type=file]').first();
  await expect(input).toBeAttached();
  const bytes = readFileSync(join(fixture.mediaDir, 'fixture.png'));
  const filename=`e2e-upload-${fixture.fixture}-${test.info().project.name}.png`;
  await input.setInputFiles({ name: filename, mimeType: 'image/png', buffer: bytes });
  await expect(page.getByText(filename)).toBeVisible({ timeout: 20_000 });
  const videoName=`uploaded-video-${fixture.fixture}-${test.info().project.name}.mp4`;
  await input.setInputFiles({name:videoName,mimeType:'video/mp4',buffer:readFileSync(join(fixture.mediaDir,'fixture.mp4'))});
  await expect(page.getByText(videoName)).toBeVisible({timeout:150_000});
  const client=await userClientFor();
  const {data:asset}=await client.from('media_assets').select('status,validation_status,detected_video_codec,checksum_sha256').eq('original_filename',videoName).single();
  expect(asset).toMatchObject({status:'READY',validation_status:'VALIDATED',detected_video_codec:'h264'});
  expect(asset?.checksum_sha256).toMatch(/^[a-f0-9]{64}$/);
});

test('Storage impede bypass, valida binários no servidor e isola workspaces', async ({ page }) => {
  const auth = createClient(fixture.apiUrl, fixture.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await auth.auth.signInWithPassword({ email: fixture.ownerA.email, password: fixture.password });
  expect(signedIn.error).toBeNull();
  const client = createClient(fixture.apiUrl, fixture.anonKey, { global: { headers: { Authorization: `Bearer ${signedIn.data.session!.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const storage = client.storage.from('media');
  const directFinal = await storage.upload(`${fixture.ownerA.workspaceId}/${crypto.randomUUID()}/original.png`, readFileSync(join(fixture.mediaDir, 'fixture.png')), { contentType:'image/png',upsert:false });
  expect(directFinal.error).not.toBeNull();
  const signed = await storage.createSignedUrl(fixture.fixtureObject, 60);
  expect(signed.error).toBeNull();
  const publicUrl = client.storage.from('media').getPublicUrl(fixture.fixtureObject).data.publicUrl;
  const publicProbe = await fetch(publicUrl);
  expect([400, 401, 403, 404]).toContain(publicProbe.status);
  const deniedType = await client.storage.from('media-quarantine').upload(`${fixture.ownerA.workspaceId}/${crypto.randomUUID()}/upload`, Buffer.from('not allowed'), { contentType: 'text/plain', upsert: false });
  expect(deniedType.error).not.toBeNull();
  for (const [file,mime] of [['fixture.jpg','image/jpeg'],['fixture.png','image/png'],['fixture.webp','image/webp']] as const) {
    const bytes=readFileSync(join(fixture.mediaDir,file));
    const started=await client.rpc('begin_media_upload',{p_workspace:fixture.ownerA.workspaceId,p_filename:`binary-${file}`,p_mime:mime,p_size:bytes.byteLength});
    expect(started.error).toBeNull();
    const key=started.data.quarantine_key as string;
    const upload=await client.storage.from('media-quarantine').upload(key,bytes,{contentType:mime,upsert:false});
    expect(upload.error).toBeNull();
    const validated=await client.functions.invoke('media-validate',{body:{media_id:started.data.media_id}});
    expect(validated.error,`${file} validation`).toBeNull();
    expect(validated.data.status).toBe('READY');
    const approved=await client.storage.from('media').download(started.data.storage_key);
    expect(approved.error).toBeNull();
  }
  const fakeBytes=Buffer.from('not actually a PNG');
  const malicious=await client.rpc('begin_media_upload',{p_workspace:fixture.ownerA.workspaceId,p_filename:'fake.png',p_mime:'image/png',p_size:fakeBytes.byteLength});
  expect(malicious.error).toBeNull();
  const fakeKey=malicious.data.quarantine_key as string;
  const fakeUpload=await client.storage.from('media-quarantine').upload(fakeKey,fakeBytes,{contentType:'image/png',upsert:false});
  expect(fakeUpload.error).toBeNull();
  const rejected=await client.functions.invoke('media-validate',{body:{media_id:malicious.data.media_id}});
  expect(rejected.error).not.toBeNull();
  const persisted=await client.from('media_assets').select('status,validation_status').eq('id',malicious.data.media_id).single();
  expect(persisted.data).toMatchObject({status:'FAILED',validation_status:'REJECTED'});
  const absent=await storage.download(malicious.data.storage_key);
  expect(absent.error).not.toBeNull();
  async function rejectedImageFixture(name:string,mime:string,bytes:Buffer) {
    const started=await client.rpc('begin_media_upload',{p_workspace:fixture.ownerA.workspaceId,p_filename:name,p_mime:mime,p_size:bytes.byteLength});
    expect(started.error).toBeNull();
    const uploaded=await client.storage.from('media-quarantine').upload(started.data.quarantine_key,bytes,{contentType:mime,upsert:false});
    expect(uploaded.error).toBeNull();
    const result=await client.functions.invoke('media-validate',{body:{media_id:started.data.media_id}});
    expect(result.error,`${name} must be rejected`).not.toBeNull();
    const row=await client.from('media_assets').select('status,validation_status').eq('id',started.data.media_id).single();
    expect(row.data).toMatchObject({status:'FAILED',validation_status:'REJECTED'});
    const final=await storage.download(started.data.storage_key);
    expect(final.error).not.toBeNull();
  }
  await rejectedImageFixture('truncated.jpg','image/jpeg',readFileSync(join(fixture.mediaDir,'fixture.jpg')).subarray(0,12));
  await rejectedImageFixture('truncated.png','image/png',readFileSync(join(fixture.mediaDir,'fixture.png')).subarray(0,24));
  await rejectedImageFixture('invalid.webp','image/webp',Buffer.from('RIFF0000WEBPnot a decodable image'));
  const hugePng=Buffer.alloc(33); Buffer.from([137,80,78,71,13,10,26,10]).copy(hugePng); hugePng.writeUInt32BE(13,8); Buffer.from('IHDR').copy(hugePng,12); hugePng.writeUInt32BE(100000,16); hugePng.writeUInt32BE(100000,20); hugePng[24]=8; hugePng[25]=2;
  await rejectedImageFixture('huge-dimensions.png','image/png',hugePng);
  async function uploadVideo(name:string,bytes:Buffer) {
    const started=await client.rpc('begin_media_upload',{p_workspace:fixture.ownerA.workspaceId,p_filename:name,p_mime:'video/mp4',p_size:bytes.byteLength});
    expect(started.error).toBeNull();
    const uploaded=await client.storage.from('media-quarantine').upload(started.data.quarantine_key,bytes,{contentType:'video/mp4',upsert:false});
    expect(uploaded.error).toBeNull();
    // Para mídia inválida, o worker pode concluir REJECTED antes da chamada à
    // Edge Function; nesse caso 409 é correto. O estado persistido é a autoridade.
    await client.functions.invoke('media-validate',{body:{media_id:started.data.media_id}});
    const deadline=Date.now()+30_000; let row;
    do { const loaded=await client.from('media_assets').select('id,storage_key,status,validation_status,validation_error_code,checksum_sha256').eq('id',started.data.media_id).single(); row=loaded.data; if(row?.status==='READY'||row?.status==='FAILED') break; await new Promise(resolve=>setTimeout(resolve,300)); } while(Date.now()<deadline);
    return row!;
  }
  const invalidVideo=await uploadVideo('invalid.mp4',Buffer.from('not a video container'));
  expect(invalidVideo).toMatchObject({status:'FAILED',validation_status:'REJECTED'});
  const truncatedVideo=await uploadVideo('truncated.mp4',readFileSync(join(fixture.mediaDir,'fixture.mp4')).subarray(0,32));
  expect(truncatedVideo).toMatchObject({status:'FAILED',validation_status:'REJECTED'});
  const wrongCodec=await uploadVideo('mpeg4-codec.mp4',readFileSync(join(fixture.mediaDir,'mpeg4.mp4')));
  expect(wrongCodec.validation_error_code).toBe('VIDEO_CODEC_UNSUPPORTED');
  const longVideo=await uploadVideo('too-long.mp4',readFileSync(join(fixture.mediaDir,'long.mp4')));
  expect(longVideo.validation_error_code).toBe('VIDEO_DURATION_UNSUPPORTED');
  const wideVideo=await uploadVideo('too-wide.mp4',readFileSync(join(fixture.mediaDir,'wide.mp4')));
  expect(wideVideo.validation_error_code).toBe('VIDEO_DIMENSIONS_UNSUPPORTED');
  const validMp4=await client.rpc('begin_media_upload',{p_workspace:fixture.ownerA.workspaceId,p_filename:'valid-video.mp4',p_mime:'video/mp4',p_size:readFileSync(join(fixture.mediaDir,'fixture.mp4')).byteLength});
  expect(validMp4.error).toBeNull();
  const mp4Bytes=readFileSync(join(fixture.mediaDir,'fixture.mp4'));
  const mp4Upload=await client.storage.from('media-quarantine').upload(validMp4.data.quarantine_key,mp4Bytes,{contentType:'video/mp4',upsert:false});
  expect(mp4Upload.error).toBeNull();
  const mp4Validation=await client.functions.invoke('media-validate',{body:{media_id:validMp4.data.media_id}});
  expect(mp4Validation.error).toBeNull();
  expect(mp4Validation.data.status).toBe('VALIDATING');
  const videoDeadline=Date.now()+30_000; let approvedVideo;
  do { const loaded=await client.from('media_assets').select('id,storage_key,status,validation_status,checksum_sha256').eq('id',validMp4.data.media_id).single(); approvedVideo=loaded.data; if(approvedVideo?.status==='READY') break; await new Promise(resolve=>setTimeout(resolve,300)); } while(Date.now()<videoDeadline);
  expect(approvedVideo).toMatchObject({status:'READY',validation_status:'VALIDATED'});
  const finalVideo=await client.storage.from('media').download(approvedVideo!.storage_key);
  expect(finalVideo.error).toBeNull();
  const actualHash=createHash('sha256').update(Buffer.from(await finalVideo.data!.arrayBuffer())).digest('hex');
  expect(actualHash).toBe(approvedVideo?.checksum_sha256);
  const isolatedClient=await userClientFor(fixture.viewer.email);
  const foreign = await isolatedClient.storage.from('media').createSignedUrl(fixture.foreignObject, 60);
  expect(foreign.error).not.toBeNull();
  const anon = createClient(fixture.apiUrl, fixture.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const unauthenticated = await anon.storage.from('media-quarantine').upload(`${fixture.ownerA.workspaceId}/${crypto.randomUUID()}/upload`, readFileSync(join(fixture.mediaDir, 'fixture.png')), { contentType: 'image/png', upsert: false });
  expect(unauthenticated.error).not.toBeNull();
  const oversized = await client.storage.from('media-quarantine').upload(`${fixture.ownerA.workspaceId}/${crypto.randomUUID()}/upload`, Buffer.alloc(50 * 1024 * 1024 + 1), { contentType: 'video/mp4', upsert: false });
  expect(oversized.error).not.toBeNull();
  const directUpdate=await client.from('media_assets').update({checksum_sha256:'f'.repeat(64),status:'READY'}).eq('id',fixture.fixtureMediaId);
  expect(directUpdate.error).not.toBeNull();
  const overwrite=await storage.upload(fixture.fixtureObject,readFileSync(join(fixture.mediaDir,'fixture.jpg')),{contentType:'image/jpeg',upsert:true});
  expect(overwrite.error).not.toBeNull();
});

test('confirma lote, repete como rascunho, reagenda e cancela sem publicar', async ({ page }) => {
  const mobile=test.info().project.name.startsWith('mobile');
  const actor=mobile?fixture.ownerB:fixture.ownerA;
  const channelLabel=mobile?`PRIVATE E2E ${fixture.fixture}`:`E2E fixture ${fixture.fixture}`;
  const mediaFilename=mobile?fixture.foreignVideoFilename:fixture.fixtureVideoFilename;
  const mediaId=mobile?fixture.foreignVideoId:fixture.fixtureVideoId;
  await login(page,actor);
  const client=await userClientFor(actor.email);
  const beforeJobs=await client.from('publication_jobs').select('id',{count:'exact',head:true}).eq('workspace_id',actor.workspaceId);
  const beforeReservations=await client.from('publication_quota_reservations').select('id',{count:'exact',head:true}).eq('workspace_id',actor.workspaceId).eq('status','RESERVED');
  await page.goto('/publicacoes');
  await page.getByRole('button',{name:'Agendamento em lote'}).click();
  await page.locator('label').filter({hasText:channelLabel}).getByRole('checkbox').first().check();
  await page.getByRole('button',{name:'Continuar'}).click();
  await page.getByRole('checkbox',{name:new RegExp(mediaFilename)}).check();
  await page.getByRole('button',{name:'Continuar'}).click();
  await page.getByLabel('Legenda padrão').fill(`Legenda E2E ${fixture.fixture}`);
  await page.getByLabel('Início').fill(futureLocalInput());
  await page.getByRole('checkbox',{name:'Confirmo que tenho os direitos/consentimentos necessários para o áudio de todas as publicações.'}).check();
  await page.getByRole('button',{name:'Continuar'}).click();
  await page.getByRole('button',{name:'Editar configurações'}).click();
  const settingsDialog=page.getByRole('dialog').last();
  await settingsDialog.getByRole('combobox').click();
  await page.getByRole('option',{name:'SELF_ONLY'}).click();
  await settingsDialog.getByRole('button',{name:'Salvar no rascunho'}).click();
  const confirmBatch=page.getByRole('button',{name:'Confirmar lote'});
  await expect(confirmBatch).toBeEnabled();
  const beforeConfirm=await client.from('publication_jobs').select('id',{count:'exact',head:true}).eq('workspace_id',actor.workspaceId);
  expect(beforeConfirm.count).toBe(beforeJobs.count);
  const previewReservations=await client.from('publication_quota_reservations').select('id',{count:'exact',head:true}).eq('workspace_id',actor.workspaceId).eq('status','RESERVED');
  expect(previewReservations.count).toBe(beforeReservations.count);
  await confirmBatch.click();
  await expect(page.getByText(/1 publicação\(ões\) confirmada\(s\) no lote/)).toBeVisible();
  const created=await client.from('publication_jobs').select('id,batch_id,caption,scheduled_at,status,media_asset_id').eq('workspace_id',actor.workspaceId).eq('media_asset_id',mediaId).order('created_at',{ascending:false}).limit(1).single();
  expect(created.error).toBeNull();
  expect(created.data.caption).toBe(`Legenda E2E ${fixture.fixture}`);
  expect(created.data.status).toBe('SCHEDULED');
  expect(created.data.batch_id).toBeTruthy();
  const afterConfirm=await client.from('publication_quota_reservations').select('id',{count:'exact',head:true}).eq('workspace_id',actor.workspaceId).eq('status','RESERVED');
  expect(afterConfirm.count).toBe((beforeReservations.count??0)+1);
  await page.keyboard.press('Escape');
  await page.goto('/lotes');
  let batchRow=page.getByRole('row').filter({hasText:created.data.batch_id.slice(0,8)});
  await batchRow.getByRole('button',{name:'Detalhes'}).click();
  await page.getByRole('button',{name:'Repetir lote'}).click();
  await expect(page.getByRole('heading',{name:'Agendamento em lote'})).toBeVisible();
  await page.getByRole('button',{name:'Continuar'}).click();
  await expect(page.getByRole('checkbox',{name:new RegExp(mediaFilename)})).toBeChecked();
  await page.getByRole('button',{name:'Continuar'}).click();
  const repeatStart=page.getByLabel('Início');
  await expect(repeatStart).toHaveValue('');
  await page.getByRole('button',{name:'Continuar'}).click();
  const repeatedConfirm=page.getByRole('button',{name:'Confirmar lote'});
  await expect(repeatedConfirm).toBeDisabled();
  await page.getByRole('button',{name:'Voltar'}).click();
  await repeatStart.fill(futureLocalInput(5,15));
  await page.getByRole('button',{name:'Continuar'}).click();
  await expect(page.getByRole('button',{name:'Confirmar lote'})).toBeEnabled();
  await page.getByRole('button',{name:'Confirmar lote'}).click();
  await expect(page.getByText(/publicação\(ões\) confirmada\(s\) no lote/)).toBeVisible();
  const jobsAfterRepeat=await client.from('publication_jobs').select('id,batch_id,caption,scheduled_at,status').eq('workspace_id',actor.workspaceId).eq('media_asset_id',mediaId).order('created_at',{ascending:true});
  expect(jobsAfterRepeat.data).toHaveLength(2);
  expect(jobsAfterRepeat.data?.[0].batch_id).not.toBe(jobsAfterRepeat.data?.[1].batch_id);
  expect(jobsAfterRepeat.data?.[0].scheduled_at).toBe(created.data.scheduled_at);
  expect(jobsAfterRepeat.data?.[1].caption).toBe(created.data.caption);
  await page.keyboard.press('Escape');

  const repeatedBatchId=jobsAfterRepeat.data![1].batch_id!;
  await page.goto('/lotes');
  batchRow=page.getByRole('row').filter({hasText:repeatedBatchId.slice(0,8)});
  await batchRow.getByRole('button',{name:'Detalhes'}).click();
  const itemRow=page.getByRole('dialog').last().locator('table tbody tr').first();
  await itemRow.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Reagendar selecionadas'}).click();
  const rescheduleStart=page.getByLabel('Nova data e horário inicial');
  await rescheduleStart.fill(futureLocalInput(7,16));
  await page.getByLabel('Intervalo entre publicações (minutos)').fill('5');
  await expect(page.getByText(/Sem conflito encontrado/)).toBeVisible();
  const rescheduleButton=page.getByRole('button',{name:'Confirmar reagendamento'});
  await expect(rescheduleButton).toBeEnabled();
  await rescheduleButton.click();
  await page.getByRole('alertdialog').getByRole('button',{name:'Confirmar reagendamento'}).click();
  await expect(page.getByText(/1 publicação\(ões\) reagendadas/)).toBeVisible();
  let scheduled=await client.from('publication_jobs').select('scheduled_at,status').eq('batch_id',repeatedBatchId).single();
  expect(scheduled.data?.status).toBe('SCHEDULED');
  expect(new Date(scheduled.data!.scheduled_at).getTime()).toBeGreaterThan(Date.now()+5*24*60*60_000);
  const reservedBeforeCancel=await client.from('publication_quota_reservations').select('id',{count:'exact',head:true}).eq('workspace_id',actor.workspaceId).eq('status','RESERVED');
  await page.getByRole('dialog').last().locator('table tbody tr').first().getByRole('checkbox').first().check();
  await page.getByRole('button',{name:'Cancelar selecionadas'}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'Cancelar',exact:true}).last().click();
  await expect(page.getByText(/1 publicação\(ões\) canceladas/)).toBeVisible();
  await expect(page.getByText(/1 publicação\(ões\) canceladas/)).toBeVisible();
  scheduled=await client.from('publication_jobs').select('scheduled_at,status').eq('batch_id',repeatedBatchId).single();
  expect(scheduled.data?.status).toBe('CANCELLED');
  const reservedAfterCancel=await client.from('publication_quota_reservations').select('id',{count:'exact',head:true}).eq('workspace_id',actor.workspaceId).eq('status','RESERVED');
  expect(reservedAfterCancel.count).toBe((reservedBeforeCancel.count??0)-1);
});

test('CSV rejeita linhas inválidas e confirma uma publicação válida de vídeo', async ({ page }) => {
  const mobile=test.info().project.name.startsWith('mobile');
  const actor=mobile?fixture.ownerB:fixture.ownerA;
  const channelName=mobile?`PRIVATE E2E ${fixture.fixture}`:`E2E fixture ${fixture.fixture}`;
  const videoName=mobile?fixture.foreignVideoFilename:fixture.fixtureVideoFilename;
  const imageName=mobile?fixture.foreignMediaFilename:fixture.fixtureMediaFilename;
  const mediaId=mobile?fixture.foreignVideoId:fixture.fixtureVideoId;
  await login(page,actor);
  const client=await userClientFor(actor.email);
  const before=await client.from('publication_jobs').select('id',{count:'exact',head:true}).eq('workspace_id',actor.workspaceId);
  await page.goto('/publicacoes');
  const input=page.locator('input[type=file][accept=".csv,text/csv"]');
  await input.setInputFiles({name:'bad-e2e.csv',mimeType:'text/csv',buffer:Buffer.from('foo,bar\nx,y')});
  await expect(page.getByRole('alert').filter({ hasText: 'Colunas obrigatórias ausentes' })).toBeVisible();
  const validHeaderButImage=Buffer.from(`canal,video,legenda,data_hora,fuso_horario,direitos_audio_confirmados\n${channelName},${imageName},Teste,${futureLocalInput(10)},${Intl.DateTimeFormat().resolvedOptions().timeZone},true`);
  await input.setInputFiles({name:'image-as-video-e2e.csv',mimeType:'text/csv',buffer:validHeaderButImage});
  await expect(page.getByRole('alert').filter({ hasText: 'não é um vídeo validado' })).toBeVisible();
  const unchanged=await client.from('publication_jobs').select('id',{count:'exact',head:true}).eq('workspace_id',actor.workspaceId);
  expect(unchanged.count).toBe(before.count);
  const caption=`CSV de vídeo E2E ${fixture.fixture}-${test.info().project.name}`;
  const validCsv=Buffer.from(`canal,video,legenda,data_hora,fuso_horario,direitos_audio_confirmados,privacidade\n${channelName},${videoName},${caption},${futureLocalInput(12)},${Intl.DateTimeFormat().resolvedOptions().timeZone},true,SELF_ONLY`);
  await input.setInputFiles({name:'valid-video-e2e.csv',mimeType:'text/csv',buffer:validCsv});
  await expect(page.getByText(/1 publicação\(ões\) importada\(s\) e agendada\(s\)/)).toBeVisible();
  const created=await client.from('publication_jobs').select('id,status,media_asset_id,caption,batch_id').eq('workspace_id',actor.workspaceId).eq('caption',caption).single();
  expect(created.data).toMatchObject({status:'SCHEDULED',media_asset_id:mediaId});
  expect(created.data?.batch_id).toBeTruthy();
  const reservation=await client.from('publication_quota_reservations').select('status').eq('publication_job_id',created.data!.id).single();
  expect(reservation.data?.status).toBe('RESERVED');
});

test('troca de workspace atualiza o escopo e sessão revogada redireciona ao login', async ({ page }) => {
  await login(page);
  await page.goto('/canais');
  await expect(page.getByText(`E2E fixture ${fixture.fixture}`)).toBeVisible();
  if(test.info().project.name.startsWith('mobile')) await page.getByRole('button',{name:'Abrir menu'}).click();
  const switcher=page.getByRole('combobox',{name:'Workspace'});
  await switcher.click();
  await page.getByRole('option',{name:fixture.workspaceBName}).click();
  await expect(page.getByText(`PRIVATE E2E ${fixture.fixture}`)).toBeVisible();
  await expect(page.getByText(`E2E fixture ${fixture.fixture}`)).toHaveCount(0);
  const auth=createClient(fixture.apiUrl,fixture.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const logged=await auth.auth.signInWithPassword({email:fixture.ownerA.email,password:fixture.password});
  expect(logged.error).toBeNull();
  await auth.auth.signOut({scope:'global'});
  await page.evaluate(() => {
    for(const key of Object.keys(localStorage).filter(value=>value.endsWith('-auth-token'))) {
      try { const session=JSON.parse(localStorage.getItem(key)!); session.expires_at=1; localStorage.setItem(key,JSON.stringify(session)); } catch { /* ignore unrelated keys */ }
    }
  });
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login/,{timeout:15_000});
});
