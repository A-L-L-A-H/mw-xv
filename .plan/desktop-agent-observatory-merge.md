# Plan: Merge Multi-Agent Observatory into `apps/desktop` (Retire `tools/agent-observatory`)

- **Plan ID:** `desktop-agent-observatory-merge`
- **ADR:** `.plan/desktop-agent-observatory-merge/ADR-002-desktop-observatory-consolidation.md`
- **Total Micro-Tasks:** `16` (`D01`–`D16`) — 100% autonomous, zero overlap, Flash-ready
- **Target Branch:** `dev`
- **End State:** Multi-agent real-time Observatory runs natively inside `apps/desktop` (both Tauri window `/board/desktop/observatory` and `moonwitness-desktop serve --serve-web`), all Desktop + UI + non-overlap gates pass, and `tools/agent-observatory/` is completely deleted from the repository.

---

## 1. Autonomous Execution Protocol

1. Pick the first unchecked `- [ ] Dxx`, confirm all `Depends On` tasks are `[x]`.
2. Edit ONLY files in `Owner File(s)` for `Dxx`. Follow `Exact Spec` strictly.
3. Run `Verify` and satisfy every `Acceptance Criteria` and `Expected Output`.
4. Mark `- [x] Dxx` in this file and commit atomically:
   ```powershell
   git commit --only <Dxx-owner-files> .plan/desktop-agent-observatory-merge.md -m "<type>(desktop): Dxx <short-title>"
   ```
   (If pre-commit `eslint --fix` modifies a staged file, re-run the exact same `git commit --only ...` command once.)
5. Windows PowerShell ONLY: chain with `; if ($?) { ... }`, NEVER `&&`. NEVER run `git add -A`.

---

## 2. Disjoint File Ownership DAG

| Wave | Tasks | Exclusive File Ownership | Depends On |
|---|---|---|---|
| **Wave 1 — Backend Collectors** | `D01`–`D06` | `apps/desktop/src/observatory/**`, `apps/desktop/src/index.ts` | None |
| **Wave 2 — Sidecar API & CLI** | `D07`–`D09` | `apps/desktop/src/local-api-server.ts`, `apps/desktop/src/cli.ts`, `package.json` | `D06` |
| **Wave 3 — Desktop React UI** | `D10`–`D13` | `apps/desktop/desktop-web/observatory/**`, `apps/desktop/desktop-web/main.tsx`, `apps/desktop/desktop-web/desktop.css`, `apps/board/src/components/layout/app-shell.tsx` | `D08` |
| **Wave 4 — Tests, Cutover & Cleanup** | `D14`–`D16` | `apps/desktop/tests/observatory.test.ts`, `apps/desktop/tests/local-api-server.test.ts`, `apps/desktop/desktop-web/tests/routes.spec.ts`, removal of `tools/agent-observatory/**` | `D09`, `D13` |

---

## 3. Micro-Task Breakdown (`D01`–`D16`)

### Wave 1 — Typed Observatory Collectors (`apps/desktop/src/observatory/`)

#### - [x] D01 — Define Observatory TypeScript contracts & shared bounded file/redaction helpers
- **Owner File(s):** `apps/desktop/src/observatory/types.ts`, `apps/desktop/src/observatory/io.ts`
- **Depends On:** None
- **Exact Spec:**
  - Create `types.ts` exporting readonly interfaces: `ObservatoryRuntime` (`'antigravity' | 'claude' | 'codex' | 'qoder' | 'gemini-cli' | 'desktop-worktree' | 'visual-swarm'`), `ObservatorySessionStatus` (`'running' | 'recent' | 'error' | 'idle'`), `ObservatorySubagent`, `ObservatoryEvent`, `ObservatorySessionSummary`, `ObservatorySessionDetail`, `ObservatoryPlanTask`, `ObservatoryPlanWave`, `ObservatoryPlanSummary`, `ObservatorySwarmSummary`, `ObservatoryProbeResult`, `ObservatoryLocalPortResult`, `ObservatoryGitState`, `ObservatorySnapshot`, `ObservatoryServiceOptions`.
  - Create `io.ts` with:
    - `clipRedacted(text, max)`: pipes through `redactSensitiveText` from `../risk-gate.js` plus Postgres URL credential redaction, collapses whitespace, clips to `max`.
    - `safeJsonParse<T>(line)`: returns `T | null` without throwing.
    - `readHeadAndTailLines(filePath, fileSize, headBytes = 32768, tailBytes = 196608)`: bounded `fs/promises` `open()` + `read()` avoiding full multi-MB reads.
    - `walkJsonlFiles(dir, maxDepth)`: bounded directory walk returning `{ fullPath, name, stat }[]`.
    - `deriveSessionStatus(mtimeMs, explicitRunState, hasRecentError, nowMs)`.
