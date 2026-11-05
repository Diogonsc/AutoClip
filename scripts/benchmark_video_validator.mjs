import { spawn, spawnSync } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const image = process.env.VIDEO_VALIDATOR_IMAGE ?? 'autoclip-video-validator:3.6.0';
const durations = (process.env.VIDEO_BENCHMARK_SECONDS ?? '10,30,60,180').split(',').map(Number);
if (durations.some(value => ![10,30,60,180].includes(value))) throw new Error('Durations aceitas: 10,30,60,180 segundos.');
for (const [command, args] of [['docker',['--version']],['ffmpeg',['-version']]]) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  if (result.status !== 0) throw new Error(`${command} indisponível no host local.`);
}

function run(command, args, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore','pipe','pipe'] });
    const stdout=[]; const stderr=[];
    child.stdout.on('data', chunk => stdout.push(chunk)); child.stderr.on('data', chunk => stderr.push(chunk));
    const timer=setTimeout(()=>child.kill('SIGKILL'),timeoutMs);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{
      clearTimeout(timer);
      if(code!==0) reject(new Error(`${command} failed (${code}): ${Buffer.concat(stderr).toString().trim().split(/\s+/).at(-1)}`));
      else resolvePromise(Buffer.concat(stdout).toString());
    });
  });
}

function parseBytes(value) {
  const match = value.match(/^([\d.]+)\s*(B|kB|MB|GB|KiB|MiB|GiB)$/i);
  if (!match) return null;
  const base = match[2].toLowerCase().includes('i') ? 1024 : 1000;
  const unit = match[2].toLowerCase();
  const power = unit.startsWith('g') ? 3 : unit.startsWith('m') ? 2 : unit.startsWith('k') ? 1 : 0;
  return Math.round(Number(match[1]) * base ** power);
}

async function sha256(path) {
  const hash=createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function dockerStats(name) {
  try {
    const { stdout } = await execFileAsync('docker',['stats','--no-stream','--format','{{.CPUPerc}}|{{.MemUsage}}',name],{timeout:3000});
    const [cpuRaw,memoryRaw]=stdout.trim().split('|');
    const memUsed=memoryRaw?.split('/')[0]?.trim();
    return { cpu: Number.parseFloat(cpuRaw), memory: parseBytes(memUsed) };
  } catch { return null; }
}

async function measureContainer(name, file) {
  const args=['run','--rm','--name',name,'--network','none','--user','1000:1000','--memory','768m','--memory-swap','768m','--cpus','1','--pids-limit','48','--read-only','--security-opt','no-new-privileges','--cap-drop','ALL','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=96m','-v',`${file}:/input/video:ro`,image,'/input/video','video/mp4'];
  const child=spawn('docker',args,{shell:false,stdio:['ignore','pipe','pipe']});
  const stdout=[]; const stderr=[]; const start=performance.now(); let peakMemoryBytes=0; let peakCpuPercent=0;
  child.stdout.on('data',chunk=>stdout.push(chunk)); child.stderr.on('data',chunk=>stderr.push(chunk));
  let sampling=true;
  const sampler=(async()=>{
    while(sampling){
      const stats=await dockerStats(name);
      if(stats){peakMemoryBytes=Math.max(peakMemoryBytes,stats.memory??0);peakCpuPercent=Math.max(peakCpuPercent,stats.cpu??0);}
      await new Promise(resolvePromise=>setTimeout(resolvePromise,250));
    }
  })();
  const exitCode=await new Promise((resolvePromise,reject)=>{
    const timer=setTimeout(()=>child.kill('SIGKILL'),130_000);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);resolvePromise(code);});
  });
  sampling=false; await sampler;
  if(exitCode!==0) throw new Error(`Validator rejeitou benchmark ${name}: ${Buffer.concat(stderr).toString().trim().split(/\s+/).at(-1)}`);
  const result=JSON.parse(Buffer.concat(stdout).toString());
  return { totalValidationMs:Math.round(performance.now()-start),probeMs:result.probeDurationMs,decodeMs:result.decodeDurationMs,peakMemoryBytes:peakMemoryBytes||null,peakCpuPercent:peakCpuPercent||null };
}

const temp=await mkdtemp(join(tmpdir(),'autoclip-video-benchmark-'));
try {
  await run('docker',['build','-t',image,'-f',resolve(root,'scripts/video-validator/Dockerfile'),resolve(root,'scripts/video-validator')],300_000);
  for(const seconds of durations){
    const path=join(temp,`${seconds}s.mp4`);
    const generationStart=performance.now();
    await run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=360x640:rate=24','-t',String(seconds),'-an','-c:v','libx264','-preset','ultrafast','-crf','32','-pix_fmt','yuv420p','-movflags','+faststart','-y',path],300_000);
    const generationMs=Math.round(performance.now()-generationStart);
    const stat=spawnSync('stat',['-c','%s',path],{encoding:'utf8'});
    if(stat.status!==0)throw new Error('Não foi possível medir o tamanho da fixture.');
    const sizeBytes=Number(stat.stdout.trim());
    const hashStart=performance.now(); await sha256(path); const sha256Ms=Math.round(performance.now()-hashStart);
    const validation=await measureContainer(`acvbench-${process.pid}-${randomUUID().slice(0,8)}`,path);
    console.log(JSON.stringify({seconds,sizeBytes,generationMs,sha256Ms,...validation,storageDownloadMs:null,storagePromotionMs:null}));
  }
} finally { await rm(temp,{recursive:true,force:true}); }
