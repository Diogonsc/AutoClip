#!/usr/bin/env bash
# Homologação local com duas conexões reais ao Postgres. Não usa Storage/TikTok
# e remove o usuário/fixture ao final, inclusive se algum teste falhar.
set -euo pipefail

DB_URL="${AUTOCLIP_LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
USER_ID="99999999-0000-0000-0000-000000000009"
CHANNEL_ID="99999999-0000-0000-0000-000000000101"
QUOTA_MEDIA_ID="99999999-0000-0000-0000-000000000102"
CLEANUP_MEDIA_ID="99999999-0000-0000-0000-000000000103"
IDEMPOTENCY_MEDIA_ID="99999999-0000-0000-0000-000000000104"
VIDEO_VALIDATION_MEDIA_ID="99999999-0000-0000-0000-000000000105"
QUOTA_JOB_A="99999999-0000-0000-0000-000000000201"
QUOTA_JOB_B="99999999-0000-0000-0000-000000000202"
PUBLISHED_JOB_ID="99999999-0000-0000-0000-000000000203"
LOCK_A="99999999-0000-0000-0000-000000000301"
LOCK_B="99999999-0000-0000-0000-000000000302"
LOCK_DUPLICATE="99999999-0000-0000-0000-000000000303"

psql_cmd() { psql "$DB_URL" -v ON_ERROR_STOP=1 -X "$@"; }
# workspaces.owner_user_id usa RESTRICT; remova primeiro o workspace de fixture
# (as tabelas operacionais fazem cascade) para a repetição ser idempotente.
cleanup() {
  psql_cmd -q -c "
    delete from public.publication_jobs where workspace_id in (select id from public.workspaces where owner_user_id = '$USER_ID'::uuid);
    delete from public.media_assets where workspace_id in (select id from public.workspaces where owner_user_id = '$USER_ID'::uuid);
    delete from public.workspaces where owner_user_id = '$USER_ID'::uuid;
    delete from auth.users where id = '$USER_ID'::uuid;
  " >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

psql_cmd -q <<SQL
insert into auth.users (id, instance_id, aud, role, email)
values ('$USER_ID', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'concurrency@test.dev');
insert into public.channels (id, workspace_id, display_name, connection_status)
select '$CHANNEL_ID', id, 'Canal concorrência', 'CONNECTED'::public.channel_status from public.workspaces where owner_user_id = '$USER_ID';
insert into public.media_assets (id, workspace_id, original_filename, storage_key, mime_type, file_size_bytes, status, created_by, validation_status, checksum_sha256, detected_mime_type, detected_video_codec, validated_at, validator_version)
select '$QUOTA_MEDIA_ID', id, 'quota.mp4', id::text || '/$QUOTA_MEDIA_ID/original.mp4', 'video/mp4', 1024, 'READY', '$USER_ID', 'VALIDATED', repeat('a',64), 'video/mp4', 'h264', now(), 'concurrency-fixture'
from public.workspaces where owner_user_id = '$USER_ID';
insert into public.media_assets (id, workspace_id, original_filename, storage_key, mime_type, file_size_bytes, status, created_by, validation_status, checksum_sha256, detected_mime_type, detected_video_codec, validated_at, validator_version)
select '$CLEANUP_MEDIA_ID', id, 'cleanup.mp4', id::text || '/$CLEANUP_MEDIA_ID/original.mp4', 'video/mp4', 1024, 'READY', '$USER_ID', 'VALIDATED', repeat('a',64), 'video/mp4', 'h264', now(), 'concurrency-fixture'
from public.workspaces where owner_user_id = '$USER_ID';
insert into public.media_assets (id, workspace_id, original_filename, storage_key, mime_type, file_size_bytes, status, created_by, validation_status, checksum_sha256, detected_mime_type, detected_video_codec, validated_at, validator_version)
select '$IDEMPOTENCY_MEDIA_ID', id, 'idempotency.mp4', id::text || '/$IDEMPOTENCY_MEDIA_ID/original.mp4', 'video/mp4', 1024, 'READY', '$USER_ID', 'VALIDATED', repeat('a',64), 'video/mp4', 'h264', now(), 'concurrency-fixture'
from public.workspaces where owner_user_id = '$USER_ID';
insert into public.media_assets (id, workspace_id, original_filename, storage_key, mime_type, file_size_bytes, status, created_by, validation_status, upload_completed_at)
select '$VIDEO_VALIDATION_MEDIA_ID', id, 'validation.mp4', id::text || '/$VIDEO_VALIDATION_MEDIA_ID/original.mp4', 'video/mp4', 1024, 'UPLOADING', '$USER_ID', 'PENDING', now()
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

# A primeira confirmação de lote reserva a única unidade; a segunda deve aguardar
# o mesmo lock do ciclo e falhar por quota. São duas conexões autenticadas reais.
(psql_cmd -q -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$USER_ID\",\"role\":\"authenticated\"}', true); select public.confirm_publication_batch((select id from public.workspaces where owner_user_id = '$USER_ID'::uuid), '$LOCK_A'::uuid, jsonb_build_array(jsonb_build_object('channel_id','$CHANNEL_ID','media_asset_id','$QUOTA_MEDIA_ID','scheduled_at',(now() + interval '1 day')::text,'timezone','America/Sao_Paulo','caption','concorrência A','music_rights_confirmed',true)), '{\"strategy\":\"SEQUENTIAL\"}'::jsonb); select pg_sleep(1); commit;" >/tmp/autoclip-quota-a.log) &
pid_a=$!
sleep 0.2
set +e
psql_cmd -q -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$USER_ID\",\"role\":\"authenticated\"}', true); select public.confirm_publication_batch((select id from public.workspaces where owner_user_id = '$USER_ID'::uuid), '$LOCK_B'::uuid, jsonb_build_array(jsonb_build_object('channel_id','$CHANNEL_ID','media_asset_id','$QUOTA_MEDIA_ID','scheduled_at',(now() + interval '1 day')::text,'timezone','America/Sao_Paulo','caption','concorrência B','music_rights_confirmed',true)), '{\"strategy\":\"SEQUENTIAL\"}'::jsonb); commit;" >/tmp/autoclip-quota-b.log 2>&1
quota_b_exit=$?
set -e
wait "$pid_a"
test "$quota_b_exit" -ne 0
test "$(psql_cmd -Atqc "select count(*) from public.publication_quota_reservations r join public.publication_jobs j on j.id = r.publication_job_id where j.workspace_id = (select id from public.workspaces where owner_user_id = '$USER_ID'::uuid) and j.media_asset_id = '$QUOTA_MEDIA_ID'::uuid;")" = "1"
psql_cmd -q -c "update public.workspace_usage_cycles set publication_limit = 3 where workspace_id = (select id from public.workspaces where owner_user_id = '$USER_ID'::uuid);"

# Duas confirmações simultâneas com a mesma chave retornam o mesmo lote.
# A segunda conexão precisa aguardar o advisory lock e não pode falhar na UNIQUE.
duplicate_scheduled_at="$(date -u -d '+2 days' '+%Y-%m-%dT%H:%M:%SZ')"
duplicate_payload="jsonb_build_array(jsonb_build_object('channel_id','$CHANNEL_ID','media_asset_id','$IDEMPOTENCY_MEDIA_ID','scheduled_at','$duplicate_scheduled_at','timezone','UTC','caption','idempotência concorrente','music_rights_confirmed',true))"
(psql_cmd -q -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$USER_ID\",\"role\":\"authenticated\"}', true); select public.confirm_publication_batch((select id from public.workspaces where owner_user_id = '$USER_ID'::uuid), '$LOCK_DUPLICATE'::uuid, $duplicate_payload, '{\"strategy\":\"SEQUENTIAL\"}'::jsonb); select pg_sleep(1); commit;" >/tmp/autoclip-idempotency-a.log) &
pid_idempotency_a=$!
sleep 0.2
psql_cmd -q -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$USER_ID\",\"role\":\"authenticated\"}', true); select public.confirm_publication_batch((select id from public.workspaces where owner_user_id = '$USER_ID'::uuid), '$LOCK_DUPLICATE'::uuid, $duplicate_payload, '{\"strategy\":\"SEQUENTIAL\"}'::jsonb); commit;" >/tmp/autoclip-idempotency-b.log
wait "$pid_idempotency_a"
test "$(psql_cmd -Atqc "select count(*) from public.publication_jobs where workspace_id = (select id from public.workspaces where owner_user_id = '$USER_ID'::uuid) and media_asset_id = '$IDEMPOTENCY_MEDIA_ID'::uuid;")" = "1"

# Dois workers competem pelo mesmo vídeo pendente. SKIP LOCKED garante um único
# claim, e uma lease expirada permite recuperação com token/attempt novo.
(psql_cmd -q -t -c "begin; set local role service_role; select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true); select count(*) from public.claim_pending_video_validation(1,240) where media_id='$VIDEO_VALIDATION_MEDIA_ID'; select pg_sleep(1); commit;" >/tmp/autoclip-video-claim-a.log) &
pid_video_claim=$!
sleep 0.2
video_claim_b_output="$(psql_cmd -Atqc "set role service_role; select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false); select count(*) from public.claim_pending_video_validation(1,240) where media_id='$VIDEO_VALIDATION_MEDIA_ID';")"
video_claim_b="$(printf '%s\n' "$video_claim_b_output" | tail -n 1 | tr -d '[:space:]')"
wait "$pid_video_claim"
test "$(tr -d '[:space:]' </tmp/autoclip-video-claim-a.log | tail -c 1)" = "1"
test "$video_claim_b" = "0"
psql_cmd -q -c "set role service_role; select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false); update public.media_assets set validation_locked_until=now()-interval '1 second' where id='$VIDEO_VALIDATION_MEDIA_ID';"
video_reclaim_output="$(psql_cmd -Atqc "set role service_role; select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false); select count(*) from public.claim_pending_video_validation(1,240) where media_id='$VIDEO_VALIDATION_MEDIA_ID';")"
video_reclaim="$(printf '%s\n' "$video_reclaim_output" | tail -n 1 | tr -d '[:space:]')"
test "$video_reclaim" = "1"
test "$(psql_cmd -Atqc "select validation_attempt_count from public.media_assets where id='$VIDEO_VALIDATION_MEDIA_ID';")" = "2"

