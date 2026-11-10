#!/usr/bin/env bash
# Real PostgreSQL concurrency test. It uses two independent local psql sessions
# and never contacts Supabase Cloud or TikTok.
set -euo pipefail

DB_URL="${AUTOCLIP_LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
USER_ID="91000000-0000-0000-0000-000000000001"
FIRST_HASH="$(printf 'a%.0s' {1..64})"
SECOND_HASH="$(printf 'b%.0s' {1..64})"
LOG_A="/tmp/autoclip-seller-start-a.log"
LOG_B="/tmp/autoclip-seller-start-b.log"

psql_local() { psql "$DB_URL" -X -v ON_ERROR_STOP=1 "$@"; }
cleanup() {
  psql_local -q -c "
    delete from public.workspaces where owner_user_id = '$USER_ID'::uuid;
    delete from auth.users where id = '$USER_ID'::uuid;
  " >/dev/null 2>&1 || true
  rm -f "$LOG_A" "$LOG_B"
}
trap cleanup EXIT
cleanup

psql_local -q -c "
  insert into auth.users (id, instance_id, aud, role, email)
  values ('$USER_ID', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seller-start-concurrency@test.invalid');
"

WORKSPACE_ID="$(psql_local -Atqc "select id from public.workspaces where owner_user_id = '$USER_ID'::uuid")"
test -n "$WORKSPACE_ID"

# Session A holds the per-user/workspace advisory lock while Session B attempts
# a distinct state. B must wait, then fail with 23505 after A commits.
(psql_local -q -c "
  begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{\"sub\":\"$USER_ID\",\"role\":\"authenticated\"}', true);
  select public.create_seller_oauth_state('$WORKSPACE_ID'::uuid, '$FIRST_HASH');
  select pg_sleep(1);
  commit;
" >"$LOG_A" 2>&1) &
PID_A=$!
sleep 0.2
set +e
psql_local -q -c "
  begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{\"sub\":\"$USER_ID\",\"role\":\"authenticated\"}', true);
  select public.create_seller_oauth_state('$WORKSPACE_ID'::uuid, '$SECOND_HASH');
  commit;
" >"$LOG_B" 2>&1
EXIT_B=$?
set -e
wait "$PID_A"

test "$EXIT_B" -ne 0
grep -q 'seller authorization already pending' "$LOG_B"
test "$(psql_local -Atqc "select count(*) from public.seller_oauth_states where workspace_id = '$WORKSPACE_ID'::uuid and status = 'PENDING'")" = "1"

printf 'Seller OAuth Start concurrency passed: one independent transaction created the active state; the competing transaction was serialized and rejected.\n'
