import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const image='autoclip-video-validator:local';
const dir=await mkdtemp(join(tmpdir(),'autoclip-validator-test-'));
function run(command,args,options={}) { const result=spawnSync(command,args,{encoding:'utf8',...options}); if(result.status!==0)throw new Error(result.stderr||result.stdout||`${command} exited ${result.status}`); return result.stdout; }
function assert(condition,message){if(!condition)throw new Error(message);}
function validate(path,mime){
  return spawnSync('docker',['run','--rm','--network','none','--memory','512m','--memory-swap','512m','--cpus','1','--pids-limit','32','--read-only','--security-opt','no-new-privileges','--cap-drop','ALL','--tmpfs','/tmp:rw,noexec,nosuid,size=32m','-v',`${path}:/input/video:ro`,image,'/input/video',mime],{encoding:'utf8'});
}
try {
  if(spawnSync('docker',['image','inspect',image],{stdio:'ignore'}).status!==0)run('docker',['build','-t',image,'-f','scripts/video-validator/Dockerfile','scripts/video-validator'],{cwd:root,stdio:'inherit'});
  run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=360x640:d=2','-c:v','libx264','-profile:v','high','-pix_fmt','yuv420p','-r','30','-movflags','+faststart',join(dir,'valid.mp4')]);
  run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=360x360:d=1','-c:v','mpeg4','-movflags','+faststart',join(dir,'mpeg4.mp4')]);
  const valid=validate(join(dir,'valid.mp4'),'video/mp4');
  assert(valid.status===0,'MP4 H.264 binário real deveria passar');
  const metadata=JSON.parse(valid.stdout);
  assert(metadata.container==='mp4'&&metadata.codec==='h264'&&metadata.width===360&&metadata.height===640,'metadados validado incompatíveis');
  await writeFile(join(dir,'text.mp4'),Buffer.from('not an MP4'));
  const malformed=validate(join(dir,'text.mp4'),'video/mp4');
  assert(malformed.status!==0&&malformed.stderr.includes('VIDEO_CONTAINER_UNSUPPORTED'),'conteúdo textual renomeado deveria ser rejeitado');
  const source=await readFile(join(dir,'valid.mp4'));
  await writeFile(join(dir,'truncated.mp4'),source.subarray(0,32));
  const truncated=validate(join(dir,'truncated.mp4'),'video/mp4');
  assert(truncated.status!==0,'MP4 truncado deveria ser rejeitado');
  const unsupported=validate(join(dir,'mpeg4.mp4'),'video/mp4');
  assert(unsupported.status!==0&&unsupported.stderr.includes('VIDEO_CODEC_UNSUPPORTED'),'codec MPEG-4 deveria ser rejeitado');
  const mov=validate(join(dir,'valid.mp4'),'video/quicktime');
  assert(mov.status!==0&&mov.stderr.includes('INVALID_VALIDATOR_INPUT'),'MIME MOV deve falhar fechado');
  const webm=validate(join(dir,'valid.mp4'),'video/webm');
  assert(webm.status!==0&&webm.stderr.includes('INVALID_VALIDATOR_INPUT'),'MIME WebM deve falhar fechado');
  await writeFile(join(dir,'empty.mp4'),Buffer.alloc(0));
  const empty=validate(join(dir,'empty.mp4'),'video/mp4');
  assert(empty.status!==0,'arquivo vazio deve ser rejeitado');
  process.stdout.write('Video validator local: MP4 H.264 real aprovado; bytes falsos, vazio, truncamento, codec MPEG-4, QuickTime/MOV e WebM rejeitados.\n');
} finally { await rm(dir,{recursive:true,force:true}); }