# Dois reagendamentos concorrentes: o primeiro obtém o lock; o segundo envia a
# versão anterior e deve receber conflito otimista depois de esperar.
reschedule_job_id="$(psql_cmd -Atqc "select id from public.publication_jobs where workspace_id = (select id from public.workspaces where owner_user_id = '$USER_ID'::uuid) and media_asset_id = '$QUOTA_MEDIA_ID'::uuid and status = 'SCHEDULED' order by created_at desc limit 1;")"
reschedule_original="$(psql_cmd -Atqc "select scheduled_at::text from public.publication_jobs where id = '$reschedule_job_id'::uuid;")"
(psql_cmd -q -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$USER_ID\",\"role\":\"authenticated\"}', true); select public.reschedule_publication_batch_items((select id from public.workspaces where owner_user_id = '$USER_ID'::uuid), jsonb_build_array(jsonb_build_object('job_id','$reschedule_job_id','original_scheduled_at','$reschedule_original','scheduled_at',(now() + interval '3 days')::text,'timezone','UTC')), '$LOCK_A'::uuid); select pg_sleep(1); commit;" >/tmp/autoclip-reschedule-a.log 2>&1) &
pid_reschedule=$!
sleep 0.2
set +e
psql_cmd -q -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$USER_ID\",\"role\":\"authenticated\"}', true); select public.reschedule_publication_batch_items((select id from public.workspaces where owner_user_id = '$USER_ID'::uuid), jsonb_build_array(jsonb_build_object('job_id','$reschedule_job_id','original_scheduled_at','$reschedule_original','scheduled_at',(now() + interval '4 days')::text,'timezone','UTC')), '$LOCK_B'::uuid); commit;" >/tmp/autoclip-reschedule-b.log 2>&1
reschedule_b_exit=$?
set -e
wait "$pid_reschedule"
test "$reschedule_b_exit" -ne 0
grep -q 'batch_reschedule_stale' /tmp/autoclip-reschedule-b.log

# Enquanto a primeira transação mantém o row lock, SKIP LOCKED impede um segundo claim.
(psql_cmd -q -c "begin; select count(*) from public.claim_media_cleanup_candidates(1, '$LOCK_A'::uuid); select pg_sleep(1); rollback;" >/tmp/autoclip-cleanup-a.log) &
pid_cleanup=$!
sleep 0.2
cleanup_claims="$(psql_cmd -Atqc "select count(*) from public.claim_media_cleanup_candidates(1, '$LOCK_B'::uuid);")"
wait "$pid_cleanup"
test "$cleanup_claims" = "0"

printf 'Concurrency checks passed: quota reservation, duplicate idempotent confirmation, stale reschedule rejection, publication cleanup SKIP LOCKED, and exclusive media validation lease/recovery.\n'
