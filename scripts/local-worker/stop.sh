#!/usr/bin/env bash
set -euo pipefail
worker_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../deploy/local-worker" && pwd)"
docker compose --project-directory "$worker_dir" -f "$worker_dir/compose.yaml" stop
