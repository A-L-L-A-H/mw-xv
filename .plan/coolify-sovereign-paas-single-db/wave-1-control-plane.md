# Wave 1 — Stateless Control-Plane Agent (`M04`–`M15`)

**ADR Reference:** `.plan/coolify-sovereign-paas-single-db/ADR-001-sovereign-paas-single-db.md` (Decisions 1, 2, 3)
**Depends On:** `M03`
**Hard Rule:** ZERO `m.db` access in `agent_stateless.go`; EVERY micro-task MUST compile and pass `go test` on its own before committing!

---

## - [x] M04 — Switch Caddy Global Block to `admin localhost:2019` + Add Mutex

- **Owner File (MODIFY):** `apps/control-plane/caddy.go`
- **Depends On:** `M03`
- **Exact Spec:**
  1. Import `"sync"`.
  2. Line 249 in `GenerateCaddyfile`: replace `\tadmin off\n` with `\tadmin localhost:2019\n`.
  3. Add `mu sync.Mutex` field to `CaddyManager` struct (line 265).
  4. Lock `m.mu` in `SetStaticRoutes`, `StaticRoutes`, `ConfigureContainerReload`, and `Sync`.
- **Acceptance Criteria:**
  - `GenerateCaddyfile` outputs `admin localhost:2019` and remains deterministic.
  - All existing `apps/control-plane` tests pass with zero race issues.
- **Expected Output:** `ok moonwitness-control-plane` from `go test`.
- **Verify:**
  ```powershell
  go test -C apps/control-plane -run TestGenerateCaddyfile -v ./...; if ($?) { go vet -C apps/control-plane ./... }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/control-plane/caddy.go .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-1-control-plane.md -m "feat(control-plane): M04 enable container-internal caddy admin localhost:2019 and mutex"
  ```

---

## - [x] M05 — Add `ReconcileDeclarative` & Zero-Downtime `caddy reload` to `caddy.go`

- **Owner File (MODIFY):** `apps/control-plane/caddy.go`
- **Depends On:** `M04`
- **Exact Spec:**
  - Add structs:
    ```go
    type CaddyBootstrapListener struct {
    	Enabled  bool   `json:"enabled"`
    	Port     int    `json:"port"`
    	Upstream string `json:"upstream"`
    }

    type CaddyPreviewListener struct {
    	Slug     string `json:"slug"`
    	Port     int    `json:"port"`
    	Upstream string `json:"upstream"`
    }
    ```
  - Add `validateUpstreamTarget(upstream string) error` reusing `validateStaticRoute`'s upstream checks (rejecting control chars, forbidden chars, empty host, bad port, `control-plane`, `postgres`, `moonwitness-postgres`, `:3003`, `:5432`).
  - Add `ReconcileDeclarative(ctx context.Context, bootstrap CaddyBootstrapListener, previews []CaddyPreviewListener, routes []CaddyStaticRoute) (string, error)`:
    - Reject `!bootstrap.Enabled && len(routes) == 0` (`"cannot disable bootstrap HTTP listener when no domain routes exist"`).
    - When `bootstrap.Enabled`: default port `8000`, reject port outside `1024..65535` or in `{3000, 3003, 3004, 3005, 4174, 5432}`, default upstream `"moonwitness_board:8080"`, validate upstream.
    - When `bootstrap.Enabled`: validate each preview port in `8001..8010`, unique port (`!= bootstrap.Port`), valid upstream; sort by `Port` ascending.
    - Validate each route with `validateStaticRoute`, reject duplicate `Domain`, sort by `Domain` ascending.
    - Render deterministic Caddyfile (`admin localhost:2019` + optional `:<bootstrap.Port>` + optional `:<preview.Port>` + `<domain>` blocks), write atomically (`0644`).
  - Add shared `reloadCaddyLocked(ctx context.Context) error` called by BOTH `Sync` and `ReconcileDeclarative`:
    - If `m.caddyContainer != "" && m.dockerBin != ""`:
      1. Try `m.runner(ctx, m.dockerBin, "exec", m.caddyContainer, "caddy", "reload", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")`.
      2. If err != nil: fall back to `m.runner(ctx, m.dockerBin, "restart", m.caddyContainer)`.
