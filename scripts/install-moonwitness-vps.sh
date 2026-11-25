#!/usr/bin/env bash
set -euo pipefail

# MoonWitness Turnkey VPS Installer
# Idempotent POSIX/bash installer for Ubuntu/Debian VPS nodes.
# Clones/updates MoonWitness, generates redacted secrets (chmod 600),
# starts EasyTier P2P mesh, installs moonwitness-control-plane.service,
# and launches the Docker Compose stack (postgres, api, board, workers, sandbox).

MW_INSTALL_DIR="${MW_INSTALL_DIR:-/opt/moonwitness-xv}"
MW_REPO_URL="${MW_REPO_URL:-https://github.com/moonwitness/mw-xv.git}"
MW_REPO_BRANCH="${MW_REPO_BRANCH:-dev}"
MW_MESH_ENV_DIR="${MW_MESH_ENV_DIR:-/etc/moonwitness}"
MW_MESH_ENV_FILE="${MW_MESH_ENV_DIR}/mesh.env"
MW_ENV_FILE="${MW_INSTALL_DIR}/.env"
MW_MESH_IPV4="${MW_MESH_IPV4:-10.144.0.1}"
MW_MESH_HOSTNAME="${MW_MESH_HOSTNAME:-$(hostname -s 2>/dev/null || echo moonwitness-vps)}"
MW_MESH_CONTAINER_NAME="${MW_MESH_CONTAINER_NAME:-moonwitness-easytier}"
MW_CONTROL_PLANE_PORT="${MW_CONTROL_PLANE_PORT:-3003}"
MW_API_PORT="${MW_API_PORT:-3000}"
MW_BOARD_PORT="${MW_BOARD_PORT:-4174}"
MW_SYSTEMD_UNIT="/etc/systemd/system/moonwitness-control-plane.service"

log() {
  printf '[moonwitness-vps] %s\n' "$*"
}

