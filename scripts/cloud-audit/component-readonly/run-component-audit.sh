#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly PROJECT_REF='djrwfvcxgpyknmizqumn'
readonly HOST='db.djrwfvcxgpyknmizqumn.supabase.co'
readonly PORT='5432'
readonly DATABASE='postgres'
readonly DB_USER='postgres'
readonly APP_NAME='autoclip_component_audit'
readonly CA='/home/diogo-nascimento/Documentos/Atual/AutoClip/prod-ca-2021.crt'
readonly ROOT='/home/diogo-nascimento/Documentos/Atual/AutoClip'
readonly DIR="$ROOT/scripts/cloud-audit/component-readonly"
readonly GUARD_HASH='3702f145a33ffcb3d16138246b9aec0daf3bd564086e34039859338db66052b1'

usage() {
  printf 'Usage: bash scripts/cloud-audit/component-readonly/run-component-audit.sh <component>\n' >&2
  printf 'Components: preflight schema rls grants routines storage extensions jobs ledger\n' >&2
}

[[ $# -eq 1 ]] || { usage; exit 2; }
component=$1
case "$component" in
  preflight) file='00_environment_preflight.sql'; expected_section='environment_preflight'; expected='7f31204f14829d66e576dcc06cf28c955ed37ed19c34975a981c450bec90561e' ;;
  schema) file='01_schema_inventory.sql'; expected_section='schema_inventory'; expected='ad5064b58e34214004ef758b7182442f0bbbd8dd0a5654f751042954c2c5223c' ;;
  rls) file='02_rls_policies.sql'; expected_section='rls_policies'; expected='1ce0c0445db943a9156efa91b7b79f9cca9e7c426533c566262834401053609a' ;;
  grants) file='03_roles_grants_public.sql'; expected_section='roles_grants_public'; expected='d393c7ce849db68d7ba571a12b770433004c86faa604b385c1323bf08d67ec17' ;;
  routines) file='04_security_definer_functions.sql'; expected_section='security_definer_functions'; expected='efad352064cdd5256accb649a6b3b1bc00dbe256cfbafc4c54bedee7095cf1b9' ;;
  storage) file='05_storage_metadata.sql'; expected_section='storage_bucket_metadata'; expected='dfce37f7f3c0303cb49f4465b32cded6891d750789d952602a6a0868299f5bc1' ;;
  extensions) file='06_extensions_pg_net.sql'; expected_section='extensions_and_pg_net'; expected='21e4c3555c28caae6521c91354acfaf64633473647727cfad782f5a7c62815fb' ;;
  jobs) file='07_jobs_metadata.sql'; expected_section='jobs_and_queue_catalog_shape'; expected='6b91012c752cd8bcdd250e7ddb22388bbd8c171d088330889f6f02c10aa726df' ;;
  ledger) file='08_migration_ledger.sql'; expected_section='migration_ledger'; expected='a58508f7612def71af5ad8c9a691c6e0c890b127b6315fa92672075a5752218c' ;;
  *) usage; exit 2 ;;
esac

[[ -f "$ROOT/supabase/config.toml" && -f "$DIR/$file" ]] || { printf 'ABORT: run from the AutoClip repository with audit files present.\n' >&2; exit 2; }
cd "$ROOT"
command -v psql >/dev/null || { printf 'ABORT: psql unavailable.\n' >&2; exit 2; }
command -v jq >/dev/null || { printf 'ABORT: jq unavailable.\n' >&2; exit 2; }
command -v sha256sum >/dev/null || { printf 'ABORT: sha256sum unavailable.\n' >&2; exit 2; }
command -v openssl >/dev/null || { printf 'ABORT: openssl unavailable.\n' >&2; exit 2; }
[[ -r "$CA" ]] || { printf 'ABORT: CA file missing or unreadable.\n' >&2; exit 2; }
ca_mode=$(stat -c '%a' "$CA")
[[ "$ca_mode" == '644' ]] || { printf 'ABORT: CA permissions must be 0644 (public certificate, no group/other write).\n' >&2; exit 2; }

hash_guard=$(sha256sum "$DIR/_guard.psql" | cut -d ' ' -f1)
hash_sql=$(sha256sum "$DIR/$file" | cut -d ' ' -f1)
[[ "$hash_guard" == "$GUARD_HASH" && "$hash_sql" == "$expected" ]] || {
  printf 'ABORT: SQL/guard SHA-256 mismatch; no connection attempted.\n' >&2; exit 3;
}

fingerprint=$(openssl x509 -in "$CA" -noout -fingerprint -sha256 | sed 's/^[^=]*=//; s/://g' | tr '[:lower:]' '[:upper:]')
[[ "$fingerprint" == '807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA' ]] || {
  printf 'ABORT: CA fingerprint mismatch; no connection attempted.\n' >&2; exit 3;
}

out=$(mktemp "$HOME/autoclip-component-audit.XXXXXX")
chmod 600 "$out"
keep=0
cleanup() {
  rc=$?
  trap - EXIT
  if [[ $keep -ne 1 && -n ${out:-} ]]; then rm -f -- "$out"; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

conninfo="host=$HOST port=$PORT dbname=$DATABASE user=$DB_USER sslmode=verify-full sslrootcert=$CA connect_timeout=10 application_name=$APP_NAME"
if env \
  -u PGSERVICE -u PGSERVICEFILE -u PGPASSWORD -u PGHOST -u PGHOSTADDR -u PGPORT \
  -u PGDATABASE -u PGUSER -u PGSSLMODE -u PGSSLROOTCERT -u PGSSLCRL -u PGSSLCRLDIR \
  -u PGSSLCERT -u PGSSLKEY -u PGAPPNAME -u PGCONNECT_TIMEOUT -u PGOPTIONS -u PGTARGETSESSIONATTRS \
  PGPASSFILE=/dev/null \
  psql -X -W -q -A -t -v ON_ERROR_STOP=1 \
    -v component_local_test=false -v component_cloud_approved=true \
    -v "cloud_project_ref=$PROJECT_REF" -v "cloud_host=$HOST" -v "cloud_port=$PORT" \
    -f "$DIR/$file" -o "$out" "$conninfo"
then
  if jq -s -e --arg section "$expected_section" 'length == 1 and (.[0] | type == "object" and .section == $section)' "$out" >/dev/null; then
    keep=1
    printf 'Protected JSON report: %s\n' "$out"
  else
    printf 'ABORT: result is not exactly one valid JSON object; partial output removed.\n' >&2
    exit 4
  fi
else
  rc=$?
  printf 'Audit failed (exit %s); partial output removed. No retry performed.\n' "$rc" >&2
  exit "$rc"
fi