- **Acceptance Criteria:**
  - `ReconcileDeclarative` enforces all guards fail-closed and writes deterministic output.
  - Zero regressions in existing `paas_test.go` / `paas_coolify_test.go`.
- **Expected Output:** `go test -C apps/control-plane ./...` passes 100%.
- **Verify:**
  ```powershell
  go test -C apps/control-plane ./...; if ($?) { go vet -C apps/control-plane ./... }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/control-plane/caddy.go .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-1-control-plane.md -m "feat(control-plane): M05 add declarative caddy reconciliation and zero-downtime reload"
  ```

---

## - [x] M06 — Add `MW_CONTROL_PLANE_STATELESS=true` Mode & `db == nil`-Safe `/health`

- **Owner File (MODIFY):** `apps/control-plane/main.go`
- **Depends On:** `M05`
- **Exact Spec:**
  1. Add `isStatelessAgentMode() bool` returning `strings.EqualFold(strings.TrimSpace(os.Getenv("MW_CONTROL_PLANE_STATELESS")), "true")`.
  2. In `main()` (lines 162–221):
     - If `isStatelessAgentMode()`:
       - Keep `DB = nil` (do NOT call `sql.Open`, do NOT call `initSchema()`, do NOT call `paasMgr.SyncCaddyRoutesOnStartup(ctx)`).
       - Require `MW_CONTROL_PLANE_TOKEN` or `MW_INTERNAL_SECRET` or `JWT_SECRET` (fail-closed `log.Fatalf` if none set so no `.admin-token` disk file is needed in stateless mode).
       - Log `"control-plane running in stateless agent mode (zero local database)"`.
     - Else: preserve legacy SQLite path unchanged.
  3. In `handleHealth(db *sql.DB, dockerBin string)` (line 649):
     ```go
     dbStatus := "ok"
     if db != nil && db.Ping() != nil {
     	dbStatus = "error"
     }
     ```
- **DO NOT:** Change JSON keys of `/health` or emit the word `"sqlite"` (`TestHealthPayloadIsBoundedAndMethodGated` forbids it).
- **Acceptance Criteria:**
  - `handleHealth(nil, dockerBin)` returns `200` with `{"status":"ok","database":{"status":"ok"},"docker":"ok"}`.
  - Existing `main_test.go` passes 100%.
- **Expected Output:** `ok moonwitness-control-plane`.
- **Verify:**
  ```powershell
  go test -C apps/control-plane -run "TestHealth|TestResolveAdminToken" -v ./...; if ($?) { go vet -C apps/control-plane ./... }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/control-plane/main.go .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-1-control-plane.md -m "feat(control-plane): M06 support stateless agent mode with zero sqlite db"
  ```

---

## - [x] M07 — Enable `/agent/` Auth Prefix in `buildMux` (`main.go`)

- **Owner File (MODIFY):** `apps/control-plane/main.go` (lines 357–369)
- **Depends On:** `M06`
- **Exact Spec:**
  - Update `if strings.HasPrefix(route.pattern, "/paas/")` to `if strings.HasPrefix(route.pattern, "/paas/") || strings.HasPrefix(route.pattern, "/agent/")` in BOTH `case accessAuthenticated:` and `case accessPrivileged:`.
  - **DO NOT** register unimplemented `/agent/*` rows in `controlPlaneRouteMatrix` yet — `M08`–`M13` each register their own routes in the same commit as their handlers!
