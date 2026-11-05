import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve('.');
const script = resolve('scripts/cloud-audit/admin-readonly/containment-ops.sh');
const report = JSON.stringify({
  role_present:true, role:'autoclip_cloud_auditor', marker_matches:true, can_login:true,
  valid_until:'2026-11-15T00:43:58+00:00', connection_limit:1,
  superuser:false, inherit:false, create_role:false, create_db:false, replication:false, bypass_rls:false,
  database_privileges:{create:false,connect:true,temporary:true},
  membership_edges:[{member:'postgres',granted_role:'autoclip_cloud_auditor',admin_option:true,inherit_option:false,set_option:false}],
  effective_memberships:[], active_session_count:0, active_sessions:[], shared_dependencies:[],
});

async function fixture({mode='success'}={}) {
  const root=await mkdtemp(join(tmpdir(),'autoclip-gate3104-'));
  const home=join(root,'home'), bin=join(root,'bin');
  await mkdir(home,{mode:0o700}); await mkdir(bin,{mode:0o700});
  const mock=`#!/bin/bash
set -eu
out=''
previous=''
for arg in "$@"; do
  if [ "$previous" = '-o' ]; then out="$arg"; fi
  previous="$arg"
done
[ -n "$out" ]
[ "\${PGPASSFILE-}" = '/dev/null' ]
[ -z "\${PGPASSWORD-}" ]
printf '%s\\n' "$*" >> "\${MOCK_CALLS}"
case "\${MOCK_MODE}" in
  success) printf '%s\\n' '\${JSON_FIXTURE}' > "$out" ;;
  invalid) printf '%s\\n' 'invalid-json' > "$out" ;;
  empty) : > "$out" ;;
  multiple) printf '%s\\n%s\\n' '\${JSON_FIXTURE}' '\${JSON_FIXTURE}' > "$out" ;;
  auth-fail) printf 'simulated authentication failure\\n' >&2; exit 2 ;;
  tls-fail) printf 'certificate verify failed\\n' >&2; exit 3 ;;
  contain-success) printf 'BEGIN\\nNOLOGIN VERIFIED: new role logins are disabled; no sessions were terminated.\\n'; : > "$out" ;;
  contain-abort) printf 'BEGIN\\nABORT: role identity/state precondition failed; no change committed.\\n'; exit 4 ;;
  contain-postcommit) printf 'COMMIT\\nPOST-COMMIT VERIFICATION FAILED: reconcile read-only.\\n'; exit 5 ;;
  wait) : > "\${MOCK_STARTED}"; exec /bin/sleep 60 ;;
  *) exit 99 ;;
esac
`;
  await writeFile(join(bin,'psql'),mock.replaceAll('${JSON_FIXTURE}',report),{mode:0o700});
  const env={...process.env,HOME:home,PATH:`${bin}:/usr/bin:/bin`,MOCK_MODE:mode,
    MOCK_CALLS:join(root,'calls'),MOCK_STARTED:join(root,'started')};
  for(const key of ['PGSERVICE','PGSERVICEFILE','PGPASSWORD','PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGSSLMODE','PGSSLROOTCERT','PGOPTIONS']) delete env[key];
  return {root,home,env};
}

async function runZshBash(f,args,{input}={}) {
  return spawnSync('zsh',['-c','exec bash "$@"','autoclip-test',script,...args],{
    cwd:repo,env:f.env,input,encoding:'utf8',timeout:10_000,
  });
}

async function reportFile(home,{value=report,ageSeconds=0}={}) {
  const path=join(home,`autoclip-admin-readonly.${Math.random().toString(16).slice(2,10)}`);
  await writeFile(path,value,{mode:0o600});
  await chmod600(path);
  if(ageSeconds) {
    const old=new Date(Date.now()-ageSeconds*1000);
    await utimes(path,old,old);
  }
  return path;
}
async function chmod600(path) {
  const { chmod }=await import('node:fs/promises'); await chmod(path,0o600);
}

test('Bash launched from Zsh runs read-only diagnostic, pins TLS and preserves one mode-0600 JSON report',async t=>{
  const f=await fixture(); t.after(()=>rm(f.root,{recursive:true,force:true}));
  const result=await runZshBash(f,['diagnose']);
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  const path=result.stdout.match(/Diagnóstico read-only validado\. Relatório protegido: (.+)/)?.[1];
  assert.ok(path,result.stdout);
  assert.equal((await stat(path)).mode&0o777,0o600);
  assert.equal(JSON.parse(await readFile(path,'utf8')).role,'autoclip_cloud_auditor');
  const args=await readFile(f.env.MOCK_CALLS,'utf8');
  for(const item of ['sslmode=verify-full','db.djrwfvcxgpyknmizqumn.supabase.co','prod-ca-2021.crt','00_role_containment_diagnostic.sql','-X -W -q -A -t']) assert.ok(args.includes(item),`missing argument ${item}`);
  assert.equal((await readdir(f.home)).length,1);
});

for(const [label,mode] of [['authentication','auth-fail'],['TLS verification','tls-fail'],['invalid JSON','invalid'],['empty JSON','empty'],['multiple JSON objects','multiple']]) {
  test(`diagnostic removes partial output on ${label} failure`,async t=>{
    const f=await fixture({mode}); t.after(()=>rm(f.root,{recursive:true,force:true}));
    const result=await runZshBash(f,['diagnose']);
    assert.notEqual(result.status,0);
    assert.equal((await readdir(f.home)).length,0);
  });
}

