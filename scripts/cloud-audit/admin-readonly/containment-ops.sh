#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly EXPECTED_PROJECT='djrwfvcxgpyknmizqumn'
readonly EXPECTED_ROLE='autoclip_cloud_auditor'
readonly EXPECTED_VALID_UNTIL='2026-11-15T00:43:58+00:00'
readonly HOST='db.djrwfvcxgpyknmizqumn.supabase.co'
readonly PORT='5432'
readonly DATABASE='postgres'
readonly ADMIN_USER='postgres'
readonly APP_NAME='autoclip_gate36_admin_readonly'
readonly EXPECTED_CA_FINGERPRINT='80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA'
readonly DIAGNOSTIC_HASH='86eb075d1a3f6be08ed704e2518b352d6cf9320449321c2eab3658533788044c'
readonly CONTAINMENT_HASH='335997ae505ebb3d2f58d63ccddb03fcb5488ba18ae94933cbc0fe0278700707'
readonly GUARD_HASH='9a326bf4cda77395c9ea7cbb65aadb55fb6a7e72b4c6ed394df40280331cad9f'
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly ROOT="$(git -C "$SCRIPT_DIR/../../.." rev-parse --show-toplevel)"
readonly CA="$ROOT/prod-ca-2021.crt"
readonly DIAGNOSTIC_SQL="$SCRIPT_DIR/00_role_containment_diagnostic.sql"
readonly CONTAINMENT_SQL="$SCRIPT_DIR/31_disable_role_nologin.sql"
readonly GUARD_SQL="$SCRIPT_DIR/_guard.psql"

report=''
transcript=''
query_output=''
preserve_outputs=0
announced_outputs=0

die() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }

cleanup() {
  local rc=$?
  trap - EXIT
  if [[ "$preserve_outputs" -eq 1 ]]; then
    if [[ "$announced_outputs" -ne 1 ]]; then
      printf 'Saídas protegidas para reconciliação: %s %s %s\n' \
        "${report:-}" "${transcript:-}" "${query_output:-}" >&2
    fi
  else
    [[ -z "$report" ]] || rm -f -- "$report" || true
    [[ -z "$transcript" ]] || rm -f -- "$transcript" || true
    [[ -z "$query_output" ]] || rm -f -- "$query_output" || true
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

require_root() {
  [[ "$(pwd -P)" == "$ROOT" ]] || die "execute Bash a partir da raiz do repositório: $ROOT"
}

require_tools() {
  local tool
  for tool in psql jq sha256sum openssl stat; do command -v "$tool" >/dev/null || die "ferramenta ausente: $tool"; done
}

verify_hashes() {
  local include_containment="${1:-false}"
  if [[ "$include_containment" == true ]]; then
    printf '%s  %s\n%s  %s\n%s  %s\n' \
      "$DIAGNOSTIC_HASH" "$DIAGNOSTIC_SQL" \
      "$CONTAINMENT_HASH" "$CONTAINMENT_SQL" \
      "$GUARD_HASH" "$GUARD_SQL" | sha256sum --check --status || die 'hash de SQL/guard divergente'
  else
    printf '%s  %s\n%s  %s\n' \
      "$DIAGNOSTIC_HASH" "$DIAGNOSTIC_SQL" \
      "$GUARD_HASH" "$GUARD_SQL" | sha256sum --check --status || die 'hash de diagnóstico/guard divergente'
  fi
}

verify_ca() {
  [[ -r "$CA" ]] || die "CA ausente ou ilegível: $CA"
  [[ "$(stat -c %a "$CA")" == 644 ]] || die 'permissão do CA diferente de 0644'
  local fingerprint
  fingerprint="$(openssl x509 -in "$CA" -noout -fingerprint -sha256 | sed 's/^.*=//')" || die 'CA PEM inválido'
  [[ "$fingerprint" == "$EXPECTED_CA_FINGERPRINT" ]] || die 'fingerprint do CA divergente'
}

neutralize_pg_environment() {
  unset PGSERVICE PGSERVICEFILE PGPASSWORD PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER \
    PGSSLMODE PGSSLROOTCERT PGSSLCRL PGSSLCRLDIR PGSSLCERT PGSSLKEY \
    PGSSLMINPROTOCOLVERSION PGSSLMAXPROTOCOLVERSION PGSSLCOMPRESSION \
    PGAPPNAME PGOPTIONS PGCONNECT_TIMEOUT PGTARGETSESSIONATTRS PGREQUIRESSL \
    PGCHANNELBINDING
}

conninfo() {
  printf 'host=%s port=%s dbname=%s user=%s sslmode=verify-full sslrootcert=%s connect_timeout=10 application_name=%s' \
    "$HOST" "$PORT" "$DATABASE" "$ADMIN_USER" "$CA" "$APP_NAME"
}

validate_report_file() {
  local path="$1" now mtime owner mode
  case "$path" in "$HOME"/autoclip-admin-readonly.*) ;; *) die 'relatório fora do padrão/pasta HOME esperado' ;; esac
  [[ -f "$path" ]] || die 'relatório não existe ou não é arquivo regular'
  owner="$(stat -c %u "$path")"; mode="$(stat -c %a "$path")"; mtime="$(stat -c %Y "$path")"; now="$(date +%s)"
  [[ "$owner" == "$(id -u)" && "$mode" == 600 ]] || die 'relatório deve pertencer ao usuário atual e estar em modo 0600'
  [[ "$mtime" -le "$now" && "$((now - mtime))" -le 300 ]] || die 'relatório tem mais de 5 minutos ou timestamp futuro'
  jq -s -e --arg role "$EXPECTED_ROLE" --arg valid "$EXPECTED_VALID_UNTIL" '
    length == 1 and
    (.[0] as $r |
      $r.role_present == true and $r.role == $role and $r.marker_matches == true and
      $r.can_login == true and $r.valid_until == $valid and $r.connection_limit == 1 and
      $r.superuser == false and $r.inherit == false and $r.create_role == false and
      $r.create_db == false and $r.replication == false and $r.bypass_rls == false and
      $r.database_privileges.connect == true and $r.database_privileges.create == false and
      $r.database_privileges.temporary == true and
      $r.effective_memberships == [] and $r.active_session_count == 0 and
      $r.active_sessions == [] and $r.shared_dependencies == [] and
      ($r.membership_edges | length) == 1 and
      $r.membership_edges[0] == {
        member: "postgres", granted_role: $role, admin_option: true,
        inherit_option: false, set_option: false
      }
    )
  ' "$path" >/dev/null || die 'relatório ausente, inválido, antigo ou com estado divergente'
}

