# MoonWitness Sovereign PaaS — Master Long-Horizon Plan (Flash-Ready · 66 Micro-Tasks)

- **Plan ID:** `coolify-sovereign-paas-single-db`
- **ADR:** `.plan/coolify-sovereign-paas-single-db/ADR-001-sovereign-paas-single-db.md`
- **Total Micro-Tasks:** `66` (`M01`–`M66`) — 100% autonomous, zero human decisions, zero overlap
- **Target Branch:** `dev`
- **Target VPS:** `moonwitness-vps` (`163.61.134.104`, EasyTier mesh `10.144.0.1`)
- **Final VPS State (Deterministic, Zero Human Question):** After proving full lifecycle + `M65` clean DB-wipe reinstall, `moonwitness-vps` remains freshly booted in Coolify IP-First Bootstrap Mode at `http://163.61.134.104:8000/setup`.

---

## 1. Flash Agent Autonomous Execution Loop (READ EVERY TURN)

Execute strictly **1 micro-task (`Mxx`) per cycle** without asking the user any questions:

1. **Load Minimal Context:** Read this Master file to find the first unchecked `- [ ] Mxx`, then read **ONLY** the single Wave Playbook owning `Mxx` (and `ADR-001` only if you need architectural rationale).
2. **Verify Predecessor:** Confirm every task listed in `Depends On` is marked `[x]`.
3. **Implement `Mxx`:** Edit ONLY the files listed under `Owner File(s)` for `Mxx`. Follow `Exact Spec` and `DO / DO-NOT` strictly.
4. **Run `Verify` Command:** Must exit `0` and satisfy every bullet in `Acceptance Criteria` and `Expected Output`. Fix root causes immediately if anything fails.
5. **Update Tracking:** Change `- [ ]` -> `- [x]` for `Mxx` in BOTH the Wave Playbook AND this Master file, and update the Progress Ledger row.
6. **Atomic Per-Micro-Task Commit (for code tasks `M01`–`M54`):**
   ```powershell
   git commit --only <Mxx-owner-files> .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/<wave-file>.md -m "<type>(<scope>): Mxx <short-title>"
   ```
   - **Pre-Commit Auto-Fix Recovery:** If the pre-commit hook runs `eslint --fix` and modifies a staged file, simply re-run the exact same `git commit --only ...` command once.
   - **NEVER** run `git add -A`, **NEVER** touch unrelated dirty files, **NEVER** pass `--force` or `--no-verify`.
7. **Hard Invariants:**
   - Windows PowerShell ONLY: chain with `; if ($?) { ... }`, NEVER `&&`.
   - Single DB = PostgreSQL (`moonwitness_postgres`); ZERO SQLite `.db` on VPS; ZERO `:3004`; ZERO public `paas.*`.
   - NEVER print VPS passwords, `MW_SETUP_TOKEN`, `JWT_SECRET`, or bearer tokens to logs/chat.
   - Board UI: ONLY `@moonwitness/ui/components/*` & `@moonwitness/ui/icons`; NEVER import `paas-template-pack-coolify` JSON into `apps/board`.

---

## 2. Disjoint File Ownership & Dependency DAG (Zero Overlap Guarantee)

