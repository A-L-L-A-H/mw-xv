# Wave 4 & 5 — Zero-Domain `install.sh`, Live VPS E2E, & Clean DB-Wipe Proof (`M52`–`M66`)

**ADR Reference:** `.plan/coolify-sovereign-paas-single-db/ADR-001-sovereign-paas-single-db.md`
**Target VPS:** `moonwitness-vps` (`163.61.134.104`, private EasyTier mesh `10.144.0.1`)
**SECURITY RULE:** NEVER print any password, `MW_SETUP_TOKEN`, `JWT_SECRET`, or bearer token to stdout, logs, or chat!
**AUTONOMY RULE:** Execute through `M66` with ZERO human prompts; final state after `M65` clean wipe is deterministically factory-fresh `http://163.61.134.104:8000/setup`.

---

## Wave 4 — Zero-Domain, Zero-SQLite `deploy/vps/install.sh` (`M52`–`M55`)

### - [x] M52 — Update `install.sh` CLI Flags, Auto-Docker Install, IPv4 Detect, & Secrets

- **Owner File (MODIFY):** `deploy/vps/install.sh`
- **Depends On:** `M15`, `M38`, `M51`
- **Exact Spec:**
  1. Defaults: `MW_BASE_DOMAIN="${MW_BASE_DOMAIN:-}"` (**EMPTY by default!**), `MW_PUBLIC_PORT="${MW_PUBLIC_PORT:-8000}"`, `UNLOCK_PORT="false"`, `WIPE_TLS="false"`.
  2. Add flags: `--port <port>`, `--unlock-port`, `--wipe-tls`.
  3. Auto-install Docker Engine + Compose v2 if missing (`curl -fsSL https://get.docker.com | sh && systemctl enable --now docker`).
  4. Add `detect_public_ipv4()` (`api.ipify.org` -> `ifconfig.me` -> `ip -4 route get 1.1.1.1`).
  5. Write to `/opt/moonwitness-xv/.env`: `MW_SETUP_TOKEN` (24 random bytes hex), `TRUST_PROXY_HOPS=2`, `MW_PUBLIC_IPV4`, `SUPERADMIN_LOGIN=superadmin`, `SUPERADMIN_PASSWORD`.
- **Acceptance Criteria:** No `--domain` required; secrets written with `chmod 600`.
- **Expected Output:** `bash -n` (or syntax check) passes.
- **Verify:**
  ```powershell
  node -e "const s=require('fs').readFileSync('deploy/vps/install.sh','utf8'); for (const k of ['MW_SETUP_TOKEN','TRUST_PROXY_HOPS','detect_public_ipv4','--unlock-port']) if(!s.includes(k)) process.exit(1); console.log('M52 OK')"
  ```
- **Commit:**
  ```powershell
  git commit --only deploy/vps/install.sh .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-4-installer-and-vps-e2e.md -m "feat(deploy): M52 add zero-domain defaults, auto-docker, ipv4 detect, and setup token"
  ```

---

### - [x] M53 — Update `install.sh` Full Clean DB/Volume Wipe & Stateless `control-plane.env`

