#!/usr/bin/env bash
set -euo pipefail

# MoonWitness Turnkey Linux VPS Installer (Control Plane + EasyTier P2P Mesh)
# Binds moonwitness-control-plane strictly to the private mesh IP (never 0.0.0.0).

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "ERROR: Please run this installer as root (e.g. via sudo)." >&2
  exit 1
fi

MW_MESH_NETWORK_NAME="${MW_MESH_NETWORK_NAME:-}"
MW_MESH_NETWORK_SECRET="${MW_MESH_NETWORK_SECRET:-}"
MW_MESH_SUBNET="${MW_MESH_SUBNET:-10.144.0.0/24}"
MW_MESH_IP="${MW_MESH_IP:-10.144.0.1}"
MW_MESH_PEERS="${MW_MESH_PEERS:-}"
MW_CONTROL_PLANE_PORT="${MW_CONTROL_PLANE_PORT:-3003}"
MW_CONTROL_PLANE_DIR="${MW_CONTROL_PLANE_DIR:-/opt/moonwitness/apps/control-plane}"
MW_CONTROL_PLANE_BIN="${MW_CONTROL_PLANE_BIN:-/usr/local/bin/moonwitness-control-plane}"
MW_DATA_DIR="${MW_DATA_DIR:-/var/lib/moonwitness}"
MW_ETC_DIR="/etc/moonwitness"
MW_ENV_FILE="${MW_ETC_DIR}/mesh.env"
EASYTIER_IMAGE="${EASYTIER_IMAGE:-easytier/easytier:latest}"
EASYTIER_CONTAINER="${EASYTIER_CONTAINER:-moonwitness-easytier}"
SYSTEMD_UNIT="/etc/systemd/system/moonwitness-control-plane.service"

if [ -z "${MW_MESH_NETWORK_NAME}" ] || [ -z "${MW_MESH_NETWORK_SECRET}" ]; then
  echo "ERROR: MW_MESH_NETWORK_NAME and MW_MESH_NETWORK_SECRET are required." >&2
  exit 1
fi

case "${MW_MESH_IP}" in
  "0.0.0.0"|"::"|"*")
    echo "ERROR: MW_MESH_IP must be a private mesh IP, never a public wildcard (${MW_MESH_IP})." >&2
    exit 1
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to run EasyTier and control-plane workloads." >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "ERROR: systemd (systemctl) is required." >&2
  exit 1
fi

echo "[1/5] Writing restricted mesh credentials to ${MW_ENV_FILE} (chmod 600)..."
mkdir -p "${MW_ETC_DIR}" "${MW_DATA_DIR}"
chmod 700 "${MW_ETC_DIR}"
umask 077
cat > "${MW_ENV_FILE}" <<EOF
MW_MESH_NETWORK_NAME=${MW_MESH_NETWORK_NAME}
MW_MESH_NETWORK_SECRET=${MW_MESH_NETWORK_SECRET}
MW_MESH_SUBNET=${MW_MESH_SUBNET}
MW_MESH_IP=${MW_MESH_IP}
MW_CONTROL_PLANE_PORT=${MW_CONTROL_PLANE_PORT}
CONTROL_PLANE_LISTEN_ADDR=${MW_MESH_IP}:${MW_CONTROL_PLANE_PORT}
CONTROL_PLANE_DB_PATH=${MW_DATA_DIR}/control-plane.db
EOF
chmod 600 "${MW_ENV_FILE}"

echo "[2/5] Starting EasyTier P2P mesh container (${EASYTIER_IMAGE})..."
docker pull "${EASYTIER_IMAGE}" >/dev/null
if docker ps -a --format '{{.Names}}' | grep -qx "${EASYTIER_CONTAINER}"; then
  docker rm -f "${EASYTIER_CONTAINER}" >/dev/null
fi

EASYTIER_ARGS=(
  --network-name "${MW_MESH_NETWORK_NAME}"
  --network-secret "${MW_MESH_NETWORK_SECRET}"
  --ipv4 "${MW_MESH_IP}"
  --hostname "$(hostname -s)-control-plane"
)

if [ -n "${MW_MESH_PEERS}" ]; then
  IFS=',' read -r -a PEER_LIST <<< "${MW_MESH_PEERS}"
  for peer in "${PEER_LIST[@]}"; do
    peer_trimmed="$(echo "${peer}" | xargs)"
    if [ -n "${peer_trimmed}" ]; then
      EASYTIER_ARGS+=(--peers "${peer_trimmed}")
    fi
  done
fi

docker run -d \
  --name "${EASYTIER_CONTAINER}" \
  --restart unless-stopped \
  --network host \
  --cap-add NET_ADMIN \
  --device /dev/net/tun:/dev/net/tun \
  --env-file "${MW_ENV_FILE}" \
  "${EASYTIER_IMAGE}" \
  "${EASYTIER_ARGS[@]}" >/dev/null

echo "[3/5] Building/verifying moonwitness-control-plane binary..."
if [ ! -x "${MW_CONTROL_PLANE_BIN}" ]; then
  if [ -d "${MW_CONTROL_PLANE_DIR}" ] && command -v go >/dev/null 2>&1; then
    (cd "${MW_CONTROL_PLANE_DIR}" && go build -o "${MW_CONTROL_PLANE_BIN}" .)
    chmod 755 "${MW_CONTROL_PLANE_BIN}"
  else
    echo "ERROR: ${MW_CONTROL_PLANE_BIN} not found and Go source not available at ${MW_CONTROL_PLANE_DIR}." >&2
    exit 1
  fi
fi

echo "[4/5] Installing systemd unit ${SYSTEMD_UNIT} bound strictly to ${MW_MESH_IP}:${MW_CONTROL_PLANE_PORT}..."
cat > "${SYSTEMD_UNIT}" <<EOF
[Unit]
Description=MoonWitness Control Plane (Mesh-Bound)
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
EnvironmentFile=${MW_ENV_FILE}
WorkingDirectory=${MW_DATA_DIR}
ExecStart=${MW_CONTROL_PLANE_BIN}
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable moonwitness-control-plane.service
systemctl restart moonwitness-control-plane.service

echo "[5/5] Verifying control-plane health on private mesh IP ${MW_MESH_IP}:${MW_CONTROL_PLANE_PORT}..."
HEALTH_URL="http://${MW_MESH_IP}:${MW_CONTROL_PLANE_PORT}/health"
for attempt in $(seq 1 15); do
  if curl -fsS --max-time 2 "${HEALTH_URL}" >/dev/null 2>&1; then
    echo "OK: moonwitness-control-plane is healthy on ${MW_MESH_IP}:${MW_CONTROL_PLANE_PORT}"
    exit 0
  fi
  sleep 1
done

echo "ERROR: Health check failed at ${HEALTH_URL}. Check 'journalctl -u moonwitness-control-plane -n 50'." >&2
exit 1
