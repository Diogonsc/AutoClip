#!/usr/bin/env bash
# Homologação local com duas conexões reais ao Postgres. Não usa Storage/TikTok
# e remove o usuário/fixture ao final, inclusive se algum teste falhar.
set -euo pipefail

DB_URL="${AUTOCLIP_LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
USER_ID="99999999-0000-0000-0000-000000000009"
CHANNEL_ID="99999999-0000-0000-0000-000000000101"
QUOTA_MEDIA_ID="99999999-0000-0000-0000-000000000102"
CLEANUP_MEDIA_ID="99999999-0000-0000-0000-000000000103"
QUOTA_JOB_A="99999999-0000-0000-0000-000000000201"
QUOTA_JOB_B="99999999-0000-0000-0000-000000000202"
PUBLISHED_JOB_ID="99999999-0000-0000-0000-000000000203"
LOCK_A="99999999-0000-0000-0000-000000000301"
LOCK_B="99999999-0000-0000-0000-000000000302"

psql_cmd() { psql "$DB_URL" -v ON_ERROR_STOP=1 -X "$@"; }
cleanup() { psql_cmd -q -c "delete from auth.users where id = '$USER_ID'::uuid;" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

psql_cmd -q <<SQL
insert into auth.users (id, instance_id, aud, role, email)
values ('$USER_ID', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'concurrency@test.dev');
insert into public.channels (id, workspace_id, display_name)
select '$CHANNEL_ID', id, 'Canal concorrência' from public.workspaces where owner_user_id = '$USER_ID';
insert into public.media_assets (id, workspace_id, original_filename, storage_key, mime_type, file_size_bytes, status, created_by)
select '$QUOTA_MEDIA_ID', id, 'quota.mp4', id::text || '/$QUOTA_MEDIA_ID/original.mp4', 'video/mp4', 1024, 'READY', '$USER_ID'
from public.workspaces where owner_user_id = '$USER_ID';
insert into public.media_assets (id, workspace_id, original_filename, storage_key, mime_type, file_size_bytes, status, created_by)
select '$CLEANUP_MEDIA_ID', id, 'cleanup.mp4', id::text || '/$CLEANUP_MEDIA_ID/original.mp4', 'video/mp4', 1024, 'READY', '$USER_ID'
from public.workspaces where owner_user_id = '$USER_ID';
update public.workspace_settings set auto_delete_media_enabled = true, auto_delete_media_dry_run = true
where workspace_id = (select id from public.workspaces where owner_user_id = '$USER_ID');
insert into public.workspace_usage_cycles (workspace_id, period_started_at, period_ends_at, publication_limit)
select s.workspace_id, s.current_period_started_at, s.current_period_ends_at, 1
from public.workspace_subscriptions s join public.workspaces w on w.id = s.workspace_id where w.owner_user_id = '$USER_ID';
insert into public.publication_jobs (id, workspace_id, channel_id, media_asset_id, created_by, status, scheduled_at, music_rights_confirmed)
select '$PUBLISHED_JOB_ID', w.id, '$CHANNEL_ID', '$CLEANUP_MEDIA_ID', '$USER_ID', 'PUBLISHED', now() - interval '2 days', true
from public.workspaces w where w.owner_user_id = '$USER_ID';
set session_replication_role = replica;
update public.publication_jobs set updated_at = now() - interval '25 hours' where id = '$PUBLISHED_JOB_ID';
set session_replication_role = origin;
SQL

# A primeira conexão reserva a única unidade; a segunda deve aguardar o lock e falhar por quota.
(psql_cmd -q -c "begin; insert into public.publication_jobs (id, workspace_id, channel_id, media_asset_id, created_by, status, scheduled_at, music_rights_confirmed) select '$QUOTA_JOB_A', w.id, '$CHANNEL_ID', '$QUOTA_MEDIA_ID', '$USER_ID', 'SCHEDULED', now() + interval '1 day', true from public.workspaces w where w.owner_user_id = '$USER_ID'; select pg_sleep(1); commit;" >/tmp/autoclip-quota-a.log) &
pid_a=$!
sleep 0.2
set +e
psql_cmd -q -c "insert into public.publication_jobs (id, workspace_id, channel_id, media_asset_id, created_by, status, scheduled_at, music_rights_confirmed) select '$QUOTA_JOB_B', w.id, '$CHANNEL_ID', '$QUOTA_MEDIA_ID', '$USER_ID', 'SCHEDULED', now() + interval '1 day', true from public.workspaces w where w.owner_user_id = '$USER_ID';" >/tmp/autoclip-quota-b.log 2>&1
quota_b_exit=$?
set -e
wait "$pid_a"
test "$quota_b_exit" -ne 0
test "$(psql_cmd -Atqc "select count(*) from public.publication_quota_reservations where publication_job_id in ('$QUOTA_JOB_A'::uuid, '$QUOTA_JOB_B'::uuid);")" = "1"

# Enquanto a primeira transação mantém o row lock, SKIP LOCKED impede um segundo claim.
(psql_cmd -q -c "begin; select count(*) from public.claim_media_cleanup_candidates(1, '$LOCK_A'::uuid); select pg_sleep(1); rollback;" >/tmp/autoclip-cleanup-a.log) &
pid_cleanup=$!
sleep 0.2
cleanup_claims="$(psql_cmd -Atqc "select count(*) from public.claim_media_cleanup_candidates(1, '$LOCK_B'::uuid);")"
wait "$pid_cleanup"
test "$cleanup_claims" = "0"

printf 'Concurrency checks passed: quota reservation is serialized and cleanup uses SKIP LOCKED.\n'
