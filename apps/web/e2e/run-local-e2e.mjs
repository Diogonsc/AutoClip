import { spawnSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

function localHost(value, label) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error(`${label} não aponta para localhost; execução interrompida por segurança.`);
}
if (process.env.E2E_EPHEMERAL !== '1' || !process.env.E2E_PROJECT_DIR) {
  throw new Error('E2E exige o runner descartável run-disposable-e2e.mjs; o Supabase local persistente não pode ser usado.');
}
const disposableProjectDir = resolve(process.env.E2E_PROJECT_DIR);
if (!disposableProjectDir.startsWith(join(tmpdir(), 'autoclip-e2e-disposable-'))) {
  throw new Error('Diretório Supabase E2E não pertence ao namespace temporário descartável.');
}
const markerPath = join(disposableProjectDir, '.autoclip-e2e-disposable');
if (!existsSync(markerPath)) throw new Error('Marcador do projeto descartável ausente; execução interrompida.');
const sb = { API_URL: process.env.E2E_SUPABASE_URL, DB_URL: process.env.E2E_DB_URL, ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY, SERVICE_ROLE_KEY: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY };
localHost(sb.API_URL, 'Supabase API');
localHost(sb.DB_URL, 'Supabase PostgreSQL');
if (!sb.ANON_KEY || !sb.SERVICE_ROLE_KEY) throw new Error('Supabase local não forneceu as chaves necessárias.');
const health = await fetch(`${sb.API_URL}/auth/v1/health`);
if (!health.ok) throw new Error(`Auth local não saudável (HTTP ${health.status}).`);

