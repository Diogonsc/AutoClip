import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function envFrom(text) {
  const out={};
  for(const line of text.split(/\r?\n/)){const match=line.match(/^([A-Z0-9_]+)=(.*)$/);if(match)out[match[1]]=match[2].replace(/^['"]|['"]$/g,'');}
  return out;
}
function run(command,args,options={}) { const result=spawnSync(command,args,{encoding:'utf8',...options});if(result.status!==0)throw new Error((result.stderr||result.stdout||`${command} exited ${result.status}`).trim());return result.stdout; }
const status=run('supabase',['status','-o','env']);
const env=envFrom(status);
for(const [value,label] of [[env.API_URL,'Supabase API'],[env.DB_URL,'PostgreSQL']]) {const host=new URL(value).hostname;if(!['localhost','127.0.0.1','::1'].includes(host))throw new Error(`${label} não é local; abortando antes de qualquer operação.`);}
if(!env.SERVICE_ROLE_KEY)throw new Error('Supabase local não forneceu service role; abortando.');
const root=resolve(import.meta.dirname,'..');
const sql=run('psql',[env.DB_URL,'-X','-v','ON_ERROR_STOP=1','-A','-t','-f',resolve(root,'scripts/inventory_legacy_media.sql')]);
process.stdout.write('Inventário de mídia (somente leitura, Supabase local):\n');
process.stdout.write(sql.trim()||'[]');
process.stdout.write('\n');
if(!process.argv.includes('--apply-local')) {
  process.stdout.write('Dry-run concluído: nenhuma linha, quota, job ou objeto foi alterado. Use --apply-local explicitamente apenas para mídia fictícia no ambiente local.\n');
  process.exit(0);
}
const workspaceIndex=process.argv.indexOf('--workspace');
const workspaceId=workspaceIndex>=0?process.argv[workspaceIndex+1]:null;
if(!workspaceId||!/^[0-9a-f-]{36}$/i.test(workspaceId))throw new Error('Aplicação local exige --workspace <UUID>; nenhum escopo global é inferido.');
const image='autoclip-video-validator:local';
const inspect=spawnSync('docker',['image','inspect',image],{stdio:'ignore'});
if(inspect.status!==0) run('docker',['build','-t',image,'-f','scripts/video-validator/Dockerfile','scripts/video-validator'],{cwd:root,stdio:'inherit'});
const admin=createClient(env.API_URL,env.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:candidates,error:candidateError}=await admin.from('media_assets').select('id,workspace_id,mime_type').eq('workspace_id',workspaceId).eq('status','READY').eq('validation_status','UNVERIFIED').is('storage_deleted_at',null).order('created_at').order('id');
if(candidateError)throw candidateError;
const scratch=await mkdtemp(join(tmpdir(),'autoclip-legacy-validation-'));
const runValidator=(path,mime)=>{
  const result=spawnSync('docker',['run','--rm','--network','none','--memory','512m','--memory-swap','512m','--cpus','1','--pids-limit','32','--read-only','--security-opt','no-new-privileges','--cap-drop','ALL','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=32m',
    '--mount',`type=bind,src=${path},dst=/input/media,readonly`,image,'/input/media',mime],{cwd:root,encoding:'utf8',timeout:150_000});
  if(result.error)throw result.error;
  if(result.status!==0)throw Object.assign(new Error(result.stderr.trim().split(/\s+/).at(-1)||'LEGACY_VALIDATION_FAILED'),{invalid:true});
  return JSON.parse(result.stdout);
};
let processed=0;let rejected=0;
try {
  for(const candidate of candidates??[]) {
    const {data:claimed,error:claimError}=await admin.rpc('claim_legacy_media_revalidation',{p_media_id:candidate.id});
    if(claimError)throw claimError;
    const lease=claimed?.[0];if(!lease)continue;
    try {
      const {data:blob,error:downloadError}=await admin.storage.from(lease.storage_source).download(lease.storage_key);
      if(downloadError||!blob)throw Object.assign(new Error('LEGACY_OBJECT_MISSING'),{invalid:true});
      if(blob.size<=0||blob.size!==Number(lease.file_size_bytes))throw Object.assign(new Error('LEGACY_OBJECT_SIZE_MISMATCH'),{invalid:true});
      const bytes=new Uint8Array(await blob.arrayBuffer());
      if(bytes.byteLength!==Number(lease.file_size_bytes))throw Object.assign(new Error('LEGACY_OBJECT_SIZE_MISMATCH'),{invalid:true});
      const input=join(scratch,`${randomUUID()}.media`);await writeFile(input,bytes,{mode:0o600,flag:'wx'});
      try {
        const proof=runValidator(input,lease.mime_type);
        const sha256=createHash('sha256').update(bytes).digest('hex');
        const {error:completeError}=await admin.rpc('complete_legacy_media_revalidation',{
          p_media_id:lease.media_id,p_claim_token:lease.claim_token,p_size:bytes.byteLength,p_sha256:sha256,
          p_mime:proof.mime,p_codec:proof.codec??null,p_duration:proof.duration??null,p_width:proof.width,p_height:proof.height,
          p_validator_version:`${proof.validatorVersion}-local-one-shot`,
        });
        if(completeError)throw completeError;
        processed++;
      } finally { await rm(input,{force:true}); }
    } catch(error) {
      const code=error?.message&&/^[A-Z0-9_]{1,64}$/.test(error.message)?error.message:'LEGACY_REVALIDATION_RETRYABLE';
      const rpc=error?.invalid?'reject_video_media_validation':'release_media_validation_claim';
      const args=error?.invalid?{p_media_id:lease.media_id,p_claim_token:lease.claim_token,p_code:code}:{p_media_id:lease.media_id,p_claim_token:lease.claim_token,p_error_code:code};
      const {error:stateError}=await admin.rpc(rpc,args);
      if(stateError)throw new Error(`${code}; claim recovery failed: ${stateError.message}`);
      if(error?.invalid)rejected++;
    }
  }
} finally { await rm(scratch,{recursive:true,force:true}); }
process.stdout.write(`Aplicação local explícita concluída: ${processed} mídia(s) revalidadas, ${rejected} rejeitada(s); IDs, objetos, jobs e quotas foram preservados. Esta ferramenta one-shot usa service role somente do Supabase local; não é o worker residente.\n`);
