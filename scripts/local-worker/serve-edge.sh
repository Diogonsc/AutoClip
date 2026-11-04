#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
worker_dir="$repo_root/deploy/local-worker"
edge_env="$worker_dir/.edge.env"
export PATH="$HOME/.nvm/current/bin:$HOME/.nvm/versions/node/$(find "$HOME/.nvm/versions/node" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort -V | tail -n 1)/bin:$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"
[[ -s "$edge_env" ]] || { echo 'Execute install.sh para gerar .edge.env local.' >&2; exit 2; }
api_url="$(supabase status -o env 2>/dev/null | sed -n 's/^API_URL=//p' | tr -d '\"')"
[[ "$api_url" =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$ ]] || { echo 'Recusa fechada: Edge local exige Supabase em loopback.' >&2; exit 2; }
cd "$repo_root"
exec supabase functions serve video-worker-api --no-verify-jwt --env-file "$edge_env"