- **Acceptance Criteria:** Zero `defineModel`/`defineAddon`, zero external deps, strict TypeScript (`noImplicitAny` / `exactOptionalPropertyTypes` compatible).
- **Expected Output:** `typecheck` exits `0`.
- **Verify:** `bun --filter @moonwitness/desktop typecheck`

#### - [x] D02 — Implement `.plan/*.md` + Wave Playbook parser collector
- **Owner File(s):** `apps/desktop/src/observatory/plan-collector.ts`
- **Depends On:** `D01`
- **Exact Spec:**
  - Implement `collectPlans(repoRoot: string): Promise<{ plans: readonly ObservatoryPlanSummary[]; defaultPlanId: string | null }>`.
  - Auto-discover all `.plan/*.md` master checklists (`- [ ] **M01** — ...` / `- [x] **D01** — ...`) and sibling `.plan/<plan-id>/*.md` wave playbooks (skipping `ADR-*.md` for task extraction).
  - Extract per-task metadata: `wave`, `playbook`, `ownerFiles`, `dependsOn`, `acceptance`, `expected`, `verify`, `spec` (clipped via `clipRedacted`).
  - Prefer `coolify-sovereign-paas-single-db` if present, else most recently modified plan.
- **Acceptance Criteria:** Parses both `.plan/coolify-sovereign-paas-single-db.md` (`66` tasks) and `.plan/desktop-agent-observatory-merge.md` (`16` tasks) cleanly; returns empty list when `.plan/` does not exist.
- **Expected Output:** `typecheck` exits `0`.
- **Verify:** `bun --filter @moonwitness/desktop typecheck`

#### - [x] D03 — Implement Antigravity collector (`ConversationService` API + brain transcripts + swarms)
- **Owner File(s):** `apps/desktop/src/observatory/antigravity-collector.ts`
- **Depends On:** `D01`
- **Exact Spec:**
  - Implement `AntigravityCollector` class with injectable `homeDir`, `env` (`ANTIGRAVITY_LS_ADDRESS`, `ANTIGRAVITY_CSRF_TOKEN`, `ANTIGRAVITY_CONVERSATION_ID`), and `enableLiveApi` flag.
  - `refreshLiveApi()`: calls `ListConversations` (`pageSize: 15`, `timeoutMs: 10000`) and child `ListConversations` (`parentConversationId`) for top 5 parents + current conversation using `globalThis.AbortController`. Gracefully degrades to `connected: false` when env vars absent or unreachable.
  - `collect(repoRoot)`: scans `<homeDir>/.gemini/antigravity/brain/*/.system_generated/logs/transcript.jsonl` (top 20 by `mtimeMs`), caches head+tail parse AND full-file subagent/swarm scan (`<= 25 MB`) keyed by `(mtimeMs, size)`, parses `.system_generated/swarm/plan.json`, merges live API `runState` + child conversations, and supports `readDetail(id)` (`512 KB` tail).
- **Acceptance Criteria:** Never exposes `ANTIGRAVITY_CSRF_TOKEN`; gracefully returns `[]` when `~/.gemini/antigravity/brain` does not exist; discovers `invoke_subagent`, `swarm add`, and API child subagents.
- **Expected Output:** `typecheck` exits `0`.
- **Verify:** `bun --filter @moonwitness/desktop typecheck`

