#!/usr/bin/env bash
set -euo pipefail
worker_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../deploy/local-worker" && pwd)"
for attempt in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    exec docker compose --project-directory "$worker_dir" -f "$worker_dir/compose.yaml" up -d
  fi
  sleep 2
done
echo 'Docker daemon não ficou disponível após 120 segundos.' >&2
exit 1