| Wave | Playbook | Tasks | Exclusive File Ownership | Depends On |
|---|---|---|---|---|
| **Wave 0** | `.plan/coolify-sovereign-paas-single-db/wave-0-packaging.md` | `M01`–`M03` | `packages/orm-cloud/package.json`, `Dockerfile`, `apps/whatsapp/Dockerfile`, `bun.lock` | None |
| **Wave 1** | `.plan/coolify-sovereign-paas-single-db/wave-1-control-plane.md` | `M04`–`M15` | `apps/control-plane/caddy.go`, `main.go`, `agent_stateless.go`, `agent_stateless_test.go`, `main_test.go` | `M03` |
| **Wave 2A (Cloud Core)** | `.plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md` | `M16`–`M31`, `M36`–`M37` | `packages/orm-cloud/src/**`, `packages/orm-cloud/tests/**` | `M03` (`M24`+ uses `M14` contract) |
| **Wave 2B (Auth/API/SDK)** | `.plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md` | `M32`–`M35`, `M38` | `packages/auth/src/**`, `packages/client/src/**`, `apps/api/src/routes/auth.routes.ts`, `apps/api/src/app.ts`, `apps/api/tests/auth-setup-claim.test.ts` | `M03` (disjoint from Wave 1 & Wave 2A!) |
| **Wave 3 (Board UI)** | `.plan/coolify-sovereign-paas-single-db/wave-3-board-ui.md` | `M39`–`M51` | `apps/board/src/app/api/session/route.ts`, `apps/board/src/app/setup/**`, `apps/board/src/board-pages/{setup,auth,settings}-page.tsx`, `apps/board/src/components/cloud/**` | `M35`, `M31` |
| **Wave 4 (Installer)** | `.plan/coolify-sovereign-paas-single-db/wave-4-installer-and-vps-e2e.md` | `M52`–`M55` | `deploy/vps/install.sh` | `M15`, `M38`, `M51` |
| **Wave 5 (Live VPS E2E)** | `.plan/coolify-sovereign-paas-single-db/wave-4-installer-and-vps-e2e.md` | `M56`–`M66` | Remote `moonwitness-vps` runtime + `/tmp/*` | `M55` |

---

## 3. Global Micro-Task Checklist (`M01`–`M66`)

### Wave 0 — Workspace & Docker Packaging (`wave-0-packaging.md`)
- [x] **M01** — Add `yaml` & `paas-template-pack-coolify` to `packages/orm-cloud/package.json`
- [x] **M02** — Add `COPY packages/paas-template-pack-coolify/package.json` in `Dockerfile` & `apps/whatsapp/Dockerfile`
- [x] **M03** — Sync `bun.lock` (if needed) & pass `docker-workspace-manifests.test.mjs` + `@moonwitness/orm-cloud build`

### Wave 1 — Stateless Control-Plane Agent (`wave-1-control-plane.md`)
- [x] **M04** — `caddy.go`: switch `admin off` -> `admin localhost:2019` + add `sync.Mutex`
- [x] **M05** — `caddy.go`: add `CaddyBootstrapListener`, `CaddyPreviewListener`, `ReconcileDeclarative`, zero-downtime `caddy reload`
- [x] **M06** — `main.go`: add `MW_CONTROL_PLANE_STATELESS=true`, `DB = nil`, `db == nil`-safe `/health`
- [x] **M07** — `main.go`: enable `/agent/` auth middleware prefix in `buildMux`
- [x] **M08** — `agent_stateless.go` + `main.go`: `POST /agent/caddy/reconcile` & `GET /agent/metrics`
- [x] **M09** — `agent_stateless.go` + `main.go`: `GET /agent/containers` & `POST /agent/containers/run`
- [x] **M10** — `agent_stateless.go` + `main.go`: `/agent/containers/{slug}/{action}` (single + compose aware)
- [x] **M11** — `agent_stateless.go` + `main.go`: `POST /agent/compose/up` (path-confined inline config files + strict security validator)
- [x] **M12** — `agent_stateless.go` + `main.go`: `POST /agent/git/deploy` (stateless SSRF-safe clone + build + swap)
- [x] **M13** — `agent_stateless.go` + `main.go`: `POST /agent/dns/verify` (apex, synthetic `mw-dns-check.<wildcard>`, Cloudflare-proxy detection, strict TLS `/readyz`)
- [x] **M14** — `agent_stateless_test.go` + `main_test.go`: full `db == nil` unit test suite & auth matrix tests
- [x] **M15** — Verify `go test` + `go vet` + cross-compile Linux `amd64` control-plane binary

