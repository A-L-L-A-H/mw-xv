# Wave 2 — PostgreSQL Single-DB, 390+ Coolify Compiler, & Setup Claim (`M16`–`M38`)

**ADR Reference:** `.plan/coolify-sovereign-paas-single-db/ADR-001-sovereign-paas-single-db.md` (Decisions 1, 4, 5, 6, 7)
**Depends On:** `M03` (Wave 2B tasks `M32`–`M35`, `M38` have zero file overlap with Wave 2A!)
**Hard Rule:** Every micro-task adds its OWN `CLOUD_ROUTE_ACCESS_MATRIX` row(s) alongside its handler so EVERY single commit compiles and passes tests on its own!

---

## - [x] M16 — Extend `CloudApp` Schema in `packages/orm-cloud/src/models/index.ts`

- **Owner File (MODIFY):** `packages/orm-cloud/src/models/index.ts` (inside `CloudApp.fields`)
- **Depends On:** `M03`
- **Exact Fields to Add (all defaulted or nullable):**
  ```ts
    managed_by: fields.enum(['manual', 'paas', 'coolify'] as const, {
      required: true,
      default: 'manual',
      label: 'Managed By',
    }),
    deploy_mode: fields.enum(['image', 'compose', 'git'] as const, {
      required: true,
      default: 'image',
      label: 'Deploy Mode',
    }),
    template_id: fields.string({ label: 'Coolify Template ID' }),
    compose_spec: fields.text({ label: 'Compose Specification' }),
    git_repo: fields.string({ label: 'Git Repository URL' }),
    git_branch: fields.string({ label: 'Git Branch' }),
    dockerfile_path: fields.string({ label: 'Dockerfile Path' }),
    ingress_routes: fields.json({ label: 'Ingress Routes' }),
    webhook_secret: fields.string({ sensitive: true, label: 'Webhook Secret' }),
  ```
- **Acceptance Criteria:** Existing seeded `moonwitness-isp` defaults to `managed_by = 'manual'`; all existing `@moonwitness/orm-cloud` tests pass.
- **Expected Output:** 100% tests pass.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build; if ($?) { bun --filter @moonwitness/orm-cloud test }
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/src/models/index.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(orm-cloud): M16 extend cloud.app model for paas compose, git, and templates"
  ```

---

## - [x] M17 — Create Coolify Template Pack Loader & Classifier (`coolify-template-pack.ts`)

- **Owner File (CREATE):** `packages/orm-cloud/src/coolify-template-pack.ts`
- **Depends On:** `M16`
- **Exact Spec:**
  - Resolve `service-templates.json` in order: `process.env.MW_COOLIFY_TEMPLATE_PACK_DIR` -> `createRequire(import.meta.url).resolve('paas-template-pack-coolify/service-templates.json')` -> `path.resolve(import.meta.dirname, '../../paas-template-pack-coolify/service-templates.json')`.
  - Parse once into an in-memory cache (`try/catch` per entry so 1 malformed YAML never crashes catalog).
  - Decode base64 `compose` -> `parse` from `'yaml'`.
  - Classify `compatibility`:
    - `'restricted'`: any service uses `privileged: true`, `network_mode/pid/ipc/uts: host`, `cap_add` containing `SYS_ADMIN | ALL | SYS_PTRACE | SYS_MODULE`, volume containing `docker.sock`, or host bind starting with `/`, `~`, or `..` without `content`.
    - `'inline_config'`: not restricted AND any volume object has `type: 'bind'` with string `content` and relative `./` `source`.
    - `'ready'`: all other valid Compose v2 templates.
  - Extract `magicSecrets` (`SERVICE_(?:PASSWORD|USER|HEX|BASE64)(?:_64)?_[A-Z0-9_]+`) and `editableEnv` (`${KEY:-default}` / `${KEY-default}` excluding `SERVICE_*`).
- **Acceptance Criteria:** Module compiles cleanly and parses `service-templates.json` (`>350` templates).
- **Expected Output:** `bun --filter @moonwitness/orm-cloud build` exits `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/src/coolify-template-pack.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(orm-cloud): M17 add coolify 390+ template pack loader and compatibility classifier"
  ```

---

## - [x] M18 — Add Paginated Search & Detail Exports to `coolify-template-pack.ts`

- **Owner Files (MODIFY):**
  - `packages/orm-cloud/src/coolify-template-pack.ts`
  - `packages/orm-cloud/src/index.ts` (export `listCoolifyTemplates`, `getCoolifyTemplateDetail`, and types)
- **Depends On:** `M17`
- **Exact Spec:**
  - `listCoolifyTemplates({ q?, category?, tag?, compatibility?, includeOutdated?, page = 1, limit = 24 })`: clamp `limit` to `1..100`, filter case-insensitively on `id`/`name`/`slogan`/`category`/`tags`, return `{ items, total, page, limit, categories: Array<{ id, count }> }`.
  - `getCoolifyTemplateDetail(id: string): CoolifyTemplateDetail | undefined`.
- **Acceptance Criteria:** Server-side pagination returns bounded slice + accurate `total` and `categories`.
- **Expected Output:** `node -e` quick check prints `total >= 350` and `n8n` detail!
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build; if ($?) { node -e "import('./packages/orm-cloud/dist/index.js').then(m=>{const r=m.listCoolifyTemplates({q:'n8n'}); if(r.total<1 || !m.getCoolifyTemplateDetail('n8n')) process.exit(1); console.log('M18 OK total_all=', m.listCoolifyTemplates().total)})" }
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/src/coolify-template-pack.ts packages/orm-cloud/src/index.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(orm-cloud): M18 add paginated search and detail exports for coolify templates"
  ```

