#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditQueries, isSafePreflight } from './readonly-audit.mjs';

const container='supabase_db_tiktok-saas';
const suffix=randomBytes(4).toString('hex');
const database=`autoclip_audit_test_${suffix}`;
const role=`autoclip_cloud_auditor_test_${suffix}`;
const parentRole=`autoclip_audit_parent_test_${suffix}`;
const expiry=new Date(Date.now()+7*24*60*60*1000).toISOString();
const sqlDir=resolve(fileURLToPath(new URL('./sql/',import.meta.url)));
const projectRef='djrwfvcxgpyknmizqumn';
const pgpassPath=`/tmp/autoclip-audit-${suffix}.pgpass`;

function run(args,{input,allowFailure=false,redactInput=false}={}){
  const result=spawnSync('docker',args,{input,encoding:'utf8',timeout:60_000,maxBuffer:8*1024*1024});
  if(result.error)throw result.error;
  if(!allowFailure&&result.status!==0)throw new Error(`${result.stderr||''}\n${result.stdout||''}${redactInput?'':'\nSQL input excerpt:\n'+String(input??'').slice(0,1800)}`.trim());
  return {status:result.status,stdout:result.stdout,stderr:result.stderr};
}
function startActiveAuditorSession(){
  const child=spawn('docker',['exec','-i','-e',`PGPASSFILE=${pgpassPath}`,'-e','PGAPPNAME=autoclip-cloud-audit:djrwfvcxgpyknmizqumn',container,'psql','-X','-h','127.0.0.1','-U',role,'-d',database,'-A','-t','-v','ON_ERROR_STOP=1','-c','SELECT pg_sleep(60);'],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.setEncoding('utf8').on('data',chunk=>stdout+=chunk);child.stderr.setEncoding('utf8').on('data',chunk=>stderr+=chunk);
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal,stdout,stderr})));
  return {child,exited,get stdout(){return stdout;},get stderr(){return stderr;}};
}
function psql(script,{asAdmin=true,allowFailure=false,redactInput=false}={}){
  const args=['exec','-i',container,'psql','-X','-U','supabase_admin','-d',database,'-A','-t','-v','ON_ERROR_STOP=1'];
  if(asAdmin)args.push('-v','audit_local_test=true','-v',`audit_role=${role}`,'-v',`audit_database=${database}`,'-v',`audit_role_expiry=${expiry}`,'-v',`audit_parent_role=${parentRole}`);
  args.push('-f','-');return run(args,{input:script,allowFailure,redactInput});
}
async function include(file){
  const source=await readFile(resolve(sqlDir,'metadata-only',file),'utf8');
  const guard=await readFile(resolve(sqlDir,'_guard.psql'),'utf8');
  return `${source.replace('\\ir ../_guard.psql',()=>guard)}\n`;
}
async function readGuard(relative){return readFile(resolve(sqlDir,relative),'utf8');}
function parseLastJson(output){const line=output.split(/\r?\n/).reverse().find(x=>/^[{[]/.test(x.trim()));if(!line)throw new Error(`JSON result not found: ${output}`);return JSON.parse(line);}
function asAuditor(query,{allowFailure=false}={}){return psql(`SET SESSION AUTHORIZATION :"audit_role"; BEGIN READ ONLY;\n${query};\nROLLBACK; RESET SESSION AUTHORIZATION;`,{asAdmin:true,allowFailure});}

let dbCreated=false;let roleMayExist=false;let parentRoleMayExist=false;
try{
  const context=run(['context','show']).stdout.trim();
  const endpoint=run(['context','inspect',context,'--format','{{json .Endpoints.docker.Host}}']).stdout.trim();
  if(!endpoint.startsWith('"unix://'))throw new Error('Refusing local SQL test: Docker context is not a local Unix socket.');
  const identity=run(['inspect',container,'--format','{{.Name}}|{{index .Config.Labels "com.supabase.cli.project"}}']).stdout.trim();
  if(identity!=='/supabase_db_tiktok-saas|tiktok-saas')throw new Error(`Unexpected local DB container identity: ${identity}`);
  const env=JSON.parse(run(['exec',container,'psql','-X','-U','supabase_admin','-d','postgres','-Atc',"select jsonb_build_object('database',current_database(),'version',current_setting('server_version_num')::int,'superuser',r.rolsuper) from pg_roles r where r.rolname=current_user"]).stdout.trim());
  if(env.database!=='postgres'||env.version<140000||!env.superuser)throw new Error('Local Supabase PostgreSQL identity/version check failed.');
  run(['exec',container,'createdb','-U','supabase_admin',database]);dbCreated=true;
  psql(`CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, inserted_at timestamptz);
    INSERT INTO supabase_migrations.schema_migrations VALUES ('20261103000008',now());
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id integer PRIMARY KEY, email text, encrypted_password text);
    CREATE TABLE public.oauth_tokens(id integer PRIMARY KEY, access_token text, refresh_token text);
    CREATE TABLE public.business_fixture(id integer PRIMARY KEY, secret text);
    INSERT INTO public.business_fixture VALUES (1,'must-not-be-readable');
    CREATE FUNCTION public.autoclip_sensitive_rpc() RETURNS text LANGUAGE sql AS $$SELECT 'sensitive'::text$$;
    REVOKE ALL ON FUNCTION public.autoclip_sensitive_rpc() FROM PUBLIC;
    ALTER TABLE public.business_fixture OWNER TO postgres;
    ALTER TABLE supabase_migrations.schema_migrations OWNER TO postgres;`);

  roleMayExist=true;
  const createRoleSql=await include('00_create_role.sql');
  const grantMinimumSql=await include('01_grant_minimum_permissions.sql');
  const verifyMetadataSql=await include('02_verify_metadata_readonly.sql');
  const guardCloudTargetMismatch=run(['exec','-i',container,'psql','-X','-U','supabase_admin','-d',database,'-A','-t','-v','ON_ERROR_STOP=1','-v','audit_local_test=false','-v','cloud_admin_approved=true','-v',`cloud_project_ref=${projectRef}`,'-v','audit_database=postgres','-v',`audit_role=${role}`,'-f','-'],{input:await readGuard('_guard.psql'),allowFailure:true});
  if(guardCloudTargetMismatch.status===0||!`${guardCloudTargetMismatch.stdout}\n${guardCloudTargetMismatch.stderr}`.includes('connected database is not the approved postgres database'))throw new Error('Administrative guard did not fail closed when declared database differed from the actual connected database.');
  psql(createRoleSql);
  const allowedGrantsAbsent=()=>{
    const state=parseLastJson(psql(`SELECT jsonb_build_object(
      'direct_connect',EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=:'audit_database' AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname=:'audit_role') AND a.privilege_type='CONNECT'),
      'direct_ledger_usage',EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE n.nspname='supabase_migrations' AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname=:'audit_role') AND a.privilege_type='USAGE'),
      'direct_ledger_version',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute at ON at.attrelid=c.oid CROSS JOIN LATERAL aclexplode(at.attacl) a WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations' AND at.attname='version' AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname=:'audit_role') AND a.privilege_type='SELECT'))`).stdout);
    if(state.direct_connect||state.direct_ledger_usage||state.direct_ledger_version)throw new Error(`A rejected pre-grant state still received an allowlisted grant: ${JSON.stringify(state)}`);
  };
  const pregrantMustReject=(setup,cleanup,label)=>{
    psql(setup);
    try{
      const attempt=psql(grantMinimumSql,{allowFailure:true});
      if(attempt.status===0||!`${attempt.stdout}\n${attempt.stderr}`.includes('metadata_audit_pregrant_check_blocked'))throw new Error(`Pre-grant checker did not fail closed for ${label}: ${attempt.stdout} ${attempt.stderr}`);
      allowedGrantsAbsent();
    }finally{psql(cleanup);}
  };
  pregrantMustReject(
    `GRANT SELECT ON public.business_fixture TO :"audit_role";`,
    `REVOKE SELECT ON public.business_fixture FROM :"audit_role";`,
    'direct business-table SELECT');
  pregrantMustReject(
    `GRANT USAGE ON SCHEMA auth TO :"audit_role";`,
    `REVOKE USAGE ON SCHEMA auth FROM :"audit_role";`,
    'application-schema USAGE');
  psql('CREATE SEQUENCE public.audit_gate3_fixture_seq;');
  pregrantMustReject(
    `GRANT USAGE ON SEQUENCE public.audit_gate3_fixture_seq TO :"audit_role";`,
    `REVOKE USAGE ON SEQUENCE public.audit_gate3_fixture_seq FROM :"audit_role";`,
    'sequence USAGE');
  psql('DROP SEQUENCE public.audit_gate3_fixture_seq;');
  pregrantMustReject(
    `GRANT EXECUTE ON FUNCTION public.autoclip_sensitive_rpc() TO :"audit_role";`,
    `REVOKE EXECUTE ON FUNCTION public.autoclip_sensitive_rpc() FROM :"audit_role";`,
    'function EXECUTE');
  pregrantMustReject(
    `GRANT EXECUTE ON FUNCTION public.autoclip_sensitive_rpc() TO PUBLIC;`,
    `REVOKE EXECUTE ON FUNCTION public.autoclip_sensitive_rpc() FROM PUBLIC;`,
    'PUBLIC function EXECUTE');
  pregrantMustReject(
    `GRANT SELECT ON public.business_fixture TO PUBLIC;`,
    `REVOKE SELECT ON public.business_fixture FROM PUBLIC;`,
    'PUBLIC business-table SELECT');
  pregrantMustReject(
    `GRANT TEMP ON DATABASE :"audit_database" TO :"audit_role";`,
    `REVOKE TEMP ON DATABASE :"audit_database" FROM :"audit_role";`,
    'direct TEMP');
  pregrantMustReject(
    `GRANT CREATE ON DATABASE postgres TO :"audit_role";`,
    `REVOKE CREATE ON DATABASE postgres FROM :"audit_role";`,
    'non-target database CREATE');
  pregrantMustReject(
    `GRANT SELECT ON public.business_fixture TO :"audit_role" WITH GRANT OPTION;`,
    `REVOKE GRANT OPTION FOR SELECT ON public.business_fixture FROM :"audit_role"; REVOKE SELECT ON public.business_fixture FROM :"audit_role";`,
    'grant option');
  const localExceptionStart=grantMinimumSql.indexOf("      AND NOT (\n        :'audit_local_test'::boolean");
  const localExceptionEnd=grantMinimumSql.indexOf('\n      )',localExceptionStart)+'\n      )'.length;
  if(localExceptionStart<0||localExceptionEnd<'\n      )'.length)throw new Error('Could not isolate the harness-only database exception.');
  const strictCloudConnectSql=grantMinimumSql.slice(0,localExceptionStart)+'      AND true'+grantMinimumSql.slice(localExceptionEnd);
  const strictCloudConnect=psql(strictCloudConnectSql,{allowFailure:true});
  if(strictCloudConnect.status===0||!`${strictCloudConnect.stdout}\n${strictCloudConnect.stderr}`.includes('metadata_audit_pregrant_check_blocked'))throw new Error('Cloud-strict branch accepted PUBLIC CONNECT access to non-target databases.');
  allowedGrantsAbsent();
  parentRoleMayExist=true;
  psql(`CREATE ROLE :"audit_parent_role" NOLOGIN; GRANT :"audit_parent_role" TO :"audit_role";`);
  pregrantMustReject('',`REVOKE :"audit_parent_role" FROM :"audit_role"; DROP ROLE :"audit_parent_role";`,'role membership');
  parentRoleMayExist=false;
  psql(`ALTER TABLE public.business_fixture OWNER TO :"audit_role";`);
  pregrantMustReject('',`ALTER TABLE public.business_fixture OWNER TO postgres;`,'object ownership');
  psql(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO :"audit_role";`);
  pregrantMustReject('',`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT ON TABLES FROM :"audit_role";`,'default privileges');
  psql(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC;`);
  pregrantMustReject('',`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT ON TABLES FROM PUBLIC;`,'PUBLIC default privileges');
  const pregrantLargeObject=parseLastJson(psql(`SELECT lo_create(0) AS oid \\gset
    GRANT SELECT ON LARGE OBJECT :oid TO :"audit_role";
    SELECT jsonb_build_object('oid',:'oid');`).stdout);
  const pregrantLargeObjectOid=pregrantLargeObject.oid;
  pregrantMustReject('',`REVOKE SELECT ON LARGE OBJECT ${pregrantLargeObjectOid} FROM :"audit_role"; SELECT lo_unlink(${pregrantLargeObjectOid});`,'large-object access');

  // In an isolated copy of the script, stub only the precheck result so an
  // injected post-GRANT error can prove PostgreSQL rolls back the transaction.
  const precheckStart=grantMinimumSql.indexOf('WITH r AS');
  const precheckEnd=grantMinimumSql.indexOf('\\gset',precheckStart)+'\\gset'.length;
  if(precheckStart<0||precheckEnd<'\\gset'.length)throw new Error('Could not locate the precheck result in the local SQL fixture.');
  const forcedFailureSql=grantMinimumSql.slice(0,precheckStart)
    +'SELECT true AS role_preconditions,0 AS violation_count,NULL::text AS violation_reasons\\gset'
    +grantMinimumSql.slice(precheckEnd)
    .replace('GRANT CONNECT ON DATABASE :"audit_database" TO :"audit_role";', 'GRANT CONNECT ON DATABASE :"audit_database" TO :"audit_role";\nGRANT SELECT ON TABLE public.audit_gate3_missing_fixture TO :"audit_role";');
  const forcedFailure=psql(forcedFailureSql,{allowFailure:true});
  if(forcedFailure.status===0||!`${forcedFailure.stdout}\n${forcedFailure.stderr}`.includes('audit_gate3_missing_fixture'))throw new Error(`Injected post-GRANT SQL error did not fail the local transaction: status=${forcedFailure.status} stdout=${forcedFailure.stdout} stderr=${forcedFailure.stderr}`);
  allowedGrantsAbsent();

  const install=psql(`${grantMinimumSql}${verifyMetadataSql}`);
  const verify=parseLastJson(install.stdout);
  if(verify.role!==role||verify.role_marker_matches!==true||verify.verification_safe!==true||!verify.login||verify.superuser||verify.inherit||verify.create_role||verify.create_db||verify.replication||verify.bypass_rls||verify.business_relation_select||verify.business_schema_usage||verify.unapproved_schema_usage||verify.unapproved_relation_reads||verify.unapproved_sequence_access||verify.persistent_write||verify.ledger_table_select||!verify.ledger_version_select||verify.executable_application_functions||verify.large_object_access||verify.grant_option||verify.default_privileges_for_public_or_auditor||verify.owned_objects||verify.membership_count!==0||verify.connection_limit!==1||verify.role_defaults?.default_transaction_read_only!=='on'||verify.role_defaults?.statement_timeout!=='20s'||verify.role_defaults?.lock_timeout!=='3s'||verify.role_defaults?.idle_in_transaction_session_timeout!=='30s')throw new Error(`Minimum role verification failed: ${JSON.stringify(verify)}`);
  psql(grantMinimumSql);
  const assertVerifierBlocks=(label)=>{const result=psql(verifyMetadataSql,{allowFailure:true});if(result.status===0)throw new Error(`SQL privilege verifier accepted unexpected condition: ${label}`);};
  const duplicateCreate=psql(createRoleSql,{allowFailure:true});
  if(duplicateCreate.status===0)throw new Error(`Duplicate role creation unexpectedly succeeded: ${duplicateCreate.stdout} ${duplicateCreate.stderr}`);
  psql(`COMMENT ON ROLE :"audit_role" IS 'incorrect-marker';`);
  try{const wrongMarker=psql(grantMinimumSql,{allowFailure:true});if(wrongMarker.status===0)throw new Error('Grant script accepted a role with an incorrect provenance marker.');const wrongMarkerVerify=psql(verifyMetadataSql,{allowFailure:true});if(wrongMarkerVerify.status===0)throw new Error('Privilege verifier accepted an incorrect role provenance marker.');}
  finally{psql(`COMMENT ON ROLE :"audit_role" IS 'autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn';`);}

  const preflight=parseLastJson(asAuditor(auditQueries.preflight).stdout);
  if(isSafePreflight(preflight))throw new Error('PUBLIC TEMP must be denied without project-bound opt-in.');
  const testScope={projectRef,allowPublicTempProjectRef:projectRef,allowLocalTestRole:true};
  if(!isSafePreflight(preflight,testScope))throw new Error(`Preflight rejected expected restricted metadata role: ${JSON.stringify(preflight)}`);
  if(preflight.temp_acl_sources.public!==true||preflight.temp_acl_sources.direct!==false||preflight.temp_acl_sources.membership!==false||preflight.temp_acl_sources.public_grant_option!==false)throw new Error(`TEMP provenance was not exactly PUBLIC: ${JSON.stringify(preflight.temp_acl_sources)}`);

  const catalogResults={};
  for(const [name,query] of Object.entries(auditQueries)){
    if(name==='preflight'||name==='migrationVersions')continue;
    catalogResults[name]=asAuditor(query).stdout;
  }
  const visibleSchemas=parseLastJson(catalogResults.schemas);
  const visibleRoutines=parseLastJson(catalogResults.routines);
  if(visibleSchemas.some(item=>item.schema==='autoclip_audit')||visibleRoutines.some(item=>item.name==='inventory_summary'))throw new Error('Metadata-only fixture unexpectedly contains the excluded projection schema/function.');
  const ledger=parseLastJson(asAuditor(auditQueries.migrationVersions).stdout);
  if(JSON.stringify(ledger)!=='["20261103000008"]')throw new Error(`Ledger version access mismatch: ${JSON.stringify(ledger)}`);

  psql(`REVOKE SELECT (version) ON supabase_migrations.schema_migrations FROM :"audit_role"; REVOKE USAGE ON SCHEMA supabase_migrations FROM :"audit_role"; ALTER TABLE supabase_migrations.schema_migrations ENABLE ROW LEVEL SECURITY;`);
  const rlsLedgerGrant=psql(grantMinimumSql);
  const rlsLedgerVerification=parseLastJson(psql(verifyMetadataSql).stdout);
  if(!rlsLedgerVerification.verification_safe||rlsLedgerVerification.ledger_schema_usage||rlsLedgerVerification.ledger_version_select)throw new Error(`RLS-protected ledger was granted or reported as readable: ${JSON.stringify(rlsLedgerVerification)}`);
  psql(`ALTER TABLE supabase_migrations.schema_migrations DISABLE ROW LEVEL SECURITY; REVOKE SELECT (version) ON supabase_migrations.schema_migrations FROM :"audit_role"; REVOKE USAGE ON SCHEMA supabase_migrations FROM :"audit_role"; DROP TABLE supabase_migrations.schema_migrations; CREATE TABLE supabase_migrations.schema_migrations(version bigint);`);
  psql(grantMinimumSql);
  const incompatibleLedger=parseLastJson(psql(verifyMetadataSql).stdout);
  if(!incompatibleLedger.verification_safe||incompatibleLedger.ledger_schema_usage||incompatibleLedger.ledger_version_select)throw new Error(`Incompatible ledger received or retained grants: ${JSON.stringify(incompatibleLedger)}`);
  psql(grantMinimumSql);

  const forbiddenRead=asAuditor('SELECT secret FROM public.business_fixture',{allowFailure:true});
  if(forbiddenRead.status===0)throw new Error('Business-table SELECT unexpectedly succeeded.');
  const forbiddenAuth=asAuditor('SELECT email FROM auth.users',{allowFailure:true});
  const forbiddenTokens=asAuditor('SELECT access_token FROM public.oauth_tokens',{allowFailure:true});
  if(forbiddenAuth.status===0||forbiddenTokens.status===0)throw new Error('Auth/OAuth credential table access unexpectedly succeeded.');
  const forbiddenWrites=psql(`SET SESSION AUTHORIZATION :"audit_role"; BEGIN; INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('forbidden');`,{allowFailure:true});
  if(forbiddenWrites.status===0)throw new Error('Persistent write unexpectedly succeeded.');
  const deniedDdl=psql(`SET SESSION AUTHORIZATION :"audit_role"; CREATE TABLE public.forbidden_ddl(id int);`,{allowFailure:true});
  if(deniedDdl.status===0)throw new Error('Persistent DDL unexpectedly succeeded.');
  const deniedExecute=asAuditor('SELECT public.autoclip_sensitive_rpc()',{allowFailure:true});
  if(deniedExecute.status===0)throw new Error('Sensitive custom function execution unexpectedly succeeded.');

  const checkMutation=(grant,revoke,expectedField)=>{
    psql(grant);
    try{const result=parseLastJson(asAuditor(auditQueries.preflight).stdout);if(result[expectedField]!==true||isSafePreflight(result,testScope))throw new Error(`Preflight did not reject unexpected privilege ${expectedField}: ${JSON.stringify(result)}`);assertVerifierBlocks(expectedField);}
    finally{psql(revoke);}
  };
  checkMutation(`GRANT SELECT ON public.business_fixture TO :"audit_role";`,`REVOKE SELECT ON public.business_fixture FROM :"audit_role";`,'unapproved_relation_reads');
  checkMutation(`GRANT SELECT (version) ON supabase_migrations.schema_migrations TO :"audit_role" WITH GRANT OPTION;`,`REVOKE GRANT OPTION FOR SELECT (version) ON supabase_migrations.schema_migrations FROM :"audit_role";`,'unapproved_grant_options');
  psql(`GRANT TEMP ON DATABASE :"audit_database" TO :"audit_role";`);
  try{const directTemp=parseLastJson(asAuditor(auditQueries.preflight).stdout);if(isSafePreflight(directTemp,testScope))throw new Error('Direct TEMP grant was incorrectly accepted.');assertVerifierBlocks('direct TEMP');}
  finally{psql(`REVOKE TEMP ON DATABASE :"audit_database" FROM :"audit_role";`);}
  psql(`GRANT EXECUTE ON FUNCTION public.autoclip_sensitive_rpc() TO :"audit_role";`);
  try{const execGrant=parseLastJson(asAuditor(auditQueries.preflight).stdout);if(execGrant.unexpected_function_execute!==true||isSafePreflight(execGrant,testScope))throw new Error('Custom function EXECUTE grant was not blocked.');assertVerifierBlocks('custom function EXECUTE');}
  finally{psql(`REVOKE EXECUTE ON FUNCTION public.autoclip_sensitive_rpc() FROM :"audit_role";`);}
  psql(`GRANT USAGE ON SCHEMA auth TO :"audit_role";`);
  try{const schemaUsage=parseLastJson(asAuditor(auditQueries.preflight).stdout);if(schemaUsage.unapproved_schema_usage!==true||isSafePreflight(schemaUsage,testScope))throw new Error('Unexpected application schema USAGE was not blocked.');assertVerifierBlocks('application schema USAGE');}
  finally{psql(`REVOKE USAGE ON SCHEMA auth FROM :"audit_role";`);}
  psql(`GRANT CREATE ON SCHEMA public TO :"audit_role"; ALTER TABLE public.business_fixture OWNER TO :"audit_role";`);
  try{const owner=parseLastJson(asAuditor(auditQueries.preflight).stdout);if(owner.owned_application_objects!==true||isSafePreflight(owner,testScope))throw new Error('Application object ownership was not blocked.');assertVerifierBlocks('application object ownership');}
  finally{psql('ALTER TABLE public.business_fixture OWNER TO postgres; REVOKE CREATE ON SCHEMA public FROM :"audit_role";');}
  parentRoleMayExist=true;
  psql(`CREATE ROLE :"audit_parent_role" NOLOGIN; GRANT :"audit_parent_role" TO :"audit_role";`);
  try{const membership=parseLastJson(asAuditor(auditQueries.preflight).stdout);if(!membership.role_memberships.includes(parentRole)||isSafePreflight(membership,testScope))throw new Error('Role membership was not blocked.');assertVerifierBlocks('role membership');}
  finally{psql(`REVOKE :"audit_parent_role" FROM :"audit_role"; DROP ROLE :"audit_parent_role";`);parentRoleMayExist=false;}
  psql(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO :"audit_role";`);
  try{const defaults=parseLastJson(asAuditor(auditQueries.preflight).stdout);if(defaults.unapproved_default_privileges!==true||isSafePreflight(defaults,testScope))throw new Error('Unexpected default privileges were not blocked.');assertVerifierBlocks('default privileges');}
  finally{psql(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT ON TABLES FROM :"audit_role";`);}
  const largeObjectGrant=psql(`SELECT lo_create(0) AS fixture_large_object_oid
\\gset
GRANT SELECT ON LARGE OBJECT :fixture_large_object_oid TO :"audit_role";
SELECT :'fixture_large_object_oid';`);
  const largeObjectOid=largeObjectGrant.stdout.trim().split(/\r?\n/).at(-1);
  if(!/^\d+$/.test(largeObjectOid??''))throw new Error('Could not capture isolated large-object fixture OID.');
  try{const largeObject=parseLastJson(asAuditor(auditQueries.preflight).stdout);if(largeObject.unapproved_large_object_access!==true||isSafePreflight(largeObject,testScope))throw new Error('Large-object access was not blocked.');assertVerifierBlocks('large-object access');}
  finally{psql(`REVOKE SELECT ON LARGE OBJECT ${largeObjectOid} FROM :"audit_role";`);}
  psql(`ALTER LARGE OBJECT ${largeObjectOid} OWNER TO :"audit_role";`);
  try{const largeObjectOwner=parseLastJson(asAuditor(auditQueries.preflight).stdout);if(largeObjectOwner.owned_application_objects!==true||isSafePreflight(largeObjectOwner,testScope))throw new Error('Large-object ownership was not blocked.');assertVerifierBlocks('large-object ownership');}
  finally{psql(`ALTER LARGE OBJECT ${largeObjectOid} OWNER TO supabase_admin;`);}

  // Simulate a Cloud installation without its migration ledger. The catalog
  // inventory should remain usable and the ledger must be reported unavailable.
  psql('DROP SCHEMA supabase_migrations CASCADE;');
  const missingLedger=parseLastJson(asAuditor(auditQueries.availability).stdout);
  if(missingLedger.ledger_relation_in_catalog||missingLedger.ledger_version_column_in_catalog||missingLedger.ledger_schema_usage||missingLedger.ledger_version_select)throw new Error(`Missing ledger was misclassified: ${JSON.stringify(missingLedger)}`);
  const metadataAfterLedgerMissing=asAuditor(auditQueries.schemas);
  if(metadataAfterLedgerMissing.status!==0)throw new Error(`Metadata catalog query failed after absent ledger: ${metadataAfterLedgerMissing.stderr}`);
  const safeWithoutLedger=parseLastJson(asAuditor(auditQueries.preflight).stdout);
  if(!isSafePreflight(safeWithoutLedger,testScope)||!safeWithoutLedger.ledger_column_select_scope_safe)throw new Error(`Absent ledger incorrectly made the metadata role unsafe: ${JSON.stringify(safeWithoutLedger)}`);

  const localTestPassword=randomBytes(32).toString('hex');
  psql(`ALTER ROLE :"audit_role" PASSWORD '${localTestPassword}';`,{redactInput:true});
  run(['exec','-i',container,'sh','-c',`umask 077; cat > '${pgpassPath}'; chmod 600 '${pgpassPath}'`],{input:`127.0.0.1:*:${database}:${role}:${localTestPassword}\n`,redactInput:true});
  const activeSession=startActiveAuditorSession();
  let activeSessionVisible=false;
  for(let attempt=0;attempt<60;attempt++){
    const check=run(['exec',container,'psql','-X','-U','supabase_admin','-d',database,'-Atc',"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='autoclip-cloud-audit:djrwfvcxgpyknmizqumn' AND query LIKE '%pg_sleep%')"]);
    if(check.stdout.trim()==='t'){activeSessionVisible=true;break;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!activeSessionVisible){activeSession.child.kill('SIGTERM');throw new Error(`Could not establish synthetic active auditor session: ${activeSession.stderr}`);}
  const emergency=psql(await include('03_emergency_revoke_metadata_role.sql'));
  const emergencyState=parseLastJson(psql(`SELECT jsonb_build_object('login',r.rolcanlogin,'expired',r.rolvaliduntil<=now(),'direct_connect',EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=:'audit_database' AND a.grantee=r.oid AND a.privilege_type='CONNECT'),'remaining_sessions',EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND (usename=r.rolname OR application_name='autoclip-cloud-audit:djrwfvcxgpyknmizqumn'))) FROM pg_roles r WHERE r.rolname=:'audit_role';`).stdout);
  if(emergencyState.login||!emergencyState.expired||emergencyState.direct_connect||emergencyState.remaining_sessions||!emergency.stdout.includes('EMERGENCY REVOCATION COMPLETE'))throw new Error(`Emergency revocation did not disable role and terminate sessions: ${JSON.stringify(emergencyState)}`);
  const sessionExit=await Promise.race([activeSession.exited,new Promise(resolve=>setTimeout(()=>resolve(null),5000))]);
  if(!sessionExit){activeSession.child.kill('SIGTERM');throw new Error('Emergency revocation did not close the active auditor process.');}
  psql(`COMMENT ON ROLE :"audit_role" IS 'incorrect-marker';`);
  try{const wrongRemoval=psql(await include('04_remove_metadata_role.sql'),{allowFailure:true});if(wrongRemoval.status===0)throw new Error('Definitive removal accepted an incorrect role marker.');}
  finally{psql(`COMMENT ON ROLE :"audit_role" IS 'autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn';`);}
  psql(`CREATE TABLE public.role_dependency_fixture(id integer); ALTER TABLE public.role_dependency_fixture OWNER TO :"audit_role";`);
  const dependencyRemoval=psql(await include('04_remove_metadata_role.sql'),{allowFailure:true});
  if(dependencyRemoval.status===0)throw new Error('Definitive removal ignored an owned-object dependency.');
  const rolePreserved=parseLastJson(psql(`SELECT jsonb_build_object('exists',EXISTS(SELECT 1 FROM pg_roles WHERE rolname=:'audit_role'),'login',(SELECT rolcanlogin FROM pg_roles WHERE rolname=:'audit_role'));`).stdout);
  if(!rolePreserved.exists||rolePreserved.login)throw new Error(`Failed removal changed/removes the disabled role unexpectedly: ${JSON.stringify(rolePreserved)}`);
  psql(`ALTER TABLE public.role_dependency_fixture OWNER TO postgres; DROP TABLE public.role_dependency_fixture;`);
  const cleanup=psql(await include('04_remove_metadata_role.sql'));roleMayExist=false;
  const expectedDenied=['pre-grant direct business SELECT','pre-grant app schema USAGE','pre-grant sequence USAGE','pre-grant function EXECUTE','pre-grant PUBLIC function EXECUTE','pre-grant PUBLIC business SELECT','pre-grant direct TEMP','pre-grant non-target database CREATE','pre-grant grant option','pre-grant Cloud-strict PUBLIC database privileges','pre-grant membership','pre-grant ownership','pre-grant default privileges','pre-grant PUBLIC default privileges','pre-grant large-object access','forced transaction rollback','business table SELECT','auth.users SELECT','OAuth token SELECT','persistent INSERT','persistent DDL','custom function EXECUTE','GRANT OPTION','direct TEMP','business schema USAGE','application object ownership','role membership','default privileges','large-object read privilege','large-object ownership'];
  process.stdout.write(`${JSON.stringify({status:'LOCAL_METADATA_ONLY_ROLE_TESTS_PASSED',database,postgresVersion:env.version,roleVerification:verify,preflightPublicTemp:preflight.temp_acl_sources,metadataQueriesExecuted:Object.keys(catalogResults),migrationLedgerVersions:ledger,ledgerRlsCase:{grantOmitted:true,verificationSafe:true},ledgerIncompatibleCase:{grantsOmitted:true,verificationSafe:true},ledgerMissingCase:{reportedNotAvailable:true,catalogQueriesContinue:true,preflightRemainsSafe:true},pregrantBlockedBeforeAnyGrant:expectedDenied.slice(0,15),negativeCasesDenied:expectedDenied,allowlistedGrantsAlreadyPresentAccepted:true,duplicateCreationDenied:true,incorrectMarkerDenied:true,removalDependencyBlocked:true,sqlVerifierFailClosed:true,activeSessionRevoked:true,roleDropped:cleanup.stdout.includes('ROLE_ABSENT_VERIFIED'),projectionRequired:false,autoclipAuditSchemaRequired:false,cloudConnection:false,note:'Isolated local Supabase database only; PUBLIC TEMP residual is explicitly accepted only by the exact project opt-in.'},null,2)}\n`);
}finally{
  run(['exec',container,'rm','-f','--',pgpassPath],{allowFailure:true});
  if(roleMayExist)run(['exec',container,'psql','-X','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',`DROP ROLE IF EXISTS "${role}"`],{allowFailure:true});
  if(parentRoleMayExist)run(['exec',container,'psql','-X','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',`DROP ROLE IF EXISTS "${parentRole}"`],{allowFailure:true});
  if(dbCreated)run(['exec',container,'dropdb','-U','supabase_admin','--if-exists',database],{allowFailure:true});
}