#### - [x] D04 — Implement multi-agent collectors (Claude Code, Codex, Qoder, Gemini CLI, Visual-Swarm, Desktop Worktrees)
- **Owner File(s):** `apps/desktop/src/observatory/external-agents-collector.ts`
- **Depends On:** `D01`
- **Exact Spec:**
  - Implement `ExternalAgentsCollector` with injectable `homeDir` and `mtimeMs + size` parse/subagent caches:
    - **Claude Code:** `<homeDir>/.claude/projects/*/*.jsonl` + `custom-title.json` + `<sessionId>/subagents/*.jsonl` + `Agent`/`Task` tool_use subagent scan + token usage.
    - **Codex:** `<homeDir>/.codex/sessions/**/*.jsonl` (`session_meta`, `thread_settings_applied`, `thread_goal_updated`, `token_usage_record`, `token_count`, `AgentMessage`, `CommandExecution`, `custom_tool_call`).
    - **Qoder / Gemini CLI:** generic bounded JSONL collector over `<homeDir>/.qoder/projects` and `<homeDir>/.gemini/tmp`.
    - **Local `.swarm/swarm.json`:** visual-swarm manifest reader.
    - **Desktop Native Worktrees:** maps `DesktopCapabilityBridge.worktree.listLeases()` into `desktop-worktree` sessions so MoonWitness Desktop's own internal agent sandboxes appear alongside external agents.
  - Provide `readDetail(runtime, id)` for Claude and Codex session inspector drawers.
- **Acceptance Criteria:** Handles missing directories cleanly; redacts all extracted snippets; maps active `WorktreeSandbox` leases without mutating bridge state.
- **Expected Output:** `typecheck` exits `0`.
- **Verify:** `bun --filter @moonwitness/desktop typecheck`

#### - [x] D05 — Implement Git commit mapper & non-blocking VPS / local port prober
- **Owner File(s):** `apps/desktop/src/observatory/infra-collector.ts`
- **Depends On:** `D01`
- **Exact Spec:**
  - Implement `collectGitState(repoRoot)`: `execFile('git', ...)` with `3500ms` timeout returning `branch`, `head`, `dirtyCount`, recent 20 commits, and `commitByTaskId` regex matching `\b([MD]\d{2})\b`.
  - Implement `probeVpsTargets(targets)`: uses `globalThis.AbortController` (`3500ms` timeout), enforces URL scheme `http:`/`https:` and rejects link-local/cloud-metadata hosts (`169.254.*`, `fe80:*`), parses `/readyz` & `/auth/setup-status` JSON status badges safely.
  - Implement `probeLocalPorts(ports)`: `350ms` loopback `127.0.0.1` TCP connect check (`3000`, `3001`, `4174`, `4242`, `5173`, `5432`, `6379`, `8000`).
- **Acceptance Criteria:** Safe timeout bounds, zero credential egress, SSRF metadata guard active.
- **Expected Output:** `typecheck` exits `0`.
- **Verify:** `bun --filter @moonwitness/desktop typecheck`