### Wave 2 — PostgreSQL Single-DB, 390+ Coolify Compiler, & Setup Claim (`wave-2-postgres-and-coolify-pack.md`)
- [x] **M16** — `packages/orm-cloud/src/models/index.ts`: extend `CloudApp` (`managed_by`, `deploy_mode`, `template_id`, `compose_spec`, `git_*`, `ingress_routes`, `webhook_secret`)
- [x] **M17** — `packages/orm-cloud/src/coolify-template-pack.ts`: catalog resolver + YAML parser + compatibility classifier (`ready` | `inline_config` | `restricted`)
- [x] **M18** — `packages/orm-cloud/src/coolify-template-pack.ts`: paginated `listCoolifyTemplates` & `getCoolifyTemplateDetail`
- [x] **M19** — `packages/orm-cloud/src/coolify-compose-compiler.ts`: security policy gate + idempotent Coolify magic variable resolver (`existingEnv` reuse)
- [x] **M20** — `packages/orm-cloud/src/coolify-compose-compiler.ts`: full YAML transformer (volume prefixing, top-level `volumes:`, networks/aliases, inline `content:` files)
- [x] **M21** — `packages/orm-cloud/src/paas-state.ts`: NULL-safe `base_config_parameters` upsert + `readPaasInstanceSettings` / `savePaasInstanceSettings`
- [x] **M22** — `packages/orm-cloud/src/paas-state.ts`: `allocatePreviewPort`, `buildDeclarativeCaddySpec`, `reconcileCaddyWithAgent`, `promotePreviewAppsToWildcard`
- [x] **M23** — `packages/orm-cloud/src/providers/moonwitness-mesh.ts` + `index.ts`: fix RAM MB casing + add stateless `/agent/*` client helpers
- [x] **M24** — `packages/orm-cloud/src/http.ts`: wire `GET /settings`, `POST /settings/verify-dns`, `POST /settings/apply` (with strict TLS lockdown gate)
- [x] **M25** — `packages/orm-cloud/src/http.ts`: wire `POST /settings/promote-wildcard`, `GET /mesh/status`, & `onReady` boot reconciliation hook
- [x] **M26** — `packages/orm-cloud/src/http.ts`: wire 390+ template endpoints (`GET /templates`, `GET /templates/:id`, `POST /templates/deploy`)
- [x] **M27** — `packages/orm-cloud/src/http.ts`: refactor `GET /apps` & add `GET /apps/:slug` (PostgreSQL `CloudApp` + live agent merge + deployment history)
- [x] **M28** — `packages/orm-cloud/src/http.ts`: refactor `POST /apps/deploy` & add `POST /apps/deploy-compose` (Postgres + agent + Caddy)
- [x] **M29** — `packages/orm-cloud/src/http.ts`: add `POST /apps/deploy-git` & `POST /webhooks/github/:slug` (HMAC-SHA256 verified against Postgres)
- [x] **M30** — `packages/orm-cloud/src/http.ts`: refactor `POST /apps/:slug/:action` + add `GET /apps/:slug/stats` + update `logs/stream` to `/agent/containers/*`
- [x] **M31** — `packages/orm-cloud/src/http.ts`: add `POST /apps/:slug/env` (`[REDACTED]`-safe) & `POST /apps/:slug/domain` (Postgres + compose recompile + Caddy)
- [x] **M32** — `packages/auth/src/service.ts` + `index.ts`: add transactional `claimSuperadminSetup()` (raw password -> auto-hashed by `User` model!)
- [x] **M33** — `apps/api/src/routes/auth.routes.ts`: add `GET /auth/setup-status` & `POST /auth/setup-claim` (SHA-256 constant-time `MW_SETUP_TOKEN`, `409` after claim)
- [x] **M34** — `apps/api/src/app.ts`: make `strict-transport-security` HTTPS-conditional
- [x] **M35** — `packages/client/src/types.ts` + `client.ts`: add `getSetupStatus()` & `claimSetup()`
- [x] **M36** — `packages/orm-cloud/tests/coolify-template-pack.test.ts`: validate ALL 390+ templates + compiler/secret-idempotency tests
- [x] **M37** — `packages/orm-cloud/tests/cloud-auth-ops.test.ts`: test Postgres settings, TLS lockdown gate, preview ports, promote-wildcard, RAM MB, mesh status, app CRUD
- [x] **M38** — `apps/api/tests/auth-setup-claim.test.ts`: test setup-status, `401`/`201`/`409` claim lifecycle, conditional HSTS + full Wave 2 gate