diagnose() {
  require_root; require_tools; verify_hashes false; verify_ca
  report="$(mktemp "$HOME/autoclip-admin-readonly.XXXXXX")"
  chmod 600 "$report"
  neutralize_pg_environment
  if PGPASSFILE=/dev/null psql -X -W -q -A -t -v ON_ERROR_STOP=1 \
      -v audit_local_test=false -v cloud_admin_approved=true \
      -v cloud_project_ref="$EXPECTED_PROJECT" -v audit_database="$DATABASE" \
      -v audit_role="$EXPECTED_ROLE" -f "$DIAGNOSTIC_SQL" -o "$report" "$(conninfo)"; then
    jq -s -e 'length == 1 and (.[0] | type == "object" and has("role_present") and has("role") and has("marker_matches") and has("can_login") and has("valid_until") and has("connection_limit") and has("membership_edges") and has("effective_memberships") and has("active_session_count") and has("active_sessions") and has("shared_dependencies"))' "$report" >/dev/null || die 'resultado não é um único JSON completo'
    preserve_outputs=1; announced_outputs=1
    printf 'Diagnóstico read-only validado. Relatório protegido: %s\n' "$report"
  else
    die 'diagnóstico falhou; saída parcial será removida'
  fi
}

validate() {
  require_tools
  [[ $# -eq 1 ]] || die 'uso: validate /caminho/do/autoclip-admin-readonly.XXXXXX'
  validate_report_file "$1"
  jq -s --arg role "$EXPECTED_ROLE" '
    .[0] | {
      role_present, role, marker_matches, can_login, valid_until, connection_limit,
      superuser, inherit, create_role, create_db, replication, bypass_rls,
      database_privileges, membership_edges, effective_memberships,
      active_session_count,
      active_session_states: ((.active_sessions // []) | map(.state // "unknown") | group_by(.) | map({state: .[0], count: length})),
      dependency_counts: ([.shared_dependencies[].dependency_type] | group_by(.) | map({type: .[0], count: length}))
    }
  ' "$1"
}

summarize() {
  require_tools
  [[ $# -eq 1 ]] || die 'uso: summarize /caminho/do/autoclip-admin-readonly.XXXXXX'
  local path="$1" now mtime owner mode
  case "$path" in "$HOME"/autoclip-admin-readonly.*) ;; *) die 'relatório fora do padrão/pasta HOME esperado' ;; esac
  [[ -f "$path" ]] || die 'relatório não existe ou não é arquivo regular'
  owner="$(stat -c %u "$path")"; mode="$(stat -c %a "$path")"; mtime="$(stat -c %Y "$path")"; now="$(date +%s)"
  [[ "$owner" == "$(id -u)" && "$mode" == 600 ]] || die 'relatório deve pertencer ao usuário atual e estar em modo 0600'
  [[ "$mtime" -le "$now" && "$((now - mtime))" -le 300 ]] || die 'relatório tem mais de 5 minutos ou timestamp futuro'
  jq -s -e --arg role "$EXPECTED_ROLE" '
    length == 1 and (.[0] | type == "object" and .role == $role and .role_present == true and has("marker_matches") and has("can_login") and has("active_sessions") and has("shared_dependencies"))
  ' "$path" >/dev/null || die 'relatório de diagnóstico inválido ou incompleto'
  jq -s '
    .[0] | {
      role_present, role, marker_matches, can_login, valid_until, connection_limit,
      superuser, inherit, create_role, create_db, replication, bypass_rls,
      database_privileges, membership_edges, effective_memberships,
      active_session_count,
      active_session_states: ((.active_sessions // []) | map(.state // "unknown") | group_by(.) | map({state: .[0], count: length})),
      dependency_counts: ([.shared_dependencies[].dependency_type] | group_by(.) | map({type: .[0], count: length}))
    }
  ' "$path"
}

contain() {
  require_root; require_tools; verify_ca
  [[ $# -eq 1 ]] || die 'uso: contain /caminho/do/autoclip-admin-readonly.XXXXXX'
  validate_report_file "$1"
  read -r -p 'Confirme que não há operação administrativa concorrente sobre a role (digite YES): ' answer
  [[ "$answer" == YES ]] || die 'confirmação ausente'
  verify_hashes true

  transcript="$(mktemp "$HOME/autoclip-nologin-status.XXXXXX")"
  query_output="$(mktemp "$HOME/autoclip-nologin-psql-output.XXXXXX")"
  chmod 600 "$transcript" "$query_output"
  preserve_outputs=1
  neutralize_pg_environment

  if PGPASSFILE=/dev/null psql -X -W -A -t -v ON_ERROR_STOP=1 \
      -v audit_local_test=false -v cloud_admin_approved=true \
      -v cloud_project_ref="$EXPECTED_PROJECT" -v audit_database="$DATABASE" \
      -v audit_role="$EXPECTED_ROLE" -f "$CONTAINMENT_SQL" \
      -o "$query_output" "$(conninfo)" >"$transcript"; then
    if grep -Fq 'NOLOGIN VERIFIED: new role logins are disabled; no sessions were terminated.' "$transcript"; then
      announced_outputs=1
      printf 'Script concluiu sua checagem pós-COMMIT. Isso não substitui o diagnóstico read-only independente. Saídas: %s %s\n' "$transcript" "$query_output"
    else
      die 'marcador de conclusão ausente; resultado indeterminado; não repetir'
    fi
  else
    local rc=$?
    if grep -Fq 'POST-COMMIT VERIFICATION FAILED' "$transcript"; then
      printf 'Falha após COMMIT: NOLOGIN pode estar aplicado. Faça apenas diagnóstico read-only para reconciliar.\n' >&2
    elif grep -Fq 'ABORT:' "$transcript"; then
      printf 'O SQL abortou por guard/precondição; não repetir sem investigar.\n' >&2
    else
      printf 'Falha/desconexão sem resultado conclusivo. Não repetir; reconciliar com diagnóstico read-only.\n' >&2
    fi
    exit "$rc"
  fi
}

case "${1:-}" in
  diagnose) [[ $# -eq 1 ]] || die 'uso: diagnose'; diagnose ;;
  validate) shift; validate "$@" ;;
  summarize) shift; summarize "$@" ;;
  contain) shift; contain "$@" ;;
  *) die 'uso: bash scripts/cloud-audit/admin-readonly/containment-ops.sh {diagnose|validate|summarize|contain} [relatório]' ;;
esac