- **Acceptance Criteria:** `buildMux` routes `/agent/*` through `requirePaasAuth` / `requirePrivilegedPaasAuth`; all existing tests pass.
- **Expected Output:** `TestControlPlaneRouteMatrix` PASS.
- **Verify:**
  ```powershell
  go test -C apps/control-plane -run TestControlPlaneRouteMatrix -v ./...
  ```
- **Commit:**
  ```powershell
  git commit --only apps/control-plane/main.go .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-1-control-plane.md -m "feat(control-plane): M07 apply paas auth middleware to /agent/* route family"
  ```

---

## - [x] M08 — Create `agent_stateless.go`: `POST /agent/caddy/reconcile` & `GET /agent/metrics`

- **Owner Files:**
  - `apps/control-plane/agent_stateless.go` (CREATE)
  - `apps/control-plane/main.go` (MODIFY — register `/agent/caddy/reconcile` [`accessPrivileged`, `POST`] & `/agent/metrics` [`accessAuthenticated`, `GET`])
- **Depends On:** `M07`
- **Exact Spec:**
  - Zero `m.db` references!
  - `POST /agent/caddy/reconcile`: decode `AgentCaddyReconcileRequest { PublicPort, PublicPortEnabled, BootstrapUpstream, PreviewListeners, Routes }` -> call `m.caddyMgr.ReconcileDeclarative(...)` -> return `200 { ok: true, publicPort, publicPortEnabled, previewCount, routeCount }`. Validation failure -> `400`; Caddy reload error -> `500`.
  - `GET /agent/metrics`: call `readHostResourceMetrics(runtime.NumCPU())`, `docker version`, `docker ps --filter label=mw.paas.managed=true --filter status=running -q` (runningApps), `docker ps -a --filter label=mw.paas.managed=true -q` (totalApps), `m.meshMgr.Status(ctx)`, `MW_PUBLIC_IPV4`. Return `200` with `PaasNodeMetrics` + `publicIpv4` + `stateless: true`.
- **Acceptance Criteria:** Compiles cleanly, `TestControlPlaneRouteMatrix` passes, zero `m.db` calls in `agent_stateless.go`.
- **Expected Output:** `go test` & `go vet` exit `0`.
- **Verify:**
  ```powershell
  go test -C apps/control-plane ./...; if ($?) { go vet -C apps/control-plane ./... }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/control-plane/agent_stateless.go apps/control-plane/main.go .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-1-control-plane.md -m "feat(control-plane): M08 add stateless /agent/caddy/reconcile and /agent/metrics"
  ```

---

## - [x] M09 — Add `GET /agent/containers` & `POST /agent/containers/run`

- **Owner Files (MODIFY):**
  - `apps/control-plane/agent_stateless.go`
  - `apps/control-plane/main.go` (register `/agent/containers` [`accessAuthenticated`, `GET`] & `/agent/containers/run` [`accessPrivileged`, `POST`])
- **Depends On:** `M08`
- **Exact Spec:**
  - `GET /agent/containers`: execute `docker ps -a --format '{{.Names}}\t{{.ID}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.Labels}}'`; parse `mw.paas.app`, `mw.paas.service`, `mw.paas.tenant`, `mw.paas.managed` from comma-separated labels; return `200 { containers: [...] }`.
  - `POST /agent/containers/run`: decode `PaasDeployRequest`, run `normalizeDeployRequest(req, "")` & `ValidateDeployRequest(req)`, execute `m.deployContainerZeroDowntime(ctx, req, PaasContainerName(req.Slug))`, return `201 { ok: true, slug, containerName, containerId, status: "running" }` (redact env secrets on error).
- **Acceptance Criteria:** Zero `m.db` references; both routes registered in matrix & mux; tests pass.
- **Expected Output:** `go test` & `go vet` exit `0`.
- **Verify:**
  ```powershell
  go test -C apps/control-plane ./...; if ($?) { go vet -C apps/control-plane ./... }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/control-plane/agent_stateless.go apps/control-plane/main.go .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-1-control-plane.md -m "feat(control-plane): M09 add stateless /agent/containers list and run endpoints"
  ```