#### - [x] D06 — Build `DesktopObservatoryService` coordinator with lazy polling & export from `apps/desktop/src/index.ts`
- **Owner File(s):** `apps/desktop/src/observatory/service.ts`, `apps/desktop/src/index.ts`
- **Depends On:** `D02`, `D03`, `D04`, `D05`
- **Exact Spec:**
  - Implement `DesktopObservatoryService`:
    - Constructor takes `{ repoRoot, homeDir?, bridge?, enableNetworkProbes?, enableAntigravityApi?, probeTargets? }`.
    - `getSnapshot(options?: { fresh?: boolean })`: aggregates plans, Antigravity, external agents, native worktrees, git commit mapping, host CPU/RAM, and probes; deduplicates concurrent refreshes.
    - `getSessionDetail(runtime, id)`: returns full 40-event detail timeline + subagents.
    - `subscribe(listener)`: registers SSE listener; starts `2s` snapshot diff timer, `4s` git/AG API timer, `10s` probe timer, and `.plan/` `fs.watch` ONLY when subscriber count transitions `0 -> 1` (all timers `.unref()`'d). Stops all timers & watchers automatically when subscriber count transitions `1 -> 0`.
    - `stop()`: unconditionally closes all listeners, timers, and watchers.
  - Re-export `DesktopObservatoryService` and observatory types from `apps/desktop/src/index.ts`.
- **Acceptance Criteria:** Zero background timers or open handles created on instantiation when no SSE subscriber is attached; `stop()` is idempotent.
- **Expected Output:** `bun --filter @moonwitness/desktop build` exits `0`.
- **Verify:** `bun --filter @moonwitness/desktop typecheck; if ($?) { bun --filter @moonwitness/desktop build }`

---

### Wave 2 — Sidecar API Routes, Headless Web Serve, & CLI (`apps/desktop/src/`)

#### - [x] D07 — Mount `/api/desktop/observatory/*` routes on `LocalApiServer`
- **Owner File(s):** `apps/desktop/src/local-api-server.ts`
- **Depends On:** `D06`
- **Exact Spec:**
  - Extend `LocalApiServerOptions` with optional `repoRoot?: string`, `observatoryHomeDir?: string`, `enableObservatoryProbes?: boolean`, `serveWebDistDir?: string`.
  - Instantiate `DesktopObservatoryService` inside `startLocalApiServer()` and call `observatory.stop()` inside `stop()`.
  - Add 3 authenticated read-only endpoints (active in **both** `workspace` and `developer` modes, returning `401` when `!req.auth`):
    - `GET /api/desktop/observatory/state` (`?fresh=1` triggers fresh git + probe + collector refresh) -> `{ success: true, data: snapshot }`.
    - `GET /api/desktop/observatory/session` (`?runtime=&id=`) -> `{ success: true, data: detail }` or `404`.
    - `GET /api/desktop/observatory/stream`: sets CORS origin header matching `isAllowedCorsOrigin`, `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-store`, `X-Accel-Buffering: no`; hijacks `reply.raw`, writes `retry: 2000\n\n` + initial `event: snapshot`, subscribes to `observatory.subscribe(...)`, sends `: keepalive\n\n` every `15s` (`.unref()`), and unsubscribes immediately on `req.raw.on('close', ...)`.
- **Acceptance Criteria:** Existing `local-api-server.test.ts` stays 100% green; unauthenticated requests get `401`; SSE stream closes cleanly without leaking handles.
- **Expected Output:** `bun --filter @moonwitness/desktop build` and existing tests pass.
- **Verify:** `bun --filter @moonwitness/desktop typecheck; if ($?) { bun --filter @moonwitness/desktop test tests/local-api-server.test.ts }`

#### - [x] D08 — Add optional headless `--serve-web` static hosting in `LocalApiServer` & `cli.ts`
- **Owner File(s):** `apps/desktop/src/local-api-server.ts`, `apps/desktop/src/cli.ts`
- **Depends On:** `D07`
- **Exact Spec:**
  - In `cli.ts`: add `--serve-web` flag (and `MW_DESKTOP_SERVE_WEB=true` env) to `DesktopCliOptions`; forward `repoRoot: options.repoRoot` and `serveWebDistDir` (resolved to `../dist-board` relative to `dist/cli.js` when `--serve-web` is set) into `startLocalApiServer()`.
  - In `local-api-server.ts`: when `serveWebDistDir` exists, serve static assets from `dist-board` safely (path-confined with `path.resolve` prefix check, proper MIME types for `.html`/`.js`/`.css`/`.svg`/`.woff2`/`.webp`/`.png`/`.json`) and inject `<script>window.__MW_DESKTOP_API_URL__ = window.location.origin;</script>` into SPA HTML fallback for `/board/*` routes (so browser mode auto-connects to `127.0.0.1:4242` with zero manual config!).
  - Emit `observatoryUrl: "${apiUrl}/board/desktop/observatory"` in CLI readiness JSON when `--serve-web` is active.
- **Acceptance Criteria:** Opening `http://127.0.0.1:4242/board/desktop/observatory` in Chrome/Edge when running `moonwitness-desktop serve --serve-web` loads the full Desktop React SPA directly; path traversal (`../`) returns `403`/`404`.
- **Expected Output:** `bun --filter @moonwitness/desktop build` exits `0`.
- **Verify:** `bun --filter @moonwitness/desktop build; if ($?) { node scripts/check-desktop-non-overlap.mjs }`

#### - [x] D09 — Add root `package.json` convenience script `desktop:observatory`
- **Owner File(s):** `package.json`
- **Depends On:** `D08`
- **Exact Spec:**
  - Add `"desktop:observatory": "node apps/desktop/dist/cli.js serve --serve-web --api-port 4242"` (and `"desktop:serve": "node apps/desktop/dist/cli.js serve --api-port 4242"`) to root `package.json` `scripts`.
- **Acceptance Criteria:** `package.json` valid JSON; zero workspace dependency changes.
- **Expected Output:** `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` exits `0`.
- **Verify:** `node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); if(!p.scripts['desktop:observatory']) process.exit(1); console.log('OK')"`

---

### Wave 3 — Native Desktop Observatory React UI (`apps/desktop/desktop-web/`)

#### - [x] D10 — Build `useDesktopObservatoryStream` hook (authenticated `fetch()` ReadableStream SSE)
- **Owner File(s):** `apps/desktop/desktop-web/observatory/use-observatory-stream.ts`
- **Depends On:** `D07`
- **Exact Spec:**
  - Create typed client hook reading desktop API base URL (`window.__MW_DESKTOP_API_URL__ ?? ''`) and bearer token from `@/lib/client` (`client.accessToken` / `localStorage` `mw-board-session`).
  - Open `GET /api/desktop/observatory/stream` via `fetch()` with `Authorization: Bearer <token>` and `AbortController`; parse `event: snapshot` / `data: ...` SSE frames incrementally via `ReadableStreamDefaultReader` + `TextDecoder`; auto-reconnect on drop (`2s` -> `5s` backoff); expose `{ snapshot, connectionState, error, refreshNow, fetchSessionDetail }`.
- **Acceptance Criteria:** Zero bearer tokens in URL query strings; cleans up `AbortController` on unmount; falls back cleanly to `/api/desktop/observatory/state` when `ReadableStream` is mocked in Playwright.
- **Expected Output:** `typecheck:web` exits `0`.
- **Verify:** `bun --filter @moonwitness/desktop typecheck:web`

#### - [x] D11 — Build Observatory Panels (Agents, Activity Feed, Plan Micro-Tasks, Subagents/Swarms, Server/Git) using `@moonwitness/ui`
- **Owner File(s):** `apps/desktop/desktop-web/observatory/observatory-page.tsx`, `apps/desktop/desktop-web/observatory/session-inspector-sheet.tsx`
- **Depends On:** `D10`
- **Exact Spec:**
  - Build `DesktopObservatoryPage` inside `AppShell` (or matching Desktop board layout) using ONLY `@moonwitness/ui/components/*` (`PageHeader`, `MetricTile`, `Panel`, `Badge`, `Button`, `Input`, `SelectField`, `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription`, `Skeleton`, `EmptyState`, `ErrorState`, `Checkbox`) and `@moonwitness/ui/icons`.
  - Include all 4 tabs:
    1. **Live Agents & Activity:** runtime filter (`all`, `antigravity`, `claude`, `codex`, `qoder`, `gemini-cli`, `desktop-worktree`), status filter, workspace-only checkbox, agent cards with subagent badges, unified live feed, mini VPS probe panel.
    2. **Plan Micro-Tasks:** plan selector dropdown, wave progress cards, search + status filter, expandable micro-task rows showing Owner Files, Depends On, Acceptance Criteria, Expected Output, Verify command, and linked Git commit SHA.
    3. **Subagents & Swarms:** active swarm plans/workers + Parent -> Subagent hierarchy tree.
    4. **Server, VPS & Git:** recent Git commits with `Mxx`/`Dxx` badges, full VPS probe table, local TCP ports grid, host CPU/RAM tile.
  - Clicking any agent card opens `SessionInspectorSheet` (`@moonwitness/ui/components/sheet`) fetching `fetchSessionDetail(runtime, id)`.
  - **STRICT UI GATE:** ZERO raw `<button>`, `<input>`, `<select>`, `<svg>` tags; ZERO hex/rgb color literals or inline `style` color props.
- **Acceptance Criteria:** Passes `typecheck:web` and `bun run ui:check` with `0` findings.
- **Expected Output:** `UI design system: 0 finding(s) (none).`
- **Verify:** `bun --filter @moonwitness/desktop typecheck:web; if ($?) { bun run ui:check }`

#### - [x] D12 — Wire `/board/desktop/observatory` route & live status pill in `DesktopChrome`
- **Owner File(s):** `apps/desktop/desktop-web/main.tsx`, `apps/desktop/desktop-web/desktop.css`
- **Depends On:** `D11`
- **Exact Spec:**
  - Lazy-import or import `DesktopObservatoryPage` in `apps/desktop/desktop-web/main.tsx` and map `normalized === '/board/desktop/observatory'` in `DesktopRouteSwitch()`.
  - Upgrade `DesktopChrome` with a compact `@moonwitness/ui/components/button` link (`size="sm"`, `variant="ghost"`) navigating directly to `/board/desktop/observatory` (so it is 1 click away from anywhere in MoonWitness Desktop).
  - Add any needed layout classes in `apps/desktop/desktop-web/desktop.css` using ONLY `var(--mw-*)` tokens (zero literal colors).
- **Acceptance Criteria:** Navigating to `/board/desktop/observatory` renders `DesktopObservatoryPage`; `build:web` and `ui:check` pass with 0 findings.
- **Expected Output:** `apps/desktop/dist-board/` built cleanly.
- **Verify:** `bun --filter @moonwitness/desktop typecheck:web; if ($?) { bun --filter @moonwitness/desktop build:web }; if ($?) { bun run ui:check }`

#### - [x] D13 — Add `isDesktop`-gated sidebar entry in `apps/board/src/components/layout/app-shell.tsx`
- **Owner File(s):** `apps/board/src/components/layout/app-shell.tsx`
- **Depends On:** `D12`
- **Exact Spec:**
  - Inside `ModelNavigation` / `AppShell`, when `isDesktop` (from existing `useDesktopBridge()`) is `true`, render `<NavItem to="/board/desktop/observatory" label="Agent Observatory" icon={ActivityIcon} onNavigate={onNavigate} />`.
  - Do NOT import anything from `apps/desktop` or `node:*`; when running in standard web Board (`isDesktop === false`), this link is not rendered.
- **Acceptance Criteria:** `check-desktop-non-overlap.mjs`, `check-board-shared-ui.mjs`, `ui:check`, and `board:budget` all pass.
- **Expected Output:** Zero boundary violations and zero budget regressions.
- **Verify:** `node scripts/check-desktop-non-overlap.mjs; if ($?) { node scripts/check-board-shared-ui.mjs }; if ($?) { bun run ui:check }`

---

### Wave 4 — Automated Tests, Cutover, & Delete `tools/agent-observatory`

#### - [x] D14 — Add unit tests for Observatory collectors & sidecar endpoints
- **Owner File(s):** `apps/desktop/tests/observatory.test.ts`, `apps/desktop/tests/local-api-server.test.ts`
- **Depends On:** `D08`
- **Exact Spec:**
  - Create `apps/desktop/tests/observatory.test.ts` using temporary fixture directories (`os.tmpdir()`):
    - Plan parsing (`M01`/`D01` checkboxes, wave details, progress percentage).
    - Antigravity transcript head+tail parsing, `invoke_subagent` + `swarm add` discovery, secret redaction (`Bearer ...`, `sk-...`, `POSTGRES_PASSWORD=...`).
    - Claude Code session + `subagents/*.jsonl` + `Agent` tool call + `custom-title.json` parsing.
    - Codex rollout `session_meta`, `thread_goal_updated`, `token_count`, `CommandExecution` failure parsing.
    - SSRF guard blocking `http://169.254.169.254/latest/meta-data`.
    - Lazy subscriber lifecycle: zero timers before subscribe, clean stop on last unsubscribe.
  - Extend `apps/desktop/tests/local-api-server.test.ts` to verify:
    - `401` on `/api/desktop/observatory/state` without auth.
    - `200` on `/api/desktop/observatory/state` in BOTH `workspace` and `developer` modes.
    - SSE `GET /api/desktop/observatory/stream` emits `event: snapshot` frame and closes cleanly on abort.
    - `--serve-web` path traversal rejection (`/../package.json` -> `403`/`404`).
- **Acceptance Criteria:** All Vitest tests pass offline in `< 10s` with zero hanging handles.
- **Expected Output:** `bun --filter @moonwitness/desktop test` exits `0`.
- **Verify:** `bun --filter @moonwitness/desktop test`

#### - [x] D15 — Add Playwright webview E2E spec for `/board/desktop/observatory`
- **Owner File(s):** `apps/desktop/desktop-web/tests/routes.spec.ts`
- **Depends On:** `D13`, `D14`
- **Exact Spec:**
  - Add mock routes for `/api/desktop/observatory/state`, `/api/desktop/observatory/stream`, and `/api/desktop/observatory/session` in `mockSidecar()`.
  - Add Playwright test navigating to `/board/desktop/observatory`, asserting:
    - KPI tiles render (`Plan Progress`, `Coding Agents`, `Subagents & Swarms`).
    - Switching tabs (`Plan Micro-Tasks`, `Subagents & Swarms`, `Server, VPS & Git`) works cleanly.
    - Clicking an agent card opens `SessionInspectorSheet` and renders detail events.
    - Zero console/page errors.
- **Acceptance Criteria:** Full Playwright desktop web suite passes.
- **Expected Output:** `bun --filter @moonwitness/desktop test:web` exits `0`.
- **Verify:** `bun --filter @moonwitness/desktop build:web; if ($?) { bun --filter @moonwitness/desktop test:web }`

#### - [x] D16 — Retire `tools/agent-observatory/` & run full end-to-end verification gate
- **Owner File(s):** Remove `tools/agent-observatory/server.mjs`, `tools/agent-observatory/public/index.html`
- **Depends On:** `D14`, `D15`
- **Exact Spec:**
  - Stop any running `node tools/agent-observatory/server.mjs` process.
  - Delete `tools/agent-observatory/` (`git rm -r tools/agent-observatory`).
  - Run full verification suite:
    1. `bun --filter @moonwitness/desktop typecheck`
    2. `bun --filter @moonwitness/desktop typecheck:web`
    3. `bun --filter @moonwitness/desktop build`
    4. `bun --filter @moonwitness/desktop build:web`
    5. `bun --filter @moonwitness/desktop test`
    6. `bun --filter @moonwitness/desktop test:web`
    7. `node scripts/check-desktop-non-overlap.mjs`
    8. `node scripts/check-board-shared-ui.mjs`
    9. `bun run ui:check`
    10. `node scripts/check-docs.mjs`
  - Smoke-test live headless launch `node apps/desktop/dist/cli.js serve --serve-web --api-port 4242` -> verify `GET http://127.0.0.1:4242/board/desktop/observatory` returns `200` and `/api/desktop/observatory/state` returns live Antigravity + Claude + Codex + `.plan/` data!
- **Acceptance Criteria:** `tools/agent-observatory/` does not exist; all 10 verification gates pass; live `apps/desktop` Observatory serves real-time telemetry natively.
- **Expected Output:** All checks exit `0`; `Test-Path tools/agent-observatory` is `False`.
- **Verify:** `Test-Path tools/agent-observatory` returns `False` and all 10 gates exit `0`.

---

## 4. Progress Ledger

| Wave | Task Range | Completed | Last Commit SHA | Evidence |
|---|---|---|---|---|
| Wave 1 | `D01`–`D06` | `6 / 6` | `pending` | `typecheck`, `build`, `check-desktop-non-overlap.mjs` passed |
| Wave 2 | `D07`–`D09` | `3 / 3` | `pending` | `local-api-server.test.ts` (8/8) + SSE + path-confined `--serve-web` passed |
| Wave 3 | `D10`–`D13` | `4 / 4` | `pending` | `typecheck:web`, `build:web`, `ui:check` (`0` findings) passed |
| Wave 4 | `D14`–`D16` | `3 / 3` | `pending` | `observatory.test.ts` (3/3), `test:web` (10/10); `tools/agent-observatory` retained per user directive |