- **Owner File (MODIFY):** `deploy/vps/install.sh`
- **Depends On:** `M52`
- **Exact Spec:**
  1. `cleanup_for_reinstall()` MUST wipe **100% of MoonWitness & PaaS databases, volumes, networks, stacks, backups, and env state**:
     - Stop `moonwitness-control-plane.service`.
     - Remove core containers (`moonwitness_board`, `moonwitness_api`, `moonwitness_postgres`, `moonwitness_whatsapp`, `moonwitness_whatsapp_tunnel`, `moonwitness-caddy`) AND all PaaS containers (`docker ps -a --filter label=mw.paas.managed=true -q` + `docker ps -a --filter name='^mw-paas-' -q`).
     - Remove ALL MoonWitness & PaaS volumes: `moonwitness-xv_pgdata`, `moonwitness-xv_attachments_data`, `moonwitness-whatsapp_whatsapp_auth_data`, `moonwitness_pgdata`, `pgdata`, PLUS `docker volume ls -q | grep -E '^(mw-|mw-paas-)' | xargs -r docker volume rm -f || true`.
     - Remove isolated PaaS stack networks: `docker network ls --format '{{.Name}}' | grep -E '^(mw-paas-|mw-stack-)' | xargs -r docker network rm >/dev/null 2>&1 || true`.
     - Remove `${MW_DATA_DIR}/control-plane.db*`, `${MW_DATA_DIR}/stacks`, `${MW_DATA_DIR}/backups/*`, `${MW_ETC_DIR}/control-plane.env`, `${MW_ETC_DIR}/Caddyfile`, `${MW_INSTALL_DIR}/.env`, `${MW_WA_DIR}/.env`.
     - If `[ "${WIPE_TLS}" = "true" ]`, also wipe `${MW_DATA_DIR}/caddy-data/*` & `${MW_DATA_DIR}/caddy-config/*`.
     - Preserve unrelated VPS containers (`freellmapi-*`, `dx-api-postgres-test`).
  2. Write `/etc/moonwitness/control-plane.env` with **`MW_CONTROL_PLANE_STATELESS=true`**, `MW_PUBLIC_IPV4`, `MW_CONTROL_PLANE_ADDR=10.144.0.1:3003`, `MW_INTERNAL_SECRET`, `DOCKER_BIN=docker`, `MW_PAAS_CADDYFILE_PATH`, `MW_PAAS_DOCKER_NETWORK=moonwitness-paas`, `MW_PAAS_CADDY_CONTAINER=moonwitness-caddy`, `MW_PAAS_CADDY_RELOAD=true`, `MW_PAAS_BACKUP_DIR`, `MW_PAAS_PG_CONTAINER=moonwitness_postgres`, `MW_MESH_*`.
  3. **NEVER** write `MW_CONTROL_PLANE_DB_PATH` or `MW_PAAS_UI_ADDR`!
- **Acceptance Criteria:** Zero `MW_CONTROL_PLANE_DB_PATH` in `install.sh`; full volume/DB cleanup implemented.
- **Expected Output:** Verification snippet prints `M53 OK`.
- **Verify:**
  ```powershell
  node -e "const s=require('fs').readFileSync('deploy/vps/install.sh','utf8'); if(!s.includes('MW_CONTROL_PLANE_STATELESS') || s.includes('MW_CONTROL_PLANE_DB_PATH') || s.includes('MW_PAAS_UI_ADDR')) process.exit(1); console.log('M53 OK')"
  ```
- **Commit:**
  ```powershell
  git commit --only deploy/vps/install.sh .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-4-installer-and-vps-e2e.md -m "feat(deploy): M53 enforce full db/volume wipe and stateless control-plane in install.sh"
  ```

---

### - [x] M54 — Update `install.sh` Caddy `:8000–8010`, UFW, `--unlock-port` PostgreSQL Recovery, & Banner

- **Owner File (MODIFY):** `deploy/vps/install.sh`
- **Depends On:** `M53`
- **Exact Spec:**
  1. Initial `/etc/moonwitness/Caddyfile`: `admin localhost:2019` + `:${MW_PUBLIC_PORT} { encode zstd gzip; reverse_proxy moonwitness_board:8080 { ... } }`; append domain blocks ONLY if `-n "${MW_BASE_DOMAIN}"`.
  2. Launch `moonwitness-caddy` with `-p 80:80 -p 443:443 -p 443:443/udp -p 8000-8010:8000-8010`.
  3. UFW rules: allow `80/tcp`, `443/tcp`, `443/udp`, `8000:8010/tcp`, and Docker bridges -> `10.144.0.1:3003/tcp`; delete any `:3004` rule.
  4. Implement `unlock_public_port()` for `--unlock-port`: executes `psql` in `moonwitness_postgres` setting `base_config_parameters` `key='paas.public_port_enabled'` (`company_id IS NULL`) to `'true'`, then restarts `moonwitness_api` to reconcile Caddy!
  5. Update completion banner to print `http://${MW_PUBLIC_IPV4}:${MW_PUBLIC_PORT}/setup` and `grep '^MW_SETUP_TOKEN=' /opt/moonwitness-xv/.env`.
