#!/usr/bin/env bash
set -euo pipefail

# Coolify-style one-click MoonWitness VPS self-updater.
# Invoked by moonwitness-control-plane via MW_SELF_UPDATE_SCRIPT when an admin clicks "Update & Restart".

TARGET_TAG="${1:-${MW_TARGET_VERSION:-}}"
if ! [[ "${TARGET_TAG}" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.(0|[1-9][0-9]*))?$ ]]; then
  echo "Invalid target release tag: ${TARGET_TAG}" >&2
  exit 1
fi

MW_INSTALL_DIR="${MW_INSTALL_DIR:-/opt/moonwitness-xv}"
MW_COMPOSE_FILE="${MW_COMPOSE_FILE:-${MW_INSTALL_DIR}/docker-compose.vps.yml}"
MW_ETC_DIR="${MW_ETC_DIR:-/etc/moonwitness}"
MW_CP_ENV="${MW_ETC_DIR}/control-plane.env"
MW_CONTROL_PLANE_BIN="${MW_CONTROL_PLANE_BIN:-/usr/local/bin/moonwitness-control-plane}"
MW_PAAS_NETWORK="${MW_PAAS_NETWORK:-moonwitness-paas}"
MW_UPDATE_REPO="${MW_UPDATE_REPO:-A-L-L-A-H/mw-xv}"
REPO_LOWER="$(printf '%s' "${MW_UPDATE_REPO}" | tr '[:upper:]' '[:lower:]')"
API_GHCR_IMAGE="ghcr.io/${REPO_LOWER}:${TARGET_TAG}"
BOARD_GHCR_IMAGE="ghcr.io/${REPO_LOWER}-board:${TARGET_TAG}"

log() { printf '[moonwitness-self-update] %s\n' "$*"; }

upsert_env() {
  local file="$1" key="$2" val="$3"
  [ -f "$file" ] || return 0
  if grep -qE "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    printf '%s=%s\n' "$key" "$val" >> "$file"
  fi
}

log "Applying MoonWitness release ${TARGET_TAG}..."

if [ -n "${MW_UPDATE_GITHUB_TOKEN:-}" ]; then
  printf '%s' "${MW_UPDATE_GITHUB_TOKEN}" | docker login ghcr.io -u moonwitness-updater --password-stdin >/dev/null 2>&1 || true
fi

PULLED_PREBUILT="false"
if docker pull "${API_GHCR_IMAGE}" && docker pull "${BOARD_GHCR_IMAGE}"; then
  log "Pulled prebuilt GHCR release images (${API_GHCR_IMAGE}, ${BOARD_GHCR_IMAGE})."
  docker tag "${API_GHCR_IMAGE}" moonwitness-api:vps
  docker tag "${BOARD_GHCR_IMAGE}" moonwitness-board:vps
  PULLED_PREBUILT="true"
else
  log "Prebuilt GHCR images unavailable for ${TARGET_TAG}; falling back to git tag source build."
fi

REBUILT_CONTROL_PLANE="false"
if [ -d "${MW_INSTALL_DIR}/.git" ]; then
  if git -C "${MW_INSTALL_DIR}" fetch --depth=1 origin "refs/tags/${TARGET_TAG}:refs/tags/${TARGET_TAG}" 2>/dev/null; then
    git -C "${MW_INSTALL_DIR}" checkout --detach "${TARGET_TAG}"
    if command -v go >/dev/null 2>&1 && [ -d "${MW_INSTALL_DIR}/apps/control-plane" ]; then
      log "Rebuilding moonwitness-control-plane binary for ${TARGET_TAG}..."
      tmp_bin="${MW_CONTROL_PLANE_BIN}.next.$$"
      (cd "${MW_INSTALL_DIR}/apps/control-plane" && CGO_ENABLED=0 go build -o "${tmp_bin}" .)
      chmod 0755 "${tmp_bin}"
      mv -f "${tmp_bin}" "${MW_CONTROL_PLANE_BIN}"
      REBUILT_CONTROL_PLANE="true"
    fi
  elif [ "${PULLED_PREBUILT}" != "true" ]; then
    echo "Failed to pull GHCR images and could not fetch git tag ${TARGET_TAG}." >&2
    exit 1
  fi
elif [ "${PULLED_PREBUILT}" != "true" ]; then
  echo "Failed to pull GHCR images and ${MW_INSTALL_DIR} is not a git repository." >&2
  exit 1
fi

log "Restarting MoonWitness stack via ${MW_COMPOSE_FILE}..."
if [ "${PULLED_PREBUILT}" = "true" ]; then
  (cd "${MW_INSTALL_DIR}" && MW_IMAGE_TAG="${TARGET_TAG}" MW_VERSION="${TARGET_TAG}" docker compose -f "${MW_COMPOSE_FILE}" up -d --no-build --remove-orphans postgres api board)
else
  (cd "${MW_INSTALL_DIR}" && MW_IMAGE_TAG="${TARGET_TAG}" MW_VERSION="${TARGET_TAG}" docker compose -f "${MW_COMPOSE_FILE}" up -d --build --remove-orphans postgres api board)
fi

docker network connect "${MW_PAAS_NETWORK}" moonwitness_api 2>/dev/null || true
docker network connect "${MW_PAAS_NETWORK}" moonwitness_board 2>/dev/null || true
docker network connect "${MW_PAAS_NETWORK}" moonwitness_whatsapp 2>/dev/null || true

upsert_env "${MW_CP_ENV}" "MW_VERSION" "${TARGET_TAG}"
log "Updated MW_VERSION=${TARGET_TAG} in ${MW_CP_ENV}."

if [ "${REBUILT_CONTROL_PLANE}" = "true" ] && command -v systemctl >/dev/null 2>&1; then
  log "Scheduling detached restart of moonwitness-control-plane.service in 2s..."
  if command -v systemd-run >/dev/null 2>&1; then
    systemd-run --on-active=2s --unit="mw-cp-restart-$(date +%s)" systemctl restart moonwitness-control-plane.service >/dev/null 2>&1 || true
  else
    nohup sh -c 'sleep 2 && systemctl restart moonwitness-control-plane.service' >/dev/null 2>&1 &
  fi
fi

log "MoonWitness self-update to ${TARGET_TAG} complete."
