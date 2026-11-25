# ADR-001: MoonWitness Sovereign PaaS — Single-DB PostgreSQL, Stateless Host Agent, & Coolify-Plus Flow

- **Status:** Accepted (Locked for Autonomous Execution)
- **Date:** 2026-11-25
- **Plan Tracker:** `.plan/coolify-sovereign-paas-single-db.md` (`M01`–`M66`)

---

## 1. Context & Problem Statement

MoonWitness previously deployed PaaS with three structural flaws:
1. **Split-Brain Double Database:** `apps/api` stored `cloud_apps`, `cloud_deployments`, and `base_config_parameters` in PostgreSQL (`moonwitness_postgres`), while `apps/control-plane` simultaneously opened a second SQLite database (`/var/lib/moonwitness/control-plane.db`) storing duplicate `paas_apps`, `paas_deployments`, and UI users. Restoring a PostgreSQL backup lost PaaS state, and deploying via `/api/cloud/paas/*` bypassed PostgreSQL `cloud_apps`.
2. **Domain & Cloudflare Lock-In at Install Time:** `deploy/vps/install.sh` required `--domain` upfront and hardcoded `apps.moonwitness.biz.id` / `wa.apps.moonwitness.biz.id` into static env files, blocking bare-VPS IP-first onboarding.
3. **Unused 390+ Official Coolify Template Pack & Broken Plain-HTTP Login:** `packages/paas-template-pack-coolify` (390+ Compose YAML templates) was not wired to Board/API; `apps/board/src/app/api/session/route.ts` hardcoded `secure: NODE_ENV === 'production'`, silently dropping session cookies on `http://<PUBLIC_IP>:8000`.

---

## 2. Decision Drivers

- **Single Source of Truth:** 1 database (`moonwitness_postgres`) for all core, PaaS, domain, env vault, and WhatsApp data.
- **Zero-Domain Fresh Boot:** Any bare Ubuntu/Debian VPS boots directly to `http://<PUBLIC_IP>:8000` with zero DNS or Cloudflare required.
- **Zero Public Control-Plane Exposure:** `apps/control-plane` listens strictly on private EasyTier mesh (`10.144.0.1:3003`); port `3004` and `paas.*` stay permanently closed.
- **Simpler & Stronger Than Coolify:** No extra Coolify DB, no Redis, no Soketi, no localhost SSH loopback hack; native 390+ Compose compiler + 3 domain modes (IP preview `:8001–8010`, 1-click free `<ip-dashed>.sslip.io` wildcard, or any custom DNS provider).
- **100% Autonomous & Flash-Executable:** Every contract, error code, and verification step must be deterministic with zero human judgment required during execution.

---

## 3. Architectural Decisions

### Decision 1 — Single Database (PostgreSQL) & Stateless Control-Plane Agent
- **Chosen:** PostgreSQL (`moonwitness_postgres`) owns 100% of persistent state (`base_config_parameters`, `cloud_apps`, `cloud_deployments`, `users`, `whatsapp.*`). `apps/control-plane` runs on VPS with `MW_CONTROL_PLANE_STATELESS=true` (`DB = nil`, zero `/var/lib/moonwitness/control-plane.db`) exposing stateless `/agent/*` executor endpoints.
- **Rejected:** Adding a `paas_settings` table inside SQLite `control-plane.db` (causes double-DB split-brain and broken backup/restore).
- **Consequence:** Restoring a single PostgreSQL dump + restarting `moonwitness_api` reconciles all Caddy routes automatically. Existing Go unit tests that inject an explicit `:memory:` SQLite handle continue passing without regression.

### Decision 2 — Caddy Owns `:8000–8010` Bootstrap & Preview Ports (Zero Docker–UFW Bypass)
- **Chosen:** `moonwitness_board` binds ONLY internally (`127.0.0.1:4174:8080`, `10.144.0.1:4174:8080`, `moonwitness-paas` network). `moonwitness-caddy` publishes `:80`, `:443`, and `:8000–8010`. Turning off `publicPortEnabled` removes `:8000–8010` blocks from `/etc/moonwitness/Caddyfile` and reloads Caddy.
- **Rejected:** Publishing `0.0.0.0:8000:8080` directly on `moonwitness_board` and relying on `ufw delete allow 8000/tcp` (Docker `DNAT` iptables rules bypass UFW `INPUT` chain on Linux!).
- **Consequence:** Port `8000` lockdown is instant, atomic, immune to UFW bypass, requires zero root firewall calls from Go, and is reversible via `install.sh --unlock-port`.

### Decision 3 — Zero-Downtime Caddy Reload via Container-Internal `admin localhost:2019`
- **Chosen:** Emit `admin localhost:2019` (never published outside the `moonwitness-caddy` container) and reload via `docker exec moonwitness-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile` (automatic fallback to `docker restart`).
- **Rejected:** `admin off` forcing `docker restart moonwitness-caddy` on every deploy/domain edit (drops active connections).