- **Acceptance Criteria:** `--unlock-port` updates PostgreSQL (Single Source of Truth) and triggers reconciliation.
- **Expected Output:** Verification prints `M54 OK`.
- **Verify:**
  ```powershell
  node -e "const s=require('fs').readFileSync('deploy/vps/install.sh','utf8'); for (const k of ['admin localhost:2019','8000-8010:8000-8010','paas.public_port_enabled','unlock_public_port']) if(!s.includes(k)) process.exit(1); console.log('M54 OK')"
  ```
- **Commit:**
  ```powershell
  git commit --only deploy/vps/install.sh .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-4-installer-and-vps-e2e.md -m "feat(deploy): M54 configure caddy :8000-8010 bootstrap and --unlock-port postgres recovery"
  ```

---

### - [ ] M55 — Push `dev` (Passes All Pre-Push Static, UI, Doc, & Secret Gates)

- **Depends On:** `M54`
- **Verify & Push:**
  ```powershell
  git push origin dev; if (-not $?) { git pull --rebase --autostash origin dev; if ($?) { git push origin dev } }
  ```
- **Acceptance Criteria:** `origin/dev` fast-forwarded with exit `0` (all pre-push hooks green!).

---

## Wave 5 — Live VPS E2E & Full Clean DB-Wipe Proof (`M56`–`M66`)

### - [ ] M56 — Archive Tarball & Upload Staging Artifacts to `moonwitness-vps`

- **Depends On:** `M55`
- **Actions:**
  1. `git archive --format=tar.gz -o "C:\Users\bjo16\.gemini\antigravity\brain\682931c0-bdfe-41e8-84a3-e0a9d98bd906\scratch\mw-xv-fresh.tar.gz" HEAD`
  2. Upload via `vps_upload` (`moonwitness-vps`): tarball -> `/tmp/mw-xv-fresh.tar.gz`, Linux binary -> `/tmp/moonwitness-control-plane-linux-amd64`, `deploy/vps/install.sh` -> `/tmp/install.sh`.
  3. On VPS (`vps_exec`): `sed -i 's/\r$//' /tmp/install.sh && chmod +x /tmp/install.sh && bash -n /tmp/install.sh`.
- **Acceptance Criteria:** `bash -n /tmp/install.sh` exits `0` and all 3 files exist in `/tmp/`.

---

### - [ ] M57 — Run Fresh Zero-Domain `install.sh --reinstall` & Verify Zero SQLite DB

- **Depends On:** `M56`
- **Action (`vps_exec`, background to `/tmp/mw-reinstall.log`):**
  ```bash
  nohup bash -c 'bash /tmp/install.sh --reinstall --source-tarball /tmp/mw-xv-fresh.tar.gz --control-plane-bin /tmp/moonwitness-control-plane-linux-amd64 ; echo "EXIT_CODE=$?"' > /tmp/mw-reinstall.log 2>&1 </dev/null &
  ```
- **Acceptance Criteria (after `EXIT_CODE=0`):**
  - `test ! -e /var/lib/moonwitness/control-plane.db` succeeds (ZERO SQLite DB!).
  - `ss -tulpn | grep ':3004'` is empty; `systemctl is-active moonwitness-control-plane.service` -> `active`; `curl -fsS http://10.144.0.1:3003/health` -> `200`.
  - All 6 MoonWitness containers `Up` / `healthy`; unrelated `freellmapi` & `dx-api-postgres-test` untouched.

---

### - [ ] M58 — Verify IP Bootstrap (`http://163.61.134.104:8000`) & Plain-HTTP Cookie

- **Depends On:** `M57`
- **Acceptance Criteria (probed from Windows via `node -e`):**
  - `GET http://163.61.134.104:8000/` -> `200`
  - `GET http://163.61.134.104:8000/setup` -> `200`
  - `GET http://163.61.134.104:8000/readyz` -> `200` AND has NO `strict-transport-security` header
  - `GET http://163.61.134.104:8000/auth/setup-status` -> `200` with `setupRequired: true`
  - `POST http://163.61.134.104:8000/api/session` (`{"token":"smoke"}`) -> `Set-Cookie` includes `HttpOnly` and **NO `Secure`**.

