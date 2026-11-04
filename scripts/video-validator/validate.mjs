import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const file = process.argv[2];
const declaredMime = process.argv[3];
if (typeof file !== 'string' || !file.startsWith('/input/') && !file.startsWith('/tmp/autoclip-validator-') || !['video/mp4', 'image/jpeg', 'image/png', 'image/webp'].includes(declaredMime)) {
  process.stderr.write('INVALID_VALIDATOR_INPUT\n');
  process.exit(2);
}

function run(command, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { bytes += chunk.length; if (bytes > 1024 * 1024) child.kill('SIGKILL'); else stdout.push(chunk); });
    child.stderr.on('data', (chunk) => { if (Buffer.concat(stderr).length < 64 * 1024) stderr.push(chunk); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(signal === 'SIGKILL' ? 'VALIDATION_TIMEOUT_OR_OUTPUT_LIMIT' : `DECODER_EXIT_${code}`));
      else resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

try {
  const header = await readFile(file);
  if (!header.byteLength) throw new Error('EMPTY_FILE');
  if (declaredMime === 'video/mp4') {
    if (header.byteLength < 12 || header.toString('ascii', 4, 8) !== 'ftyp') throw new Error('VIDEO_CONTAINER_UNSUPPORTED');
    const majorBrand = header.toString('ascii', 8, 12);
    if (!['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1'].includes(majorBrand)) throw new Error('VIDEO_CONTAINER_UNSUPPORTED');
  } else if (declaredMime === 'image/jpeg' && (header[0] !== 0xff || header[1] !== 0xd8)) throw new Error('IMAGE_SIGNATURE_INVALID');
  else if (declaredMime === 'image/png' && !Buffer.from([137,80,78,71,13,10,26,10]).equals(header.subarray(0,8))) throw new Error('IMAGE_SIGNATURE_INVALID');
  else if (declaredMime === 'image/webp' && (header.toString('ascii',0,4)!=='RIFF' || header.toString('ascii',8,12)!=='WEBP')) throw new Error('IMAGE_SIGNATURE_INVALID');
  const probeStarted = performance.now();
  const raw = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=format_name,duration,size:stream=index,codec_type,codec_name,width,height,avg_frame_rate,disposition',
    '-of', 'json', '-probesize', '10000000', '-analyzeduration', '10000000', file,
  ]);
  const probeDurationMs = Math.round(performance.now() - probeStarted);
  const data = JSON.parse(raw);
  const streams = data.streams ?? [];
  if (streams.length < 1 || streams.length > 2) throw new Error('MEDIA_STREAM_COUNT_INVALID');
  const video = streams.filter((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  const audio = streams.filter((stream) => stream.codec_type === 'audio');
  if (video.length !== 1 || audio.length > 1 || streams.some((stream) => !['video', 'audio'].includes(stream.codec_type))) throw new Error('MEDIA_STREAM_LAYOUT_UNSUPPORTED');
  const v = video[0];
  const formatNames=(data.format?.format_name ?? '').split(',');
  if (declaredMime.startsWith('image/')) {
    const formats={ 'image/jpeg':['jpeg_pipe','mjpeg'], 'image/png':['png_pipe','png'], 'image/webp':['webp_pipe','webp'] };
    if (!formats[declaredMime].some(name=>formatNames.includes(name)) || audio.length) throw new Error('IMAGE_CONTAINER_MISMATCH');
    if (!['image/jpeg','image/png','image/webp'].includes(declaredMime)) throw new Error('IMAGE_FORMAT_UNSUPPORTED');
    const width=Number(v.width),height=Number(v.height);
    if (!Number.isInteger(width)||!Number.isInteger(height)||width<360||height<360||width>4096||height>4096||width*height>16000000) throw new Error('MEDIA_DIMENSIONS_UNSUPPORTED');
    const decodeStarted=performance.now();
    await run('ffmpeg',['-nostdin','-v','error','-xerror','-threads','1','-max_alloc','268435456','-i',file,'-map','0:v:0','-frames:v','1','-f','null','-'],30000);
    const decodeDurationMs=Math.round(performance.now()-decodeStarted);
    process.stdout.write(JSON.stringify({kind:'image',mime:declaredMime,codec:v.codec_name,duration:null,width,height,probeDurationMs,decodeDurationMs,validatorVersion:'autoclip-ffmpeg-1'}));
    process.exit(0);
  }
  if (!formatNames.includes('mov,mp4,m4a,3gp,3g2,mj2') && !formatNames.includes('mp4')) throw new Error('VIDEO_CONTAINER_UNSUPPORTED');
  if (v.codec_name !== 'h264') throw new Error('VIDEO_CODEC_UNSUPPORTED');
  if (audio.length && audio[0].codec_name !== 'aac') throw new Error('AUDIO_CODEC_UNSUPPORTED');
  const duration = Number(data.format?.duration);
  const width = Number(v.width);
  const height = Number(v.height);
  const frameRate = (v.avg_frame_rate ?? '0/1').split('/').map(Number);
  const fps = frameRate[1] ? frameRate[0] / frameRate[1] : 0;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 600) throw new Error('VIDEO_DURATION_UNSUPPORTED');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 360 || height < 360 || width > 4096 || height > 4096 || width * height > 16000000) throw new Error('VIDEO_DIMENSIONS_UNSUPPORTED');
  if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error('VIDEO_FRAME_RATE_UNSUPPORTED');

  // Probe metadados e depois decodifica todos os frames e o áudio. Sem rede,
  // filesystem somente leitura e timeout externo do container.
  const decodeStarted=performance.now();
  await run('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-threads', '1', '-max_alloc', '268435456', '-i', file, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-'], 120000);
  const decodeDurationMs=Math.round(performance.now()-decodeStarted);
  process.stdout.write(JSON.stringify({ container: 'mp4', mime: 'video/mp4', codec: 'h264', audioCodec: audio[0]?.codec_name ?? null, duration, width, height, frameRate: fps, probeDurationMs, decodeDurationMs, validatorVersion: 'autoclip-ffmpeg-1' }));
} catch (error) {
  const message = error instanceof Error ? error.message : 'VIDEO_VALIDATION_FAILED';
  process.stderr.write(`${/^[A-Z0-9_]+$/.test(message) ? message : 'VIDEO_VALIDATION_FAILED'}\n`);
  process.exit(1);
}
