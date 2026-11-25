#!/usr/bin/env bash
set -euo pipefail

# MoonWitness Coolify-Pattern Turnkey VPS Installer
#
# Single public control entry:
#   https://<MW_BASE_DOMAIN>         -> moonwitness_board -> moonwitness_api -> private control-plane (10.144.0.1:3003)
#   https://wa.<MW_BASE_DOMAIN>      -> standalone @moonwitness/whatsapp service
#   https://<slug>.<MW_BASE_DOMAIN>  -> dynamically deployed PaaS apps via Caddy
#
# Control-plane stays 100% private on the EasyTier mesh (never exposed publicly on :3003 or :3004).

REINSTALL="false"
MW_BASE_DOMAIN="${MW_BASE_DOMAIN:-}"
MW_PUBLIC_PORT="${MW_PUBLIC_PORT:-8000}"
UNLOCK_PORT="false"
WIPE_TLS="false"
MW_INSTALL_DIR="${MW_INSTALL_DIR:-/opt/moonwitness-xv}"
MW_WA_DIR="${MW_WA_DIR:-/opt/moonwitness-whatsapp}"
MW_REPO_URL="${MW_REPO_URL:-https://github.com/A-L-L-A-H/mw-xv.git}"
MW_REPO_BRANCH="${MW_REPO_BRANCH:-dev}"
MW_SOURCE_TARBALL="${MW_SOURCE_TARBALL:-}"
MW_CONTROL_PLANE_SRC_BIN="${MW_CONTROL_PLANE_SRC_BIN:-}"
MW_CONTROL_PLANE_BIN="${MW_CONTROL_PLANE_BIN:-/usr/local/bin/moonwitness-control-plane}"
MW_ETC_DIR="/etc/moonwitness"
MW_DATA_DIR="/var/lib/moonwitness"
MW_MESH_IPV4="${MW_MESH_IPV4:-10.144.0.1}"
MW_MESH_HOSTNAME="${MW_MESH_HOSTNAME:-$(hostname -s 2>/dev/null || echo moonwitness-vps)}"
MW_CONTROL_PLANE_PORT="${MW_CONTROL_PLANE_PORT:-3003}"
MW_PAAS_NETWORK="${MW_PAAS_NETWORK:-moonwitness-paas}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --reinstall)
      REINSTALL="true"
      shift
      ;;
    --domain)
      MW_BASE_DOMAIN="${2:?--domain requires a value}"
      shift 2
      ;;
    --port)
      MW_PUBLIC_PORT="${2:?--port requires a value}"
      shift 2
      ;;
    --unlock-port)
      UNLOCK_PORT="true"
      shift
      ;;
    --wipe-tls)
      WIPE_TLS="true"
      shift
      ;;
    --source-tarball)
      MW_SOURCE_TARBALL="${2:?--source-tarball requires a path}"
      shift 2
      ;;
    --control-plane-bin)
      MW_CONTROL_PLANE_SRC_BIN="${2:?--control-plane-bin requires a path}"
      shift 2
      ;;
    --branch)
      MW_REPO_BRANCH="${2:?--branch requires a value}"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

[ "${EUID:-$(id -u)}" -eq 0 ] || { echo "ERROR: Run as root." >&2; exit 1; }

# Auto-install Docker Engine + Compose v2 when missing.
if ! command -v docker >/dev/null 2>&1; then
  echo "[moonwitness-install] Docker not found; installing Docker Engine..."
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true
if ! docker compose version >/dev/null 2>&1; then
  echo "[moonwitness-install] Installing Docker Compose v2 plugin..."
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi
command -v openssl >/dev/null 2>&1 || { echo "ERROR: openssl required." >&2; exit 1; }

detect_public_ipv4() {
  local detected=""
  detected="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  [ -n "$detected" ] || detected="$(curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)"
  [ -n "$detected" ] || detected="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')"
  printf '%s' "$detected"
}

if [ -z "${MW_PUBLIC_IPV4:-}" ]; then
  MW_PUBLIC_IPV4="$(detect_public_ipv4)"
fi
[ -n "$MW_PUBLIC_IPV4" ] || { echo "ERROR: could not detect public IPv4; set MW_PUBLIC_IPV4 explicitly." >&2; exit 1; }

log() { printf '[moonwitness-install] %s\n' "$*"; }