test('local report validator accepts fresh expected state and prints sanitized summary',async t=>{
  const f=await fixture(); t.after(()=>rm(f.root,{recursive:true,force:true}));
  const path=await reportFile(f.home);
  const result=await runZshBash(f,['validate',path]);
  assert.equal(result.status,0,result.stderr);
  const summary=JSON.parse(result.stdout);
  assert.equal(summary.role,'autoclip_cloud_auditor');
  assert.equal(summary.active_session_count,0);
  assert.deepEqual(summary.active_session_states,[]);
  assert.equal('active_sessions' in summary,false);
});

test('post-containment summary accepts NOLOGIN and exposes no raw session data',async t=>{
  const f=await fixture(); t.after(()=>rm(f.root,{recursive:true,force:true}));
  const state={...JSON.parse(report),can_login:false,active_session_count:1,active_sessions:[{pid:321,state:'idle',client_addr:'192.0.2.1',query:'sensitive'}]};
  const path=await reportFile(f.home,{value:JSON.stringify(state)});
  const result=await runZshBash(f,['summarize',path]);
  assert.equal(result.status,0,result.stderr);
  const summary=JSON.parse(result.stdout);
  assert.equal(summary.can_login,false);
  assert.equal(summary.active_session_count,1);
  assert.deepEqual(summary.active_session_states,[{state:'idle',count:1}]);
  assert.doesNotMatch(result.stdout,/192\.0\.2\.1|sensitive|321|client_addr|query/);
});

for(const [label,options] of [
  ['old report',{ageSeconds:600}],
  ['divergent role state',{value:JSON.stringify({...JSON.parse(report),can_login:false})}],
  ['active session',{value:JSON.stringify({...JSON.parse(report),active_session_count:1,active_sessions:[{state:'active'}]})}],
  ['unexpected membership',{value:JSON.stringify({...JSON.parse(report),effective_memberships:['other_role']})}],
  ['shared dependency',{value:JSON.stringify({...JSON.parse(report),shared_dependencies:[{dependency_type:'owner'}]})}],
  ['unexpected administrative attribute',{value:JSON.stringify({...JSON.parse(report),superuser:true})}],
  ['unexpected expiry',{value:JSON.stringify({...JSON.parse(report),valid_until:'2026-12-01T00:00:00+00:00'})}],
  ['invalid report',{value:'not-json'}],
]) {
  test(`local validator blocks ${label}`,async t=>{
    const f=await fixture(); t.after(()=>rm(f.root,{recursive:true,force:true}));
    const path=await reportFile(f.home,options);
    const result=await runZshBash(f,['validate',path]);
    assert.notEqual(result.status,0);
  });
}

test('containment refuses divergent or old report before invoking psql',async t=>{
  const f=await fixture({mode:'contain-success'}); t.after(()=>rm(f.root,{recursive:true,force:true}));
  const old=await reportFile(f.home,{ageSeconds:600});
  const result=await runZshBash(f,['contain',old],{input:'YES\n'});
  assert.notEqual(result.status,0);
  await assert.rejects(stat(f.env.MOCK_CALLS));
});

test('containment requires explicit concurrency confirmation and preserves output on success',async t=>{
  const f=await fixture({mode:'contain-success'}); t.after(()=>rm(f.root,{recursive:true,force:true}));
  const path=await reportFile(f.home);
  const result=await runZshBash(f,['contain',path],{input:'YES\n'});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/diagnóstico read-only independente/);
  const calls=await readFile(f.env.MOCK_CALLS,'utf8');
  assert.equal(calls.trim().split('\n').length,1,'containment must not retry or run another SQL');
  assert.match(calls,/31_disable_role_nologin\.sql/);
  assert.doesNotMatch(calls,/30_disable_role_and_terminate_sessions|00_role_containment_diagnostic/);
});

test('post-COMMIT failure is ambiguous, exits nonzero, and is never retried',async t=>{
  const f=await fixture({mode:'contain-postcommit'}); t.after(()=>rm(f.root,{recursive:true,force:true}));
  const path=await reportFile(f.home);
  const result=await runZshBash(f,['contain',path],{input:'YES\n'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/NOLOGIN pode estar aplicado/);
  const calls=await readFile(f.env.MOCK_CALLS,'utf8');
  assert.equal(calls.trim().split('\n').length,1);
  assert.match(result.stderr,/Saídas protegidas para reconciliação/);
});

test('TERM during diagnostic exits nonzero and removes partial JSON output',async t=>{
  const f=await fixture({mode:'wait'}); t.after(()=>rm(f.root,{recursive:true,force:true}));
  const child=spawn('zsh',['-c','exec bash "$@"','autoclip-test',script,'diagnose'],{
    cwd:repo,env:f.env,detached:true,stdio:['ignore','pipe','pipe'],
  });
  let stdout=''; child.stdout.setEncoding('utf8').on('data',x=>stdout+=x);
  for(let i=0;i<100;i++) { try { await stat(f.env.MOCK_STARTED); break; } catch { await new Promise(r=>setTimeout(r,20)); } }
  await stat(f.env.MOCK_STARTED);
  process.kill(-child.pid,'SIGTERM');
  const close=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  assert.equal(close.code,143,`${stdout}`);
  assert.equal((await readdir(f.home)).length,0);
});
