import { execFileSync, spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = resolve(root, 'deploy/local-worker');
const localHost = value => ['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname);
const statusText = execFileSync('supabase', ['status', '-o', 'env'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const status = Object.fromEntries(statusText.split(/\r?\n/).flatMap(line => { const i=line.indexOf('='); return i<0?[]:[[line.slice(0,i),line.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]]; }));
if (!status.API_URL || !status.ANON_KEY || !status.SERVICE_ROLE_KEY || !localHost(status.API_URL) || !localHost(status.DB_URL)) throw new Error('Recusa fechada: este ensaio usa somente Supabase local.');
const api = status.API_URL.replace(/\/$/, '');
const instance = randomUUID();
const suffix = randomBytes(6).toString('hex');
const email = `autoclip-worker-${suffix}@example.test`;
const password = `LocalWorker-${randomBytes(18).toString('hex')}!`;
const secretDir=resolve(workerDir,'secrets');
const secretValue=name=>readFile(join(secretDir,name),'utf8').then(value=>value.trim()).catch(()=>randomBytes(32).toString('hex'));
const apiSecret=await secretValue('video_worker_api_secret');
const validatorToken=await secretValue('video_validator_token');
const attestationKey=await secretValue('video_validation_attestation_key');
const project = `autoclip-task-${process.pid}-${suffix}`;
const temp = await mkdtemp(join(tmpdir(), `autoclip-task-${suffix}-`));
const composeEnv = join(temp, '.env');
const edgeEnv = join(temp, 'edge.env');
const service = createClient(api, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const composeBase = ['compose', '--project-name', project, '--project-directory', workerDir, '-f', resolve(workerDir, 'compose.yaml'), '--env-file', composeEnv];
let edge;
let userId;
let workspaceId;
let mediaId;
let mediaKey;
let apiWorkerPort;
let stopped = false;

function run(command, args, options = {}) { return execFileSync(command, args, { cwd: root, stdio: options.stdio ?? 'pipe', encoding: options.encoding ?? 'utf8', timeout: options.timeout ?? 300_000 }); }
async function port() {
  const s=createServer(); await new Promise((resolvePromise,reject)=>s.once('error',reject).listen(0,'127.0.0.1',resolvePromise));
  const value=s.address().port; await new Promise(resolvePromise=>s.close(resolvePromise)); return value;
}
async function waitFor(predicate, description, timeout=120_000) {
  const end=Date.now()+timeout; let last;
  while(Date.now()<end) { try { last=await predicate(); if(last) return last; } catch(error) { last=error.message; } await new Promise(resolvePromise=>setTimeout(resolvePromise,500)); }
  throw new Error(`Timeout aguardando ${description}: ${typeof last==='string'?last:'condição não satisfeita'}`);
}
async function signedApi(body, nonce=randomUUID(), timestamp=Math.floor(Date.now()/1000)) {
  const raw=JSON.stringify(body); const endpoint=`${api}/functions/v1/video-worker-api`;
  const sig=createHmac('sha256',apiSecret).update(`POST\n/video-worker-api\n${timestamp}\n${nonce}\n${createHash('sha256').update(raw).digest('hex')}`).digest('hex');
  return fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-worker-timestamp':String(timestamp),'x-worker-nonce':nonce,'x-worker-signature':sig},body:raw});
}
async function startEdge() {
  const endpoint=`${api}/functions/v1/video-worker-api`;
  const existing=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).catch(()=>null);
  const existingBody=await existing?.json().catch(()=>({}));
  if(existing?.status===401&&existingBody?.error==='worker_request_expired_or_invalid') return;
  edge=spawn('supabase',['functions','serve','--no-verify-jwt','--env-file',edgeEnv],{cwd:root,stdio:['ignore','pipe','pipe']});
  let errors=''; edge.stderr.on('data',chunk=>{ errors+=chunk.toString(); });
  await waitFor(async()=>{
    if(edge.exitCode!==null) throw new Error(errors.slice(-1200));
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).catch(()=>null);
    if(response?.status===401) { const b=await response.json().catch(()=>({})); return b.error==='worker_request_expired_or_invalid'; }
    return false;
  },'Edge Function local video-worker-api',90_000);
}
async function stopEdge() {
  if(!edge||edge.exitCode!==null) return;
  const child=edge; edge=undefined;
  await new Promise(resolvePromise=>{ const timer=setTimeout(()=>child.kill('SIGKILL'),10_000); child.once('close',()=>{clearTimeout(timer);resolvePromise();}); child.kill('SIGTERM'); });
}

try {
  const pending=await service.from('media_assets').select('id',{count:'exact',head:true}).eq('status','UPLOADING').in('validation_status',['PENDING','VALIDATING']);
  if(pending.error) throw pending.error;
  if(pending.count!==0) throw new Error(`Fila local contém ${pending.count} mídia(s) pendente(s); não processarei tarefas alheias ao teste.`);
  const activeCutoff=new Date(Date.now()-120_000).toISOString();
  const activeWorkers=await service.from('media_validation_workers').select('instance_id,status,last_heartbeat_at')
    .in('status',['ONLINE','DEGRADED']).gte('last_heartbeat_at',activeCutoff).limit(20);
  if(activeWorkers.error) throw activeWorkers.error;
  const competingWorkers=(activeWorkers.data??[]).filter(worker=>worker.instance_id!==instance);
  if(competingWorkers.length) throw new Error(`Execução recusada: ${competingWorkers.length} outro(s) worker(s) de validação ativo(s) pode(m) consumir a fixture; pare-os manualmente e repita.`);

  const created=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:`Worker fixture ${suffix}`}});
  if(created.error) throw created.error;
  userId=created.data.user.id;
  const membership=await service.from('workspace_members').select('workspace_id').eq('user_id',userId).single();
  if(membership.error) throw membership.error;
  workspaceId=membership.data.workspace_id;
  const client=createClient(api,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const login=await client.auth.signInWithPassword({email,password});
  if(login.error) throw login.error;

  const fixture=join(temp,'fixture-h264-aac.mp4');
  run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=360x640:rate=25','-f','lavfi','-i','sine=frequency=1000:sample_rate=44100','-t','4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-y',fixture],{timeout:60_000});
  const original=await readFile(fixture);
  const begun=await client.rpc('begin_media_upload',{p_workspace:workspaceId,p_filename:'compose-validation-fixture.mp4',p_mime:'video/mp4',p_size:original.byteLength});
  if(begun.error) throw begun.error;
  mediaId=begun.data.media_id; mediaKey=begun.data.storage_key;
  const uploaded=await client.storage.from('media-quarantine').upload(begun.data.quarantine_key,original,{contentType:'video/mp4',upsert:false});
  if(uploaded.error) throw uploaded.error;

  const workerSecretPath=join(temp,'worker-api-secret');
  const validatorTokenPath=join(temp,'validator-token');
  const attestationPath=join(temp,'attestation-key');
  await writeFile(workerSecretPath,apiSecret,{mode:0o600,flag:'wx'});
  await writeFile(validatorTokenPath,validatorToken,{mode:0o600,flag:'wx'});
  await writeFile(attestationPath,attestationKey,{mode:0o600,flag:'wx'});
  await writeFile(edgeEnv,`VIDEO_WORKER_API_SECRET=${apiSecret}\nVIDEO_VALIDATION_ATTESTATION_KEY=${attestationKey}\n`,{mode:0o600,flag:'wx'});
  apiWorkerPort=await port();
  await writeFile(composeEnv,[
    `VIDEO_WORKER_API_URL=http://host.docker.internal:54321/functions/v1/video-worker-api`,
    `VIDEO_WORKER_API_SECRET_FILE=${workerSecretPath}`,
    `VIDEO_VALIDATOR_TOKEN_FILE=${validatorTokenPath}`,
    `VIDEO_VALIDATION_ATTESTATION_KEY_FILE=${attestationPath}`,
    'VIDEO_WORKER_ALLOW_CLOUD=false',`WORKER_INSTANCE_ID=${instance}`,
    `WORKER_HEALTH_HOST_PORT=${apiWorkerPort}`,
  ].join('\n')+'\n',{mode:0o600,flag:'wx'});

  await startEdge();
  const queuedValidation=await client.functions.invoke('media-validate',{body:{media_id:mediaId}});
  if(queuedValidation.error||queuedValidation.data?.status!=='VALIDATING') {
    throw new Error(`Edge Function did not register uploaded object for validation: ${queuedValidation.error?.message??queuedValidation.data?.status??'unknown response'}`);
  }
  const invalid=await fetch(`${api}/functions/v1/video-worker-api`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  if(invalid.status!==401) throw new Error(`API aceitou request sem assinatura (HTTP ${invalid.status})`);
  const firstNonce=randomUUID();
  const replayPayload={action:'heartbeat',instance_id:randomUUID(),version:'3.6.1-test',status:'ONLINE',metrics:{processing:0,errors:0,average_ms:0,last_completed_at:null}};
  const first=await signedApi(replayPayload,firstNonce);
  const replay=await signedApi(replayPayload,firstNonce);
  if(!first.ok||replay.status!==401) throw new Error('Replay do mesmo nonce não foi rejeitado');
  await service.from('media_validation_workers').delete().eq('instance_id',replayPayload.instance_id);
  const expired=await signedApi({action:'claim'},randomUUID(),Math.floor(Date.now()/1000)-120);
  if(expired.status!==401) throw new Error('Assinatura expirada foi aceita');

  run('docker',['build','-t','autoclip-video-validator:3.6.1','-f',resolve(root,'scripts/video-validator/Dockerfile'),resolve(root,'scripts/video-validator')],{timeout:300_000});
  run('docker',['compose',...composeBase.slice(1),'config','--quiet']);
  run('docker',['compose',...composeBase.slice(1),'up','-d','--build'],{timeout:300_000});
  await waitFor(async()=>{
    const row=await service.from('media_validation_workers').select('status,last_heartbeat_at,pending_count,processing_count')
      .eq('instance_id',instance).maybeSingle();
    if(row.error) throw row.error;
    return row.data?.status==='ONLINE'&&row.data.last_heartbeat_at&&row.data.processing_count===0?row.data:false;
  },'heartbeat inicial do worker exclusivo do teste',40_000);
  const media=await waitFor(async()=>{
    const result=await service.from('media_assets').select('id,status,validation_status,checksum_sha256,file_size_bytes,detected_mime_type,detected_video_codec,validated_at,validator_version').eq('id',mediaId).single();
    if(result.error) throw result.error;
    return result.data.status==='READY'&&result.data.validation_status==='VALIDATED'?result.data:false;
  },'a tarefa real ser validada e promovida',90_000);
  const final=await service.storage.from('media').download(mediaKey);
  if(final.error||!final.data) throw new Error('Objeto promovido não está acessível ao backend local');
  const finalBytes=new Uint8Array(await final.data.arrayBuffer());
  const finalHash=createHash('sha256').update(finalBytes).digest('hex');
  if(finalHash!==media.checksum_sha256||finalBytes.byteLength!==Number(media.file_size_bytes)||finalHash!==createHash('sha256').update(original).digest('hex')) throw new Error('Hash/tamanho do objeto final não corresponde ao objeto original validado');
  const quarantine=await service.storage.from('media-quarantine').download(`${workspaceId}/${mediaId}/upload`);
  if(!quarantine.error) throw new Error('Objeto de quarentena não foi removido após confirmação READY');
  if(media.detected_mime_type!=='video/mp4'||media.detected_video_codec!=='h264'||!media.validated_at||!media.validator_version) throw new Error('Metadados de validação incompletos');

  const completedHeartbeat=await waitFor(async()=>{
    const row=await service.from('media_validation_workers').select('status,last_completed_at,pending_count,processing_count').eq('instance_id',instance).single();
    if(row.error) throw row.error;
    return row.data.last_completed_at&&row.data.pending_count===0&&row.data.processing_count===0?row.data:false;
  },'heartbeat de conclusão persistido',40_000);
  if(!completedHeartbeat.last_completed_at) throw new Error('Heartbeat final do worker exclusivo não confirma conclusão da tarefa.');
  const logs=run('docker',['compose',...composeBase.slice(1),'logs','--no-color','worker']);
  if(!logs.includes('"event":"worker_heartbeat"')) {
    const eventNames=[...logs.matchAll(/"event":"([A-Za-z0-9_-]+)"/g)].map(match=>match[1]);
    const state=run('docker',['compose',...composeBase.slice(1),'ps','-q','worker']).trim();
    const inspection=state?run('docker',['inspect','--format','{{json .State}}|{{.HostConfig.LogConfig.Type}}',state]).trim():'sem container';
    throw new Error(`Logs do worker não contêm heartbeat operacional (eventos=${JSON.stringify(eventNames)}, log_bytes=${Buffer.byteLength(logs)}, estado=${inspection.slice(0,700)})`);
  }
  console.log(JSON.stringify({result:'PASS',integration:'real local Compose task',format:'MP4/H.264 + AAC',bytes:finalBytes.byteLength,sha256:finalHash,validationStatus:media.validation_status,apiAuth:'HMAC + timestamp + nonce; missing/expired/replay rejected',workerContainerHasServiceRole:false,quarantineRemoved:true}));
} catch(error) {
  console.error(`FAIL Compose task integration: ${error.message}`);
  process.exitCode=1;
} finally {
  try { run('docker',['compose',...composeBase.slice(1),'down'],{timeout:60_000}); } catch { /* unique compose project only */ }
  await stopEdge().catch(()=>{});
  if(workspaceId) {
    try {
      await service.storage.from('media').remove([mediaKey].filter(Boolean));
      if(mediaId) await service.storage.from('media-quarantine').remove([`${workspaceId}/${mediaId}/upload`]);
      if(instance) await service.from('media_validation_workers').delete().eq('instance_id',instance);
      await service.from('publication_jobs').delete().eq('workspace_id',workspaceId);
      await service.from('media_assets').delete().eq('workspace_id',workspaceId);
      await service.from('workspaces').delete().eq('id',workspaceId);
    } catch { process.stderr.write('Fixture cleanup requer verificação manual no banco local.\n'); process.exitCode=1; }
  }
  if(userId) { const deleted=await service.auth.admin.deleteUser(userId); if(deleted.error) process.exitCode=1; }
  await rm(temp,{recursive:true,force:true});
}