---

## - [x] M19 — Create `coolify-compose-compiler.ts`: Security Gate & Idempotent Magic Variable Resolver

- **Owner File (CREATE):** `packages/orm-cloud/src/coolify-compose-compiler.ts`
- **Depends On:** `M18`
- **Exact Spec:**
  - Export `validateComposeSecurity(doc)` (fail-closed rejection of `docker.sock`, `privileged: true`, host namespace modes, `SYS_ADMIN`/`ALL`/`SYS_PTRACE`/`SYS_MODULE`, unsafe host bind mounts).
  - Export `resolveCoolifyMagicVariables({ slug, composeYaml, doc, defaultPort, primaryDomain, wildcardDomain, publicIpv4, previewPort, existingEnv, userEnv })`:
    - **Idempotency:** For every `SERVICE_(PASSWORD|USER|HEX|BASE64)(_64)?_*`, reuse `existingEnv[key]` if present; otherwise generate URL-safe CSPRNG secret (alphanumeric `[A-Za-z0-9]` for passwords so `postgres://user:pass@host` never breaks!).
    - Extract `SERVICE_(FQDN|URL)_<TOKEN>(?:_<PORT>)?` declarations per service -> map primary ingress service to `primaryDomain` (`https://...`) or `http://${publicIpv4}:${previewPort}` (or internal fallback), and secondary ingress services to `${safeSvc}-${slug}.${wildcardDomain}` when `wildcardDomain` is set.
    - Populate BOTH `SERVICE_FQDN_*` and `SERVICE_URL_*` into `env`.
- **Acceptance Criteria:** Compiles cleanly; re-running with `existingEnv` preserves every generated secret identically.
- **Expected Output:** Build exits `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/src/coolify-compose-compiler.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(orm-cloud): M19 add coolify compose security gate and idempotent magic var resolver"
  ```

---

## - [x] M20 — Complete `compileCoolifyCompose` YAML Transformer (`coolify-compose-compiler.ts`)

- **Owner Files (MODIFY):**
  - `packages/orm-cloud/src/coolify-compose-compiler.ts`
  - `packages/orm-cloud/src/index.ts` (export `compileCoolifyCompose` & types)