die() {
  printf '[moonwitness-vps] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

generate_secret() {
  local length="${1:-48}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$((length * 2))" | tr -dc 'A-Za-z0-9' | head -c "$length"
  else
    LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$length"
  fi
}

get_env_value() {
  local file="$1"
  local key="$2"
  if [ -f "$file" ]; then
    awk -F= -v k="$key" '$1 == k { sub(/^[^=]*=/, ""); print; exit }' "$file"
  fi
}

ensure_env_kv() {
  local file="$1"
  local key="$2"
  local value="$3"
  local existing replacement
  existing="$(get_env_value "$file" "$key" || true)"
  if [ "$existing" = "$value" ]; then
    return
  fi

  replacement="$(mktemp "${file}.XXXXXX")"
  if [ -f "$file" ]; then
    awk -F= -v k="$key" -v v="$value" '
      BEGIN { replaced = 0 }
      $1 == k {
        if (!replaced) print k "=" v
        replaced = 1
        next
      }
      { print }
      END {
        if (!replaced) print k "=" v
      }
    ' "$file" >"$replacement"
  else
    printf '%s=%s\n' "$key" "$value" >"$replacement"
  fi
  chmod 600 "$replacement"
  mv -f "$replacement" "$file"
}

redact_secret() {
  local value="$1"
  local len="${#value}"
  if [ "$len" -le 8 ]; then
    printf '[REDACTED]'
  else
    printf '%s...[REDACTED]' "${value:0:4}"
  fi
}

preflight() {
  require_cmd git
  require_cmd docker
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 plugin is required."
}

sync_repository() {
  if [ -d "${MW_INSTALL_DIR}/.git" ]; then
    log "Updating existing repository in ${MW_INSTALL_DIR} (branch: ${MW_REPO_BRANCH})"
    git -C "${MW_INSTALL_DIR}" fetch origin "${MW_REPO_BRANCH}" --depth=1
    git -C "${MW_INSTALL_DIR}" checkout -B "${MW_REPO_BRANCH}" "origin/${MW_REPO_BRANCH}"
  else
    log "Cloning MoonWitness (${MW_REPO_BRANCH}) into ${MW_INSTALL_DIR}"
    mkdir -p "$(dirname "${MW_INSTALL_DIR}")"
    git clone --branch "${MW_REPO_BRANCH}" --depth=1 "${MW_REPO_URL}" "${MW_INSTALL_DIR}"
  fi
}

configure_app_env() {
  log "Ensuring idempotent application secrets in ${MW_ENV_FILE} (chmod 600)"
  touch "${MW_ENV_FILE}"
  chmod 600 "${MW_ENV_FILE}"

  local pg_pass jwt_secret metrics_token observability_token sandbox_token superadmin_login superadmin_pass
  pg_pass="$(get_env_value "${MW_ENV_FILE}" "POSTGRES_PASSWORD" || true)"
  [ -n "$pg_pass" ] || pg_pass="$(generate_secret 32)"

  jwt_secret="$(get_env_value "${MW_ENV_FILE}" "JWT_SECRET" || true)"
  [ -n "$jwt_secret" ] || jwt_secret="$(generate_secret 64)"

  metrics_token="$(get_env_value "${MW_ENV_FILE}" "METRICS_TOKEN" || true)"
  [ -n "$metrics_token" ] || metrics_token="$(generate_secret 40)"

  observability_token="$(get_env_value "${MW_ENV_FILE}" "OBSERVABILITY_INGEST_TOKEN" || true)"
  if [ "${#observability_token}" -lt 32 ]; then
    observability_token="$(generate_secret 48)"
  fi

  sandbox_token="$(get_env_value "${MW_ENV_FILE}" "AGENT_SANDBOX_TOKEN" || true)"
  if [ "${#sandbox_token}" -lt 32 ]; then
    sandbox_token="$(generate_secret 48)"
  fi

  superadmin_login="$(get_env_value "${MW_ENV_FILE}" "SUPERADMIN_LOGIN" || true)"
  [ -n "$superadmin_login" ] || superadmin_login="${SUPERADMIN_LOGIN:-admin}"

  superadmin_pass="$(get_env_value "${MW_ENV_FILE}" "SUPERADMIN_INITIAL_PASSWORD" || true)"
  [ -n "$superadmin_pass" ] || superadmin_pass="${SUPERADMIN_INITIAL_PASSWORD:-$(generate_secret 24)}"

  ensure_env_kv "${MW_ENV_FILE}" "POSTGRES_PASSWORD" "${pg_pass}"
  ensure_env_kv "${MW_ENV_FILE}" "JWT_SECRET" "${jwt_secret}"
  ensure_env_kv "${MW_ENV_FILE}" "MW_INTERNAL_SECRET" "${jwt_secret}"
  ensure_env_kv "${MW_ENV_FILE}" "METRICS_TOKEN" "${metrics_token}"
  ensure_env_kv "${MW_ENV_FILE}" "OBSERVABILITY_INGEST_TOKEN" "${observability_token}"
  ensure_env_kv "${MW_ENV_FILE}" "AGENT_SANDBOX_TOKEN" "${sandbox_token}"
  ensure_env_kv "${MW_ENV_FILE}" "SUPERADMIN_LOGIN" "${superadmin_login}"
  ensure_env_kv "${MW_ENV_FILE}" "SUPERADMIN_INITIAL_PASSWORD" "${superadmin_pass}"
  ensure_env_kv "${MW_ENV_FILE}" "SUPERADMIN_PASSWORD" "${superadmin_pass}"
  ensure_env_kv "${MW_ENV_FILE}" "DATABASE_URL" "postgresql://postgres:${pg_pass}@postgres:5432/moonwitness_db"
  ensure_env_kv "${MW_ENV_FILE}" "API_PORT" "${MW_API_PORT}"
  ensure_env_kv "${MW_ENV_FILE}" "BOARD_PORT" "${MW_BOARD_PORT}"
  chmod 600 "${MW_ENV_FILE}"
}

configure_mesh_env() {
  log "Ensuring idempotent P2P mesh credentials in ${MW_MESH_ENV_FILE} (chmod 600)"
  mkdir -p "${MW_MESH_ENV_DIR}"
  chmod 700 "${MW_MESH_ENV_DIR}"
  touch "${MW_MESH_ENV_FILE}"
  chmod 600 "${MW_MESH_ENV_FILE}"

  local mesh_name mesh_secret
  mesh_name="$(get_env_value "${MW_MESH_ENV_FILE}" "MW_MESH_NETWORK_NAME" || true)"
  [ -n "$mesh_name" ] || mesh_name="${MW_MESH_NETWORK_NAME:-moonwitness-mesh-$(generate_secret 8)}"

  mesh_secret="$(get_env_value "${MW_MESH_ENV_FILE}" "MW_MESH_NETWORK_SECRET" || true)"
  [ -n "$mesh_secret" ] || mesh_secret="${MW_MESH_NETWORK_SECRET:-$(generate_secret 40)}"

  ensure_env_kv "${MW_MESH_ENV_FILE}" "MW_MESH_NETWORK_NAME" "${mesh_name}"
  ensure_env_kv "${MW_MESH_ENV_FILE}" "MW_MESH_NETWORK_SECRET" "${mesh_secret}"
  ensure_env_kv "${MW_MESH_ENV_FILE}" "MW_MESH_IPV4" "${MW_MESH_IPV4}"
  chmod 600 "${MW_MESH_ENV_FILE}"
}

start_easytier_mesh() {
  local mesh_name mesh_secret mesh_ip
  mesh_name="$(get_env_value "${MW_MESH_ENV_FILE}" "MW_MESH_NETWORK_NAME")"
  mesh_secret="$(get_env_value "${MW_MESH_ENV_FILE}" "MW_MESH_NETWORK_SECRET")"
  mesh_ip="$(get_env_value "${MW_MESH_ENV_FILE}" "MW_MESH_IPV4")"
  [ -n "$mesh_ip" ] || mesh_ip="${MW_MESH_IPV4}"

  log "Starting EasyTier P2P mesh container (${MW_MESH_CONTAINER_NAME}) on ${mesh_ip}"
  docker rm -f "${MW_MESH_CONTAINER_NAME}" >/dev/null 2>&1 || true
  docker run -d \
    --name "${MW_MESH_CONTAINER_NAME}" \
    --restart unless-stopped \
    --network host \
    --cap-add NET_ADMIN \
    --device /dev/net/tun:/dev/net/tun \
    easytier/easytier:latest \
    --ipv4 "${mesh_ip}" \
    --hostname "${MW_MESH_HOSTNAME}" \
    --network-name "${mesh_name}" \
    --network-secret "${mesh_secret}" >/dev/null
}

install_control_plane_service() {
  local mesh_ip
  mesh_ip="$(get_env_value "${MW_MESH_ENV_FILE}" "MW_MESH_IPV4")"
  [ -n "$mesh_ip" ] || mesh_ip="${MW_MESH_IPV4}"

  log "Installing systemd unit ${MW_SYSTEMD_UNIT} bound to ${mesh_ip}:${MW_CONTROL_PLANE_PORT} and 127.0.0.1:${MW_CONTROL_PLANE_PORT}"
  cat >"${MW_SYSTEMD_UNIT}" <<EOF
[Unit]
Description=MoonWitness Control Plane (Mesh + Loopback)
After=network-online.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=${MW_INSTALL_DIR}
EnvironmentFile=${MW_ENV_FILE}
EnvironmentFile=${MW_MESH_ENV_FILE}
Environment=MW_CONTROL_PLANE_BIND_MESH=${mesh_ip}:${MW_CONTROL_PLANE_PORT}
Environment=MW_CONTROL_PLANE_BIND_LOOPBACK=127.0.0.1:${MW_CONTROL_PLANE_PORT}
ExecStart=/usr/bin/docker compose -f ${MW_INSTALL_DIR}/deploy/compose/docker-compose.yml up --build control-plane
ExecStop=/usr/bin/docker compose -f ${MW_INSTALL_DIR}/deploy/compose/docker-compose.yml stop control-plane
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    systemctl daemon-reload
    systemctl enable moonwitness-control-plane.service
  else
    log "systemd not active; control-plane will be started via docker compose directly"
  fi
}

start_compose_stack() {
  log "Starting MoonWitness stack (postgres, api, board, jobs-worker, jobs-scheduler, outbox-worker, agent-sandbox) via docker compose"
  docker compose \
    -f "${MW_INSTALL_DIR}/deploy/compose/docker-compose.yml" \
    -f "${MW_INSTALL_DIR}/deploy/compose/docker-compose.production.yml" \
    --env-file "${MW_ENV_FILE}" \
    up -d --build postgres api board jobs-worker jobs-scheduler outbox-worker agent-sandbox

  if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    systemctl restart moonwitness-control-plane.service
  else
    log "systemd not active; starting control-plane via docker compose directly"
    docker compose -f "${MW_INSTALL_DIR}/deploy/compose/docker-compose.yml" --env-file "${MW_ENV_FILE}" up -d --build control-plane
  fi
}

probe_http_status() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
      printf 'healthy'
    else
      printf 'starting'
    fi
  else
    printf 'unknown'
  fi
}

