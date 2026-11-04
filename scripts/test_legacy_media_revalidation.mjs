import { spawnSync, execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function envFrom(text){const out={};for(const line of text.split(/\r?\n/)){const match=line.match(/^([A-Z0-9_]+)=(.*)$/);if(match)out[match[1]]=match[2].replace(/^['"]|['"]$/g,'');}return out;}
function assert(value,message){if(!value)throw new Error(message);}
const status=spawnSync('supabase',['status','-o','env'],{encoding:'utf8'});
assert(status.status===0,'Supabase local deve estar ativo');
const env=envFrom(status.stdout);
for(const [url,label] of [[env.API_URL,'Supabase API'],[env.DB_URL,'PostgreSQL']])assert(['localhost','127.0.0.1','::1'].includes(new URL(url).hostname),`${label} não é local: abortado`);
assert(env.SERVICE_ROLE_KEY&&env.ANON_KEY,'Chaves locais não encontradas');
const admin=createClient(env.API_URL,env.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const suffix=randomBytes(5).toString('hex'); const password=`LegacyE2E-${randomBytes(16).toString('hex')}!`;
const email=`legacy-${suffix}@example.test`; const userId=randomUUID(); const workspaceIds=[]; const keys=[]; const temp=await mkdtemp(join(tmpdir(),'autoclip-legacy-'));
let failure;
try {
  const created=await admin.auth.admin.createUser({id:userId,email,password,email_confirm:true,user_metadata:{display_name:'Legacy fixture'}});
  if(created.error)throw created.error;
  const member=await admin.from('workspace_members').select('workspace_id').eq('user_id',userId).single();
  if(member.error)throw member.error;
  const workspaceId=member.data.workspace_id;workspaceIds.push(workspaceId);
  const channelId=randomUUID();
  const channel=await admin.from('channels').insert({id:channelId,workspace_id:workspaceId,display_name:`Legacy fixture ${suffix}`,provider_user_id:`legacy-${suffix}`,connection_status:'CONNECTED',creator_info:{privacy_level_options:['SELF_ONLY'],comment_disabled:false,duet_disabled:false,stitch_disabled:false,max_video_post_duration_sec:600}});
  if(channel.error)throw channel.error;
  const settings=await admin.from('workspace_settings').update({publish_mode:'DIRECT'}).eq('workspace_id',workspaceId);if(settings.error)throw settings.error;
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=green:s=360x640:d=2','-c:v','libx264','-profile:v','high','-pix_fmt','yuv420p','-r','30','-movflags','+faststart',join(temp,'legacy.mp4')]);
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=360x360','-frames:v','1',join(temp,'legacy.png')]);
  const client=createClient(env.API_URL,env.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const login=await client.auth.signInWithPassword({email,password});if(login.error)throw login.error;
  const userClient=createClient(env.API_URL,env.ANON_KEY,{global:{headers:{Authorization:`Bearer ${login.data.session.access_token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const fixtureAssets=[];
  for(const [filename,mime] of [['legacy.mp4','video/mp4'],['legacy.png','image/png']]){
    const bytes=await readFile(join(temp,filename));const id=randomUUID();const key=`${workspaceId}/${id}/original.${filename.endsWith('.mp4')?'mp4':'png'}`;keys.push(key);
    const uploaded=await admin.storage.from('media').upload(key,bytes,{contentType:mime,upsert:false});if(uploaded.error)throw uploaded.error;
    const inserted=await admin.from('media_assets').insert({id,workspace_id:workspaceId,original_filename:`${suffix}-${filename}`,storage_key:key,mime_type:mime,file_size_bytes:bytes.length,duration_seconds:filename.endsWith('.mp4')?2:null,width:360,height:filename.endsWith('.mp4')?640:360,status:'READY',created_by:userId,validation_status:'VALIDATED',checksum_sha256:createHash('sha256').update(bytes).digest('hex'),detected_mime_type:mime,detected_video_codec:filename.endsWith('.mp4')?'h264':null,validated_at:new Date().toISOString(),validator_version:'legacy-fixture'});
    if(inserted.error)throw inserted.error;fixtureAssets.push({id,mime});
  }
  const scheduledAt=new Date(Date.now()+3*86400000).toISOString();
  const confirmation=await userClient.rpc('confirm_publication_batch',{p_workspace:workspaceId,p_idempotency_key:randomUUID(),p_items:[{channel_id:channelId,media_asset_id:fixtureAssets[0].id,scheduled_at:scheduledAt,timezone:'UTC',caption:'legacy fixture job',privacy_level:'SELF_ONLY',allow_comment:true,allow_duet:false,allow_stitch:false,brand_content:false,brand_organic:false,music_rights_confirmed:true}],p_metadata:{strategy:'SEQUENTIAL',label:'fixture legado'}});
  if(confirmation.error)throw confirmation.error;
  const job=await admin.from('publication_jobs').select('id,batch_id,status').eq('workspace_id',workspaceId).single();if(job.error)throw job.error;
  const reservationBefore=await admin.from('publication_quota_reservations').select('id,status').eq('publication_job_id',job.data.id).single();if(reservationBefore.error)throw reservationBefore.error;
  assert(reservationBefore.data.status==='RESERVED','fixture de job deve ter reserva');
  const unverified=await admin.from('media_assets').update({validation_status:'UNVERIFIED'}).in('id',fixtureAssets.map(a=>a.id));if(unverified.error)throw unverified.error;
  const blocked=await admin.from('publication_jobs').update({status:'BLOCKED_PERMISSION',last_error_code:'MEDIA_VALIDATION_REQUIRED',last_error_message:'fixture legado'}).eq('id',job.data.id);if(blocked.error)throw blocked.error;

  const root=resolve(import.meta.dirname,'..');
  const dry=spawnSync(process.execPath,[resolve(root,'scripts/revalidate_legacy_media.mjs')],{cwd:root,encoding:'utf8'});
  if(dry.status!==0)throw new Error(`Inventário dry-run falhou: ${dry.stderr||dry.stdout}`);
  const unchanged=await admin.from('media_assets').select('id,validation_status').in('id',fixtureAssets.map(a=>a.id));
  assert(unchanged.data?.every(a=>a.validation_status==='UNVERIFIED'),'dry-run alterou mídia');
  const image='autoclip-video-validator:local';
  const inspect=spawnSync('docker',['image','inspect',image],{stdio:'ignore'});
  if(inspect.status!==0)execFileSync('docker',['build','-t',image,'-f','scripts/video-validator/Dockerfile','scripts/video-validator'],{cwd:root,stdio:'inherit'});
  const apply=spawnSync(process.execPath,[resolve(root,'scripts/revalidate_legacy_media.mjs'),'--apply-local','--workspace',workspaceId],{cwd:root,encoding:'utf8'});
  if(apply.status!==0)throw new Error(`Revalidação local falhou: ${apply.stderr||apply.stdout}`);
  const validated=await admin.from('media_assets').select('id,status,validation_status,checksum_sha256,detected_mime_type,detected_video_codec').in('id',fixtureAssets.map(a=>a.id));
  assert(validated.data?.length===2&&validated.data.every(a=>a.status==='READY'&&a.validation_status==='VALIDATED'&&/^[a-f0-9]{64}$/.test(a.checksum_sha256??'')),'mídias legadas não foram revalidadas');
  const unchangedJob=await admin.from('publication_jobs').select('id,batch_id,status,last_error_code').eq('id',job.data.id).single();
  assert(unchangedJob.data?.id===job.data.id&&unchangedJob.data.batch_id===job.data.batch_id&&unchangedJob.data.status==='BLOCKED_PERMISSION'&&unchangedJob.data.last_error_code==='MEDIA_VALIDATION_REQUIRED','revalidação alterou job ou histórico');
  const reservationAfter=await admin.from('publication_quota_reservations').select('id,status').eq('publication_job_id',job.data.id).single();
  assert(reservationAfter.data?.id===reservationBefore.data.id&&reservationAfter.data.status==='RESERVED','revalidação alterou reserva');
  const resumed=await userClient.rpc('resume_media_validation_blocked_jobs',{p_workspace:workspaceId,p_job_ids:[job.data.id]});
  if(resumed.error)throw resumed.error;
  const resumedJob=await admin.from('publication_jobs').select('status,last_error_code').eq('id',job.data.id).single();
  assert(resumedJob.data?.status==='SCHEDULED'&&resumedJob.data.last_error_code===null,'reconciliação explícita não reativou job');
  const reservationResumed=await admin.from('publication_quota_reservations').select('id,status').eq('publication_job_id',job.data.id).single();
  assert(reservationResumed.data?.id===reservationBefore.data.id&&reservationResumed.data.status==='RESERVED','reconciliação duplicou ou liberou reserva');
  process.stdout.write('Legacy revalidation local passou: dry-run sem alterações; vídeo MP4 e PNG revalidados no mesmo ID; job/lote/histórico/reserva preservados; retomada explícita sem reserva duplicada.\n');
} catch(error){failure=error;}
finally {
  for(const workspaceId of workspaceIds){const deleted=await admin.from('publication_jobs').delete().eq('workspace_id',workspaceId);if(deleted.error)throw deleted.error;}
  for(const key of keys)await admin.storage.from('media').remove([key]);
  for(const workspaceId of workspaceIds){const deleted=await admin.from('workspaces').delete().eq('id',workspaceId);if(deleted.error)throw deleted.error;}
  const deletedUser=await admin.auth.admin.deleteUser(userId);if(deletedUser.error)throw deletedUser.error;
  await rm(temp,{recursive:true,force:true});
}
if(failure)throw failure;