### Wave 3 — Board Onboarding & Coolify-Grade PaaS Studio (`wave-3-board-ui.md`)
- [x] **M39** — `apps/board/src/app/api/session/route.ts`: dynamic HTTP/HTTPS cookie `secure` flag (`sameSite: 'lax'`)
- [x] **M40** — `apps/board/src/board-pages/setup-page.tsx`: Step 1 Claim Root Superadmin form
- [x] **M41** — `apps/board/src/board-pages/setup-page.tsx` + `apps/board/src/app/setup/page.tsx`: Step 2 3-mode domain selector + route page
- [x] **M42** — `apps/board/src/board-pages/auth-page.tsx`: first-boot `/setup` banner when `setupRequired === true`
- [x] **M43** — `apps/board/src/components/cloud/instance-domains-panel.tsx`: status strip, 1-click `sslip.io`, domain form, DNS table, Verify DNS, Save & Reload, Promote Preview Apps
- [x] **M44** — `instance-domains-panel.tsx` + `settings-page.tsx`: TLS-gated Port `8000` Lockdown (`ConfirmDialog`) + `/board/settings` admin card
- [x] **M45** — `apps/board/src/components/cloud/paas-template-catalog.tsx`: paginated server-side 390+ search + category filter + compatibility badges
- [x] **M46** — `apps/board/src/components/cloud/paas-template-catalog.tsx`: Configure & Deploy panel/modal (slug, domain/preview, editable env, secret badges)
- [x] **M47** — `apps/board/src/components/cloud/paas-app-drawer.tsx`: 4-tab per-app management drawer (Overview/Stats, Env Vault, Domain, History/SSE Logs)
- [x] **M48** — `apps/board/src/components/cloud/mesh-topology-panel.tsx`: remove hardcoded `a-l-l-a-h.com` mock, wire authenticated live `/mesh/status`
- [x] **M49** — `apps/board/src/components/cloud/paas-studio-panel.tsx`: wire `InstanceDomainsPanel`, `PaasAppDrawer`, `PaasTemplateCatalog`, `MeshTopologyPanel`
- [x] **M50** — `apps/board/src/components/cloud/paas-studio-panel.tsx`: 3-tab Deploy panel (`Docker Image` | `Git Repository` | `Docker Compose`)
- [x] **M51** — Pass full Board gate (`typecheck`, `ui:check`, `build`, `board:budget`)

### Wave 4 — Zero-Domain, Zero-SQLite `install.sh` (`wave-4-installer-and-vps-e2e.md`)
- [x] **M52** — `deploy/vps/install.sh`: CLI flags (`--port`, `--unlock-port`, `--wipe-tls`), auto-Docker install, `detect_public_ipv4`, `MW_SETUP_TOKEN`, `TRUST_PROXY_HOPS=2`
- [x] **M53** — `deploy/vps/install.sh`: full clean `cleanup_for_reinstall()` (Postgres `pgdata` + `mw-*` volumes + networks + stacks + backups + legacy SQLite + `.env`) + stateless `control-plane.env`
- [x] **M54** — `deploy/vps/install.sh`: Caddy `:80/:443/:8000-8010`, zero-domain Caddyfile (`admin localhost:2019` + `:8000`), UFW, `--unlock-port` PostgreSQL recovery, banner
- [x] **M55** — Validate `bash -n`, `gitleaks`, push `origin/dev`