---

## - [ ] M10 — Add `/agent/containers/{slug}/{action}` (Single Container + Compose Stack Aware)

- **Owner Files (MODIFY):**
  - `apps/control-plane/agent_stateless.go`
  - `apps/control-plane/main.go` (register `/agent/containers/` [`accessAuthenticated`])
- **Depends On:** `M09`
- **Exact Spec:**
  - Validate `slug` via `ValidatePaasSlug`.
  - Read routes (`GET`, authenticated):
    - `/agent/containers/{slug}/logs?tail=100` -> compose logs if `<dataDir>/stacks/<slug>/docker-compose.yml` exists, else `docker logs --tail N mw-paas-<slug>`; redact secrets -> `200 { ok: true, slug, logs }`.
    - `/agent/containers/{slug}/logs/stream?tail=100` -> SSE stream via `m.streamRunner` (compose or container).
    - `/agent/containers/{slug}/stats` -> `docker stats --no-stream --format json mw-paas-<slug>` parsed by `parseDockerStatsJSON`.
  - Mutation routes (`POST`, **MUST check canonical privileged `m.adminToken` via `constantTimeEquals`**, else `401`!):
    - `start`, `stop`, `restart`, `delete` -> run `docker compose -p mw-paas-<slug> -f <file> up -d | stop | restart | down --remove-orphans [--volumes if pruneVolumes=true]` (plus `os.RemoveAll(stackDir)` on `delete`) if stack exists, else `docker <action> mw-paas-<slug>` (`rm -f` for `delete`).
    - Return `200 { ok: true, slug, action, status }`.
- **Acceptance Criteria:** Privileged mutations reject raw `MW_INTERNAL_SECRET` (`401`); both single and compose stacks work without DB.
- **Expected Output:** `go test` & `go vet` exit `0`.
- **Verify:**
  ```powershell
  go test -C apps/control-plane ./...; if ($?) { go vet -C apps/control-plane ./... }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/control-plane/agent_stateless.go apps/control-plane/main.go .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-1-control-plane.md -m "feat(control-plane): M10 add stateless container and compose lifecycle subroutes"
  ```

---

## - [ ] M11 — Add `POST /agent/compose/up` with Path-Confined Inline File Materialization

- **Owner Files (MODIFY):**
  - `apps/control-plane/agent_stateless.go`
  - `apps/control-plane/main.go` (register `/agent/compose/up` [`accessPrivileged`, `POST`])
