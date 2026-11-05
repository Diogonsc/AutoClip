#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const container='supabase_db_tiktok-saas';
const suffix=randomBytes(4).toString('hex');
const database=`autoclip_audit_test_${suffix}`;
const role=`autoclip_cloud_auditor_test_${suffix}`;
const parentRole=`autoclip_admin_parent_test_${suffix}`;
const memberRole=`autoclip_admin_member_test_${suffix}`;
const operatorRole=`autoclip_admin_operator_test_${suffix}`;
const fixturePassword=randomBytes(32).toString('hex');
const operatorPassword=randomBytes(32).toString('hex');
const fixturePassfile=`/tmp/autoclip_gate3101_${suffix}.pgpass`;
const sqlRoot=resolve(fileURLToPath(new URL('./admin-readonly/',import.meta.url)));
const oldSqlRoot=resolve(fileURLToPath(new URL('./sql/',import.meta.url)));
let dbCreated=false,roleCreated=false,fixturePassfileCreated=false,activeFixturePid=null;

function run(args,{input,allowFailure=false,app='autoclip_gate36_admin_readonly_test'}={}){
  const result=spawnSync('docker',args,{input,encoding:'utf8',timeout:60_000,maxBuffer:16*1024*1024});
  if(result.error)throw result.error;
  if(!allowFailure&&result.status!==0)throw new Error(`${result.stderr||''}\n${result.stdout||''}`.trim());
  return {status:result.status,stdout:result.stdout,stderr:result.stderr};
}
function localPsql(sql,{allowFailure=false,base=false}={}){
  const appName='autoclip_gate36_admin_readonly_test';
  const args=['exec','-i','-e',`PGAPPNAME=${appName}`];
  args.push(container,'psql','-X','-q','-U','supabase_admin','-d',base?'postgres':database,'-A','-t','-v','ON_ERROR_STOP=1',
    '-v','audit_local_test=true','-v',`audit_role=${role}`,'-v',`audit_database=${database}`,'-f','-');
  return run(args,{input:sql,allowFailure});
}
async function cloudGuardProbe({projectRef='djrwfvcxgpyknmizqumn',targetRole='autoclip_cloud_auditor'}){
  const guard=await load(sqlRoot,'_guard.psql');
  return run(['exec','-i','-e','PGAPPNAME=autoclip_gate36_admin_readonly',container,'psql','-X','-U','supabase_admin','-d',database,'-A','-t','-v','ON_ERROR_STOP=1',
    '-v','audit_local_test=false','-v','cloud_admin_approved=true','-v',`cloud_project_ref=${projectRef}`,
    '-v','audit_database=postgres','-v',`audit_role=${targetRole}`,'-f','-'],{input:guard,allowFailure:true});
}
async function localNoTlsGuardProbe(){
  const guard=await load(sqlRoot,'_guard.psql');
  return run(['exec','-i','-e','PGAPPNAME=autoclip_gate36_admin_readonly',container,'psql','-X','-U','postgres','-d','postgres','-A','-t','-v','ON_ERROR_STOP=1',
    '-v','audit_local_test=false','-v','cloud_admin_approved=true','-v','cloud_project_ref=djrwfvcxgpyknmizqumn',
    '-v','audit_database=postgres','-v','audit_role=autoclip_cloud_auditor','-f','-'],{input:guard,allowFailure:true});
}
async function load(dir,name){return readFile(resolve(dir,name),'utf8');}
async function includeAdmin(name){
  const source=await load(sqlRoot,name),guard=await load(sqlRoot,'_guard.psql');
  return source.replaceAll('autoclip_cloud_auditor',role).replace('\\ir _guard.psql',()=>guard);
}
async function includeRemoval(){
  const source=await load(oldSqlRoot,'metadata-only/04_remove_metadata_role.sql');
  const guard=await load(oldSqlRoot,'_guard.psql');
  return source.replace('\\ir ../_guard.psql',()=>guard).replaceAll('autoclip_cloud_auditor',role);
}
function lastJson(output){const line=output.split(/\r?\n/).reverse().find(x=>x.trim().startsWith('{'));if(!line)throw new Error(`No JSON output: ${output}`);return JSON.parse(line);}

