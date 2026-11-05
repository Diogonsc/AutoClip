#!/usr/bin/env bash
set -euo pipefail
worker_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../deploy/local-worker" && pwd)"
docker compose --project-directory "$worker_dir" -f "$worker_dir/compose.yaml" ps
if command -v curl >/dev/null 2>&1; then
  wait_health() {
    local path="$1" expected="$2" deadline=$((SECONDS + 30)) response=''
    while (( SECONDS < deadline )); do
      response="$(curl --fail --silent --max-time 2 "http://127.0.0.1:9781$path" 2>/dev/null || true)"
      if [[ "$response" == *"$expected"* ]]; then printf '%s\n' "$response"; return 0; fi
      sleep 1
    done
    return 1
  }
  wait_health /live '"live":true' || {
    echo "Worker sem health endpoint após 30 s. Isso não informa o estado remoto da fila." >&2
    exit 1
  }
  wait_health /ready '"ready":true' || {
    echo "Processo vivo, mas worker sem conectividade/heartbeat recentes com Supabase após 30 s." >&2
    exit 1
  }
fi
