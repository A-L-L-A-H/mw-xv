# ADR-002: Consolidate Multi-Agent Observatory into `apps/desktop` (Retire `tools/agent-observatory`)

- **Status:** Accepted (Ready for Autonomous Execution)
- **Date:** 2026-11-25
- **Plan Tracker:** `.plan/desktop-agent-observatory-merge.md` (`D01`–`D16`)

---

## 1. Context & Problem Statement

`tools/agent-observatory/server.mjs` proved real-time multi-agent observability across Antigravity, Claude Code, Codex, Qoder, Gemini CLI, `.plan/` micro-tasks, Git commits, and live VPS probes. However, running it as a standalone Node script creates three friction points:
1. **Fragmented Runtime:** Users must start and manage a separate `node tools/agent-observatory/server.mjs` process alongside `apps/desktop` (`127.0.0.1:4242`).
2. **Duplicate Infrastructure:** `apps/desktop` already owns a Fastify loopback sidecar (`apps/desktop/src/local-api-server.ts`), Tauri v2 desktop window (`apps/desktop/src-tauri`), Vite React webview (`apps/desktop/desktop-web`), secret redaction (`apps/desktop/src/risk-gate.ts`), centralized logging (`DesktopLogHub`), and worktree lease tracking (`WorktreeSandbox`).
3. **Disconnected Design System:** Standalone raw HTML diverges from `@moonwitness/ui` Ink/Riot themes and cannot inspect MoonWitness Desktop's own native `WorktreeSandbox` leases or `DesktopLogHub` stream.

---

## 2. Architectural Decisions

### Decision 1 — Embed Observatory Engine inside `apps/desktop/src/observatory/` & Mount on `LocalApiServer` (`127.0.0.1:4242`)
- **Chosen:** Port all collectors (Plan parser, Antigravity `ConversationService` + transcripts + swarms, Claude Code + subagents, Codex rollouts, Qoder/Gemini CLI/Visual-Swarm, Git commits, VPS & local TCP probes) plus MoonWitness Desktop's native worktree leases into typed TypeScript modules under `apps/desktop/src/observatory/`. Mount read-only routes on `apps/desktop/src/local-api-server.ts`:
  - `GET /api/desktop/observatory/state` (`?fresh=1` optional)
  - `GET /api/desktop/observatory/stream` (SSE `text/event-stream`)
  - `GET /api/desktop/observatory/session?runtime=<r>&id=<id>`
- **Rejected:** Keeping `tools/agent-observatory/server.mjs` as a child process spawned by Tauri (doubles process management, port conflicts, and duplicated redaction/auth).
- **Consequence:** One single daemon (`moonwitness-desktop serve` / Tauri sidecar) powers both MoonWitness Desktop and headless browser access. Zero ORM models/addons are defined (`scripts/check-desktop-non-overlap.mjs` stays green).

### Decision 2 — Lazy-Start Polling, `.unref()` Timers, & Zero Open Handles
- **Chosen:** `DesktopObservatoryService` keeps an `mtimeMs + size` file-parse cache and starts background polling timers (`2s` SSE diff, `4s` git/Antigravity API, `10s` VPS probes, `.plan/` `fs.watch`) **only while >= 1 SSE client is subscribed**, stopping all watchers/timers automatically when the last subscriber disconnects and in `LocalApiServerHandle.stop()`. All timers call `.unref()`.
- **Rejected:** Eager background polling and external network probes on `startLocalApiServer()` boot (would slow down and hang `apps/desktop/tests/local-api-server.test.ts`).
- **Consequence:** Zero latency penalty on desktop boot or Vitest suites; instant live updates when the Observatory UI is open.

### Decision 3 — Authenticated `fetch()` ReadableStream SSE (Zero Tokens in Query Strings)
- **Chosen:** All `/api/desktop/observatory/*` routes require existing `req.auth` Bearer token (`mw_local_...`) and are enabled in **both** `workspace` and `developer` modes (`R0` read-only). The React hook `useDesktopObservatoryStream` consumes `GET /api/desktop/observatory/stream` using `fetch(..., { headers: { Authorization: 'Bearer ...' }, signal })` + incremental `ReadableStream` SSE frame parsing with exponential backoff reconnect.
- **Rejected:** Browser `EventSource('/api/desktop/observatory/stream?token=...')` (exposes bearer tokens in URL logs/history) or unauthenticated loopback endpoints.

