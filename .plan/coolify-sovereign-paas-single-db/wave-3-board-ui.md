# Wave 3 — Board Onboarding & Coolify-Grade PaaS Studio (`M39`–`M51`)

**ADR Reference:** `.plan/coolify-sovereign-paas-single-db/ADR-001-sovereign-paas-single-db.md` (Decisions 5, 6, 7)
**Depends On:** `M31`, `M35`
**Confirmed `@moonwitness/ui` Exports Available:** `button`, `input`, `textarea`, `label`, `badge`, `panel`, `tabs`, `select-field`, `select`, `switch`, `skeleton`, `empty-state`, `error-state`, `metric-tile`, `log-console`, `table`, `pagination`, `dialog`, `sheet`, `toast`, `@moonwitness/ui/icons`.
**HARD RULE:** NEVER use raw `<input>`, `<select>`, `<button>`, `<textarea>`, or `<svg>`; NEVER import `paas-template-pack-coolify` JSON into `apps/board`!

---

## - [x] M39 — Fix Dynamic HTTP/HTTPS Cookie `secure` Flag in `/api/session`

- **Owner File (MODIFY):** `apps/board/src/app/api/session/route.ts` (lines 26–34)
- **Depends On:** `M03`
- **Exact Spec:**
  ```ts
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  let urlIsHttps = false;
  try {
    urlIsHttps = new URL(request.url).protocol === 'https:';
  } catch {
    urlIsHttps = false;
  }
  const isHttps = forwardedProto === 'https' || urlIsHttps;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  ```
- **Acceptance Criteria:** Plain HTTP request sets `HttpOnly; SameSite=Lax` WITHOUT `Secure`; HTTPS request includes `Secure`.
- **Expected Output:** `board typecheck` exits `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/board typecheck
  ```
- **Commit:**
  ```powershell
  git commit --only apps/board/src/app/api/session/route.ts .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-3-board-ui.md -m "fix(board): M39 derive session cookie secure flag dynamically from request protocol"
  ```

---

## - [x] M40 — Create `apps/board/src/board-pages/setup-page.tsx` — Step 1 (Claim Root Superadmin)

- **Owner File (CREATE):** `apps/board/src/board-pages/setup-page.tsx`
- **Depends On:** `M35`, `M39`
- **Exact Spec:**
  - `'use client';`
  - Uses ONLY `@moonwitness/ui/components/{panel,button,input,label,badge,error-state,skeleton}` + `@moonwitness/ui/icons`.
  - On mount: call `client.getSetupStatus()`. If `!setupRequired && step === 1`, `router.replace('/login')`.
  - Step 1 Form: `setup_token`, `login` (default `"superadmin"`), `name`, `email`, `password`, `confirm_password`.
  - Validates `password === confirm_password` client-side, calls `await client.claimSetup(...)`, sets `step = 2` on success.
- **Acceptance Criteria:** Zero raw HTML controls; typecheck & `board:ui:check` pass.
- **Expected Output:** Both commands exit `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/board typecheck; if ($?) { bun run board:ui:check }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/board/src/board-pages/setup-page.tsx .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-3-board-ui.md -m "feat(board): M40 create first-boot setup-page step 1 superadmin claim"
  ```

---

## - [x] M41 — Complete `setup-page.tsx` Step 2 (3 Domain Modes) + Route `apps/board/src/app/setup/page.tsx`

- **Owner Files:**
  - `apps/board/src/board-pages/setup-page.tsx` (MODIFY — implement Step 2)
  - `apps/board/src/app/setup/page.tsx` (CREATE — mirror `apps/board/src/app/login/page.tsx` with `Suspense` + `BoardProviders` + `SetupPage`)
- **Depends On:** `M40`
- **Exact Spec (Step 2):**
  - Fetch `GET /api/cloud/paas/settings` using `client.request` to read `publicIpv4`.
  - Present 3 explicit options:
    1. **Skip — Continue on `http://<publicIpv4>:8000`** (`router.replace('/board/cloud')`)
    2. **1-Click Instant Free Wildcard (`<ip-dashed>.sslip.io`)** (prefills `instanceDomain` & `wildcardDomain`)
    3. **Custom Domain** (`instanceDomain`, `wildcardDomain`, optional `whatsappDomain`) + **Verify DNS** (`POST /api/cloud/paas/settings/verify-dns`) + **Save & Enable HTTPS** (`POST /api/cloud/paas/settings/apply`) -> shows clickable `https://<instanceDomain>/board/cloud`.
- **Acceptance Criteria:** Route `/setup` compiles cleanly; `board:ui:check` reports 0 findings.
- **Expected Output:** Both commands exit `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/board typecheck; if ($?) { bun run board:ui:check }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/board/src/board-pages/setup-page.tsx apps/board/src/app/setup/page.tsx .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-3-board-ui.md -m "feat(board): M41 add /setup route and step 2 domain mode onboarding"
  ```