- **Depends On:** `M10`
- **Exact Spec:**
  - Payload: `{ slug, composeSpec, env?: map[string]string, files?: map[string]string }`.
  - Validate `slug`, `env` (`paasEnvKeyPattern`, no NUL), and `files`: max 20 files, max 256 KiB each, relative path only (strip leading `./`, reject empty / `/` / `\` / `..` / control chars / `docker-compose.yml` / `.env`), verify `filepath.Rel(stackDir, target)` has no `..`.
  - Add `ValidateComposeSpecWithAllowedFiles(spec string, allowedRelPaths map[string]bool) error`: keeps all fail-closed blocks (`docker.sock`, `privileged: true`, host namespaces, `SYS_ADMIN`/`ALL`/`SYS_PTRACE`/`SYS_MODULE`, `..` traversal) while allowing relative `type: bind` / `source: ./<path>` ONLY when `<path>` is in `allowedRelPaths`.
  - Write files atomically (`0644`), `docker-compose.yml` (`0600`), `.env` (`0600`, sorted keys), run `docker compose -p mw-paas-<slug> -f <file> up -d --remove-orphans`, inspect containers -> `201 { ok: true, slug, containers }`.
- **Acceptance Criteria:** Path traversal (`../evil`), unlisted host bind mounts, and `SYS_ADMIN` return `400`; safe inline config files write cleanly inside stack dir.
- **Expected Output:** `go test` & `go vet` exit `0`.
- **Verify:**
  ```powershell
  go test -C apps/control-plane ./...; if ($?) { go vet -C apps/control-plane ./... }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/control-plane/agent_stateless.go apps/control-plane/main.go .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-1-control-plane.md -m "feat(control-plane): M11 add stateless /agent/compose/up with safe inline files"
  ```

---

## - [ ] M12 — Add `POST /agent/git/deploy` (Stateless SSRF-Safe Clone + Build + Swap)

- **Owner Files (MODIFY):**
  - `apps/control-plane/agent_stateless.go`
  - `apps/control-plane/main.go` (register `/agent/git/deploy` [`accessPrivileged`, `POST`])
- **Depends On:** `M11`
- **Exact Spec:**
  - Decode `GitDeployRequest`, validate using existing helpers from `gitbuilder.go` (`ValidatePaasSlug`, `validateGitRepoURL`, `validateGitBranch`, `validateDockerfilePath`, `ValidatePaasPort`).
  - Shallow clone into `os.MkdirTemp("", "mw-git-*")` (`defer os.RemoveAll`), read short commit SHA (`git rev-parse --short HEAD`), run `docker build -t mw-git-<slug>:<shortSha> -f <dockerfilePath> <tmpDir>`, run `deployContainerZeroDowntime` — ZERO `m.db` writes!
  - Return `201 { ok: true, slug, image, branch, commitSha, containerName, containerId }`.
- **Acceptance Criteria:** Rejects non-HTTPS or private/loopback Git URLs (`400`); zero DB mutations.
- **Expected Output:** `go test` & `go vet` exit `0`.
- **Verify:**
  ```powershell
  go test -C apps/control-plane ./...; if ($?) { go vet -C apps/control-plane ./... }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/control-plane/agent_stateless.go apps/control-plane/main.go .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-1-control-plane.md -m "feat(control-plane): M12 add stateless /agent/git/deploy endpoint"
  ```

---

## - [ ] M13 — Add `POST /agent/dns/verify` (Apex, Synthetic Wildcard, & Strict TLS `/readyz`)

- **Owner Files (MODIFY):**
  - `apps/control-plane/agent_stateless.go`
  - `apps/control-plane/paas.go` (add optional injectable test hooks `dnsLookupIP` & `httpsProbe` on `PaasManager` struct)
  - `apps/control-plane/main.go` (register `/agent/dns/verify` [`accessAuthenticated`, `POST`])
- **Depends On:** `M12`
- **Exact Spec:**
  - Request: `{ instanceDomain?, wildcardDomain?, whatsappDomain?, expectedIpv4?, checkHttps?: bool }`.
  - Default `expectedIP` from `MW_PUBLIC_IPV4`.
  - Validate any non-empty domain with `ValidatePaasDomain` (`400` on invalid).
  - Resolve `instanceDomain`, synthetic `"mw-dns-check." + wildcardDomain`, and `whatsappDomain` via `dnsLookupIP` (default `net.DefaultResolver.LookupIPAddr`, 5s timeout):
    - Status: `"skipped"` (empty), `"unresolved"` (lookup error/empty), `"matched"` (contains `expectedIP`), `"different_ip"` (resolved another IP -> include Cloudflare grey-cloud warning).
  - When `checkHttps && instanceDomain != ""`: run `httpsProbe(ctx, "https://" + instanceDomain + "/readyz")` (default `defaultHTTPHealthProbe` from `paas_ops.go` — strict TLS, SSRF-safe public IP pinned!). Return `httpsReady: { reachable, tlsVerified, error? }`.
- **Acceptance Criteria:** Synthetic wildcard probed cleanly; strict TLS check never skips cert verification.
- **Expected Output:** `go test` & `go vet` exit `0`.
- **Verify:**
  ```powershell
  go test -C apps/control-plane ./...; if ($?) { go vet -C apps/control-plane ./... }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/control-plane/agent_stateless.go apps/control-plane/paas.go apps/control-plane/main.go .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-1-control-plane.md -m "feat(control-plane): M13 add stateless /agent/dns/verify with wildcard and strict tls probe"
  ```

---

## - [ ] M14 — Add Full Stateless Unit Tests (`agent_stateless_test.go` & `main_test.go`)

- **Owner Files:**
  - `apps/control-plane/agent_stateless_test.go` (CREATE)
  - `apps/control-plane/main_test.go` (MODIFY — add `/agent/metrics`, `/agent/caddy/reconcile`, `/agent/containers/run`, `/agent/compose/up` to `TestProtectedRouteFamiliesRejectMalformedAndWrongAudienceCredentials`)
- **Depends On:** `M13`
- **Required Tests:**
  1. `TestStatelessAgentWithNilDB`: `buildMux(nil, dockerBin, token)` -> `GET /health` `200`, `GET /agent/metrics` `200` (`stateless: true`).
  2. `TestAgentCaddyReconcileModesAndGuards`: bootstrap `:8000` + preview `:8001`, `caddy reload` + `docker restart` fallback, HTTPS lockdown removes `:8000/:8001`, self-lockout `400`, duplicate domain `400`, private upstream `400`.
  3. `TestAgentComposeUpInlineFilesAndGuards`: valid `./nginx/nginx.conf` writes file & calls `docker compose up -d`; `../escape` -> `400`; `/etc/passwd:/x` -> `400`; `SYS_ADMIN` -> `400`.
  4. `TestAgentDnsVerifyStates`: `matched`, `different_ip`, `unresolved`, synthetic `mw-dns-check.<wildcard>`, strict HTTPS pass & fail.
  5. `TestAgentPrivilegedRoutesRejectRawInternalSecret`: raw `MW_INTERNAL_SECRET` returns `401` on all privileged `/agent/*` mutations; canonical derived token succeeds.
- **Acceptance Criteria:** 100% of Go tests pass with `db == nil` and with legacy SQLite fixtures.
- **Expected Output:** `PASS` / `ok moonwitness-control-plane`.
- **Verify:**
  ```powershell
  go test -C apps/control-plane -v ./...; if ($?) { go vet -C apps/control-plane ./... }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/control-plane/agent_stateless_test.go apps/control-plane/main_test.go .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-1-control-plane.md -m "test(control-plane): M14 add stateless nil-db unit tests for all /agent/* endpoints"
  ```

---

## - [ ] M15 — Cross-Compile Linux `amd64` Control-Plane Binary

- **Owner Artifact (scratch, not committed to git):** `C:\Users\bjo16\.gemini\antigravity\brain\682931c0-bdfe-41e8-84a3-e0a9d98bd906\scratch\moonwitness-control-plane-linux-amd64`
- **Depends On:** `M14`
- **Verify:**
  ```powershell
  $env:CGO_ENABLED="0"; $env:GOOS="linux"; $env:GOARCH="amd64"; go build -C apps/control-plane -o "C:\Users\bjo16\.gemini\antigravity\brain\682931c0-bdfe-41e8-84a3-e0a9d98bd906\scratch\moonwitness-control-plane-linux-amd64" .; $rc=$?; Remove-Item Env:CGO_ENABLED, Env:GOOS, Env:GOARCH -ErrorAction SilentlyContinue; if ($rc -ne 0) { exit $rc }; (Get-Item "C:\Users\bjo16\.gemini\antigravity\brain\682931c0-bdfe-41e8-84a3-e0a9d98bd906\scratch\moonwitness-control-plane-linux-amd64").Length
  ```
- **Acceptance Criteria:** Exit `0` and binary size > `10,000,000` bytes.
- **Commit (plan tracker update):**
  ```powershell
  git commit --only .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-1-control-plane.md -m "chore(plan): M15 verify linux amd64 control-plane binary build"
  ```