print_readiness_summary() {
  local mesh_ip mesh_name mesh_secret superadmin_login api_health board_health cp_health
  mesh_ip="$(get_env_value "${MW_MESH_ENV_FILE}" "MW_MESH_IPV4")"
  [ -n "$mesh_ip" ] || mesh_ip="${MW_MESH_IPV4}"
  mesh_name="$(get_env_value "${MW_MESH_ENV_FILE}" "MW_MESH_NETWORK_NAME")"
  mesh_secret="$(get_env_value "${MW_MESH_ENV_FILE}" "MW_MESH_NETWORK_SECRET")"
  superadmin_login="$(get_env_value "${MW_ENV_FILE}" "SUPERADMIN_LOGIN")"

  api_health="$(probe_http_status "http://127.0.0.1:${MW_API_PORT}/readyz")"
  board_health="$(probe_http_status "http://127.0.0.1:${MW_BOARD_PORT}/")"
  cp_health="$(probe_http_status "http://127.0.0.1:${MW_CONTROL_PLANE_PORT}/health")"

  cat <<EOF

========================================================================
 MoonWitness VPS Readiness Summary (Secrets Redacted)
========================================================================
 Install Dir        : ${MW_INSTALL_DIR}
 Branch             : ${MW_REPO_BRANCH}
 Mesh Network       : ${mesh_name}
 Mesh Secret        : $(redact_secret "${mesh_secret}") (stored in ${MW_MESH_ENV_FILE}, chmod 600)
 Mesh IPv4          : ${mesh_ip}
 Superadmin Login   : ${superadmin_login}
 Superadmin Secret  : [REDACTED] (stored in ${MW_ENV_FILE}, chmod 600)
 API Health         : ${api_health} (http://127.0.0.1:${MW_API_PORT}/readyz)
 Board Health       : ${board_health} (http://127.0.0.1:${MW_BOARD_PORT}/)
 Control Plane      : ${cp_health} (http://${mesh_ip}:${MW_CONTROL_PLANE_PORT})
 Onboarding Endpoint: http://${mesh_ip}:${MW_CONTROL_PLANE_PORT}/api/onboarding/status
========================================================================
 Connect from MoonWitness Desktop (DX Mode) using Mesh IP ${mesh_ip}.
========================================================================
EOF
}

main() {
  preflight
  sync_repository
  configure_app_env
  configure_mesh_env
  start_easytier_mesh
  install_control_plane_service
  start_compose_stack
  print_readiness_summary
}

main "$@"