---

## - [x] M42 — Add First-Boot `/setup` Banner to `auth-page.tsx`

- **Owner File (MODIFY):** `apps/board/src/board-pages/auth-page.tsx`
- **Depends On:** `M41`
- **Exact Spec:**
  - When `isLogin === true`, call `client.getSetupStatus()` in `useEffect` (swallow errors silently).
  - When `setupRequired === true`, show a compact notice above `<form id="auth-form">` with `<Button asChild variant="outline" size="sm"><Link href="/setup">Complete First-Boot Server Setup</Link></Button>`.
- **Acceptance Criteria:** Normal login untouched when `setupRequired === false`; `board:ui:check` passes.
- **Expected Output:** Both commands exit `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/board typecheck; if ($?) { bun run board:ui:check }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/board/src/board-pages/auth-page.tsx .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-3-board-ui.md -m "feat(board): M42 show first-boot /setup banner on login when instance unclaimed"
  ```

---

## - [x] M43 — Create `InstanceDomainsPanel` (Modes, `sslip.io`, DNS Doctor, Save & Reload, Promote Preview)

- **Owner File (CREATE):** `apps/board/src/components/cloud/instance-domains-panel.tsx`
- **Depends On:** `M25`
- **Exact Spec:**
  - Props: `{ apiBase: string; fetchFn: (input: string, init?: RequestInit) => Promise<Response>; onSettingsApplied?: () => void | Promise<void> }`.
  - Load `GET ${apiBase}/settings` on mount.
  - Render:
    1. Access Mode `Badge` (`IP Bootstrap :8000` | `Dual HTTP+HTTPS` | `HTTPS Hardened`) + `publicIpv4` `Badge` + button **"Use Instant Free Wildcard (`<ip-dashed>.sslip.io`)"**.
    2. Inputs (`Input` + `Label`): `Instance Domain`, `Wildcard Domain`, `WhatsApp Standalone Domain (Optional)`.
    3. Dynamic DNS `A` record guide table (explicitly noting Cloudflare grey-cloud / DNS-only recommendation for direct Let's Encrypt TLS).
    4. Buttons: **Verify DNS** (`POST ${apiBase}/settings/verify-dns` -> per-domain `Matched` / `Different IP (Proxied?)` / `Unresolved` badges + resolved IPs), **Save & Reload Proxy** (`POST ${apiBase}/settings/apply`), and **Promote IP-Preview Apps to Wildcard HTTPS** (`POST ${apiBase}/settings/promote-wildcard`, visible when `wildcardDomain` set & `hasPreviewApps`).
    5. Active Caddy routes & preview listeners list.
- **Acceptance Criteria:** Zero raw controls; typecheck & `board:ui:check` pass.
- **Expected Output:** Both commands exit `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/board typecheck; if ($?) { bun run board:ui:check }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/board/src/components/cloud/instance-domains-panel.tsx .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-3-board-ui.md -m "feat(board): M43 create InstanceDomainsPanel with sslip.io, dns doctor, and wildcard promote"
  ```

---

## - [x] M44 — Add TLS-Gated Port `8000` Lockdown Card + `/board/settings` Admin Shortcut

- **Owner Files (MODIFY):**
  - `apps/board/src/components/cloud/instance-domains-panel.tsx`
  - `apps/board/src/board-pages/settings-page.tsx`
- **Depends On:** `M43`
- **Exact Spec:**
  1. In `instance-domains-panel.tsx`: add **Port 8000 HTTPS-Only Hardening** `Panel` with **Test HTTPS Reachability** (`POST ${apiBase}/settings/verify-dns` `{ instanceDomain, checkHttps: true }`), **Lock Down Port 8000** button (disabled until saved `instanceDomain` AND `httpsReady.reachable && httpsReady.tlsVerified === true`!) opening `ConfirmDialog` citing SSH recovery `bash /opt/moonwitness-xv/deploy/vps/install.sh --unlock-port`, plus **Re-enable Port 8000** when currently locked.
  2. In `settings-page.tsx`: for `isAdmin && !isDesktop`, add a compact `Panel` ("Server Instance & Domains") with `<Button asChild variant="outline" size="sm"><Link href="/board/cloud">Manage Instance & Domains</Link></Button>`.
- **Acceptance Criteria:** Lockdown button stays disabled until strict TLS passes; `board:ui:check` passes.
- **Expected Output:** Both commands exit `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/board typecheck; if ($?) { bun run board:ui:check }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/board/src/components/cloud/instance-domains-panel.tsx apps/board/src/board-pages/settings-page.tsx .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-3-board-ui.md -m "feat(board): M44 add tls-gated port 8000 lockdown and settings shortcut"
  ```

---

## - [x] M45 — Upgrade `PaasTemplateCatalog` to Paginated Server-Side 390+ Marketplace

- **Owner File (MODIFY):** `apps/board/src/components/cloud/paas-template-catalog.tsx`
- **Depends On:** `M26`
- **Exact Spec:**
  - Add optional props `apiBase`, `fetchFn`, `wildcardDomain`, `publicIpv4`, `onStackDeployed` (keep desktop fallback intact when `!apiBase?.startsWith('/api/cloud/')`).
  - In cloud mode: query `GET ${apiBase}/templates?q=&category=&page=&limit=24` (250ms debounced search).
  - Render total template count badge, search `Input`, category filter `Button` pills, compatibility `Badge` (`Ready` | `Inline Config` | `Restricted`), service count badge, docs link, and Previous/Next pagination controls.
  - Disable deploy button when `compatibility === 'restricted'`.
- **Acceptance Criteria:** Zero JSON bundled in Board; `board:ui:check` passes.
- **Expected Output:** Both commands exit `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/board typecheck; if ($?) { bun run board:ui:check }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/board/src/components/cloud/paas-template-catalog.tsx .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-3-board-ui.md -m "feat(board): M45 upgrade PaasTemplateCatalog to server-side paginated 390+ marketplace"
  ```

---

## - [ ] M46 — Add Configure & Deploy Panel to `PaasTemplateCatalog`

- **Owner File (MODIFY):** `apps/board/src/components/cloud/paas-template-catalog.tsx`
- **Depends On:** `M45`
- **Exact Spec:**
  - Clicking **Configure & Deploy** on a cloud template fetches `GET ${apiBase}/templates/${id}` and opens an inline configuration `Panel`:
    - `App Slug` (`Input`, default sanitized `id`), `Custom Domain (optional)` (`Input` showing auto `<slug>.<wildcardDomain>` or preview `:8001–8010`), editable non-secret env fields (`editableEnv`), read-only badges for auto-generated persistent secrets (`magicSecrets`), and **Deploy Stack** button calling `POST ${apiBase}/templates/deploy`.
    - On `201`: show live deployed URL and invoke `onStackDeployed?.()`.
- **Acceptance Criteria:** Full 1-click template deploy flow wired end-to-end; `board:ui:check` passes.
- **Expected Output:** Both commands exit `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/board typecheck; if ($?) { bun run board:ui:check }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/board/src/components/cloud/paas-template-catalog.tsx .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-3-board-ui.md -m "feat(board): M46 add configure-and-deploy panel for coolify templates"
  ```

---

## - [ ] M47 — Create Per-App Management Drawer (`PaasAppDrawer`)

- **Owner File (CREATE):** `apps/board/src/components/cloud/paas-app-drawer.tsx`
- **Depends On:** `M31`
- **Exact Spec:**
  - Props: `{ slug: string; apiBase: string; fetchFn: (input: string, init?: RequestInit) => Promise<Response>; onClose: () => void; onUpdated: () => void | Promise<void> }`.
  - 4 `Tabs` inside `Panel`:
    1. **Overview & Stats:** `GET ${apiBase}/apps/${slug}` + `GET ${apiBase}/apps/${slug}/stats` -> `MetricTile` for CPU, Memory, Net I/O, PIDs + clickable URL + deploy mode badge.
    2. **Env Vault:** Editable key-value list (preserving `[REDACTED]` untouched), add/remove key, **Save & Redeploy** -> `POST ${apiBase}/apps/${slug}/env`.
    3. **Domain:** Input new domain (or blank) -> **Update Domain** -> `POST ${apiBase}/apps/${slug}/domain`.
    4. **History & Logs:** PostgreSQL `deployments` list + `LogConsole` streaming `GET ${apiBase}/apps/${slug}/logs/stream`.
- **Acceptance Criteria:** Uses ONLY `@moonwitness/ui` primitives; `board:ui:check` passes.
- **Expected Output:** Both commands exit `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/board typecheck; if ($?) { bun run board:ui:check }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/board/src/components/cloud/paas-app-drawer.tsx .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-3-board-ui.md -m "feat(board): M47 create per-app PaasAppDrawer with stats, env vault, domain, and logs"
  ```

---

## - [ ] M48 — Remove Hardcoded `a-l-l-a-h.com` Mock Data from `MeshTopologyPanel`

- **Owner File (MODIFY):** `apps/board/src/components/cloud/mesh-topology-panel.tsx`
- **Depends On:** `M25`
- **Exact Spec:**
  - Add optional prop `fetchFn?: (input: string, init?: RequestInit) => Promise<Response>`.
  - Delete `OFFLINE_FALLBACK_SNAPSHOT` (zero occurrences of `a-l-l-a-h.com`!).
  - Fetch `(fetchFn ?? fetch)('${normalizedBase}/mesh/status', { cache: 'no-store' })`, unwrap `{ success: true, data }` (or raw desktop JSON), show `Skeleton` while loading and `EmptyState`/`ErrorState` when offline.
- **Acceptance Criteria:** `grep -i "a-l-l-a-h" apps/board/src/components/cloud/mesh-topology-panel.tsx` returns empty; `board:ui:check` passes.
- **Expected Output:** Both commands exit `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/board typecheck; if ($?) { bun run board:ui:check }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/board/src/components/cloud/mesh-topology-panel.tsx .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-3-board-ui.md -m "fix(board): M48 wire MeshTopologyPanel to live /mesh/status and remove mock fallback"
  ```

---

## - [ ] M49 — Wire `InstanceDomainsPanel`, `PaasAppDrawer`, `PaasTemplateCatalog`, & `MeshTopologyPanel` in `PaasStudioPanel`

- **Owner File (MODIFY):** `apps/board/src/components/cloud/paas-studio-panel.tsx`
- **Depends On:** `M44`, `M46`, `M47`, `M48`
- **Exact Spec:**
  - Fetch `GET ${normalizedBase}/settings` during `refreshState` when `isCloudApi` to populate `wildcardDomain`, `publicIpv4`, `instanceDomain`, `accessMode`.
  - Add **`Instance & Domains`** as the default tab in `Live PaaS Operations Suite` when `isCloudApi`.
  - Pass `fetchFn={paasFetch}` to `InstanceDomainsPanel`, `MeshTopologyPanel`, `PaasTemplateCatalog` (plus `apiBase={normalizedBase}`, `wildcardDomain`, `publicIpv4`, `onStackDeployed={refreshState}`).
  - Add **Manage** button on every deployed app card setting `managedSlug` -> renders `<PaasAppDrawer />`.
- **Acceptance Criteria:** Typecheck & `board:ui:check` pass.
- **Expected Output:** Both commands exit `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/board typecheck; if ($?) { bun run board:ui:check }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/board/src/components/cloud/paas-studio-panel.tsx .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-3-board-ui.md -m "feat(board): M49 integrate InstanceDomainsPanel, 390+ catalog, live mesh, and app drawer"
  ```

---

## - [ ] M50 — Add 3-Tab Deploy Panel (`Docker Image` | `Git Repository` | `Docker Compose`) in `PaasStudioPanel`

- **Owner File (MODIFY):** `apps/board/src/components/cloud/paas-studio-panel.tsx`
- **Depends On:** `M49`
- **Exact Spec:**
  - Wrap the Deploy Container App `Panel` in `Tabs` (`image` | `git` | `compose`):
    1. `Docker Image`: existing form with dynamic domain placeholder (`auto: <slug>.<wildcardDomain>` or `blank = IP preview :8001-8010`).
    2. `Git Repository`: `slug`, `gitRepo` (`https://github.com/...`), `branch` (`main`), `dockerfilePath` (`Dockerfile`), `port`, `domain` -> submits `POST ${normalizedBase}/apps/deploy-git` and displays returned GitHub webhook URL + one-time `webhookSecret`.
    3. `Docker Compose`: `slug`, `domain`, and `@moonwitness/ui/components/textarea` (`Textarea`) for YAML -> submits `POST ${normalizedBase}/apps/deploy-compose`.
- **Acceptance Criteria:** Zero raw `<textarea>` or `<input>`; `board:ui:check` passes.
- **Expected Output:** Both commands exit `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/board typecheck; if ($?) { bun run board:ui:check }
  ```
- **Commit:**
  ```powershell
  git commit --only apps/board/src/components/cloud/paas-studio-panel.tsx .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-3-board-ui.md -m "feat(board): M50 add Git Repository and Docker Compose deploy tabs to PaasStudioPanel"
  ```

---

## - [ ] M51 — Run Full Board Gate (`typecheck`, `ui:check`, `build`, `board:budget`)

- **Depends On:** `M50`
- **Acceptance Criteria:**
  - `bun --filter @moonwitness/board typecheck` exits `0`.
  - `bun run ui:check` reports **0 findings** across all design & shared-UI rules.
  - `bun --filter @moonwitness/board build` exits `0`.
  - `bun run board:budget` passes ALL route budgets (`homepage`, `board`, `login`, `model`, `audio`).
- **Expected Output:** All 4 commands exit `0`.
- **Verify:**
  ```powershell
  bun --filter @moonwitness/board typecheck; if ($?) { bun run ui:check }; if ($?) { bun --filter @moonwitness/board build }; if ($?) { bun run board:budget }
  ```
- **Commit (plan tracker update):**
  ```powershell
  git commit --only .plan/coolify-sovereign-paas-single-db.md .plan/coolify-sovereign-paas-single-db/wave-3-board-ui.md -m "chore(plan): M51 verify all board typecheck, ui, build, and budget gates"
  ```