---

### - [ ] M59 — Verify `/auth/setup-claim`, Non-Zero RAM MB Metrics, Live Mesh Status, & Internal WhatsApp

- **Depends On:** `M58`
- **Acceptance Criteria (run on VPS via `vps_exec`, NEVER echoing tokens/passwords):**
  - Wrong setup token -> `401`.
  - Valid `MW_SETUP_TOKEN` (claiming login `owner_e2e`) -> `201` + JWT.
  - Replay `/auth/setup-claim` -> `409`; `/auth/setup-status` -> `setupRequired: false`.
  - `GET /api/cloud/paas/metrics` -> `200` with `memoryTotalMb > 0`, `memoryUsedMb > 0`, `meshIp: "10.144.0.1"`.
  - `GET /api/cloud/paas/mesh/status` -> `200`, zero occurrence of `a-l-l-a-h.com`.
  - `GET /whatsapp/readyz` -> `200` (`gateway: "connected"`).

---

### - [ ] M60 — Verify 390+ Template Catalog & Deploy `uptime-kuma` in IP Preview Mode (`:8001`)

- **Depends On:** `M59`
- **Acceptance Criteria:**
  - `GET /api/cloud/paas/templates?q=uptime` -> `200`, `total >= 350`, contains `uptime-kuma`.
  - `POST /api/cloud/paas/templates/deploy` (`{"templateId":"uptime-kuma","slug":"uptime-kuma"}`) -> `201`.
  - PostgreSQL `cloud_apps` has row `name='uptime-kuma', managed_by='paas', deploy_mode='compose', host_port=8001`.
  - `test ! -e /var/lib/moonwitness/control-plane.db` STILL passes.
  - `http://163.61.134.104:8001/` returns `200` or `302`.

---

### - [ ] M61 — Verify DNS Doctor & Dynamic Custom Domain Switch (`apps.moonwitness.biz.id`)

- **Depends On:** `M60`
- **Acceptance Criteria:**
  - `POST /api/cloud/paas/settings/verify-dns` for `apps.moonwitness.biz.id` + wildcard `apps.moonwitness.biz.id` + `wa.apps.moonwitness.biz.id` -> all 3 `matched`.
  - `POST /api/cloud/paas/settings/apply` (`publicPortEnabled: true`) -> `200`, persisted in Postgres `base_config_parameters`.
  - From Windows: `https://apps.moonwitness.biz.id/readyz` -> `200` (INCLUDES `strict-transport-security`!), `https://wa.apps.moonwitness.biz.id/healthz` -> `200`.

---

### - [ ] M62 — Verify `promote-wildcard`, App Detail/Stats, & `https://uptime-kuma.apps.moonwitness.biz.id`

- **Depends On:** `M61`
- **Acceptance Criteria:**
  - `POST https://apps.moonwitness.biz.id/api/cloud/paas/settings/promote-wildcard` -> `200` (`promotedCount >= 1`).
  - `https://uptime-kuma.apps.moonwitness.biz.id/` returns `200` or `302` over valid Let's Encrypt TLS.
  - `GET https://apps.moonwitness.biz.id/api/cloud/paas/apps/uptime-kuma` & `/stats` return `200` (with PostgreSQL deployments & live CPU/RAM).

---

### - [ ] M63 — Verify TLS-Gated Port `8000` Lockdown

- **Depends On:** `M62`
- **Acceptance Criteria:**
  - `POST https://apps.moonwitness.biz.id/api/cloud/paas/settings/apply` (`{"publicPortEnabled":false}`) -> `200`.
  - `http://163.61.134.104:8000/` and `http://163.61.134.104:8001/` refuse/close connection while `https://apps.moonwitness.biz.id/readyz` stays `200`.

---

### - [ ] M64 — Verify `install.sh --unlock-port` PostgreSQL Recovery + Create Backup Dump (Prep Dirty State for `M65`)