### Decision 4 — Desktop-Native React View (`/board/desktop/observatory`) Using Shared `@moonwitness/ui`
- **Chosen:** Build the UI in `apps/desktop/desktop-web/observatory/` using exclusively `@moonwitness/ui/components/*` (`Panel`, `MetricTile`, `Badge`, `Button`, `Input`, `SelectField`, `Tabs`, `Sheet`, `Table`, `Skeleton`, `EmptyState`, `ErrorState`, `Checkbox`) and `@moonwitness/ui/icons` with semantic tokens (`var(--mw-*)` / Tailwind semantic classes). Register `/board/desktop/observatory` in `apps/desktop/desktop-web/main.tsx`, add a live **Observatory** status button in `DesktopChrome`, and add a single `isDesktop`-gated sidebar link in `apps/board/src/components/layout/app-shell.tsx`.
- **Rejected:** Iframing legacy raw HTML inside Tauri (breaks Ink/Riot themes, keyboard navigation, and `@moonwitness/ui` consistency) or putting Observatory code inside `apps/board` (violates `check-desktop-non-overlap.mjs` and `apps/board/bundle-budget.json`).

### Decision 5 — Reuse Single Secret-Redaction Authority & Preserve Locked Tauri CSP
- **Chosen:** All extracted transcript snippets, tool arguments, and command lines pass through `redactSensitiveText()` in `apps/desktop/src/risk-gate.ts`. All remote VPS/Antigravity HTTP requests execute strictly in the Node sidecar backend, with SSRF link-local/metadata IP rejection (`169.254.169.254`, `169.254.*`, `fe80::/10`) on custom probe URLs.
- **Consequence:** `apps/desktop/tauri.conf.json` and `apps/desktop/src-tauri/tauri.conf.json` keep strict loopback-only `connect-src` with zero CSP relaxation.

### Decision 6 — Headless Browser Fallback via Existing Desktop Sidecar + Full Removal of `tools/agent-observatory`
- **Chosen:** Add optional static serving of built `apps/desktop/dist-board/` on `LocalApiServer` when started via `moonwitness-desktop serve --serve-web` (or `pnpm desktop:observatory`), allowing browser access at `http://127.0.0.1:4242/board/desktop/observatory` even without opening the Tauri binary. Once all Desktop tests and gates pass, delete `tools/agent-observatory/` permanently (`git rm -r tools/agent-observatory`).
- **Scope Boundary:** `apps/agent-observability` (OpenTelemetry OTLP exporter SDK for MoonWitness API) is an unrelated package and remains untouched.

---

## 3. Repository Gate Invariants

| Gate | Command / Check | Requirement |
|---|---|---|
| Desktop Non-Overlap | `node scripts/check-desktop-non-overlap.mjs` | Zero `defineModel`/`defineAddon` in `apps/desktop/src/`; zero Node/desktop imports in `apps/board/src/`. |
| Shared UI Design System | `bun run ui:check` | `0` new/structural findings across `apps/desktop/desktop-web/**` and `apps/board/src/**`. Zero raw `<button>`/`<input>`/`<select>`/`<svg>` and zero literal hex/rgb colors. |
| Desktop Backend & Web Typecheck/Build | `bun --filter @moonwitness/desktop typecheck && bun --filter @moonwitness/desktop typecheck:web && bun --filter @moonwitness/desktop build && bun --filter @moonwitness/desktop build:web` | Clean zero-error compile & Vite bundle into `apps/desktop/dist/` and `apps/desktop/dist-board/`. |
| Desktop Unit & Webview E2E | `bun --filter @moonwitness/desktop test && bun --filter @moonwitness/desktop test:web` | All unit tests (including new observatory collector & API tests) and Playwright desktop route specs pass with zero leaked handles. |
| Board Bundle Budget | `bun run board:budget` | Unchanged/green after adding 1 `isDesktop`-gated sidebar nav item. |
