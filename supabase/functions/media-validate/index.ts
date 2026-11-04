import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, isUuid, json, parseOrigins } from '../_shared/http.ts';
import { MEDIA_VALIDATOR_VERSION, validateImage } from '../_shared/media-validation.ts';

const url=Deno.env.get('SUPABASE_URL')!;
const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=parseOrigins(Deno.env.get('WEB_URL'));

Deno.serve(async req=>{
  const headers=corsHeaders(req.headers.get('origin'),origins);
  if(req.method==='OPTIONS') return new Response('ok',{headers});
  if(req.method!=='POST') return json({error:'method_not_allowed'},405,headers);
  const auth=req.headers.get('authorization')??'';
  const token=auth.match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token) return json({error:'authentication_required'},401,headers);
  const {data:userData,error:userError}=await service.auth.getUser(token);
  if(userError||!userData.user) return json({error:'authentication_invalid'},401,headers);
  let body:unknown;
  try { body=await req.json(); } catch { return json({error:'invalid_json'},400,headers); }
  const mediaId=(body as {media_id?:unknown})?.media_id;
  if(!isUuid(mediaId)) return json({error:'media_id_invalid'},400,headers);

  const {data:media,error:mediaError}=await service.from('media_assets')
    .select('id,workspace_id,created_by,storage_key,mime_type,file_size_bytes,status,validation_status')
    .eq('id',mediaId).maybeSingle();
  if(mediaError||!media) return json({error:'media_not_found'},404,headers);
  const {data:membership}=await service.from('workspace_members').select('role')
    .eq('workspace_id',media.workspace_id).eq('user_id',userData.user.id).maybeSingle();
  if(!membership||!['OWNER','ADMIN','EDITOR'].includes(membership.role)) return json({error:'forbidden'},403,headers);
  if(media.created_by!==userData.user.id) return json({error:'upload_owner_mismatch'},403,headers);
  if(media.status!=='UPLOADING'||media.validation_status!=='PENDING') return json({error:'media_state_conflict'},409,headers);
  const quarantineKey=`${media.workspace_id}/${media.id}/upload`;
  const expectedFinalPrefix=`${media.workspace_id}/${media.id}/original.`;
  if(typeof media.storage_key!=='string'||!media.storage_key.startsWith(expectedFinalPrefix)) return json({error:'media_path_invalid'},409,headers);

  const reject=async(code:string,status=422)=>{
    await service.rpc('reject_media_validation',{p_media_id:media.id,p_code:code});
    await service.storage.from('media-quarantine').remove([quarantineKey]);
    return json({error:code,status:'FAILED'},status,headers);
  };
  const {data:blob,error:downloadError}=await service.storage.from('media-quarantine').download(quarantineKey);
  if(downloadError||!blob) return await reject('UPLOAD_OBJECT_MISSING',422);
  if(blob.size===0||blob.size>52428800||blob.size!==Number(media.file_size_bytes)) return await reject('UPLOAD_SIZE_MISMATCH',422);
  const {error:uploadCompleteError}=await service.rpc('mark_media_upload_completed',{p_media_id:media.id});
  if(uploadCompleteError) return json({error:'UPLOAD_COMPLETION_REGISTRATION_FAILED'},503,headers);
  if(media.mime_type.startsWith('video/')) {
    // A função Edge autentica o upload e deixa o objeto privado em quarentena.
    // A inspeção/decodificação real ocorre no worker Node isolado; não se promove
    // nem se marca READY enquanto esse worker não registrar o atestado.
    if(media.mime_type!=='video/mp4') return await reject('VIDEO_FORMAT_UNSUPPORTED',422);
    return json({status:'VALIDATING',media_id:media.id},202,headers);
  }
  let proof;
  try { proof=await validateImage(new Uint8Array(await blob.arrayBuffer()),media.mime_type); }
  catch(error) {
    const reason=error instanceof Error?error.message:'IMAGE_VALIDATION_FAILED';
    const code=/^[A-Z0-9_]{1,64}$/.test(reason)?reason:'IMAGE_VALIDATION_FAILED';
    return await reject(code,422);
  }

  // O objeto final é escrito somente pelo backend. Se houver retry após promoção
  // parcial, o hash do objeto existente deve ser idêntico antes de concluir READY.
  const finalKey=media.storage_key;
  const {data:promoted,error:promotionError}=await service.storage.from('media').upload(finalKey,new Uint8Array(await blob.arrayBuffer()),{
    contentType:proof.mime,upsert:false,cacheControl:'private, max-age=0',
  });
  if(promotionError) {
    const {data:existing}=await service.storage.from('media').download(finalKey);
    if(!existing) return json({error:'MEDIA_PROMOTION_FAILED'},503,headers);
    const existingHash=new Uint8Array(await crypto.subtle.digest('SHA-256',await existing.arrayBuffer()));
    const existingHex=[...existingHash].map(v=>v.toString(16).padStart(2,'0')).join('');
    if(existingHex!==proof.sha256) return await reject('PROMOTION_OBJECT_HASH_MISMATCH',409);
  }
  void promoted;
  const {error:completeError}=await service.rpc('complete_media_validation',{
    p_media_id:media.id,p_size:proof.size,p_sha256:proof.sha256,p_detected_mime:proof.mime,
    p_width:proof.width,p_height:proof.height,p_duration:null,p_validator_version:MEDIA_VALIDATOR_VERSION,
  });
  if(completeError) return json({error:'MEDIA_VALIDATION_COMMIT_FAILED'},503,headers);
  await service.storage.from('media-quarantine').remove([quarantineKey]);
  return json({status:'READY',media_id:media.id,mime:proof.mime,width:proof.width,height:proof.height,size:proof.size},200,headers);
});