generate_secret() {
  local bytes="${1:-32}"
  openssl rand -hex "$bytes"
}

get_env() {
  local file="$1" key="$2"
  [ -f "$file" ] && awk -F= -v k="$key" '$1 == k { sub(/^[^=]*=/, ""); print; exit }' "$file" || true
}

upsert_env() {
  local file="$1" key="$2" val="$3"
  touch "$file"
  chmod 600 "$file"
  if grep -qE "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    printf '%s=%s\n' "$key" "$val" >> "$file"
  fi
}

cleanup_for_reinstall() {
  log "Reinstall mode: wiping MoonWitness containers, ALL databases/volumes/networks/stacks/backups, and env state (preserving unrelated containers)..."
  systemctl stop moonwitness-control-plane.service 2>/dev/null || true

  for c in moonwitness_board moonwitness_api moonwitness_postgres moonwitness_whatsapp moonwitness_whatsapp_tunnel moonwitness-caddy; do
    docker rm -f "$c" >/dev/null 2>&1 || true
  done
  docker ps -a --filter "label=mw.paas.managed=true" -q | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker ps -a --filter 'name=^mw-paas-' -q | xargs -r docker rm -f >/dev/null 2>&1 || true

  for v in moonwitness-xv_pgdata moonwitness-xv_attachments_data moonwitness-whatsapp_whatsapp_auth_data moonwitness_pgdata pgdata; do
    docker volume rm -f "$v" >/dev/null 2>&1 || true
  done
  docker volume ls -q | grep -E '^(mw-|mw-paas-)' | xargs -r docker volume rm -f >/dev/null 2>&1 || true

  docker network ls --format '{{.Name}}' | grep -E '^(mw-paas-|mw-stack-)' | xargs -r docker network rm >/dev/null 2>&1 || true

  rm -f "${MW_DATA_DIR}/control-plane.db"* 2>/dev/null || true
  rm -rf "${MW_DATA_DIR}/stacks" 2>/dev/null || true
  rm -rf "${MW_DATA_DIR}/backups"/* 2>/dev/null || true
  rm -f "${MW_ETC_DIR}/control-plane.env" "${MW_ETC_DIR}/Caddyfile" "${MW_INSTALL_DIR}/.env" "${MW_WA_DIR}/.env" 2>/dev/null || true
  if [ "${WIPE_TLS}" = "true" ]; then
    rm -rf "${MW_DATA_DIR}/caddy-data"/* "${MW_DATA_DIR}/caddy-config"/* 2>/dev/null || true
  fi
  log "Clean wipe complete (unrelated containers such as freellmapi-* and dx-api-postgres-test were left untouched)."
}

sync_sources() {
  mkdir -p "${MW_INSTALL_DIR}" "${MW_WA_DIR}/src"
  if [ -n "${MW_SOURCE_TARBALL}" ] && [ -f "${MW_SOURCE_TARBALL}" ]; then
    log "Extracting clean source tarball into ${MW_INSTALL_DIR} and ${MW_WA_DIR}/src..."
    find "${MW_INSTALL_DIR}" -mindepth 1 -maxdepth 1 ! -name 'pgdata' -exec rm -rf {} + 2>/dev/null || true
    tar -xzf "${MW_SOURCE_TARBALL}" -C "${MW_INSTALL_DIR}"
    rm -rf "${MW_WA_DIR}/src"/*
    tar -xzf "${MW_SOURCE_TARBALL}" -C "${MW_WA_DIR}/src"
  else
    command -v git >/dev/null 2>&1 || { echo "ERROR: git required when no tarball provided." >&2; exit 1; }
    if [ -d "${MW_INSTALL_DIR}/.git" ]; then
      git -C "${MW_INSTALL_DIR}" fetch origin "${MW_REPO_BRANCH}" --depth=1
      git -C "${MW_INSTALL_DIR}" checkout -B "${MW_REPO_BRANCH}" "origin/${MW_REPO_BRANCH}"
    else
      git clone --branch "${MW_REPO_BRANCH}" --depth=1 "${MW_REPO_URL}" "${MW_INSTALL_DIR}"
    fi
    rm -rf "${MW_WA_DIR}/src"
    cp -a "${MW_INSTALL_DIR}" "${MW_WA_DIR}/src"
  fi
}

install_binaries() {
  if [ -n "${MW_CONTROL_PLANE_SRC_BIN}" ] && [ -f "${MW_CONTROL_PLANE_SRC_BIN}" ]; then
    log "Installing prebuilt moonwitness-control-plane -> ${MW_CONTROL_PLANE_BIN}"
    install -m 0755 "${MW_CONTROL_PLANE_SRC_BIN}" "${MW_CONTROL_PLANE_BIN}"
  elif command -v go >/dev/null 2>&1 && [ -d "${MW_INSTALL_DIR}/apps/control-plane" ]; then
    log "Building moonwitness-control-plane from source..."
    (cd "${MW_INSTALL_DIR}/apps/control-plane" && CGO_ENABLED=0 go build -o "${MW_CONTROL_PLANE_BIN}" .)
    chmod 755 "${MW_CONTROL_PLANE_BIN}"
  fi
  [ -x "${MW_CONTROL_PLANE_BIN}" ] || { echo "ERROR: ${MW_CONTROL_PLANE_BIN} missing." >&2; exit 1; }
}

ensure_mesh_and_network() {
  mkdir -p "${MW_ETC_DIR}" "${MW_DATA_DIR}/backups" "${MW_DATA_DIR}/caddy-data" "${MW_DATA_DIR}/caddy-config"
  chmod 700 "${MW_ETC_DIR}" "${MW_DATA_DIR}/backups"

  local mesh_env="${MW_ETC_DIR}/mesh.env"
  local mesh_name mesh_secret
  mesh_name="$(get_env "$mesh_env" "MW_MESH_NETWORK_NAME")"
  [ -n "$mesh_name" ] || mesh_name="mw-mesh-$(generate_secret 4)"
  mesh_secret="$(get_env "$mesh_env" "MW_MESH_NETWORK_SECRET")"
  [ -n "$mesh_secret" ] || mesh_secret="$(generate_secret 24)"

  upsert_env "$mesh_env" "MW_MESH_NETWORK_NAME" "$mesh_name"
  upsert_env "$mesh_env" "MW_MESH_NETWORK_SECRET" "$mesh_secret"
  upsert_env "$mesh_env" "MW_MESH_IPV4" "${MW_MESH_IPV4}"
  upsert_env "$mesh_env" "MW_MESH_HOSTNAME" "${MW_MESH_HOSTNAME}"

  if ! docker ps --format '{{.Names}}' | grep -qx "moonwitness-easytier"; then
    docker rm -f moonwitness-easytier >/dev/null 2>&1 || true
    docker run -d \
      --name moonwitness-easytier \
      --restart unless-stopped \
      --network host \
      --cap-add NET_ADMIN \
      --device /dev/net/tun:/dev/net/tun \
      easytier/easytier:latest \
      --ipv4 "${MW_MESH_IPV4}" \
      --hostname "${MW_MESH_HOSTNAME}" \
      --network-name "${mesh_name}" \
      --network-secret "${mesh_secret}" >/dev/null
  fi

  docker network inspect "${MW_PAAS_NETWORK}" >/dev/null 2>&1 || docker network create "${MW_PAAS_NETWORK}" >/dev/null
}

configure_secrets_and_env() {
  local app_env="${MW_INSTALL_DIR}/.env"
  local wa_env="${MW_WA_DIR}/.env"
  local cp_env="${MW_ETC_DIR}/control-plane.env"
  local mesh_env="${MW_ETC_DIR}/mesh.env"

  local pg_pass jwt_secret metrics_tok obs_tok sandbox_tok super_pass wa_user wa_pass setup_token
  pg_pass="$(get_env "$app_env" "POSTGRES_PASSWORD")"; [ -n "$pg_pass" ] || pg_pass="$(generate_secret 20)"
  setup_token="$(get_env "$app_env" "MW_SETUP_TOKEN")"; [ -n "$setup_token" ] || setup_token="$(generate_secret 24)"
  jwt_secret="$(get_env "$app_env" "JWT_SECRET")"; [ -n "$jwt_secret" ] || jwt_secret="$(generate_secret 32)"
  metrics_tok="$(get_env "$app_env" "METRICS_TOKEN")"; [ -n "$metrics_tok" ] || metrics_tok="$(generate_secret 20)"
  obs_tok="$(get_env "$app_env" "OBSERVABILITY_INGEST_TOKEN")"; [ ${#obs_tok} -ge 32 ] || obs_tok="$(generate_secret 24)"
  sandbox_tok="$(get_env "$app_env" "AGENT_SANDBOX_TOKEN")"; [ ${#sandbox_tok} -ge 32 ] || sandbox_tok="$(generate_secret 24)"
  super_pass="$(get_env "$app_env" "SUPERADMIN_INITIAL_PASSWORD")"; [ -n "$super_pass" ] || super_pass="$(generate_secret 14)"
  wa_user="$(get_env "$app_env" "WHATSAPP_GATEWAY_USERNAME")"; [ -n "$wa_user" ] || wa_user="mw_$(generate_secret 6)"
  wa_pass="$(get_env "$app_env" "WHATSAPP_GATEWAY_PASSWORD")"; [ -n "$wa_pass" ] || wa_pass="$(generate_secret 20)"

  upsert_env "$app_env" "POSTGRES_USER" "postgres"
  upsert_env "$app_env" "POSTGRES_PASSWORD" "$pg_pass"
  upsert_env "$app_env" "POSTGRES_DB" "moonwitness_db"
  upsert_env "$app_env" "DATABASE_URL" "postgresql://postgres:${pg_pass}@postgres:5432/moonwitness_db"
  upsert_env "$app_env" "JWT_SECRET" "$jwt_secret"
  upsert_env "$app_env" "MW_INTERNAL_SECRET" "$jwt_secret"
  upsert_env "$app_env" "METRICS_TOKEN" "$metrics_tok"
  upsert_env "$app_env" "OBSERVABILITY_INGEST_TOKEN" "$obs_tok"
  upsert_env "$app_env" "AGENT_SANDBOX_TOKEN" "$sandbox_tok"
  upsert_env "$app_env" "SUPERADMIN_LOGIN" "superadmin"
  upsert_env "$app_env" "SUPERADMIN_INITIAL_PASSWORD" "$super_pass"
  upsert_env "$app_env" "SUPERADMIN_PASSWORD" "$super_pass"
  upsert_env "$app_env" "MW_SETUP_TOKEN" "$setup_token"
  upsert_env "$app_env" "TRUST_PROXY_HOPS" "2"
  upsert_env "$app_env" "MW_PUBLIC_IPV4" "${MW_PUBLIC_IPV4}"
  upsert_env "$app_env" "ATTACHMENT_STORAGE_DRIVER" "local"
  upsert_env "$app_env" "ATTACHMENT_STORAGE_DIR" "/var/lib/moonwitness/attachments"
  upsert_env "$app_env" "WHATSAPP_GATEWAY_URL" "http://whatsapp:3000"
  upsert_env "$app_env" "WHATSAPP_GATEWAY_USERNAME" "$wa_user"
  upsert_env "$app_env" "WHATSAPP_GATEWAY_PASSWORD" "$wa_pass"
  upsert_env "$app_env" "WHATSAPP_MEDIA_SCAN" "disabled"
  upsert_env "$app_env" "BOARD_API_TARGET" "http://api:3000"
  upsert_env "$app_env" "MW_CONTROL_PLANE_URL" "http://${MW_MESH_IPV4}:${MW_CONTROL_PLANE_PORT}"

  upsert_env "$wa_env" "DATABASE_URL" "postgresql://postgres:${pg_pass}@moonwitness_postgres:5432/moonwitness_db"
  upsert_env "$wa_env" "WHATSAPP_DRIVER" "baileys"
  upsert_env "$wa_env" "WHATSAPP_GATEWAY_USERNAME" "$wa_user"
  upsert_env "$wa_env" "WHATSAPP_GATEWAY_PASSWORD" "$wa_pass"
  upsert_env "$wa_env" "WHATSAPP_SERVICE_HOST" "0.0.0.0"
  upsert_env "$wa_env" "WHATSAPP_SERVICE_PORT" "3000"
  upsert_env "$wa_env" "WHATSAPP_BAILEYS_AUTH_DIR" "/var/lib/moonwitness/whatsapp-auth"

  local mesh_name mesh_secret
  mesh_name="$(get_env "$mesh_env" "MW_MESH_NETWORK_NAME")"
  mesh_secret="$(get_env "$mesh_env" "MW_MESH_NETWORK_SECRET")"

  # Control-plane binds strictly to private mesh IP (stateless: PostgreSQL is the single source of truth).
  rm -f "$cp_env"
  upsert_env "$cp_env" "MW_CONTROL_PLANE_STATELESS" "true"
  upsert_env "$cp_env" "MW_PUBLIC_IPV4" "${MW_PUBLIC_IPV4}"
  upsert_env "$cp_env" "MW_MESH_ENABLED" "true"
  upsert_env "$cp_env" "MW_MESH_NETWORK_NAME" "$mesh_name"
  upsert_env "$cp_env" "MW_MESH_NETWORK_SECRET" "$mesh_secret"
  upsert_env "$cp_env" "MW_MESH_IPV4" "${MW_MESH_IPV4}"
  upsert_env "$cp_env" "MW_MESH_HOSTNAME" "${MW_MESH_HOSTNAME}"
  upsert_env "$cp_env" "MW_CONTROL_PLANE_ADDR" "${MW_MESH_IPV4}:${MW_CONTROL_PLANE_PORT}"
  upsert_env "$cp_env" "MW_INTERNAL_SECRET" "$jwt_secret"
  upsert_env "$cp_env" "DOCKER_BIN" "docker"
  upsert_env "$cp_env" "MW_PAAS_CADDYFILE_PATH" "${MW_ETC_DIR}/Caddyfile"
  upsert_env "$cp_env" "MW_PAAS_DOCKER_NETWORK" "${MW_PAAS_NETWORK}"
  upsert_env "$cp_env" "MW_PAAS_CADDY_CONTAINER" "moonwitness-caddy"
  upsert_env "$cp_env" "MW_PAAS_CADDY_RELOAD" "true"
  upsert_env "$cp_env" "MW_PAAS_BASE_DOMAIN" "${MW_BASE_DOMAIN}"
  upsert_env "$cp_env" "MW_PAAS_BACKUP_DIR" "${MW_DATA_DIR}/backups"
  upsert_env "$cp_env" "MW_PAAS_PG_CONTAINER" "moonwitness_postgres"
  upsert_env "$cp_env" "MW_PAAS_STATIC_ROUTES" "${MW_BASE_DOMAIN}=moonwitness_board:8080,wa.${MW_BASE_DOMAIN}=moonwitness_whatsapp:3000"
}

write_compose_and_edge() {
  cat > "${MW_INSTALL_DIR}/docker-compose.vps.yml" <<'EOF'
services:
  postgres:
    image: postgres:16-alpine
    container_name: moonwitness_postgres
    restart: unless-stopped
    env_file: .env
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d moonwitness_db"]
      interval: 5s
      timeout: 5s
      retries: 15

  api:
    build:
      context: .
      dockerfile: Dockerfile
    image: moonwitness-api:vps
    container_name: moonwitness_api
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
      API_HOST: 0.0.0.0
      API_PORT: 3000
    ports:
      - "10.144.0.1:3000:3000"
      - "127.0.0.1:3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - attachments_data:/var/lib/moonwitness/attachments

  board:
    build:
      context: .
      dockerfile: Dockerfile
      target: board-runtime
    image: moonwitness-board:vps
    container_name: moonwitness_board
    restart: unless-stopped
    env_file: .env
    ports:
      - "10.144.0.1:4174:8080"
      - "127.0.0.1:4174:8080"
    depends_on:
      - api

volumes:
  pgdata:
  attachments_data:
EOF

  cat > "${MW_WA_DIR}/docker-compose.yml" <<'EOF'
services:
  whatsapp:
    build:
      context: ./src
      dockerfile: apps/whatsapp/Dockerfile
    image: moonwitness-whatsapp:vps
    container_name: moonwitness_whatsapp
    restart: unless-stopped
    env_file: .env
    ports:
      - "127.0.0.1:3005:3000"
    networks:
      default:
      moonwitness-xv_default:
        aliases:
          - whatsapp
          - gowa
      moonwitness-paas:
    volumes:
      - whatsapp_auth_data:/var/lib/moonwitness/whatsapp-auth
    healthcheck:
      test: ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval: 10s
      timeout: 5s
      retries: 12

volumes:
  whatsapp_auth_data:

networks:
  moonwitness-xv_default:
    external: true
  moonwitness-paas:
    external: true
EOF

  cat > "${MW_ETC_DIR}/Caddyfile" <<EOF
{
	admin off
}

${MW_BASE_DOMAIN} {
	encode zstd gzip
	reverse_proxy moonwitness_board:8080 {
		header_up X-Forwarded-Proto {scheme}
		header_up X-Real-IP {remote_host}
	}
}

wa.${MW_BASE_DOMAIN} {
	encode zstd gzip
	reverse_proxy moonwitness_whatsapp:3000 {
		header_up X-Forwarded-Proto {scheme}
		header_up X-Real-IP {remote_host}
	}
}
EOF
  chmod 0644 "${MW_ETC_DIR}/Caddyfile"

  docker rm -f moonwitness-caddy >/dev/null 2>&1 || true
  docker run -d \
    --name moonwitness-caddy \
    --restart unless-stopped \
    --network "${MW_PAAS_NETWORK}" \
    -p 80:80 -p 443:443 -p 443:443/udp \
    -v "${MW_ETC_DIR}/Caddyfile:/etc/caddy/Caddyfile:ro" \
    -v "${MW_DATA_DIR}/caddy-data:/data" \
    -v "${MW_DATA_DIR}/caddy-config:/config" \
    caddy:2-alpine >/dev/null
}

install_control_plane_unit() {
  cat > /etc/systemd/system/moonwitness-control-plane.service <<EOF
[Unit]
Description=MoonWitness Control Plane Agent (Private EasyTier Mesh)
After=network-online.target docker.service
Requires=docker.service

[Service]
Type=simple
EnvironmentFile=${MW_ETC_DIR}/control-plane.env
ExecStart=${MW_CONTROL_PLANE_BIN}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable moonwitness-control-plane.service
}

start_all() {
  log "Starting postgres and building MoonWitness API + Board images..."
  (cd "${MW_INSTALL_DIR}" && docker compose -f docker-compose.vps.yml up -d --build postgres api board)

  log "Building and starting standalone @moonwitness/whatsapp..."
  (cd "${MW_WA_DIR}" && docker compose up -d --build whatsapp)

  docker network connect "${MW_PAAS_NETWORK}" moonwitness_api 2>/dev/null || true
  docker network connect "${MW_PAAS_NETWORK}" moonwitness_board 2>/dev/null || true
  docker network connect "${MW_PAAS_NETWORK}" moonwitness_whatsapp 2>/dev/null || true

  if command -v ufw >/dev/null 2>&1; then
    # Remove any legacy PaaS UI rule on port 3004; only permit internal bridge -> private control-plane :3003
    ufw delete allow from 10.254.2.0/24 to 10.254.2.1 port 3004 proto tcp >/dev/null 2>&1 || true
    for net in moonwitness-xv_default "${MW_PAAS_NETWORK}"; do
      subnet="$(docker network inspect "$net" --format '{{(index .IPAM.Config 0).Subnet}}' 2>/dev/null || true)"
      if [ -n "$subnet" ]; then
        ufw allow from "$subnet" to "${MW_MESH_IPV4}" port "${MW_CONTROL_PLANE_PORT}" proto tcp comment "mw-bridge-to-cp" >/dev/null 2>&1 || true
      fi
    done
  fi

  systemctl restart moonwitness-control-plane.service
  for _ in $(seq 1 15); do
    if curl -fsS "http://${MW_MESH_IPV4}:${MW_CONTROL_PLANE_PORT}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  log "MoonWitness installed cleanly."
  cat <<EOF
========================================================================
 MoonWitness Turnkey Ready (Coolify Pattern · Fresh Install)
========================================================================
 Control Panel   : https://${MW_BASE_DOMAIN}  (Board + PaaS Studio at /board/cloud)
 WhatsApp Service: https://wa.${MW_BASE_DOMAIN}
 Wildcard Apps   : https://<slug>.${MW_BASE_DOMAIN}
 Control Plane   : private mesh http://${MW_MESH_IPV4}:${MW_CONTROL_PLANE_PORT} (not exposed)
 Admin Credentials: stored in ${MW_INSTALL_DIR}/.env (chmod 600; SUPERADMIN_LOGIN=superadmin)
========================================================================
EOF
}

if [ "${REINSTALL}" = "true" ] || [ "${MW_REINSTALL:-false}" = "true" ]; then
  cleanup_for_reinstall
fi
sync_sources
install_binaries
ensure_mesh_and_network
configure_secrets_and_env
write_compose_and_edge
install_control_plane_unit
start_all