const admin = createClient(sb.API_URL, sb.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = randomBytes(5).toString('hex');
const tmp = join(tmpdir(), `autoclip-e2e-${suffix}.json`);
const mediaDir = mkdtempSync(join(tmpdir(), `autoclip-media-${suffix}-`));
const lockPath = join(tmpdir(), 'autoclip-e2e-local.lock');
let lockFd;
let lockOwned = false;
const password = `LocalE2E-${randomBytes(16).toString('hex')}!`;
const users = [];
const workspaces = [];
const finalKeys = [];
const quarantineKeys = [];
let edgeProcess;
let videoWorkerProcess;
let videoValidatorContainer;
let workerInstanceId;
const videoValidatorImage=process.env.E2E_VIDEO_VALIDATOR_IMAGE ?? 'autoclip-video-validator:local';
const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const workerApiSecret=randomBytes(32).toString('hex');
const validatorToken=randomBytes(32).toString('hex');
const attestationKey=randomBytes(32).toString('hex');
let edgeEnvPath;
function withTimeout(promise,ms,message) {
  let timer;
  return Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]).finally(()=>clearTimeout(timer));
}
async function stopManagedProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
  const timeout = new Promise((resolve) => { const timer=setTimeout(() => resolve(false), 10_000); timer.unref(); });
  if (await Promise.race([exited.then(() => true), timeout])) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await Promise.race([exited, new Promise((resolve) => { const timer=setTimeout(resolve, 3_000); timer.unref(); })]);
}
async function createUser(name, role = 'OWNER') {
  const email = `autoclip-${name}-${suffix}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `E2E ${name}` } });
  if (error) throw error;
  users.push(data.user.id);
  const { data: membership, error: membershipError } = await admin.from('workspace_members').select('workspace_id').eq('user_id', data.user.id).single();
  if (membershipError) throw membershipError;
  workspaces.push(membership.workspace_id);
  return { email, userId: data.user.id, workspaceId: membership.workspace_id, role };
}
let payload;
async function ensureValidator() {
  const endpoint=`${sb.API_URL}/functions/v1/media-validate`;
  const probe=async()=>{ try { return await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); } catch { return null; } };
  // `supabase start` creates the local gateway/runtime but does not reliably
  // serve this workdir's functions. Start the disposable project's functions
  // explicitly; a 401 from the handler proves readiness without a real JWT.
  edgeProcess=spawn('supabase',['functions','serve','--no-verify-jwt','--env-file',edgeEnvPath,'--workdir',disposableProjectDir],{cwd:disposableProjectDir,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
  for(let i=0;i<90;i++) {
    if(edgeProcess.exitCode!==null) throw new Error('Edge Functions locais encerraram antes do readiness.');
    const response=await probe(); if(response?.status===401) return;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  edgeProcess.kill('SIGTERM'); edgeProcess=null;
  throw new Error('media-validate não ficou disponível no Supabase descartável.');
}
async function findAvailablePort() {
  const server=createServer();
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
async function ensureVideoValidator() {
  execFileSync('docker',['build','-t',videoValidatorImage,'-f','scripts/video-validator/Dockerfile','scripts/video-validator'],{cwd:new URL('../../..',import.meta.url),stdio:'ignore'});
  const tokenPath=join(mediaDir,'validator-token');
  const attestationPath=join(mediaDir,'attestation-key');
  writeFileSync(tokenPath,validatorToken,{mode:0o600,flag:'wx'});
  writeFileSync(attestationPath,attestationKey,{mode:0o600,flag:'wx'});
  const port=await findAvailablePort();
  videoValidatorContainer=`autoclip-e2e-validator-${suffix}`;
  execFileSync('docker',[
    'run','-d','--name',videoValidatorContainer,'--network','bridge','--publish',`127.0.0.1:${port}:9782`,
    '--user','node','--read-only','--memory','768m','--memory-swap','768m','--cpus','1','--pids-limit','48',
    '--security-opt','no-new-privileges','--cap-drop','ALL','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=96m,mode=1777',
    '--mount',`type=bind,src=${tokenPath},dst=/run/secrets/video_validator_token,readonly`,
    '--mount',`type=bind,src=${attestationPath},dst=/run/secrets/video_validation_attestation_key,readonly`,
    '--env','VIDEO_VALIDATOR_TOKEN_FILE=/run/secrets/video_validator_token',
    '--env','VIDEO_VALIDATION_ATTESTATION_KEY_FILE=/run/secrets/video_validation_attestation_key',
    '--entrypoint','node',videoValidatorImage,'/opt/validator/server.mjs',
  ],{cwd:new URL('../../..',import.meta.url),stdio:'ignore'});
  const deadline=Date.now()+20_000;
  while(Date.now()<deadline) {
    const response=await fetch(`http://127.0.0.1:${port}/live`).catch(()=>null);
    if(response?.ok) break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  const live=await fetch(`http://127.0.0.1:${port}/live`).catch(()=>null);
  if(!live?.ok) throw new Error('Isolated video validator container did not start');
  workerInstanceId=randomUUID();
  const workerHealthPort=await findAvailablePort();
  videoWorkerProcess=spawn(process.execPath,['scripts/media-video-worker.mjs'],{cwd:new URL('../../..',import.meta.url),stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',env:{PATH:process.env.PATH??'',HOME:process.env.HOME??'',
    VIDEO_WORKER_API_URL:`${sb.API_URL}/functions/v1/video-worker-api`,VIDEO_WORKER_API_SECRET:workerApiSecret,
    VIDEO_VALIDATOR_URL:`http://127.0.0.1:${port}`,VIDEO_VALIDATOR_TOKEN:validatorToken,WORKER_INSTANCE_ID:workerInstanceId,VIDEO_WORKER_POLL_MS:'500',VIDEO_WORKER_ALLOW_CLOUD:'false',WORKER_HEALTH_PORT:String(workerHealthPort)}});
  let workerError=''; videoWorkerProcess.stderr.on('data',chunk=>{workerError+=chunk.toString();});
  return new Promise((resolve,reject)=>{const timer=setTimeout(resolve,1000);videoWorkerProcess.once('exit',code=>{clearTimeout(timer);reject(new Error(`Video worker saiu durante inicialização (${code}): ${workerError}`));});});
}
async function createValidatedMedia(user, filename, mime, bytes) {
  const client=createClient(sb.API_URL,sb.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const login=await client.auth.signInWithPassword({email:user.email,password});
  if(login.error) throw login.error;
  const begin=await client.rpc('begin_media_upload',{p_workspace:user.workspaceId,p_filename:filename,p_mime:mime,p_size:bytes.byteLength});
  if(begin.error) throw begin.error;
  const key=begin.data.quarantine_key;
  quarantineKeys.push({workspaceId:user.workspaceId,key});
  const upload=await client.storage.from('media-quarantine').upload(key,bytes,{contentType:mime,upsert:false});
  if(upload.error) throw upload.error;
  const validation=await client.functions.invoke('media-validate',{body:{media_id:begin.data.media_id}});
  if(validation.error) {
    const body=await validation.error.context?.json?.().catch(()=>null);
    throw new Error(`Media validation failed: ${body?.error ?? validation.error.message}`);
  }
  if(validation.data?.status==='VALIDATING') {
    const deadline=Date.now()+120_000;
    while(Date.now()<deadline) {
      const {data:current,error:pollError}=await admin.from('media_assets').select('status,validation_status,validation_error_code').eq('id',begin.data.media_id).single();
      if(pollError) throw pollError;
      if(current.status==='READY'&&current.validation_status==='VALIDATED') break;
      if(current.status==='FAILED'||current.validation_status==='REJECTED') throw new Error(`Local validator rejected media: ${current.validation_error_code}`);
      await new Promise(resolve=>setTimeout(resolve,500));
    }
  }
  const {data:asset,error}=await admin.from('media_assets').select('id,storage_key,status,validation_status').eq('id',begin.data.media_id).single();
  if(error||asset.status!=='READY'||asset.validation_status!=='VALIDATED') {
    const { data: diagnostic } = await admin.from('media_assets').select('status,validation_status,validation_error_code').eq('id',begin.data.media_id).maybeSingle();
    throw new Error(`Validated media row was not persisted (status=${diagnostic?.status ?? 'unknown'}, validation=${diagnostic?.validation_status ?? 'unknown'}, code=${diagnostic?.validation_error_code ?? 'none'}, query=${error?.code ?? 'none'})`);
  }
  finalKeys.push({workspaceId:user.workspaceId,key:asset.storage_key});
  return {id:asset.id,key:asset.storage_key};
}
try {
  try {
    lockFd = openSync(lockPath, 'wx', 0o600);
    lockOwned = true;
    writeFileSync(lockFd, JSON.stringify({ pid: process.pid, run: suffix }));
  } catch {
    throw new Error('Outra execução E2E está ativa (ou deixou lock stale) em ambiente local. Nenhuma fixture foi criada.');
  }
  edgeEnvPath = join(mediaDir, 'edge.env');
  writeFileSync(edgeEnvPath, `VIDEO_WORKER_API_SECRET=${workerApiSecret}\nVIDEO_VALIDATION_ATTESTATION_KEY=${attestationKey}\n`, { mode: 0o600, flag: 'wx' });
  await ensureValidator();
  await ensureVideoValidator();
  const ownerA = await createUser('owner-a');
  const ownerB = await createUser('owner-b');
  const { error: workspaceNameError } = await admin.from('workspaces').update({name:`E2E Workspace B ${suffix}`}).eq('id',ownerB.workspaceId);
  if (workspaceNameError) throw workspaceNameError;
  const viewer = await createUser('viewer-a', 'VIEWER');
  const { error: switchMemberError } = await admin.from('workspace_members').insert({ workspace_id: ownerB.workspaceId, user_id: ownerA.userId, role: 'EDITOR' });
  if (switchMemberError) throw switchMemberError;
  const { error: addMemberError } = await admin.from('workspace_members').insert({ workspace_id: ownerA.workspaceId, user_id: viewer.userId, role: 'VIEWER' });
  if (addMemberError) throw addMemberError;
  const { data: channelA, error: channelError } = await admin.from('channels').insert({ workspace_id: ownerA.workspaceId, display_name: `E2E fixture ${suffix}`, provider_user_id: `e2e-${suffix}`, connection_status: 'CONNECTED', authorized_at: new Date().toISOString(), last_validated_at: new Date().toISOString(), creator_info_at: new Date().toISOString(), creator_info: { privacy_level_options:['SELF_ONLY'],comment_disabled:false,duet_disabled:false,stitch_disabled:false,max_video_post_duration_sec:600 } }).select('id').single();
  if (channelError) throw channelError;
  const { data: channelB, error: channelBError } = await admin.from('channels').insert({ workspace_id: ownerB.workspaceId, display_name: `PRIVATE E2E ${suffix}`, provider_user_id: `private-${suffix}`, connection_status: 'CONNECTED', authorized_at: new Date().toISOString(), last_validated_at: new Date().toISOString(), creator_info_at: new Date().toISOString(), creator_info: { privacy_level_options:['SELF_ONLY'],comment_disabled:false,duet_disabled:false,stitch_disabled:false,max_video_post_duration_sec:600 } }).select('id').single();
  if (channelBError) throw channelBError;
  const { data: group, error: groupError } = await admin.from('account_groups').insert({ workspace_id: ownerA.workspaceId, name: `E2E group ${suffix}`, created_by: ownerA.userId }).select('id').single();
  if (groupError) throw groupError;
  const { error: memberError } = await admin.from('account_group_members').insert({ workspace_id: ownerA.workspaceId, group_id: group.id, channel_id: channelA.id });
  if (memberError) throw memberError;
  await admin.from('workspace_settings').update({publish_mode:'DIRECT'}).eq('workspace_id',ownerA.workspaceId);
  await admin.from('workspace_settings').update({publish_mode:'DIRECT'}).eq('workspace_id',ownerB.workspaceId);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=360x360', '-frames:v', '1', join(mediaDir, 'fixture.png')]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', join(mediaDir, 'fixture.png'), join(mediaDir, 'fixture.jpg')]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', join(mediaDir, 'fixture.png'), join(mediaDir, 'fixture.webp')]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=360x640:d=2', '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', join(mediaDir, 'fixture.mp4')]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=360x360:d=1', '-c:v', 'mpeg4', '-q:v', '5', '-movflags', '+faststart', join(mediaDir, 'mpeg4.mp4')]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=360x360:r=1:d=601', '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '1', '-movflags', '+faststart', join(mediaDir, 'long.mp4')]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=4200x360:d=1', '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '1', '-movflags', '+faststart', join(mediaDir, 'wide.mp4')]);
  const { readFileSync } = await import('node:fs');
  const png = readFileSync(join(mediaDir, 'fixture.png'));
  const fixtureMediaFilename=`fixture-primary-${suffix}.png`;
  const primaryMedia=await createValidatedMedia(ownerA,fixtureMediaFilename,'image/png',png);
  const foreignMedia=await createValidatedMedia(ownerB,'foreign.png','image/png',png);
  const mp4=readFileSync(join(mediaDir,'fixture.mp4'));
  const videoA=await createValidatedMedia(ownerA,`fixture-video-${suffix}.mp4`,'video/mp4',mp4);
  const videoB=await createValidatedMedia(ownerB,`fixture-video-b-${suffix}.mp4`,'video/mp4',mp4);
  const {data:workspaceB}=await admin.from('workspaces').select('name').eq('id',ownerB.workspaceId).single();
  payload = { apiUrl: sb.API_URL, anonKey: sb.ANON_KEY, password, ownerA, ownerB, viewer, fixture: suffix, mediaDir, workspaceBName:workspaceB.name, foreignChannelId: channelB.id, fixtureObject: primaryMedia.key, fixtureMediaId:primaryMedia.id, fixtureMediaFilename, fixtureVideoObject:videoA.key, fixtureVideoId:videoA.id, fixtureVideoFilename:`fixture-video-${suffix}.mp4`, foreignObject:foreignMedia.key, foreignMediaId:foreignMedia.id, foreignMediaFilename:'foreign.png', foreignVideoId:videoB.id, foreignVideoFilename:`fixture-video-b-${suffix}.mp4`, users, workspaces };
  writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600, flag: 'wx' });
  const args = process.argv.slice(2);
  const webDir = resolve(repoRoot, 'apps/web');
  execFileSync('npm', ['run', 'build'], {
    cwd: webDir,
    stdio: 'inherit',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      VITE_SUPABASE_URL: sb.API_URL,
      VITE_SUPABASE_ANON_KEY: sb.ANON_KEY,
    },
  });
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(command, ['playwright', 'test', ...args], { cwd: new URL('..', import.meta.url), stdio: 'inherit', env: { PATH: process.env.PATH??'', HOME: process.env.HOME??'', E2E_FIXTURE_FILE: tmp, E2E_SUPABASE_URL: sb.API_URL, E2E_SUPABASE_ANON_KEY: sb.ANON_KEY, E2E_WEB_PORT: process.env.E2E_WEB_PORT, E2E_BASE_URL: process.env.E2E_BASE_URL } });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  const cleanupErrors=[];
  const cleanup = async (label, operation) => {
    try { const result=await withTimeout(operation(),15_000,'cleanup timeout'); if(result?.error) throw result.error; }
    catch(error) { cleanupErrors.push(label); process.stderr.write(`Fixture cleanup warning (${label}): ${error.message}\n`); }
  };
  try {
    await stopManagedProcess(videoWorkerProcess);
    videoWorkerProcess=null;
    if(videoValidatorContainer) {
      try { execFileSync('docker',['rm','--force',videoValidatorContainer],{stdio:'ignore'}); }
      catch(error) { if(error.status!==1) { cleanupErrors.push('validator container cleanup'); process.stderr.write('Fixture cleanup warning (validator container).\n'); } }
      videoValidatorContainer=null;
    }
    if(workerInstanceId) await cleanup('worker heartbeat',()=>admin.from('media_validation_workers').delete().eq('instance_id',workerInstanceId));
    if (users.length) {
      for (const workspaceId of workspaces) {
        await cleanup('fixture publication jobs',()=>admin.from('publication_jobs').delete().eq('workspace_id',workspaceId));
        const assetResult = await withTimeout(admin.from('media_assets').select('id,storage_key').eq('workspace_id', workspaceId),15_000,'cleanup timeout').catch(error=>{cleanupErrors.push('media inventory');process.stderr.write(`Fixture cleanup warning (media inventory): ${error.message}\n`);return {data:[]};});
        for (const asset of assetResult.data ?? []) {
          await cleanup('final media objects',()=>admin.storage.from('media').remove([asset.storage_key]));
          await cleanup('quarantine objects',()=>admin.storage.from('media-quarantine').remove([`${workspaceId}/${asset.id}/upload`]));
        }
      }
      const workspaceResult=await withTimeout(admin.from('workspaces').select('id').in('owner_user_id', users),15_000,'cleanup timeout').catch(error=>{cleanupErrors.push('workspace inventory');process.stderr.write(`Fixture cleanup warning (workspace inventory): ${error.message}\n`);return {data:[]};});
      const cleanupWorkspaceIds=[...new Set([...workspaces,...(workspaceResult.data??[]).map(row=>row.id)])];
      if(cleanupWorkspaceIds.length) await cleanup('fixture workspaces',()=>admin.from('workspaces').delete().in('id',cleanupWorkspaceIds));
      for(const id of users) await cleanup('fixture user',()=>admin.auth.admin.deleteUser(id));
    }
  } finally {
    rmSync(mediaDir, { recursive: true, force: true });
    if (existsSync(tmp)) unlinkSync(tmp);
    await stopManagedProcess(edgeProcess);
    edgeProcess=null;
    try { closeSync(lockFd); } catch {}
    if (lockOwned && existsSync(lockPath)) unlinkSync(lockPath);
  }
  if(cleanupErrors.length) process.exitCode=1;
}