- **Depends On:** `M19`
- **Exact Spec:**
  - On parsed YAML `doc`:
    1. Delete Coolify-only `exclude_from_hc` per service.
    2. Set `restart: 'unless-stopped'` if unset (preserve `on-failure` / `no`).
    3. Add labels `mw.paas.managed=true`, `mw.paas.app=${slug}`, `mw.paas.service=${svcName}`, `mw.paas.tenant=${tenantId}`.
    4. Prefix named volumes (`<vol>:<mount>` -> `mw-${slug}-${vol}:<mount>`) and populate top-level `doc.volumes`.
    5. Extract inline `content:` bind-mount objects (`./...`) into `files: Record<string, string>` (reject `..`, absolute `/`, `\`, >256 KiB), delete `.content` key.
    6. Strip bare marker-only `SERVICE_FQDN_*` / `SERVICE_URL_*` entries without `=` from service `environment` arrays.
    7. Attach every service to `default`, attach primary ingress service to `moonwitness-paas` with alias `mw-paas-${slug}`, attach secondary ingress services with alias `mw-paas-${slug}-${safeSvc}`, and set top-level `doc.networks = { default: {}, [paasNetwork]: { external: true } }`.
    8. Stringify via `stringify` from `'yaml'` and return `{ composeYaml, files, env, primaryService, primaryPort, ingressRoutes }`.
- **Acceptance Criteria:** Compiling `n8n` and `appflowy` succeeds with top-level `volumes`, `networks`, and extracted `./nginx/nginx.conf`.
- **Expected Output:** `node -e` smoke prints `M20 OK`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build; if ($?) { node -e "import('./packages/orm-cloud/dist/index.js').then(m=>{const t=m.getCoolifyTemplateDetail('n8n'); const c=m.compileCoolifyCompose({slug:'n8n',tenantId:'t1',composeYaml:t.composeYaml,defaultPort:t.port,primaryDomain:'n8n.example.com'}); if(!c.composeYaml.includes('mw-n8n-n8n-data') || !c.composeYaml.includes('moonwitness-paas')) process.exit(1); console.log('M20 OK routes=', c.ingressRoutes.length)})" }
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/src/coolify-compose-compiler.ts packages/orm-cloud/src/index.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(orm-cloud): M20 complete coolify compose yaml transformer and volume prefixing"
  ```

---

## - [x] M21 — Create PostgreSQL Instance Settings Store (`paas-state.ts`, Part 1)

- **Owner File (CREATE):** `packages/orm-cloud/src/paas-state.ts`
- **Depends On:** `M16`
- **Exact Spec:**
  - Canonical global (`company_id IS NULL`) keys in `base_config_parameters`:
    - `paas.instance_domain`, `paas.wildcard_domain`, `paas.whatsapp_domain`, `paas.public_port` (`8000`), `paas.public_port_enabled` (`true`), `paas.public_ipv4` (fallback `process.env.MW_PUBLIC_IPV4 ?? ''`).
  - **CRITICAL NULL-Unique Upsert:** Query `ConfigParameter.query().where({ key }).whereNull('company_id').orderBy('id', 'desc').first()` before patch/insert so PostgreSQL never creates duplicate `NULL`-company rows!
  - Export `isValidPublicDomain(domain)` (lowercase RFC-1123 FQDN, >=2 labels, rejects IP literals, `.localhost`, `.local`, `.internal`, `.mesh`, `.easytier`, Caddy meta chars).
  - Export `readPaasInstanceSettings()` returning `{ instanceDomain, wildcardDomain, whatsappDomain, publicPort, publicPortEnabled, publicIpv4, accessMode }`.
  - Export `savePaasInstanceSettings(input)` enforcing self-lockout (`publicPortEnabled === false && !instanceDomain -> Error`) & collision guards against `whatsappDomain` and active `CloudApp` (`managed_by = 'paas'`).
- **Acceptance Criteria:** Compiles cleanly; rejects `.local`, IP literals, and self-lockout.
- **Expected Output:** `bun --filter @moonwitness/orm-cloud build` exits `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/src/paas-state.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(orm-cloud): M21 add postgresql base_config_parameters paas instance settings store"
  ```

---

## - [x] M22 — Add Preview Port Allocator, Declarative Caddy Spec Builder, & Wildcard Promoter (`paas-state.ts`, Part 2)

- **Owner Files (MODIFY):**
  - `packages/orm-cloud/src/paas-state.ts`
  - `packages/orm-cloud/src/index.ts` (export `paas-state.ts` functions & types)
- **Depends On:** `M20`, `M21`
- **Exact Spec:**
  - `allocatePreviewPort(): Promise<number | null>`: returns lowest free integer in `8001..8010` not used by active `CloudApp` (`managed_by = 'paas'`).
  - `buildDeclarativeCaddySpec()`: reads `readPaasInstanceSettings()` + `CloudApp.query().where({ managed_by: 'paas', is_active: true, active: true })`. Emits `routes` (instance, optional whatsapp, all valid public FQDN PaaS apps / `ingress_routes` — strictly skipping `.local` / non-PaaS fixtures!) + `previewListeners` (ONLY when `publicPortEnabled === true`).
  - `reconcileCaddyWithAgent(params)`: builds spec & posts to `/agent/caddy/reconcile`.
  - `promotePreviewAppsToWildcard(params)`: requires `wildcardDomain` non-empty; for each active `managed_by = 'paas'` app with empty `domain`: assigns `${app.name}.${wildcardDomain}`, clears `host_port = null`, recompiles compose env preserving `existingEnv: app.env_vars` (zero secret rotation!) and calls `upAgentCompose` if `deploy_mode === 'compose'`, updates Postgres, reconciles Caddy.
- **Acceptance Criteria:** Seeded `isp.moonwitness.local` is NEVER emitted in `buildDeclarativeCaddySpec().routes`.
- **Expected Output:** `bun --filter @moonwitness/orm-cloud build` exits `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/src/paas-state.ts packages/orm-cloud/src/index.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(orm-cloud): M22 add declarative caddy spec builder, preview allocator, and wildcard promoter"
  ```

---

## - [x] M23 — Fix RAM MB Casing & Add Stateless `/agent/*` Client Helpers (`moonwitness-mesh.ts`)

- **Owner Files (MODIFY):**
  - `packages/orm-cloud/src/providers/moonwitness-mesh.ts`
  - `packages/orm-cloud/src/index.ts`
- **Depends On:** `M03`
- **Exact Spec:**
  1. In `fetchMeshNodeMetrics`: call `/agent/metrics` (fallback `/paas/metrics` on 404); read `memoryUsedMb ?? memoryUsedMB` and `memoryTotalMb ?? memoryTotalMB`; include `publicIpv4?: string`.
  2. Add typed stateless client functions (`requestMeshJson`): `reconcileAgentCaddy`, `listAgentContainers`, `runAgentContainer`, `upAgentCompose`, `deployAgentGit`, `controlAgentContainer`, `fetchAgentContainerStats`, `verifyAgentDns`, `fetchAgentMeshStatus`.
  3. Export all new functions & types from `packages/orm-cloud/src/index.ts`.
- **Acceptance Criteria:** Existing `packages/orm-cloud/tests/moonwitness-mesh.test.ts` passes 100%; RAM MB parses both camelCase & uppercase `MB`.
- **Expected Output:** `vitest` passes.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build; if ($?) { bunx --cwd packages/orm-cloud vitest run tests/moonwitness-mesh.test.ts }
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/src/providers/moonwitness-mesh.ts packages/orm-cloud/src/index.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(orm-cloud): M23 add stateless /agent/* client helpers and fix RAM MB casing"
  ```

---

## - [x] M24 — Wire Settings, DNS Doctor, & TLS-Gated Apply Routes (`http.ts`)

- **Owner File (MODIFY):** `packages/orm-cloud/src/http.ts`
- **Depends On:** `M22`, `M23`
- **Exact Matrix Rows + Handlers (unique paths!):**
  1. `GET /api/cloud/paas/settings` (`adminOnly: true`, `permission: 'read'`, `feature: 'controlPlane'`) -> `{ success: true, data: { ...settings, routes, previewListeners, hasPreviewApps } }`.
  2. `POST /api/cloud/paas/settings/verify-dns` (`adminOnly: true`, `permission: 'read'`, `feature: 'controlPlane'`) -> proxy to `verifyAgentDns` -> `{ success: true, data }`.
  3. `POST /api/cloud/paas/settings/apply` (`adminOnly: true`, `permission: 'write'`, `feature: 'provisioning'`):
     - If `publicPortEnabled === false`: MUST run `verifyAgentDns({ instanceDomain, checkHttps: true })` first; return `400` if `!httpsReady?.reachable || !httpsReady?.tlsVerified`!
     - Call `savePaasInstanceSettings` (PostgreSQL) -> `reconcileCaddyWithAgent` -> return `200 { success: true, data }`.
- **Acceptance Criteria:** `CLOUD_ROUTE_ACCESS_MATRIX` keeps unique paths; `cloud-auth-ops.test.ts` passes.
- **Expected Output:** `vitest` exits `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build; if ($?) { bunx --cwd packages/orm-cloud vitest run tests/cloud-auth-ops.test.ts }
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/src/http.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(orm-cloud): M24 add postgres-backed paas settings, dns verify, and tls-gated lockdown routes"
  ```

---

## - [x] M25 — Wire `promote-wildcard`, Live `mesh/status`, & `onReady` Boot Reconcile (`http.ts`)

- **Owner File (MODIFY):** `packages/orm-cloud/src/http.ts`
- **Depends On:** `M24`
- **Exact Matrix Rows + Handlers:**
  1. `POST /api/cloud/paas/settings/promote-wildcard` (`adminOnly: true`, `permission: 'write'`, `feature: 'provisioning'`) -> calls `promotePreviewAppsToWildcard(...)` -> `{ success: true, data: { promotedCount, apps } }`.
  2. `GET /api/cloud/paas/mesh/status` (`adminOnly: false`, `permission: 'read'`, `feature: 'controlPlane'`) -> combines `fetchAgentMeshStatus`, `listAgentContainers`, and `buildDeclarativeCaddySpec().routes` into live `MeshTopologySnapshot` (zero mock data!).
  3. `fastify.addHook('onReady', ...)`: if `process.env.NODE_ENV === 'production' && process.env.MW_CONTROL_PLANE_URL`, run non-blocking `void reconcileCaddyWithAgent(...).catch(...)`.
- **Acceptance Criteria:** Zero regressions in `cloud-auth-ops.test.ts`.
- **Expected Output:** `vitest` exits `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build; if ($?) { bunx --cwd packages/orm-cloud vitest run tests/cloud-auth-ops.test.ts }
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/src/http.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(orm-cloud): M25 add promote-wildcard, live mesh status, and boot caddy reconcile"
  ```

---

## - [x] M26 — Wire 390+ Coolify Template Routes (`GET /templates`, `GET /templates/:id`, `POST /templates/deploy`)

- **Owner File (MODIFY):** `packages/orm-cloud/src/http.ts`
- **Depends On:** `M25`
- **Exact Matrix Rows + Handlers:**
  1. Update existing `GET /api/cloud/paas/templates`: query `{ q, category, tag, compatibility, includeOutdated, page, limit }` -> return `{ success: true, data: listCoolifyTemplates(...) }`.
  2. Add `GET /api/cloud/paas/templates/:id` (`permission: 'read'`, `resourceId: true`) -> `404` if missing, else `{ success: true, data: detail }`.
  3. Add `POST /api/cloud/paas/templates/deploy` (`permission: 'write'`):
     - Reject `compatibility === 'restricted'` with `400`.
     - Resolve domain (`body.domain` -> `wildcardDomain` -> else `allocatePreviewPort()`).
     - Compile via `compileCoolifyCompose` (reusing `existingEnv` from Postgres if slug exists!).
     - Call `upAgentCompose` -> upsert PostgreSQL `CloudApp` (`managed_by: 'paas'`, `deploy_mode: 'compose'`) + insert `CloudDeployment` -> `reconcileCaddyWithAgent` -> `201`.
- **Acceptance Criteria:** Restricted template returns `400`; valid template compiles, persists to Postgres, and reconciles Caddy.
- **Expected Output:** `vitest` exits `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build; if ($?) { bunx --cwd packages/orm-cloud vitest run tests/cloud-auth-ops.test.ts }
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/src/http.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(orm-cloud): M26 wire 390+ coolify template catalog and 1-click compose deploy routes"
  ```

---

## - [x] M27 — Refactor `GET /apps` & Add `GET /apps/:slug` (PostgreSQL + Live Agent Merge)

- **Owner File (MODIFY):** `packages/orm-cloud/src/http.ts`
- **Depends On:** `M26`
- **Exact Matrix Row + Handlers:**
  1. Refactor `GET /api/cloud/paas/apps`: query PostgreSQL `CloudApp` (`company_id: ctx.companyId, managed_by: 'paas', is_active: true, active: true`) + merge live container states from `listAgentContainers` (never leak `env_vars` secrets or `webhook_secret`).
  2. Add `GET /api/cloud/paas/apps/:slug` (`permission: 'read'`, `resourceId: true`): return `404` if not found for company; return redacted `env` (`redactSecrets`), live container state, `ingressRoutes`, `deployMode`, `templateId`, and latest 20 `CloudDeployment` rows from PostgreSQL.
- **Acceptance Criteria:** Strictly scoped by `company_id`; secrets always redacted.
- **Expected Output:** `vitest` exits `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build; if ($?) { bunx --cwd packages/orm-cloud vitest run tests/cloud-auth-ops.test.ts }
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/src/http.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(orm-cloud): M27 back paas apps list and detail with postgresql and live agent states"
  ```

---

## - [ ] M28 — Refactor `POST /apps/deploy` & Add `POST /apps/deploy-compose`

- **Owner File (MODIFY):** `packages/orm-cloud/src/http.ts`
- **Depends On:** `M27`
- **Exact Matrix Row + Handlers:**
  1. Refactor `POST /api/cloud/paas/apps/deploy`: resolve domain/previewPort -> `runAgentContainer` -> upsert Postgres `CloudApp` (`managed_by: 'paas', deploy_mode: 'image'`) + `CloudDeployment` -> `reconcileCaddyWithAgent` -> `201`.
  2. Add `POST /api/cloud/paas/apps/deploy-compose` (`permission: 'write'`): compile custom `composeSpec` via `compileCoolifyCompose` -> `upAgentCompose` -> upsert Postgres `CloudApp` (`managed_by: 'paas', deploy_mode: 'compose'`) + `CloudDeployment` -> `reconcileCaddyWithAgent` -> `201`.
- **Acceptance Criteria:** Zero writes to control-plane DB; all metadata stored in PostgreSQL `cloud_apps` & `cloud_deployments`.
- **Expected Output:** `vitest` exits `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build; if ($?) { bunx --cwd packages/orm-cloud vitest run tests/cloud-auth-ops.test.ts }
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/src/http.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(orm-cloud): M28 back image and custom compose deploys with postgresql and stateless agent"
  ```

---

## - [ ] M29 — Add `POST /apps/deploy-git` & `POST /webhooks/github/:slug`

- **Owner File (MODIFY):** `packages/orm-cloud/src/http.ts`
- **Depends On:** `M28`
- **Exact Matrix Rows + Handlers:**
  1. `POST /api/cloud/paas/apps/deploy-git` (`permission: 'write'`): validate HTTPS `gitRepo`, generate `webhook_secret` (`randomBytes(24).toString('hex')`) if new -> `deployAgentGit` -> upsert Postgres `CloudApp` (`deploy_mode: 'git', git_repo, git_branch, dockerfile_path, webhook_secret`) + `CloudDeployment` -> `reconcileCaddyWithAgent` -> return `201` (return `webhookUrl` & `webhookSecret` ONLY on initial creation!).
  2. `POST /api/cloud/paas/webhooks/github/:slug` (`permission: 'write'`, `resourceId: true` in matrix; handler verifies `X-Hub-Signature-256` HMAC-SHA256 via `timingSafeEqual` against Postgres `CloudApp.webhook_secret`, returning `401` on invalid/missing signature!) -> triggers `deployAgentGit` & records `CloudDeployment`.
- **Acceptance Criteria:** Webhook rejects missing/wrong signature with `401`; never leaks `webhook_secret` in responses/logs.
- **Expected Output:** `vitest` exits `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build; if ($?) { bunx --cwd packages/orm-cloud vitest run tests/cloud-auth-ops.test.ts }
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/src/http.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(orm-cloud): M29 add git auto-deploy and github hmac webhook routes"
  ```

---

## - [ ] M30 — Refactor App Lifecycle `:action`, Live `stats`, & `logs/stream` to Stateless Agent

- **Owner File (MODIFY):** `packages/orm-cloud/src/http.ts`
- **Depends On:** `M29`
- **Exact Matrix Row + Handlers:**
  1. Refactor `POST /api/cloud/paas/apps/:slug/:action`: scope check Postgres `CloudApp` (`404` if missing); `redeploy` re-runs stored compose/git/image spec; `delete` calls `controlAgentContainer(..., 'delete')`, deactivates Postgres `CloudApp` (`is_active: false, active: false, domain: null, host_port: null`), logs `CloudDeployment`, calls `reconcileCaddyWithAgent`.
  2. Add `GET /api/cloud/paas/apps/:slug/stats` (`permission: 'read'`, `resourceId: true`) -> calls `fetchAgentContainerStats`.
  3. Update `GET /api/cloud/paas/apps/:slug/logs/stream` to proxy `/agent/containers/${slug}/logs/stream`.
- **Acceptance Criteria:** Deleting an app removes its Caddy route immediately and cleans Postgres state.
- **Expected Output:** `vitest` exits `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build; if ($?) { bunx --cwd packages/orm-cloud vitest run tests/cloud-auth-ops.test.ts }
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/src/http.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(orm-cloud): M30 wire app lifecycle, stats, and sse logs to stateless agent"
  ```

---

## - [ ] M31 — Add `POST /apps/:slug/env` & `POST /apps/:slug/domain`

- **Owner File (MODIFY):** `packages/orm-cloud/src/http.ts`
- **Depends On:** `M30`
- **Exact Matrix Rows + Handlers:**
  1. `POST /api/cloud/paas/apps/:slug/env` (`permission: 'write'`, `resourceId: true`):
     - Body `{ env: Record<string, string>, merge?: boolean, redeploy?: boolean }`.
     - **CRITICAL:** Never overwrite an existing secret in PostgreSQL `CloudApp.env_vars` if incoming value is `"[REDACTED]"`!
     - Save merged `env_vars` to PostgreSQL -> if `redeploy !== false`, trigger compose/container redeploy on stateless agent -> return redacted env.
  2. `POST /api/cloud/paas/apps/:slug/domain` (`permission: 'write'`, `resourceId: true`):
     - Body `{ domain: string }`. Validate `isValidPublicDomain` (or `""` to detach), check collision with instance/whatsapp/other apps, patch Postgres `CloudApp.domain` (clear `host_port` if domain set), recompile & `upAgentCompose` if compose app (preserving secrets!), call `reconcileCaddyWithAgent`.
- **Acceptance Criteria:** Secret redaction placeholder never corrupts stored secrets; domain update live-reloads Caddy.
- **Expected Output:** `vitest` exits `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud build; if ($?) { bunx --cwd packages/orm-cloud vitest run tests/cloud-auth-ops.test.ts }
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/src/http.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(orm-cloud): M31 add postgres env vault and domain update routes"
  ```

---

## - [ ] M32 — Add Transactional `claimSuperadminSetup()` in `packages/auth`

- **Owner Files (MODIFY):**
  - `packages/auth/src/service.ts`
  - `packages/auth/src/index.ts` (export `SetupClaimInput`)
- **Depends On:** `M03`
- **Exact Spec:**
  - Validate `password.length` in `MIN_PASSWORD_LENGTH..MAX_PASSWORD_LENGTH` (`RangeError` otherwise).
  - Inside `User.transaction(async (trx) => { ... })`:
    1. Check `trx('base_config_parameters').where({ key: 'instance.setup_completed', active: true }).whereNull('company_id').first()`. If `row?.value === 'true'`, throw `new ConflictError('Instance has already been initialized')`.
    2. Lookup `_orm_data` `{ id: 'base.user_superadmin', model: 'base.user' }` -> fetch `superadmin = await User.query(trx).findById(identity.record_id)`.
    3. Verify no OTHER user (`id !== superadmin.id`) uses `input.login` (else `ConflictError`).
    4. **CRITICAL DO-NOT-DOUBLE-HASH WARNING:** Pass raw `input.password` to `User.query(trx).findById(superadmin.id).patch({ login: input.login, password: input.password, token_version: (superadmin.token_version ?? 1) + 1 })` — the `User` ORM model hashes `password` automatically (same as `changePassword` on line 211)!
    5. Delete old `RefreshToken` rows for `superadmin.id`.
    6. Patch `Partner` (`superadmin.partner_id`) with `name`/`email` if provided.
    7. Upsert global `base_config_parameters` row `{ key: 'instance.setup_completed', value_type: 'boolean', value: 'true', is_secret: false, company_id: null, active: true }`.
  - Issue and return fresh `AuthSession`.
- **Acceptance Criteria:** Existing `@moonwitness/auth` tests pass; second claim throws `ConflictError`.
- **Expected Output:** `vitest` exits `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/auth build; if ($?) { bun --filter @moonwitness/auth test }
  ```
- **Commit:**
  ```powershell
  git commit --only packages/auth/src/service.ts packages/auth/src/index.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(auth): M32 add transactional claimSuperadminSetup for first-boot onboarding"
  ```

---

## - [ ] M33 — Add `GET /auth/setup-status` & `POST /auth/setup-claim` in `apps/api/src/routes/auth.routes.ts`

- **Owner File (MODIFY):** `apps/api/src/routes/auth.routes.ts`
- **Depends On:** `M32`
- **Exact Spec:**
  1. `GET /auth/setup-status` (rate limit `max: loginRateMax * 3, timeWindow: '1 minute'`):
     - If `!process.env.MW_SETUP_TOKEN?.trim()` -> return `200 { success: true, data: { setupRequired: false } }` (`Cache-Control: no-store`).
     - Else check `base_config_parameters` `key = 'instance.setup_completed', company_id IS NULL, active = true`: `setupRequired = row?.value !== 'true'`.
  2. `POST /auth/setup-claim` (rate limit `max: loginRateMax, timeWindow: '1 minute'`):
     - Strict schema `{ setup_token, login, password, name?, email? }`, `additionalProperties: false`.
     - Constant-time compare `createHash('sha256').update(req.body.setup_token).digest()` vs `createHash('sha256').update(expectedToken).digest()` via `timingSafeEqual`. If missing env or mismatch -> `401 { success: false, error: 'Invalid setup token' }`.
     - Call `authService.claimSuperadminSetup(...)`, `invalidateAuthCache(session.userId)` -> `201` with `tokenResponse(session)` (`Cache-Control: no-store`). Catch `ConflictError` -> `409`, `RangeError` -> `400`.
- **Acceptance Criteria:** Passes `bun run api:addon:check`; fails closed when `MW_SETUP_TOKEN` is unset.
- **Expected Output:** Build & addon boundary check exit `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/api build; if ($?) { bun run api:addon:check }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/api/src/routes/auth.routes.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(api): M33 add /auth/setup-status and constant-time /auth/setup-claim routes"
  ```

---

## - [ ] M34 — Make `strict-transport-security` HTTPS-Conditional in `apps/api/src/app.ts`

- **Owner File (MODIFY):** `apps/api/src/app.ts` (lines 204–206)
- **Depends On:** `M03`
- **Exact Spec:** Emit `strict-transport-security` ONLY when `config.env === 'production' && (request.protocol === 'https' || firstForwardedProto === 'https')`.
- **Acceptance Criteria:** Plain HTTP responses on `:8000` emit NO HSTS header; HTTPS responses emit `max-age=31536000; includeSubDomains`.
- **Expected Output:** `bun --filter @moonwitness/api build` exits `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/api build
  ```
- **Commit:**
  ```powershell
  git commit --only apps/api/src/app.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "fix(api): M34 emit HSTS header only on HTTPS requests"
  ```

---

## - [ ] M35 — Add `getSetupStatus()` & `claimSetup()` to `MoonWitnessClient`

- **Owner Files (MODIFY):**
  - `packages/client/src/types.ts` (export `SetupStatus { setupRequired: boolean }` & `SetupClaimParams { setup_token: string; login: string; password: string; name?: string; email?: string }`)
  - `packages/client/src/client.ts` (add `getSetupStatus()` & `claimSetup(params)` calling `this.authenticate('/auth/setup-claim', params)`)
- **Depends On:** `M33`
- **Acceptance Criteria:** Calling `client.claimSetup(...)` persists tokens via `CookieTokenStorage` and fires `onSessionChange` listeners.
- **Expected Output:** `@moonwitness/client` build & tests pass.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/client build; if ($?) { bun --filter @moonwitness/client test }
  ```
- **Commit:**
  ```powershell
  git commit --only packages/client/src/types.ts packages/client/src/client.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "feat(client): M35 add getSetupStatus and claimSetup SDK methods"
  ```

---

## - [ ] M36 — Write `packages/orm-cloud/tests/coolify-template-pack.test.ts` (Validates ALL 390+ Templates)

- **Owner File (CREATE):** `packages/orm-cloud/tests/coolify-template-pack.test.ts`
- **Depends On:** `M20`
- **Required Assertions:**
  1. `listCoolifyTemplates().total >= 350` with zero unhandled parse errors across the entire pack.
  2. `compileCoolifyCompose` succeeds for `n8n`, `uptime-kuma`, `activepieces`, `ghost`, `affine` (`exclude_from_hc` removed), `alexandrie` (multiple ingress routes), and `appflowy` (`./nginx/nginx.conf` extracted into `files`).
  3. `anythingllm` is classified `'restricted'` and rejected by `compileCoolifyCompose`.
  4. Secret idempotency: compiling `activepieces` twice with `existingEnv` from run #1 produces identical `SERVICE_PASSWORD_POSTGRES` & `SERVICE_USER_POSTGRES`.
  5. Path-traversal inline file (`../escape`) rejected.
- **Expected Output:** 100% tests pass.
- **Verify:**
  ```powershell
  bunx --cwd packages/orm-cloud vitest run tests/coolify-template-pack.test.ts
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/tests/coolify-template-pack.test.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "test(orm-cloud): M36 validate all 390+ coolify templates and compose compiler"
  ```

---

## - [ ] M37 — Expand `packages/orm-cloud/tests/cloud-auth-ops.test.ts` for Postgres PaaS & Stateless Agent

- **Owner File (MODIFY):** `packages/orm-cloud/tests/cloud-auth-ops.test.ts`
- **Depends On:** `M31`
- **Required Assertions:**
  - `GET/POST /api/cloud/paas/settings*`: persists to `base_config_parameters`, rejects `:8000` lockdown when `checkHttps` fails, accepts when `checkHttps` passes, never leaks seeded `isp.moonwitness.local` into Caddy routes.
  - `POST /templates/deploy` allocates preview port `8001` in IP mode and `promote-wildcard` switches to `<slug>.<wildcard>` preserving secrets.
  - `POST /apps/:slug/env` preserves existing secrets when `[REDACTED]` sent; `GET /metrics` parses `memoryUsedMB`/`memoryTotalMB`; `GET /mesh/status` returns live routes.
- **Expected Output:** All `@moonwitness/orm-cloud` tests pass (`fail 0`).
- **Verify:**
  ```powershell
  bun --filter @moonwitness/orm-cloud test
  ```
- **Commit:**
  ```powershell
  git commit --only packages/orm-cloud/tests/cloud-auth-ops.test.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "test(orm-cloud): M37 cover postgres paas settings, templates, env vault, and tls lockdown"
  ```

---

## - [ ] M38 — Write `apps/api/tests/auth-setup-claim.test.ts` & Run Full Wave 2 Gate

- **Owner File (CREATE):** `apps/api/tests/auth-setup-claim.test.ts`
- **Depends On:** `M33`, `M34`, `M35`, `M36`, `M37`
- **Required Assertions:**
  - Without `MW_SETUP_TOKEN`: `setupRequired === false`.
  - With `MW_SETUP_TOKEN`: `setupRequired === true`; wrong token -> `401`; valid claim -> `201` + can login with new superadmin login & password; replay -> `409`; `setupRequired` now `false`.
  - Conditional HSTS: plain HTTP has no `strict-transport-security`; `x-forwarded-proto: https` includes it.
- **Expected Output:** All Wave 2 packages + API tests + `api:addon:check` exit `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/auth test; if ($?) { bun --filter @moonwitness/client test }; if ($?) { bun --filter @moonwitness/orm-cloud test }; if ($?) { bunx --cwd apps/api vitest run tests/auth-setup-claim.test.ts }; if ($?) { bun run api:addon:check }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/api/tests/auth-setup-claim.test.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-2-postgres-and-coolify-pack.md -m "test(api): M38 add setup-claim lifecycle and conditional HSTS tests"
  ```
