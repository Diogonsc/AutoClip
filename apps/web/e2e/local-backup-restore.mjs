import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

function local(value, label) {
  const host = new URL(value).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error(`${label} não é local; backup/restore bloqueado.`);
}
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { encoding: 'utf8', env, maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} falhou (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
const status = run('supabase', ['status', '-o', 'env']);
const values = Object.fromEntries(status.split(/\r?\n/).map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, '')]));
local(values.API_URL, 'Supabase API'); local(values.DB_URL, 'PostgreSQL');
const source = new URL(values.DB_URL);
const containers = run('docker', ['ps', '--filter', 'publish=54322', '--format', '{{.Names}}']).split(/\r?\n/).filter(Boolean);
if (containers.length !== 1 || !containers[0].startsWith('supabase_db_')) throw new Error('Não foi possível identificar unicamente o container PostgreSQL que publica a porta local 54322.');
const dbContainer = containers[0];
const admin = createClient(values.API_URL, values.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = randomBytes(4).toString('hex');
const email = `backup-fixture-${suffix}@example.test`;
const password = `LocalBackup-${randomBytes(14).toString('hex')}!`;
const backupDir = mkdtempSync(join(tmpdir(), `autoclip-pg-restore-${suffix}-`));
const archive = join(backupDir, 'local.dump');
const targetDb = `autoclip_restore_${suffix}`;
let userId, workspaceId, targetCreated = false;
const started = Date.now();
try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: 'Backup restore fixture' } });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  const memberships = await admin.from('workspace_members').select('workspace_id').eq('user_id', userId).single();
  if (memberships.error) throw memberships.error;
  workspaceId = memberships.data.workspace_id;
  const channel = await admin.from('channels').insert({ workspace_id: workspaceId, display_name: `backup fixture ${suffix}`, provider_user_id: `backup-${suffix}`, connection_status: 'PENDING_AUTH' }).select('id').single();
  if (channel.error) throw channel.error;
  const mediaId = crypto.randomUUID();
  const media = await admin.from('media_assets').insert({ id: mediaId, workspace_id: workspaceId, original_filename: 'backup-fixture.mp4', storage_key: `${workspaceId}/${mediaId}/original.mp4`, mime_type: 'video/mp4', file_size_bytes: 1, status: 'READY', created_by: userId, validation_status: 'VALIDATED', checksum_sha256: 'a'.repeat(64), detected_mime_type: 'video/mp4', detected_video_codec: 'h264', validated_at: new Date().toISOString(), validator_version: 'backup-fixture' }).select('id').single();
  if (media.error) throw media.error;
  const group = await admin.from('account_groups').insert({ workspace_id: workspaceId, name: `backup fixture ${suffix}`, created_by: userId }).select('id').single();
  if (group.error) throw group.error;
  const groupMember = await admin.from('account_group_members').insert({ workspace_id: workspaceId, group_id: group.data.id, channel_id: channel.data.id });
  if (groupMember.error) throw groupMember.error;
  const batch = await admin.from('publication_batches').insert({ workspace_id: workspaceId, created_by: userId, idempotency_key: crypto.randomUUID(), strategy: 'CSV', metadata: { fixture: true } }).select('id').single();
  if (batch.error) throw batch.error;
  const job = await admin.from('publication_jobs').insert({ workspace_id: workspaceId, batch_id: batch.data.id, channel_id: channel.data.id, media_asset_id: mediaId, status: 'FAILED', caption: 'Fixture only', scheduled_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: userId }).select('id').single();
  if (job.error) throw job.error;
  const cycle = await admin.from('workspace_usage_cycles').insert({ workspace_id: workspaceId, period_started_at: new Date().toISOString(), period_ends_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), publication_limit: 120 }).select('id').single();
  if (cycle.error) throw cycle.error;
  const audit = await admin.from('audit_logs').insert({ workspace_id: workspaceId, actor_user_id: userId, action: 'e2e.backup_fixture', entity_type: 'publication_batch', entity_id: batch.data.id, metadata: { fake: true } });
  if (audit.error) throw audit.error;

  const versions = run('docker', ['exec', dbContainer, 'pg_dump', '--version']);
  const containerArchive = `/tmp/${targetDb}.dump`;
  // pg_cron é restrito pela configuração local ao banco `postgres`; excluir a extensão
  // permite restaurar isoladamente o schema/dados de aplicação sem alterar cron.database_name.
  run('docker', ['exec', dbContainer, 'pg_dump', '-U', 'supabase_admin', '--exclude-extension=pg_cron', '--format=custom', '--no-owner', '--no-acl', '--file', containerArchive, 'postgres']);
  run('docker', ['cp', `${dbContainer}:${containerArchive}`, archive]);
  run('docker', ['exec', dbContainer, 'createdb', '-U', 'supabase_admin', targetDb]);
  targetCreated = true;
  run('docker', ['cp', archive, `${dbContainer}:${containerArchive}`]);
  const restoreStarted = Date.now();
  run('docker', ['exec', dbContainer, 'pg_restore', '-U', 'supabase_admin', '--exit-on-error', '--no-owner', '--no-acl', '--dbname', targetDb, containerArchive]);
  const restoreMs = Date.now() - restoreStarted;
  const checks = `select json_build_object('workspace', (select count(*) from public.workspaces where id='${workspaceId}'), 'channel', (select count(*) from public.channels where workspace_id='${workspaceId}'), 'group', (select count(*) from public.account_groups where workspace_id='${workspaceId}'), 'media', (select count(*) from public.media_assets where workspace_id='${workspaceId}'), 'batch', (select count(*) from public.publication_batches where workspace_id='${workspaceId}'), 'job', (select count(*) from public.publication_jobs where workspace_id='${workspaceId}'), 'quota_cycle', (select count(*) from public.workspace_usage_cycles where workspace_id='${workspaceId}'), 'audit', (select count(*) from public.audit_logs where workspace_id='${workspaceId}' and action='e2e.backup_fixture'), 'fk_orphans', (select count(*) from public.publication_jobs j where j.workspace_id='${workspaceId}' and (not exists(select 1 from public.channels c where c.id=j.channel_id and c.workspace_id=j.workspace_id) or not exists(select 1 from public.media_assets m where m.id=j.media_asset_id and m.workspace_id=j.workspace_id))), 'rpc_present', to_regprocedure('public.list_publication_batches(uuid,integer,integer,text,uuid,text,date,date,text,uuid)') is not null);`;
  const result = run('docker', ['exec', dbContainer, 'psql', '-U', 'supabase_admin', '-d', targetDb, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', checks]);
  const checksData = JSON.parse(result);
  if (Object.entries({ workspace: 1, channel: 1, group: 1, media: 1, batch: 1, job: 1, quota_cycle: 1, audit: 1, fk_orphans: 0, rpc_present: true }).some(([key, expected]) => checksData[key] !== expected)) throw new Error(`Integridade pós-restauração divergiu: ${JSON.stringify(checksData)}`);
  console.log(JSON.stringify({ result: 'PASS', source: 'Supabase PostgreSQL local', target: targetDb, dumpVersion: versions, archiveBytes: (await import('node:fs')).statSync(archive).size, totalMs: Date.now() - started, restoreMs, fixtureCounts: checksData, archivePath: archive }));
} finally {
  if (targetCreated) {
    try { run('docker', ['exec', dbContainer, 'dropdb', '-U', 'supabase_admin', targetDb]); } catch { /* preserve the source; temporary target cleanup is best effort */ }
    try { run('docker', ['exec', dbContainer, 'rm', '-f', `/tmp/${targetDb}.dump`]); } catch { /* temporary archive copy */ }
  }
  if (workspaceId) {
    const jobs = await admin.from('publication_jobs').delete().eq('workspace_id', workspaceId);
    if (jobs.error) throw jobs.error;
    const workspace = await admin.from('workspaces').delete().eq('id', workspaceId);
    if (workspace.error) throw workspace.error;
  }
  if (userId) {
    const user = await admin.auth.admin.deleteUser(userId);
    if (user.error) throw user.error;
  }
}
