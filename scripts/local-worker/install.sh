#!/usr/bin/env bash
set -euo pipefail
worker_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../deploy/local-worker" && pwd)"
repo_root="$(cd -- "$worker_dir/../.." && pwd)"
compose=(docker compose --project-directory "$worker_dir" -f "$worker_dir/compose.yaml")

command -v docker >/dev/null || { echo 'Docker não encontrado.' >&2; exit 2; }
command -v openssl >/dev/null || { echo 'openssl não encontrado; necessário para gerar credenciais locais.' >&2; exit 2; }
docker compose version >/dev/null || { echo 'Docker Compose plugin não encontrado.' >&2; exit 2; }
docker info >/dev/null || { echo 'Docker daemon indisponível para este usuário.' >&2; exit 2; }
if [[ ! -e "$worker_dir/.env" ]]; then cp "$worker_dir/.env.example" "$worker_dir/.env"; chmod 600 "$worker_dir/.env"; fi
env_value() { sed -n "s/^$1=//p" "$worker_dir/.env" | tail -n 1 | sed -E "s/^['\"](.*)['\"]$/\1/"; }
secret_path() {
  local variable="$1" path
  path="$(env_value "$variable")"
  [[ -n "$path" ]] || { echo "Configure $variable no .env." >&2; exit 2; }
  [[ "$path" = /* ]] || path="$worker_dir/$path"
  path="$(realpath -m "$path")"
  case "$path" in "$worker_dir"/secrets/*) ;; *) echo "$variable precisa apontar para deploy/local-worker/secrets/." >&2; exit 2 ;; esac
  mkdir -p "$(dirname -- "$path")"
  chmod 700 "$(dirname -- "$path")"
  touch "$path"
  chmod 600 "$path"
  printf '%s' "$path"
}

api_secret_file="$(secret_path VIDEO_WORKER_API_SECRET_FILE)"
validator_token_file="$(secret_path VIDEO_VALIDATOR_TOKEN_FILE)"
attestation_key_file="$(secret_path VIDEO_VALIDATION_ATTESTATION_KEY_FILE)"
for file in "$api_secret_file" "$validator_token_file" "$attestation_key_file"; do
  if [[ ! -s "$file" ]]; then openssl rand -hex 32 > "$file"; chmod 600 "$file"; fi
done
umask 077
edge_env_tmp="$worker_dir/.edge.env.tmp.$$"
printf 'VIDEO_WORKER_API_SECRET=%s\nVIDEO_VALIDATION_ATTESTATION_KEY=%s\n' \
  "$(cat "$api_secret_file")" "$(cat "$attestation_key_file")" > "$edge_env_tmp"
chmod 600 "$edge_env_tmp"
mv -f -- "$edge_env_tmp" "$worker_dir/.edge.env"
if ! grep -q '^WORKER_INSTANCE_ID=.' "$worker_dir/.env"; then
  sed -i "s|^WORKER_INSTANCE_ID=.*|WORKER_INSTANCE_ID=$(cat /proc/sys/kernel/random/uuid)|" "$worker_dir/.env"
fi
chmod 600 "$worker_dir/.env"

api_url="$(env_value VIDEO_WORKER_API_URL)"
allow_cloud="$(env_value VIDEO_WORKER_ALLOW_CLOUD)"
[[ -n "$api_url" ]] || { echo 'Configure VIDEO_WORKER_API_URL.' >&2; exit 2; }
if [[ "$allow_cloud" != 'true' && ! "$api_url" =~ ^http://(localhost|127\.0\.0\.1|host\.docker\.internal)(:[0-9]+)?/functions/v1/video-worker-api$ ]]; then
  echo 'Por padrão o instalador aceita somente endpoint local. Endpoint remoto exige revisão explícita e HTTPS.' >&2
  exit 2
fi
if [[ "$allow_cloud" == 'true' && ! "$api_url" =~ ^https:// ]]; then echo 'Endpoint remoto precisa usar HTTPS.' >&2; exit 2; fi

"${compose[@]}" config --quiet
docker build -t autoclip-video-validator:3.6.1 -f "$repo_root/scripts/video-validator/Dockerfile" "$repo_root/scripts/video-validator"
docker build -t autoclip-video-worker:3.6.1 -f "$worker_dir/Dockerfile" "$repo_root"
"${compose[@]}" up -d

service_dir="$HOME/.config/systemd/user"
mkdir -p "$service_dir"
escaped_dir="${worker_dir//\\/\\x5c}"
escaped_dir="${escaped_dir// /\\x20}"
systemd_start="$repo_root/scripts/local-worker/systemd-start.sh"
escaped_start="${systemd_start//\\/\\x5c}"
escaped_start="${escaped_start// /\\x20}"
serve_edge="$repo_root/scripts/local-worker/serve-edge.sh"
escaped_edge="${serve_edge//\\/\\x5c}"
escaped_edge="${escaped_edge// /\\x20}"
if [[ "$api_url" =~ ^http://(localhost|127\.0\.0\.1|host\.docker\.internal)(:[0-9]+)?/functions/v1/video-worker-api$ ]]; then
  cat > "$service_dir/autoclip-video-worker-api.service" <<UNIT
[Unit]
Description=AutoClip local restricted video worker API
After=default.target

[Service]
Type=simple
WorkingDirectory=$repo_root
ExecStart=$escaped_edge
Restart=on-failure
RestartSec=5
TimeoutStopSec=20

[Install]
WantedBy=default.target
UNIT
  chmod 600 "$service_dir/autoclip-video-worker-api.service"
fi
cat > "$service_dir/autoclip-local-worker.service" <<UNIT
[Unit]
Description=AutoClip local video validation worker
After=default.target
Wants=autoclip-video-worker-api.service
After=autoclip-video-worker-api.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$escaped_dir
ExecStart=$escaped_start
ExecStop=/usr/bin/docker compose --project-directory $escaped_dir -f $escaped_dir/compose.yaml stop
TimeoutStartSec=0
TimeoutStopSec=180

[Install]
WantedBy=default.target
UNIT
chmod 600 "$service_dir/autoclip-local-worker.service"
systemctl --user daemon-reload
if [[ "$api_url" =~ ^http://(localhost|127\.0\.0\.1|host\.docker\.internal)(:[0-9]+)?/functions/v1/video-worker-api$ ]]; then
  systemctl --user enable --now autoclip-video-worker-api.service
fi
systemctl --user enable --now autoclip-local-worker.service
echo 'Worker local habilitado no systemd do usuário; o endpoint Edge deve estar disponível para /ready.'
if ! systemctl is-enabled docker >/dev/null 2>&1; then echo 'Docker não está habilitado no boot. Admin: sudo systemctl enable docker'; fi
if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || true)" != 'yes' ]]; then
  echo "O serviço inicia antes do login somente com linger. Admin: sudo loginctl enable-linger $USER"
fi
echo "Configuração: $worker_dir/.env e $worker_dir/.edge.env (ambos 0600; segredos gerados localmente)."
echo 'Nenhuma chave service_role é solicitada ou instalada no worker.'