### Decision 4 — First-Boot Admin Claim Guarded by One-Time `MW_SETUP_TOKEN`
- **Chosen:** `install.sh` generates a 48-char hex `MW_SETUP_TOKEN` in `/opt/moonwitness-xv/.env` (`chmod 600`). `POST /auth/setup-claim` verifies SHA-256 constant-time equality, atomically updates `base.user_superadmin` in PostgreSQL, sets `base_config_parameters` `instance.setup_completed = 'true'`, and permanently returns `409 Conflict` thereafter.
- **Rejected:** Unauthenticated first-visitor signup on public `http://<PUBLIC_IP>:8000` (hijackable by automated internet scanners within seconds of VPS boot).

### Decision 5 — Server-Side Paginated 390+ Coolify Pack + Persistent Secret Vault
- **Chosen:** `packages/orm-cloud` loads `packages/paas-template-pack-coolify/service-templates.json` server-side behind paginated `GET /api/cloud/paas/templates`, classifies templates (`ready` | `inline_config` | `restricted`), compiles Coolify magic variables (`SERVICE_FQDN_*`, `SERVICE_URL_*`, `SERVICE_PASSWORD_*`, `SERVICE_USER_*`, `SERVICE_HEX_*`, `SERVICE_BASE64_*`), auto-prefixes named volumes (`mw-<slug>-*`), materializes safe relative inline `content:` files, and stores generated secrets in PostgreSQL `cloud_apps.env_vars` so redeploys/domain-switches never rotate DB passwords.
- **Rejected:** Importing 4 MB `service-templates.json` into `apps/board` (violates `apps/board/bundle-budget.json`) or regenerating secrets on each deploy (corrupts Postgres/MySQL volumes).

### Decision 6 — Protocol-Aware Session Cookies, Conditional HSTS, & Proxy Hop Trust
- **Chosen:**
  - `apps/board/src/app/api/session/route.ts` derives `secure` dynamically from `x-forwarded-proto === 'https'` / URL protocol (`sameSite: 'lax'`).
  - `apps/api/src/app.ts` emits `strict-transport-security` ONLY on HTTPS requests.
  - `install.sh` sets `TRUST_PROXY_HOPS=2` (Caddy -> Next.js BFF -> Fastify API).
- **Rejected:** Hardcoded `secure: NODE_ENV === 'production'` (breaks plain-HTTP login on `http://<PUBLIC_IP>:8000`).

### Decision 7 — 3 Flexible Domain Modes & Strict TLS Lockdown Gate
- **Chosen:** Board `/board/cloud` (`Instance & Domains`) supports:
  1. IP Bootstrap + Preview Ports `:8001–8010`
  2. 1-Click Zero-DNS Wildcard (`<ip-dashed>.sslip.io`)
  3. Any Custom Domain (provider-agnostic DNS doctor probing apex + synthetic `mw-dns-check.<wildcard>` + Cloudflare Orange Cloud detection).
  Locking down Port `8000` is rejected server-side unless strict TLS `GET https://<instanceDomain>/readyz` returns `200 OK`.

---

## 4. Security & Repository Gate Invariants

| Gate / Contract | Enforcement |
|---|---|
| `scripts/docker-workspace-manifests.test.mjs` | Every `packages/*/package.json` (including `paas-template-pack-coolify`) must be copied before `bun install --frozen-lockfile` in `Dockerfile`. |
| `packages/orm-cloud/tests/cloud-auth-ops.test.ts` | Every row in `CLOUD_ROUTE_ACCESS_MATRIX` must have a unique `path`, `method` in `'GET' \| 'POST' \| 'DELETE'`, `model` matching `/^cloud\./`. |
| `apps/control-plane/main_test.go` | `controlPlaneRouteMatrix` has unique patterns, `publicCount === 1` (`/health` only), `/health` JSON bounded to `{ status, database: { status: "ok" \| "error" }, docker }`, privileged routes reject raw `MW_INTERNAL_SECRET`. |
| `scripts/check-api-addon-boundary.mjs` | Only core allowlisted files in `apps/api/src/routes/` (like `auth.routes.ts`); all PaaS routes live in `packages/orm-cloud/src/http.ts`. |
| `bun run ui:check` & `bun run board:budget` | Board uses ONLY `@moonwitness/ui/components/*` & `@moonwitness/ui/icons` (0 findings) and passes all route JS/CSS budgets. |
| `scripts/check-docs.mjs` | No broken relative markdown links in `.md` files (use backticks for code paths in `.plan/*.md`). |
| Git Pre-Commit Hook | Runs constitution check, fast preflight, and `eslint --fix`. If `eslint --fix` edits a staged file, re-run the exact `git commit --only ...` command once so the formatted file is committed cleanly. |
