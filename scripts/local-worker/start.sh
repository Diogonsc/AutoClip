#!/usr/bin/env bash
set -euo pipefail
worker_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../deploy/local-worker" && pwd)"
compose=(docker compose --project-directory "$worker_dir" -f "$worker_dir/compose.yaml")
[[ -f "$worker_dir/.env" ]] || { echo "Falta $worker_dir/.env; execute install.sh e preencha as credenciais locais." >&2; exit 2; }
docker info >/dev/null
"${compose[@]}" config --quiet
"${compose[@]}" up -d --build
"$(dirname -- "${BASH_SOURCE[0]}")/status.sh"