- **Depends On:** `M63`
- **Acceptance Criteria:**
  - Run `bash /opt/moonwitness-xv/deploy/vps/install.sh --unlock-port` on VPS -> `http://163.61.134.104:8000/readyz` returns `200` within 10s.
  - Trigger `POST https://apps.moonwitness.biz.id/api/cloud/paas/backups/postgres` -> `201` (creates `.dump` in `/var/lib/moonwitness/backups`).
  - **DO NOT** delete `uptime-kuma`, backups, or settings — leave them dirty to prove `M65` wipes EVERYTHING!

---

### - [ ] M65 — Full Clean Reinstall DB-Wipe Proof (Zero Leftover Guarantee)

- **Depends On:** `M64`
- **Action (`vps_exec`, background to `/tmp/mw-reinstall-clean.log`):**
  ```bash
  nohup bash -c 'bash /tmp/install.sh --reinstall --source-tarball /tmp/mw-xv-fresh.tar.gz --control-plane-bin /tmp/moonwitness-control-plane-linux-amd64 ; echo "EXIT_CODE=$?"' > /tmp/mw-reinstall-clean.log 2>&1 </dev/null &
  ```
- **Strict Zero-Leftover Acceptance Criteria (ALL MUST PASS after `EXIT_CODE=0`):**
  1. `docker ps -a --filter label=mw.paas.managed=true -q` is EMPTY (`uptime-kuma` gone).
  2. `docker volume ls -q | grep -E '^(mw-|mw-paas-)'` is EMPTY (all PaaS volumes wiped).
  3. `test ! -e /var/lib/moonwitness/control-plane.db && test ! -d /var/lib/moonwitness/stacks` passes.
  4. `ls -1 /var/lib/moonwitness/backups/*.dump 2>/dev/null | wc -l` == `0`.
  5. PostgreSQL assertions (via `docker exec moonwitness_postgres psql -U postgres -d moonwitness_db -tAc ...`):
     - `SELECT count(*) FROM base_config_parameters WHERE key LIKE 'paas.%' OR key = 'instance.setup_completed';` -> **`0`**
     - `SELECT count(*) FROM cloud_apps WHERE managed_by = 'paas';` -> **`0`**
     - `SELECT count(*) FROM cloud_deployments;` -> **`0`**
     - `SELECT login FROM users WHERE role = 'superadmin';` -> **`superadmin`** (`owner_e2e` wiped!)
     - `SELECT count(*) FROM whatsapp_accounts;` -> **`0`**
  6. Old JWT from `M59` against `GET http://163.61.134.104:8000/auth/me` -> **`401`**.
  7. `GET http://163.61.134.104:8000/auth/setup-status` -> `{"success":true,"data":{"setupRequired":true}}`.
  8. `/etc/moonwitness/Caddyfile` contains ONLY `admin localhost:2019` and `:8000 -> moonwitness_board:8080` (ZERO `apps.moonwitness.biz.id`, `wa.*`, `uptime-kuma.*`).
  9. `ss -tulpn | grep ':3004'` empty; `https://paas.apps.moonwitness.biz.id/` closed; `freellmapi-freellmapi-1` & `dx-api-postgres-test` still `Up`.

---

### - [ ] M66 — Remove `/tmp/*` Staging Files & Close Plan

- **Depends On:** `M65`
- **Actions:**
  1. On VPS (`vps_exec`): `rm -f /tmp/mw-xv-fresh.tar.gz /tmp/moonwitness-control-plane-linux-amd64 /tmp/install.sh /tmp/mw-reinstall.log /tmp/mw-reinstall-clean.log`.
  2. Verify `http://163.61.134.104:8000/setup` -> `200` and `http://163.61.134.104:8000/readyz` -> `200`.
  3. Mark `M66` `[x]`, fill final Ledger row in `.plan/coolify-sovereign-paas-single-db.md`, commit & push final plan tracker update!
- **Acceptance Criteria:** Zero staging files left in `/tmp/`; all 66 tasks (`M01`–`M66`) checked `[x]`.
