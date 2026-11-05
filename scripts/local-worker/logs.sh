#!/usr/bin/env bash
set -euo pipefail
worker_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../deploy/local-worker" && pwd)"
tail_args=(-n "${LOG_LINES:-100}")
[[ "${FOLLOW:-false}" == "true" ]] && tail_args+=(-f)
docker compose --project-directory "$worker_dir" -f "$worker_dir/compose.yaml" logs "${tail_args[@]}" worker validator
