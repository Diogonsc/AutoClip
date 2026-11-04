import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditQueries, autoClipProjectRef, isSafePreflight, localManifest, parseArgs, psqlEnvironment, renderMarkdown, runPsql, validateTarget } from './readonly-audit.mjs';

const ref=autoClipProjectRef;
const credential=`postgresql://autoclip_cloud_auditor:secret@db.${ref}.supabase.co:5432/postgres`;
const confirmed=()=>parseArgs(['--audit-scope','metadata-only','--execute-read-only','--i-confirm-read-only-credential','--target-project-ref',ref]);

test('remote invocation requires explicit metadata-only scope and two confirmations',()=>{
  assert.throws(()=>validateTarget({args:parseArgs(['--target-project-ref',ref]),databaseUrl:credential}),/explicit read-only confirmation/);
  assert.throws(()=>validateTarget({args:parseArgs(['--execute-read-only','--i-confirm-read-only-credential','--target-project-ref',ref]),databaseUrl:credential}),/metadata-only/);
  assert.throws(()=>validateTarget({args:parseArgs(['--audit-scope','full','--execute-read-only','--i-confirm-read-only-credential','--target-project-ref',ref]),databaseUrl:credential}),/metadata-only/);
});
test('remote access requires dedicated credential and exact Cloud project host',()=>{
  assert.throws(()=>validateTarget({args:confirmed(),databaseUrl:undefined}),/AUTOCLIP_CLOUD_AUDIT_DATABASE_URL/);
  assert.equal(validateTarget({args:confirmed(),databaseUrl:credential}).scope,'metadata-only');
  assert.throws(()=>validateTarget({args:confirmed(),databaseUrl:credential.replace(ref,'zyxwvutsrqponmlkjihg')}),/does not exactly match/);
  assert.throws(()=>validateTarget({args:confirmed(),databaseUrl:credential.replace(`db.${ref}.supabase.co`,'pooler.supabase.com')}),/does not exactly match/);
  assert.throws(()=>validateTarget({args:confirmed(),databaseUrl:credential.replace('/postgres','/other')}),/database `postgres`/);
  assert.throws(()=>validateTarget({args:confirmed(),databaseUrl:credential.replace('postgresql:','https:')}),/PostgreSQL protocol/);
  assert.throws(()=>validateTarget({args:confirmed(),databaseUrl:credential.replace('autoclip_cloud_auditor','postgres')}),/dedicated autoclip_cloud_auditor/);
  assert.throws(()=>validateTarget({args:confirmed(),databaseUrl:`${credential}?sslmode=disable`}),/query parameters/);
  assert.throws(()=>validateTarget({args:confirmed(),databaseUrl:`${credential}#fragment`}),/query parameters/);
  assert.throws(()=>validateTarget({args:confirmed(),databaseUrl:credential.replace(':5432',':6543')}),/direct PostgreSQL endpoint/);
});
test('PUBLIC TEMP opt-in is project-bound and explicit',()=>{
  const args=parseArgs(['--audit-scope','metadata-only','--execute-read-only','--i-confirm-read-only-credential','--target-project-ref',ref,'--allow-public-temp-project-ref',ref]);
  assert.equal(validateTarget({args,databaseUrl:credential}).allowPublicTempProjectRef,ref);
  args.values.set('--allow-public-temp-project-ref','zyxwvutsrqponmlkjihg');
  assert.throws(()=>validateTarget({args,databaseUrl:credential}),/bound to the same/);
});
test('libpq environment is pinned, TLS-verified, read-only, and removes ambient routing',()=>{
  const env=psqlEnvironment(new URL(credential),{...process.env,PGSERVICE:'evil',PGSERVICEFILE:'/tmp/evil',PGPASSFILE:'/tmp/evil',PGPASSWORD:'bad',PGHOSTADDR:'203.0.113.1',PGTARGETSESSIONATTRS:'read-write',PGSSLROOTCERT:'/tmp/evil',PGOPTIONS:'-c default_transaction_read_only=off',DATABASE_URL:'secret'});
  assert.equal(env.PGHOST,`db.${ref}.supabase.co`);assert.equal(env.PGSSLMODE,'verify-full');assert.match(env.PGOPTIONS,/default_transaction_read_only=on/);
  assert.equal(env.PGAPPNAME,`autoclip-cloud-audit:${ref}`);
  for(const key of ['PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGPASSWORD','PGHOSTADDR','PGTARGETSESSIONATTRS','PGSSLROOTCERT','DATABASE_URL'])assert.equal(env[key],undefined);
});
test('metadata-only allowlist is composed exclusively of static SELECT statements and excludes business data/projection',()=>{
  for(const [name,query] of Object.entries(auditQueries)){
    assert.match(query,/^\s*SELECT\b/i,name);
    assert.doesNotMatch(query,/;|\b(?:INSERT\s+INTO|UPDATE\s+[a-z]|DELETE\s+FROM|DROP\s|ALTER\s|TRUNCATE\s|CREATE\s|CALL\s)\b/i,name);
  }
  const sql=Object.values(auditQueries).join('\n');
  assert.doesNotMatch(sql,/inventory_summary|autoclip_audit/i);
  assert.doesNotMatch(sql,/FROM\s+(?:public\.(?:media_assets|publication_jobs|publication_quota_reservations)|storage\.(?:objects|buckets))/i);
  assert.match(auditQueries.migrationVersions,/SELECT\s+coalesce\(jsonb_agg\(version::text/i);
  assert.match(auditQueries.preflight,/temp_acl_sources/);
  assert.match(auditQueries.preflight,/unexpected_function_execute/);
  assert.match(auditQueries.preflight,/unapproved_grant_options/);
  assert.match(auditQueries.preflight,/owned_application_objects/);
});

const safe={scope:'metadata-only',database:'postgres',read_only:true,role:'autoclip_cloud_auditor',role_marker:'autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn',role_valid_until:new Date(Date.now()+86400000).toISOString(),role_defaults:{default_transaction_read_only:'on',statement_timeout:'20s',lock_timeout:'3s',idle_in_transaction_session_timeout:'30s',search_path:'""'},role_memberships:[],elevated_membership:false,database_owner:false,
  temp_acl_sources:{public:false,direct:false,membership:false,public_grant_option:false},unexpected_function_execute:false,unapproved_relation_reads:false,unapproved_schema_usage:false,ledger_column_select_scope_safe:true,unapproved_sequence_access:false,unapproved_large_object_access:false,unapproved_grant_options:false,unapproved_default_privileges:false,owned_application_objects:false,
  role_flags:{login:true,superuser:false,inherit:false,create_role:false,create_db:false,replication:false,bypass_rls:false,database_create:false,database_temp:false,schema_create:false,write_privileges:false}};
test('preflight accepts only a short-lived, nonprivileged, metadata-only identity',()=>{
  assert.equal(isSafePreflight(safe),true);
  assert.equal(isSafePreflight({...safe,role:'autoclip_cloud_auditor_test_a1b2c3d4'}),false,'test identities are never accepted by the remote default');
  for(const mutation of [{scope:'full'},{database:'other'},{read_only:false},{role:'service_role'},{role_marker:'wrong-marker'},{role_valid_until:null},{role_flags:{superuser:true}},{role_flags:{inherit:true}},{role_flags:{create_role:true}},{role_flags:{create_db:true}},{role_flags:{replication:true}},{role_flags:{bypass_rls:true}},{role_flags:{database_create:true}},{role_flags:{schema_create:true}},{role_flags:{write_privileges:true}},{role_memberships:['service_role']},{elevated_membership:true},{unexpected_function_execute:true},{unapproved_relation_reads:true},{unapproved_schema_usage:true},{ledger_column_select_scope_safe:false},{unapproved_sequence_access:true},{unapproved_large_object_access:true},{unapproved_grant_options:true},{unapproved_default_privileges:true},{owned_application_objects:true},{role_defaults:{default_transaction_read_only:'off'}},{role_defaults:{statement_timeout:'0'}}]){
    const value={...safe,...mutation,role_flags:{...safe.role_flags,...mutation.role_flags},role_defaults:{...safe.role_defaults,...mutation.role_defaults}};
    assert.equal(isSafePreflight(value),false,JSON.stringify(mutation));
  }
});
test('PUBLIC TEMP is refused by default and accepted only from PUBLIC for exact project opt-in',()=>{
  const candidate={...safe,temp_acl_sources:{public:true,direct:false,membership:false,public_grant_option:false},role_flags:{...safe.role_flags,database_temp:true}};
  assert.equal(isSafePreflight(candidate),false);
  assert.equal(isSafePreflight(candidate,{projectRef:ref}),false);
  assert.equal(isSafePreflight(candidate,{projectRef:ref,allowPublicTempProjectRef:ref}),true);
  for(const source of [{direct:true},{membership:true},{public_grant_option:true},{public:false}])assert.equal(isSafePreflight({...candidate,temp_acl_sources:{...candidate.temp_acl_sources,...source}},{projectRef:ref,allowPublicTempProjectRef:ref}),false);
  assert.equal(isSafePreflight({...candidate,database_owner:true},{projectRef:ref,allowPublicTempProjectRef:ref}),false);
  assert.equal(isSafePreflight(candidate,{projectRef:'zyxwvutsrqponmlkjihg',allowPublicTempProjectRef:'zyxwvutsrqponmlkjihg'}),false);
});
test('runPsql rejects SQL outside allowlist and wraps every approved query in explicit READ ONLY transaction',()=>{
  const dir=mkdtempSync(join(tmpdir(),'autoclip-audit-test-'));const fake=join(dir,'fake-psql');
  try{
    writeFileSync(fake,'#!/usr/bin/env node\nprocess.stdout.write(\'{"ok":true}\\n\')\n');chmodSync(fake,0o700);
    assert.deepEqual(runPsql(auditQueries.availability,process.env,{binary:fake}),{ok:true});
    assert.throws(()=>runPsql('SELECT 1; DROP TABLE public.x',process.env,{binary:fake}),/static audit query allowlist/);
    writeFileSync(fake,'#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)))\n');chmodSync(fake,0o700);
    const args=runPsql(auditQueries.server,process.env,{binary:fake});const sql=args[args.indexOf('-c')+1];
    assert.match(sql,/^BEGIN READ ONLY; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='3s'; SELECT /i);assert.match(sql,/COMMIT;$/i);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('psql runner reports permission errors and enforces a process timeout without fallback credentials',()=>{
  const dir=mkdtempSync(join(tmpdir(),'autoclip-audit-test-'));const fake=join(dir,'fake-psql');
  try{
    writeFileSync(fake,'#!/usr/bin/env node\nprocess.stderr.write("permission denied for catalog fixture\\n");process.exit(1)\n');chmodSync(fake,0o700);
    assert.throws(()=>runPsql(auditQueries.schemas,process.env,{binary:fake}),/permission denied/);
    writeFileSync(fake,'#!/usr/bin/env node\nsetTimeout(()=>{},5000)\n');chmodSync(fake,0o700);
    assert.throws(()=>runPsql(auditQueries.schemas,process.env,{binary:fake,timeoutMs:30}),/timed out|ETIMEDOUT/i);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('passfile is ephemeral mode 0600 and password never reaches child environment',()=>{
  const dir=mkdtempSync(join(tmpdir(),'autoclip-audit-test-'));const fake=join(dir,'fake-psql');
  try{
    writeFileSync(fake,'#!/usr/bin/env node\nconst fs=require("node:fs");const p=process.env.PGPASSFILE;process.stdout.write(JSON.stringify({path:p,contents:fs.readFileSync(p,"utf8"),mode:fs.statSync(p).mode&0o777,password:process.env.PGPASSWORD,secret:process.env.AUTOCLIP_AUDIT_PGPASS_SECRET}))\n');chmodSync(fake,0o700);
    const env=psqlEnvironment(new URL(credential.replace('secret','p%3Aa%5Cb')));const result=runPsql(auditQueries.server,env,{binary:fake});
    assert.equal(result.mode,0o600);assert.match(result.contents,/:p\\:a\\\\b\n$/);assert.equal(result.password,undefined);assert.equal(result.secret,undefined);assert.equal(existsSync(result.path),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('local manifest is repository-only, ordered, and reports all 32 current migrations',async()=>{const report=await localManifest();assert.equal(report.migrationCount,32);assert.equal(report.migrationAudit.chronologicalOrderValid,true);assert.equal(report.migrationAudit.duplicateVersions.length,0);assert.equal(report.source,'repository only; no Cloud connection');});
test('approval candidates are only metadata-only SQL and have no passwords or cascade',async()=>{
  const {readFile,readdir}=await import('node:fs/promises');const dir=new URL('./sql/metadata-only/',import.meta.url);const names=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
  assert.deepEqual(names,['00_create_role.sql','01_grant_minimum_permissions.sql','02_verify_metadata_readonly.sql','03_emergency_revoke_metadata_role.sql','04_remove_metadata_role.sql']);
  const approval=await readFile(new URL('../../docs/CLOUD_METADATA_ONLY_AUDIT_SCOPE.md',import.meta.url),'utf8');
  for(const name of names){const sql=await readFile(new URL(name,dir),'utf8');const commands=sql.replace(/--[^\n]*/g,'');assert.doesNotMatch(commands,/PASSWORD\s+'[^']+'/i);assert.doesNotMatch(commands,/DROP\s+OWNED|DROP\s+ROLE[^;]*CASCADE/i);assert.match(sql,/\\ir \.\.\/\_guard\.psql/);assert.ok(approval.includes(`### scripts/cloud-audit/sql/metadata-only/${name}\n\n\`\`\`sql\n${sql.trimEnd()}\n\`\`\``),`${name} exact SQL missing from approval scope`);}
  const grant=await readFile(new URL('01_grant_minimum_permissions.sql',dir),'utf8');assert.doesNotMatch(grant,/SELECT\s+ON\s+ALL\s+TABLES|inventory_summary|autoclip_audit/i);assert.match(grant,/GRANT SELECT \(version\)/);
  assert.match(grant,/NOT c\.relrowsecurity AND NOT c\.relforcerowsecurity/,'RLS-protected migration ledger must receive no read grant');
  assert.match(auditQueries.availability,/ledger_row_security/);
  assert.match(auditQueries.availability,/NOT c\.relrowsecurity AND NOT c\.relforcerowsecurity/);
  const emergency=await readFile(new URL('03_emergency_revoke_metadata_role.sql',dir),'utf8');assert.match(emergency,/NOLOGIN/);assert.doesNotMatch(emergency,/application_name|DROP\s+ROLE|CASCADE|autoclip_audit|inventory_summary/i);
  const removal=await readFile(new URL('04_remove_metadata_role.sql',dir),'utf8');assert.match(removal,/DROP ROLE :"audit_role"/);assert.doesNotMatch(removal.replace(/--[^\n]*/g,''),/CASCADE|autoclip_audit|inventory_summary/i);
});
test('SQL verifier covers TEMP provenance, relation/sequence/function access, grant options and all ownership classes',async()=>{
  const {readFile}=await import('node:fs/promises');const sql=await readFile(new URL('./sql/metadata-only/02_verify_metadata_readonly.sql',import.meta.url),'utf8');
  for(const field of ['temp_acl_sources','unapproved_schema_usage','unapproved_relation_reads','unapproved_sequence_access','executable_application_functions','large_object_access','grant_option','default_privileges_for_public_or_auditor','owned_objects'])assert.match(sql,new RegExp(`'${field}'`));
  assert.match(sql,/lomowner=r\.oid/);assert.match(sql,/BEGIN READ ONLY/);assert.doesNotMatch(sql,/SECURITY\s+DEFINER|inventory_summary|autoclip_audit/i);
});
test('Gate 3.1 checks effective privileges before its first GRANT and fails closed',async()=>{
  const {readFile}=await import('node:fs/promises');const sql=await readFile(new URL('./sql/metadata-only/01_grant_minimum_permissions.sql',import.meta.url),'utf8');
  const pregrant=sql.indexOf('metadata_audit_pregrant_check_blocked');const firstGrant=sql.indexOf('\nGRANT ');
  assert.ok(pregrant>0&&firstGrant>pregrant,'all blockers must execute before the first GRANT');
  for(const marker of ['ISOLATION LEVEL SERIALIZABLE','has_database_privilege','has_schema_privilege','has_table_privilege','has_any_column_privilege','has_sequence_privilege','has_function_privilege','pg_auth_members','pg_shdepend','pg_default_acl','pg_largeobject_metadata','grant option','database CREATE or TEMP provenance','privilege on a non-target database'])assert.ok(sql.toLowerCase().includes(marker.toLowerCase()),`missing fail-closed precheck: ${marker}`);
  assert.match(sql,/ROLLBACK;[\s\S]*metadata_audit_pregrant_check_blocked/);
  assert.match(sql,/t\.typacl IS NOT NULL[\s\S]*has_type_privilege/,'only explicit custom-type ACLs are treated as unexpected; default PUBLIC type USAGE is not data access');
  assert.match(sql,/:'audit_local_test'::boolean[\s\S]*other_db\.datname IN \('postgres','_supabase','storage_vectors','template1'\)[\s\S]*acl\.grantee=r\.oid[\s\S]*acl\.is_grantable/,'local database exceptions must be test-only and reject direct grants/grant option');
  assert.match(sql,/other_db\.datallowconn[\s\S]*has_database_privilege\(r\.rolname,other_db\.oid,'CREATE'\)[\s\S]*has_database_privilege\(r\.rolname,other_db\.oid,'TEMP'\)/,'all effective non-target database privileges must be checked');
  assert.match(sql,/JOIN pg_database gd ON true CROSS JOIN LATERAL aclexplode\(coalesce\(gd\.datacl/,'database GRANT OPTION must be checked across every database');
  assert.doesNotMatch(sql,/REVOKE\s+\w+\s+ON\s+DATABASE\s+[^;]+\s+FROM\s+PUBLIC/i);
});
test('pregrant diagnostic is static, read-only, target-bound, and reports the Gate 3 blocker families',async()=>{
  const {readFile}=await import('node:fs/promises');
  const sql=await readFile(new URL('./sql/diagnose_pregrant_blockers.sql',import.meta.url),'utf8');
  assert.match(sql,/BEGIN READ ONLY/);
  assert.match(sql,/statement_timeout='20s'/);
  assert.match(sql,/current_database\(\)='postgres'/);
  assert.match(sql,/djrwfvcxgpyknmizqumn/);
  assert.match(sql,/requested audit role does not exist/);
  assert.match(sql,/SELECT 1\/0 AS abort_gate/,'psql guard failures must return a nonzero status under ON_ERROR_STOP');
  const stripped=sql.replace(/^\s*--.*$/gm,'').replace(/'(?:''|[^'])*'/g,"''");
  assert.doesNotMatch(stripped,/\b(?:GRANT|REVOKE|ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE|CALL)\b/i);
  for(const category of [
    'role membership/delegation','privilege on a non-target database',
    'database CREATE or TEMP provenance','unapproved schema USAGE/CREATE',
    'unapproved relation read/write privilege','unapproved sequence privilege',
    'application routine EXECUTE','large object privilege',
    'unapproved default privileges','object ownership','grant option',
    'migration ledger metadata',
  ]) assert.ok(sql.includes(category),`diagnostic category absent: ${category}`);
  assert.doesNotMatch(sql,/auth\.users|storage\.objects|access_token|refresh_token|inventory_summary/i);
  assert.match(sql,/p\.prosecdef/,'routine metadata may identify SECURITY DEFINER without invoking routine bodies');
  assert.match(sql,/pg_auth_members/);assert.match(sql,/pg_shdepend/);assert.match(sql,/aclexplode/);
});
test('administrative SQL guard validates the actual connected database, not only a supplied psql variable',async()=>{
  const {readFile}=await import('node:fs/promises');const guard=await readFile(new URL('./sql/_guard.psql',import.meta.url),'utf8');
  assert.match(guard,/current_database\(\)\s*=\s*'postgres'/);assert.match(guard,/connected database is not the approved postgres database/);
  assert.match(guard,/DO \$\$ BEGIN RAISE EXCEPTION 'metadata_audit_guard_blocked'/);
});
test('approval documents pin SHA-256 for metadata scripts and guard',async()=>{
  const {readFile,readdir}=await import('node:fs/promises');const base=new URL('./sql/',import.meta.url);const dir=new URL('./sql/metadata-only/',import.meta.url);
  const files=['_guard.psql',...(await readdir(dir)).filter(n=>n.endsWith('.sql')).map(n=>`metadata-only/${n}`)].sort();
  const docs=['../../docs/CLOUD_READONLY_CREDENTIAL_APPROVAL_PACKAGE.md','../../docs/CLOUD_CONTROLLED_EXECUTION_RUNBOOK.md','../../docs/CLOUD_METADATA_ONLY_AUDIT_SCOPE.md'];
  const text=await Promise.all(docs.map(p=>readFile(new URL(p,import.meta.url),'utf8')));
  for(const file of files){const content=await readFile(new URL(file,base));const hash=createHash('sha256').update(content).digest('hex');for(const doc of text)assert.ok(doc.includes(hash),`${file} hash missing from approval docs`);}
  const packageText=await readFile(new URL('../../docs/CLOUD_READONLY_CREDENTIAL_APPROVAL_PACKAGE.md',import.meta.url),'utf8');
  assert.match(packageText,/4db6b51292a8b1a2311979fcd92acba130c4aa34cc9aeaac4be211968ff463c6[\s\S]{0,100}SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO/i);
  assert.match(packageText,/6e277eb4830fb9ced2e67f7a37a01ca1555d529c8108a798c3f9fd83356d6796/);
  assert.match(packageText,/f19ab0675df9434413799baf8c7d1c2349280d5a85aa230c638b900c9ec6c386[\s\S]{0,120}SUBSTITUÍDO E NÃO AUTORIZADO PARA EXECUÇÃO/i);
});
test('argument parser rejects unknown options and local manifest does not need remote scope',()=>{assert.throws(()=>parseArgs(['--allow-write']),/Unsupported option/);assert.throws(()=>parseArgs(['--audit-scope']),/Missing value/);assert.ok(parseArgs(['--local-manifest']).flags.has('--local-manifest'));});
test('Markdown report marks inaccessible operational information as not verified rather than absent',()=>{const text=renderMarkdown({generatedAt:'2026-11-01T00:00:00Z',scope:'metadata-only',projectRef:ref,migrationCount:0,sections:{operationalData:{status:'NOT_VERIFIED',reason:'excluded'}}});assert.match(text,/metadata-only/);assert.match(text,/NÃO VERIFICADO/);assert.doesNotMatch(text,/secret|password|token/i);});