try{
  const context=run(['context','show'],{app:'autoclip_gate36_admin_readonly_test'}).stdout.trim();
  const endpoint=run(['context','inspect',context,'--format','{{json .Endpoints.docker.Host}}'],{app:'autoclip_gate36_admin_readonly_test'}).stdout.trim();
  if(!endpoint.startsWith('"unix://'))throw new Error('Refusing local admin SQL test: Docker context is not a local Unix socket.');
  const identity=run(['inspect',container,'--format','{{.Name}}|{{index .Config.Labels "com.supabase.cli.project"}}'],{app:'autoclip_gate36_admin_readonly_test'}).stdout.trim();
  if(identity!=='/supabase_db_tiktok-saas|tiktok-saas')throw new Error(`Unexpected local DB container identity: ${identity}`);
  const server=run(['exec',container,'psql','-X','-U','supabase_admin','-d','postgres','-Atc',"SELECT current_setting('server_version_num')::int"],{app:'autoclip_gate36_admin_readonly_test'}).stdout.trim();
  if(Number(server)<170000)throw new Error(`PostgreSQL 17 required, local server version_num=${server}`);
  run(['exec',container,'createdb','-U','supabase_admin',database],{app:'autoclip_gate36_admin_readonly_test'});dbCreated=true;
  roleCreated=true;
  run(['exec','-i',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-f','-'],{
    app:'autoclip_gate36_admin_readonly_test',input:`
      CREATE ROLE ${role} LOGIN PASSWORD '${fixturePassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1 VALID UNTIL '2026-11-15 00:43:58+00';
      COMMENT ON ROLE ${role} IS 'autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn';
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
      INSERT INTO supabase_migrations.schema_migrations VALUES ('fixture-version-only');
      CREATE TABLE public.audit_acl_fixture(id integer PRIMARY KEY);
      ALTER TABLE public.audit_acl_fixture ENABLE ROW LEVEL SECURITY;
      CREATE POLICY audit_acl_fixture_read ON public.audit_acl_fixture FOR SELECT USING (true);
      GRANT MAINTAIN ON TABLE public.audit_acl_fixture TO ${role};
      CREATE ROLE ${parentRole} NOLOGIN;
      CREATE ROLE ${memberRole} NOLOGIN;
      CREATE ROLE ${operatorRole} LOGIN CREATEROLE NOINHERIT NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD '${operatorPassword}';
      GRANT ${parentRole} TO ${role};
      GRANT ${role} TO ${memberRole};
    `});

  const badProject=await cloudGuardProbe({projectRef:'wrong-project-ref'});
  const badRole=await cloudGuardProbe({targetRole:'postgres'});
  if(badProject.status===0||badRole.status===0)throw new Error('Cloud guard accepted a mismatched project or role in the local guard test.');
  const noTls=await localNoTlsGuardProbe();
  if(noTls.status===0)throw new Error('Administrative guard accepted an unencrypted local socket as TLS-verified Cloud transport.');
  const diagnosticSql=await includeAdmin('00_role_containment_diagnostic.sql');
  if(/30_disable_role|04_remove_metadata_role|ALTER ROLE|pg_terminate_backend|DROP ROLE/i.test(diagnosticSql))throw new Error('Read-only diagnostic references a containment or removal operation.');
  const snapshotSql=`SELECT jsonb_build_object('role_flags',(SELECT jsonb_build_array(rolcanlogin,rolvaliduntil,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls) FROM pg_roles WHERE rolname='${role}'),'relations',(SELECT count(*) FROM pg_class),'ledger_rows',(SELECT count(*) FROM supabase_migrations.schema_migrations),'memberships',(SELECT count(*) FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname='${role}') OR member=(SELECT oid FROM pg_roles WHERE rolname='${role}')))\n`;
  const before=lastJson(localPsql(snapshotSql).stdout);
  const diagnosticOutput=localPsql(diagnosticSql).stdout;
  const state=lastJson(diagnosticOutput);
  if(!state.role_present||!state.marker_matches||!state.can_login||state.membership_edges.length!==2||state.active_session_count!==0)throw new Error(`Role state diagnostic did not report both membership directions: ${JSON.stringify(state)}`);
  if(/access_token|refresh_token|client_addr|query_text|"query"|email/i.test(diagnosticOutput))throw new Error('Containment diagnostic output unexpectedly contains sensitive fields.');
  const sanitized=spawnSync('jq',['-e',`{
    role_present,role,marker_matches,can_login,valid_until,connection_limit,
    superuser,inherit,create_role,create_db,replication,bypass_rls,database_privileges,
    membership_edges,effective_memberships,active_session_count,
    active_session_states:((.active_sessions // [])|map(.state // "unknown")|group_by(.)|map({state:.[0],count:length})),
    dependency_counts:([.shared_dependencies[].dependency_type]|group_by(.)|map({type:.[0],count:length}))
  }`],{input:diagnosticOutput,encoding:'utf8'});
  if(sanitized.error||sanitized.status!==0)throw new Error(`Sanitized jq summary rejected the actual diagnostic output: ${sanitized.stderr||sanitized.error}`);
  const summary=JSON.parse(sanitized.stdout);
  if(summary.role!==role||summary.active_session_count!==0||summary.active_session_states.length!==0||'active_sessions' in summary||'shared_dependencies' in summary)throw new Error('Sanitized jq summary is incomplete, miscounts an empty session list, or exposes raw diagnostic details.');
  const after=lastJson(localPsql(snapshotSql).stdout);
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error(`Read-only diagnostic changed fixture state: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  const inventory=localPsql(await includeAdmin('10_catalog_inventory.sql')).stdout;
  if(!inventory.includes('READ_ONLY_VERSION_METADATA')||!inventory.includes('fixture-version-only')||!inventory.includes('SECTION extension_membership')||!inventory.includes('SECTION cron_net_storage_catalog_only'))throw new Error('Catalog inventory sections or guarded ledger version are missing.');
  if(!inventory.includes('MAINTAIN'))throw new Error('PostgreSQL 17 MAINTAIN ACL entry was not emitted.');
  if(!inventory.includes(parentRole)||!inventory.includes(memberRole))throw new Error('Membership edges were not inventoried in both directions.');
  const removal=lastJson(localPsql(await includeAdmin('20_removal_preflight.sql')).stdout);
  if(!removal.role_present||!removal.marker_matches||!removal.memberships_both_directions||removal.memberships_both_directions.length!==2)throw new Error(`Removal preflight did not detect both membership directions: ${JSON.stringify(removal)}`);
  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`REVOKE ${parentRole} FROM ${role}; REVOKE ${role} FROM ${memberRole}; DROP ROLE ${parentRole}; DROP ROLE ${memberRole};`],{app:'autoclip_gate36_admin_readonly_test'});
  const clearRemoval=lastJson(localPsql(await includeAdmin('20_removal_preflight.sql')).stdout);
  if(clearRemoval.memberships_both_directions.length!==0||clearRemoval.shared_dependencies.length===0)throw new Error('Removal preflight did not distinguish cleared memberships from a remaining ACL dependency.');
  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`REVOKE MAINTAIN ON TABLE public.audit_acl_fixture FROM ${role};`],{app:'autoclip_gate36_admin_readonly_test'});
  const readyRemoval=lastJson(localPsql(await includeAdmin('20_removal_preflight.sql')).stdout);
  if(readyRemoval.shared_dependencies.length!==0)throw new Error(`Unexpected dependency remains after fixture grant was revoked: ${JSON.stringify(readyRemoval.shared_dependencies)}`);

  const nologinSql=await includeAdmin('31_disable_role_nologin.sql');
  const loginStateSql=`SELECT jsonb_build_object('can_login',r.rolcanlogin,'createdb',r.rolcreatedb,'connlimit',r.rolconnlimit,'valid_until',r.rolvaliduntil,'acl',(SELECT relacl::text FROM pg_class WHERE oid='public.audit_acl_fixture'::regclass),'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.audit_acl_fixture'::regclass),'policy_count',(SELECT count(*) FROM pg_policy WHERE polrelid='public.audit_acl_fixture'::regclass),'membership_count',(SELECT count(*) FROM pg_auth_members WHERE roleid=r.oid OR member=r.oid),'dependency_count',(SELECT count(*) FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=r.oid),'other_roles',(SELECT jsonb_agg(jsonb_build_array(rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('postgres','supabase_admin'))) FROM pg_roles r WHERE r.rolname='${role}'
`;
  const noLoginFail=(label)=>{
    const result=localPsql(nologinSql,{allowFailure:true});
    if(result.status===0)throw new Error(`NOLOGIN containment unexpectedly accepted ${label}.`);
    const state=lastJson(localPsql(loginStateSql).stdout);
    if(!state.can_login)throw new Error(`Failed precondition ${label} altered LOGIN state.`);
  };

  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`COMMENT ON ROLE ${role} IS 'wrong marker'`],{app:'autoclip_gate36_admin_readonly_test'});
  await noLoginFail('marker mismatch');
  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`COMMENT ON ROLE ${role} IS 'autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn'`],{app:'autoclip_gate36_admin_readonly_test'});

  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`ALTER ROLE ${role} CREATEDB`],{app:'autoclip_gate36_admin_readonly_test'});
  await noLoginFail('unexpected administrative attribute');
  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`ALTER ROLE ${role} NOCREATEDB`],{app:'autoclip_gate36_admin_readonly_test'});

  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`ALTER ROLE ${role} VALID UNTIL '2026-11-16 00:43:58+00'`],{app:'autoclip_gate36_admin_readonly_test'});
  await noLoginFail('unexpected validity timestamp');
  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`ALTER ROLE ${role} VALID UNTIL '2026-11-15 00:43:58+00'`],{app:'autoclip_gate36_admin_readonly_test'});

  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`ALTER ROLE ${role} CONNECTION LIMIT 2`],{app:'autoclip_gate36_admin_readonly_test'});
  await noLoginFail('unexpected connection limit');
  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`ALTER ROLE ${role} CONNECTION LIMIT 1`],{app:'autoclip_gate36_admin_readonly_test'});

  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`CREATE ROLE ${parentRole} NOLOGIN; GRANT ${parentRole} TO ${role}`],{app:'autoclip_gate36_admin_readonly_test'});
  await noLoginFail('unexpected role membership');
  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`REVOKE ${parentRole} FROM ${role}; DROP ROLE ${parentRole}`],{app:'autoclip_gate36_admin_readonly_test'});

  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`GRANT MAINTAIN ON TABLE public.audit_acl_fixture TO ${role}`],{app:'autoclip_gate36_admin_readonly_test'});
  await noLoginFail('unexpected owned/granted dependency');
  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`REVOKE MAINTAIN ON TABLE public.audit_acl_fixture FROM ${role}`],{app:'autoclip_gate36_admin_readonly_test'});

  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`GRANT ${role} TO postgres WITH ADMIN OPTION, INHERIT FALSE, SET FALSE`],{app:'autoclip_gate36_admin_readonly_test'});
  fixturePassfileCreated=true;
  run(['exec','-i',container,'sh','-c','umask 077; cat > "$1"; chmod 600 "$1"','sh',fixturePassfile],{
    app:'autoclip_gate36_admin_readonly_test',input:`127.0.0.1:5432:${database}:${role}:${fixturePassword}\n127.0.0.1:5432:${database}:${operatorRole}:${operatorPassword}\n`});
  const fixtureAuth=run(['exec','-e',`PGPASSFILE=${fixturePassfile}`,'-e','PGAPPNAME=autoclip_gate3101_fixture_probe',container,'psql','-X','-h','127.0.0.1','-U',role,'-d',database,'-Atc','SELECT current_user'],{app:'autoclip_gate36_admin_readonly_test'}).stdout.trim();
  if(fixtureAuth!==role)throw new Error('Real local password authentication as the fixture role failed.');
  const activeSession=spawn('docker',['exec','-e',`PGPASSFILE=${fixturePassfile}`,'-e','PGAPPNAME=autoclip_gate3101_active_fixture',container,'psql','-X','-h','127.0.0.1','-U',role,'-d',database,'-v','ON_ERROR_STOP=1','-c','SELECT pg_sleep(60)'],{stdio:'ignore'});
  const activeClose=new Promise(resolve=>activeSession.once('close',resolve));
  let fixturePid=0;
  for(let attempt=0;attempt<80;attempt++){
    const pid=Number(localPsql(`SELECT pid FROM pg_stat_activity WHERE usename='${role}' AND application_name='autoclip_gate3101_active_fixture' LIMIT 1`).stdout.trim());
    if(pid>0){fixturePid=pid;activeFixturePid=pid;break;}
    if(activeSession.exitCode!==null)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!fixturePid){activeSession.kill('SIGTERM');await Promise.race([activeClose,new Promise(resolve=>setTimeout(resolve,2_000))]);throw new Error('Could not observe the real local session authenticated as the fixture role.');}
  await noLoginFail('active authenticated session');
  const cancelled=localPsql(`SELECT pg_cancel_backend(${fixturePid})`).stdout.trim();
  if(cancelled!=='t')throw new Error('Could not cancel only the isolated fixture query after the NOLOGIN precheck test.');
  await Promise.race([activeClose,new Promise(resolve=>setTimeout(resolve,5_000))]);
  let fixtureSessionCleared=false;
  for(let attempt=0;attempt<50;attempt++){
    const count=Number(localPsql(`SELECT count(*) FROM pg_stat_activity WHERE usename='${role}' AND pid<>pg_backend_pid()`).stdout.trim());
    if(count===0){fixtureSessionCleared=true;break;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!fixtureSessionCleared)throw new Error('Isolated authenticated fixture session did not close after its query was cancelled.');
  activeFixturePid=null;

  const operatorPrivileges=run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-Atc',
    `SELECT (NOT rolsuper AND NOT has_table_privilege(oid,'pg_catalog.pg_authid','SELECT')) FROM pg_roles WHERE rolname='${operatorRole}'`],
  {app:'autoclip_gate36_admin_readonly_test'}).stdout.trim();
  if(operatorPrivileges!=='t')throw new Error('Limited operator fixture unexpectedly has SUPERUSER or SELECT on pg_authid.');
  const operatorGuard=(await load(sqlRoot,'_guard.psql'))
    .replace("inet_server_addr() IS NULL","inet_server_addr() IS NOT NULL")
    .replace("current_user='supabase_admin' AND session_user='supabase_admin'",`current_user='${operatorRole}' AND session_user='${operatorRole}'`);
  if(operatorGuard===(await load(sqlRoot,'_guard.psql')))throw new Error('Could not construct the test-only limited-operator guard adaptation.');
  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',
    `REVOKE ${role} FROM postgres; GRANT ${role} TO ${operatorRole} WITH ADMIN OPTION, INHERIT FALSE, SET FALSE`],
  {app:'autoclip_gate36_admin_readonly_test'});
  const operatorSql=nologinSql
    .replace("inet_server_addr() IS NULL","inet_server_addr() IS NOT NULL")
    .replace("current_user='supabase_admin' AND session_user='supabase_admin'",`current_user='${operatorRole}' AND session_user='${operatorRole}'`)
    .replaceAll("member.rolname='postgres'",`member.rolname='${operatorRole}'`);
  const operatorContext=run(['exec','-e',`PGPASSFILE=${fixturePassfile}`,'-e','PGAPPNAME=autoclip_gate36_admin_readonly_test',
    container,'psql','-X','-h','127.0.0.1','-U',operatorRole,'-d',database,'-Atc',
    "SELECT current_database()||'|'||coalesce(inet_server_addr()::text,'NULL')||'|'||current_user||'|'||session_user||'|'||current_setting('application_name')"],
  {app:'autoclip_gate36_admin_readonly_test'}).stdout.trim();
  const limitedActiveSession=spawn('docker',['exec','-e',`PGPASSFILE=${fixturePassfile}`,'-e','PGAPPNAME=autoclip_gate3101_limited_active_fixture',
    container,'psql','-X','-h','127.0.0.1','-U',role,'-d',database,'-v','ON_ERROR_STOP=1','-c','SELECT pg_sleep(60)'],{stdio:'ignore'});
  const limitedActiveClose=new Promise(resolve=>limitedActiveSession.once('close',resolve));
  let limitedFixturePid=0;
  for(let attempt=0;attempt<80;attempt++){
    const pid=Number(localPsql(`SELECT pid FROM pg_stat_activity WHERE usename='${role}' AND application_name='autoclip_gate3101_limited_active_fixture' LIMIT 1`).stdout.trim());
    if(pid>0){limitedFixturePid=pid;activeFixturePid=pid;break;}
    if(limitedActiveSession.exitCode!==null)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!limitedFixturePid)throw new Error('Could not observe the second authenticated fixture session for the limited-operator precheck.');
  const limitedActiveAttempt=run(['exec','-i','-e',`PGPASSFILE=${fixturePassfile}`,'-e','PGAPPNAME=autoclip_gate36_admin_readonly_test',
    container,'psql','-X','-h','127.0.0.1','-U',operatorRole,'-d',database,'-A','-t','-v','ON_ERROR_STOP=1',
    '-v','audit_local_test=true','-v',`audit_role=${role}`,'-v',`audit_database=${database}`,'-f','-'],
  {input:operatorSql,app:'autoclip_gate36_admin_readonly_test',allowFailure:true});
  if(limitedActiveAttempt.status===0||!limitedActiveAttempt.stdout.includes('ABORT: role identity/state'))throw new Error(`Limited operator did not block the active target session before mutation: ${limitedActiveAttempt.stdout} ${limitedActiveAttempt.stderr}`);
  if(!lastJson(localPsql(loginStateSql).stdout).can_login)throw new Error('Active-session precheck changed LOGIN under the limited operator.');
  if(localPsql(`SELECT pg_cancel_backend(${limitedFixturePid})`).stdout.trim()!=='t')throw new Error('Could not cancel the isolated second fixture query.');
  await Promise.race([limitedActiveClose,new Promise(resolve=>setTimeout(resolve,5_000))]);
  let limitedSessionCleared=false;
  for(let attempt=0;attempt<50;attempt++){
    const count=Number(localPsql(`SELECT count(*) FROM pg_stat_activity WHERE usename='${role}' AND pid<>pg_backend_pid()`).stdout.trim());
    if(count===0){limitedSessionCleared=true;break;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!limitedSessionCleared)throw new Error('The second isolated fixture session did not close after cancellation.');
  activeFixturePid=null;
  const operatorResult=run(['exec','-i','-e',`PGPASSFILE=${fixturePassfile}`,'-e','PGAPPNAME=autoclip_gate36_admin_readonly_test',
    container,'psql','-X','-h','127.0.0.1','-U',operatorRole,'-d',database,'-A','-t','-v','ON_ERROR_STOP=1',
    '-v','audit_local_test=true','-v',`audit_role=${role}`,'-v',`audit_database=${database}`,'-f','-'],
  {input:operatorSql,app:'autoclip_gate36_admin_readonly_test',allowFailure:true});
  if(operatorResult.status!==0||!operatorResult.stdout.includes('NOLOGIN VERIFIED'))throw new Error(`Limited CREATEROLE operator without pg_authid SELECT could not complete containment (local session ${operatorContext}): ${operatorResult.stdout} ${operatorResult.stderr}`);
  if(lastJson(localPsql(loginStateSql).stdout).can_login)throw new Error('Limited operator containment did not persist NOLOGIN.');
  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',
    `ALTER ROLE ${role} LOGIN; REVOKE ${role} FROM ${operatorRole}; GRANT ${role} TO postgres WITH ADMIN OPTION, INHERIT FALSE, SET FALSE`],
  {app:'autoclip_gate36_admin_readonly_test'});

  const alterFailureSql=nologinSql.replace(`ALTER ROLE ${role} NOLOGIN;`,`ALTER ROLE autoclip_missing_fixture NOLOGIN;`);
  const alterFailure=localPsql(alterFailureSql,{allowFailure:true});
  if(alterFailure.status===0||!lastJson(localPsql(loginStateSql).stdout).can_login)throw new Error('ALTER ROLE failure did not leave the transaction unchanged.');

  const forcedFailureSql=nologinSql.replace(`ALTER ROLE ${role} NOLOGIN;`,`ALTER ROLE ${role} NOLOGIN;\n  SELECT 1/0;`);
  const interrupted=localPsql(forcedFailureSql,{allowFailure:true});
  if(interrupted.status===0||!lastJson(localPsql(loginStateSql).stdout).can_login)throw new Error('Injected SQL failure after ALTER did not fail closed and roll back locally.');

  const afterCommitSql=nologinSql.replace('\nCOMMIT;\n\n-- Independent persisted-state confirmation','\nCOMMIT;\nSELECT 1/0;\n\n-- Independent persisted-state confirmation');
  const afterCommitFailure=localPsql(afterCommitSql,{allowFailure:true});
  if(afterCommitFailure.status===0||lastJson(localPsql(loginStateSql).stdout).can_login)throw new Error('Failure after COMMIT did not leave the known committed NOLOGIN state.');
  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`ALTER ROLE ${role} LOGIN`],{app:'autoclip_gate36_admin_readonly_test'});

  const postVerifyFailureSql=nologinSql.replace(/(BEGIN READ ONLY;[\s\S]*?)NOT r\.rolcanlogin/,'$1r.rolcanlogin');
  const postVerifyFailure=localPsql(postVerifyFailureSql,{allowFailure:true});
  if(postVerifyFailure.status===0||lastJson(localPsql(loginStateSql).stdout).can_login)throw new Error('Post-commit verification failure was not reported while retaining committed NOLOGIN.');
  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`ALTER ROLE ${role} LOGIN`],{app:'autoclip_gate36_admin_readonly_test'});

  const beforeNoLogin=lastJson(localPsql(loginStateSql).stdout);
  const noLoginOutput=localPsql(nologinSql).stdout;
  if(!noLoginOutput.includes('NOLOGIN VERIFIED'))throw new Error(`Isolated NOLOGIN containment did not verify: ${noLoginOutput}`);
  const afterNoLogin=lastJson(localPsql(loginStateSql).stdout);
  const expectedAfterNoLogin={...beforeNoLogin,can_login:false};
  if(JSON.stringify(afterNoLogin)!==JSON.stringify(expectedAfterNoLogin))throw new Error(`Containment changed more than rolcanlogin: before=${JSON.stringify(beforeNoLogin)} after=${JSON.stringify(afterNoLogin)}`);
  const repeatedNoLogin=localPsql(nologinSql).stdout;
  if(!repeatedNoLogin.includes('already has NOLOGIN'))throw new Error('An already-disabled role was not handled idempotently.');
  run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-c',`REVOKE ${role} FROM postgres`],{app:'autoclip_gate36_admin_readonly_test'});

  const containment=localPsql(await includeAdmin('30_disable_role_and_terminate_sessions.sql')).stdout;
  if(!containment.includes('CONTAINMENT COMPLETE'))throw new Error(`Local containment fixture did not finish: ${containment}`);
  const disabled=run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-Atc',`SELECT (NOT rolcanlogin AND rolvaliduntil<=now()) FROM pg_roles WHERE rolname='${role}'`],{app:'autoclip_gate36_admin_readonly_test'}).stdout.trim();
  if(disabled!=='t')throw new Error('Local containment did not set NOLOGIN and expiry.');
  const removeResult=localPsql(await includeRemoval());
  if(!removeResult.stdout.includes('ROLE_ABSENT_VERIFIED'))throw new Error(`No-CASCADE local removal did not verify absent role: ${removeResult.stdout}`);
  roleCreated=false;
  const absentContainment=localPsql(await includeAdmin('31_disable_role_nologin.sql'),{allowFailure:true});
  if(absentContainment.status===0)throw new Error('NOLOGIN containment accepted a missing role.');
  console.log(JSON.stringify({status:'LOCAL_ADMIN_READONLY_PACKAGE_PASSED',database,postgresVersion:Number(server),readOnlySections:['role state','schemas/relations/ACLs','constraints','indexes','triggers','RLS policies','routine properties','memberships','extension dependencies','cron/net/storage catalog shape','guarded migration version','removal preflight'],containment:'separate NOLOGIN operation plus legacy session termination tested locally',removal:'no-CASCADE local removal verified',cloudConnection:false}));
}catch(error){
  console.error(error instanceof Error?error.message:String(error));
  process.exitCode=1;
}finally{
  if(fixturePassfileCreated)run(['exec',container,'rm','-f','--',fixturePassfile],{allowFailure:true,app:'autoclip_gate36_admin_readonly_test'});
  if(activeFixturePid)run(['exec',container,'psql','-X','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',`SELECT pg_cancel_backend(${activeFixturePid})`],{allowFailure:true,app:'autoclip_gate36_admin_readonly_test'});
  if(roleCreated){
    run(['exec',container,'psql','-X','-U','supabase_admin','-d','postgres','-c',`REVOKE ${role} FROM postgres`],{allowFailure:true,app:'autoclip_gate36_admin_readonly_test'});
    run(['exec',container,'psql','-X','-U','supabase_admin','-d','postgres','-c',`REVOKE ${role} FROM ${operatorRole}`],{allowFailure:true,app:'autoclip_gate36_admin_readonly_test'});
    run(['exec',container,'psql','-X','-U','supabase_admin','-d','postgres','-c',`REVOKE ${parentRole} FROM ${role}`],{allowFailure:true,app:'autoclip_gate36_admin_readonly_test'});
    run(['exec',container,'psql','-X','-U','supabase_admin','-d','postgres','-c',`REVOKE ${role} FROM ${memberRole}`],{allowFailure:true,app:'autoclip_gate36_admin_readonly_test'});
  }
  if(dbCreated){run(['exec',container,'dropdb','-U','supabase_admin','--if-exists',database],{allowFailure:true,app:'autoclip_gate36_admin_readonly_test'});}
  if(roleCreated){run(['exec',container,'psql','-X','-U','supabase_admin','-d','postgres','-c',`DROP ROLE IF EXISTS ${role}; DROP ROLE IF EXISTS ${parentRole}; DROP ROLE IF EXISTS ${memberRole}; DROP ROLE IF EXISTS ${operatorRole}`],{allowFailure:true,app:'autoclip_gate36_admin_readonly_test'});}
}