### Wave 5 — Live VPS E2E & Full Clean DB-Wipe Proof (`wave-4-installer-and-vps-e2e.md`)
- [ ] **M56** — Archive clean tarball + upload tarball, Linux binary, `install.sh` to `moonwitness-vps`
- [ ] **M57** — Run fresh zero-domain `install.sh --reinstall` & assert zero `control-plane.db`, `:3004` closed, all 6 containers healthy
- [ ] **M58** — Verify IP Bootstrap (`http://163.61.134.104:8000/`, `/setup`, `/readyz`, `/auth/setup-status`, plain-HTTP cookie without `Secure`, no HSTS on HTTP)
- [ ] **M59** — Verify `/auth/setup-claim` (`401` -> `201` -> `409`), non-zero RAM MB metrics, zero-mock mesh status, internal WhatsApp `readyz`
- [ ] **M60** — Verify 390+ template search + deploy `uptime-kuma` in IP preview mode -> verify Postgres `cloud_apps` + `http://163.61.134.104:8001/` live
- [ ] **M61** — Verify DNS doctor (`matched`) -> apply `apps.moonwitness.biz.id` + wildcard + `wa.apps.moonwitness.biz.id` -> strict TLS `200` + HSTS header on HTTPS
- [ ] **M62** — Verify `promote-wildcard` -> `https://uptime-kuma.apps.moonwitness.biz.id/` returns `200`/`302` over valid TLS + app detail/stats endpoints pass
- [ ] **M63** — Verify Port `8000` Lockdown closes `:8000` & `:8001` while HTTPS stays `200`
- [ ] **M64** — Verify `install.sh --unlock-port` restores `:8000` from PostgreSQL + create 1 backup dump (leaving dirty state intentionally for `M65`)
- [ ] **M65** — **Full Clean Reinstall DB-Wipe Proof:** Run second `install.sh --reinstall` on dirty VPS -> assert PostgreSQL tables = `0`, admin reset to `superadmin`, old JWT = `401`, zero `mw-*` volumes/stacks/backups/SQLite/domains, fresh `setupRequired: true`
- [ ] **M66** — Clean `/tmp/*` staging files, confirm fresh `http://163.61.134.104:8000/setup` live, close Progress Ledger

---

## 4. Execution Progress Ledger

| Wave | Task Range | Completed Tasks | Last Commit SHA | Latest Verification Evidence |
|---|---|---|---|---|
| Wave 0 | `M01`–`M03` | `3 / 3` | — | `M03 OK` — frozen-lockfile dry-run exit 0 (zero drift, `bun.lock` unchanged); orm-cloud build exit 0; manifest test pass 10 / fail 0 |
| Wave 1 | `M04`–`M15` | `12 / 12` | `177580ee` | `M15 OK` — `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build` exit 0; binary size `18,091,490` bytes (> 10MB) |
| Wave 2 | `M16`–`M38` | `23 / 23` | `7de3a496` | `M38 OK` — full Wave 2 gate green: auth 18/18, client 25/25, orm-cloud 137/137, api setup-claim 3/3, api build exit 0, api:addon:check 4/4; setup-status/claim lifecycle + conditional HSTS verified |
| Wave 3 | `M39`–`M51` | `13 / 13` | `0de765f7` | `M51 OK` — full board gate green: typecheck 0; ui:check 0 findings; build exit 0 (28/28 pages incl /setup); board:budget all routes pass |
| Wave 4 | `M52`–`M55` | `4 / 4` | `7a94fa11` | `M55 OK` — `git push origin dev` succeeded (`c0c19311..7a94fa11`); all pre-push static/UI/doc/gitleaks/TaskOS gates green; dev in sync with origin/dev |
| Wave 5 | `M56`–`M66` | `0 / 11` | — | — |
