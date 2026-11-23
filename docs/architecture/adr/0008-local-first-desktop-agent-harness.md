# ADR 0008: Local-First Desktop Agent Harness (`apps/desktop`)

- **Status:** Accepted Architecture Baseline (2026-11-22; implementation tracked in [`todo-desktop.md`](../../../todo-desktop.md))
- **Runtime alignment (2026-11-23):** Node.js `24.x` supersedes the original `22.x` draft baseline and matches root engines, Desktop package, Docker and CI.
- **Date:** 2026-11-22
- **Decision owners:** MoonWitness maintainers
- **Scope:** `apps/desktop` (`@moonwitness/desktop`), `apps/board` (`@moonwitness/board`), `@moonwitness/orm`, `@moonwitness/orm-ai`, `@moonwitness/ai-runtime`, `@moonwitness/local-ai`, `@moonwitness/jobs`, `@moonwitness/orm-storage`, `@moonwitness/ui`
- **Related architecture & plans:**
  - [Desktop Local-First Harness Architecture](../desktop-local-first-harness.md)
  - [Desktop Implementation Checklist (`DSK-0`–`DSK-10`)](../../../todo-desktop.md)
  - [Blueprint: AI Corporation Desktop Harness](../../../moonwitness-ai-corporation-blueprint/docs/AI-CORPORATION-DESKTOP-HARNESS.md)
  - [ADR 0001: Platform Contracts](../../decisions/0001-platform-contracts.md)
  - [ADR 0006: Mandatory Addon-First & Thin `apps/api`](../../decisions/0006-mandatory-addon-thin-api.md)
  - [ADR 0007: AI Corporation Addon-First Architecture](../../decisions/0007-ai-corporation-addon-first-architecture.md)
  - [AI Corporation Baseline Audit](../ai-corporation-baseline-audit.md)
  - [Knowledge Domain Ownership](../knowledge-domain-ownership.md)

> **ADR Register Note:** Canonical platform ADRs reside in `docs/decisions/`. This document is the authoritative Desktop Harness ADR at `docs/architecture/adr/0008-local-first-desktop-agent-harness.md`, while `M12.06` in [`13-ai-corporation.md`](../../roadmap/13-ai-corporation.md) reserves a distinct future A2A protocol ADR; the Desktop Harness does not occupy that A2A slot.

---

## Context

MoonWitness XV already establishes:

1. **Control Plane & Shared UI (`apps/board` + `@moonwitness/ui`):** A Next.js App Router (`output: 'standalone'`) frontend rendering metadata-driven addon views (`/board/m/[model]`) and Mission Control surfaces exclusively via `@moonwitness/ui` and `@moonwitness/assets`, verified by `pnpm board:ui:check` ([`scripts/check-board-shared-ui.mjs`](../../../scripts/check-board-shared-ui.mjs)).
2. **Domain Truth & Thin Server (`apps/api` + `@moonwitness/orm` + `@moonwitness/orm-ai`):** Addon-first models installed programmatically across both PostgreSQL (`pg`) and SQLite (`better-sqlite3`) via [`installAddons`](../../../packages/orm/src/addon.ts), with `'ai.'` and `'knowledge.'` prefixes guarded from generic CRUD in [`apps/api/src/auth/policy.ts`](../../../apps/api/src/auth/policy.ts) and wired through [`apps/api/src/addons/registry.ts`](../../../apps/api/src/addons/registry.ts).
3. **Execution & Local Model Foundations (`@moonwitness/ai-runtime`, `@moonwitness/local-ai`, `@moonwitness/jobs`):** Typed provider adapters (`MockProvider`, `OllamaAdapter`, cloud adapters, secret reference validation `MW_AI_*`, redaction), a tool-free loopback-only K7 suggestion boundary (`@moonwitness/local-ai`), and durable jobs/outbox queues (`base.job`, `base.job_run`, `base.outbox_event`, `base.cron`).

However, browser-hosted `apps/board` cannot safely or ergonomically run a **local-first coding & repository agent harness** (comparable in developer ergonomics to Antigravity, Codex Desktop, or DeepSeek dsh-superagent):

- Browsers have no access to local Git worktrees, bounded process/PTY execution, canonical OS filesystem containment, local stdio MCP servers, or an offline-capable SQLite execution sidecar.
- Putting local developer OS execution into `apps/api` fails when developers work offline, against local loopback inference (`Ollama`, `DeepSeek`, `vLLM`), or on proprietary local repositories classified `local_only` / `restricted`.
- Conversely, building a disconnected desktop app with its own UI components, custom database schema, or unchecked shell runner would violate [ADR 0006](../../decisions/0006-mandatory-addon-thin-api.md) and [ADR 0007](../../decisions/0007-ai-corporation-addon-first-architecture.md) and create an un-auditable second source of truth.

We need an explicit architectural decision defining `apps/desktop` (`@moonwitness/desktop`) with **zero overlap** against `apps/board` and `apps/api`, **dual-dialect ORM continuity**, **fail-closed data classification**, and **Proof-Carrying Work (PCW)** guarantees.

---

## Decision

### 1. Zero-Overlap Boundary Between `apps/board` and `apps/desktop`

`apps/desktop` is the **Local-First Execution Plane & Native Harness Host**; `apps/board` remains the **Control Plane & Shared UI Surface**.

| Dimension                  | `apps/board` (`@moonwitness/board`)                                                                       | `apps/desktop` (`@moonwitness/desktop`)                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Primary Responsibility** | Browser Control Plane, metadata-driven CRUD/workflow views, Mission Control & review UI                   | Native Tauri v2 shell + Node.js `24.x` ESM harness sidecar, local SQLite sidecar, offline outbox sync, Git worktrees, bounded PTY, file/diff inspector, stdio MCP host                           |
| **UI Components & Tokens** | Owns Next.js pages (`src/app/**`) using `@moonwitness/ui` & `@moonwitness/assets` (`pnpm board:ui:check`) | **Zero duplicated pages/components:** hosts `apps/board` (`../board/.next/standalone/apps/board`) directly via `tauri.conf.json` and exposes `window.__MW_DESKTOP__` (`DesktopCapabilityBridge`) |
| **ORM & Domain Models**    | Never imports `@moonwitness/orm` or DB drivers; consumes `@moonwitness/client` & `@moonwitness/types`     | Never defines `defineModel` / `defineAddon`; executes existing `@moonwitness/orm-*` addon manifests against `~/.moonwitness/local.db`                                                            |
| **OS & Local Execution**   | Strictly forbidden (`fs`, `child_process`, `node-pty`, `better-sqlite3`, Tauri Rust/Node APIs)            | Owns `DesktopCapabilityBridge` (`window.__MW_DESKTOP__`) + `DesktopRiskGate` + `GitWorktreeManager` + `LocalSidecar` + `McpHost`                                                                 |
| **Authority**              | Calls `apps/api` for central state, approvals, and workflow transitions                                   | Executes bounded runs locally; syncs PCW evidence to `apps/api`; **never** self-approves `accepted` status                                                                                       |

**Strict Non-Overlap Rules (`NO-OVERLAP-01`–`NO-OVERLAP-06`):**

1. `apps/desktop` MUST NOT copy or fork `apps/board` JSX pages, views, CSS tokens, or icons; `tauri.conf.json` renders `apps/board` directly (`devUrl: http://127.0.0.1:5173/board`, `frontendDist: ../board/.next/standalone/apps/board`), and desktop-only panels in `apps/board` render via progressive enhancement when `window.__MW_DESKTOP__` is defined.
2. `apps/board` MUST compile and pass every route check, `pnpm board:ui:check`, and `pnpm board:budget` with `window.__MW_DESKTOP__ === undefined`.
3. `apps/desktop` MUST NOT introduce a second UI component kit, second client SDK, or second ORM.
4. `apps/desktop` MUST NOT bypass `apps/api` `INTERNAL_PREFIXES` (`'ai.'`, `'knowledge.'`, `'base.job'`, `'base.outbox_event'`, `'workflow.'`, `'auth.'`) or promote agent identities to `superadmin` / `system`.
5. `@moonwitness/local-ai` remains strictly loopback-only and tool-free for K0–K9 research suggestions (`AI_MODE=disabled` default); general tool-using harness loops run solely in `@moonwitness/ai-runtime` and `@moonwitness/desktop`.

### 2. Host Runtime Topology: Tauri v2 Native Window + Node.js `24.x` Harness Sidecar

`apps/desktop` uses a **Tauri v2** native window shell (`apps/desktop/tauri.conf.json`) paired with a **Node.js `24.x` ESM local harness host (`@moonwitness/desktop`)**:

1. **Tauri v2 Native Window & CSP Security (`tauri.conf.json`):**
   - `withGlobalTauri: false`, `freezePrototype: true`, `dangerousDisableAssetCspModification: false`.
   - Strict CSP locking `default-src: ['self']`, `frame-ancestors: ['none']`, `object-src: ['none']`, and `connect-src` restricted strictly to `'self'` plus explicit loopback origins (`http://127.0.0.1:3000`, `http://127.0.0.1:5173`, `http://127.0.0.1:11434`, `localhost` equivalents, and `ipc:` / `http://ipc.localhost`).
   - Hosts `apps/board` directly (`frontendDist: ../board/.next/standalone/apps/board`) without bundling a second Chromium runtime.
2. **Preload / Bridge Membrane (`window.__MW_DESKTOP__` / `DesktopCapabilityBridge`):**
   - Exposes a frozen, schema-validated `DesktopCapabilityBridge` (`protocolVersion: '1.0'`, `hostSurface: 'apps/board'`) for `worktree`, `pty`, `risk`, `sidecar`, and `mcp`.
   - Never exposes raw filesystem, Node `process`, or arbitrary shell handles to the webview.
3. **Node.js `24.x` ESM Local Harness Sidecar (`@moonwitness/desktop`):**
   - Executes `@moonwitness/orm`, `better-sqlite3`, `@moonwitness/jobs`, `@moonwitness/orm-storage`, `@moonwitness/ai-runtime`, `@moonwitness/ai-mcp`, Git worktree leases, bounded PTY execution, and PCW outbox sync natively on the monorepo's pinned Node `24.x` LTS runtime with zero ORM re-implementation in Rust.

### 3. Dual-Dialect `@moonwitness/orm` Sidecar (`~/.moonwitness/local.db`) & PCW Sync Protocol

`apps/desktop` initializes a local SQLite database at `~/.moonwitness/local.db` (configurable via `MW_DESKTOP_HOME`, WAL mode + `PRAGMA foreign_keys = ON` + single-writer process lockfile) and calls `installAddons(sqliteDb, DESKTOP_ADDONS)` using the **exact same workspace addon manifests**:

- `@moonwitness/orm-base` (`base`)
- `@moonwitness/orm-organization` (`organization`)
- `@moonwitness/jobs` (`jobs`)
- `@moonwitness/orm-notification` (`notification`)
- `@moonwitness/orm-workflow` (`workflow`)
- `@moonwitness/orm-storage` (`orm-storage`)
- `@moonwitness/orm-knowledge` (`knowledge`, read-only approved snapshot cache)
- `@moonwitness/orm-ai` (`ai`)

**Local-First Sync & Proof-Carrying Work (PCW) Reconciliation:**

1. **Upstream Pull:** When online, the desktop sync worker pulls company-scoped `ai.work_contract`, `ai.acceptance_criterion`, `ai.execution_policy`, active `ai.capability_grant`, `ai.provider_profile` / `ai.model_profile` metadata, and read-only `knowledge.*` releases via authenticated `@moonwitness/client` calls.
2. **Offline / Local Execution:** Runs record state transitions (`ai.agent_run` with `idempotency_key` and `fencing_token`), immutable evidence blobs in `LocalFileAttachmentStorage` (`~/.moonwitness/storage/`), `ai.artifact_manifest` rows (the PCW `evidence_artifact` digest ledger with 64-hex `sha256` and UUID `storage_key`), and durable `base.outbox_event` envelopes (`PcwSyncEnvelope`) atomically inside SQLite transactions.
3. **Downstream PCW Push:** Upon connectivity, the sync worker drains pending outbox envelopes (`ai.agent_run`, `ai.artifact_manifest`, `base.outbox_event`), streams referenced blobs to `apps/api` storage, and posts idempotent PCW bundles to dedicated addon routes on `apps/api`.
4. **Server Authority & Anti-Tamper:** `apps/api` PostgreSQL recomputes SHA-256 digests on uploaded blobs, verifies grant validity and monotonic `fencing_token`, and leaves `ai.work_contract` acceptance strictly gated by `orm-workflow` (`requireDifferentActor: true`) + deterministic verifier checks. Local desktop runs **never** self-certify `accepted`.

### 4. Plan–Execute–Verify Harness Loop & Data Classification Routing

The local harness executes via `@moonwitness/ai-runtime` (`AgentHarness`) rather than ad-hoc renderer loops:

1. **Plan:** Generates a structured, JSON-Schema-validated plan bound by `ExecutionPolicy` (`max_steps`, `max_wall_clock_seconds`, `max_tokens_per_run`, `max_cost_micros_per_run`).
2. **Execute:** Loops over model calls and tool invocations, re-checking [`isActiveCapabilityGrant`](../../../packages/orm-ai/src/validation.ts#L200-L226), `company_id`, `work_contract_id`, `policy_version`, `is_emergency_stopped`, and `DesktopRiskGate` (`R0`–`R4`) at **execution time** for every tool call.
3. **Verify:** Executes deterministic verification hooks (`automated_test`, `schema_check`, `source_inspection`) inside the isolated worktree and emits an immutable `evidence_bundle` (`ai.artifact_manifest`).

**Provider & Data Classification Gate:**

- **Local Loopback Providers:** Ollama (`/api/chat`, `/api/tags` via `OllamaAdapter`) and OpenAI-compatible local runtimes (DeepSeek local / vLLM / llama.cpp bound strictly to `localhost`, `127.0.0.1`, or `::1` via [`validateLoopbackEndpointUrl`](../../../packages/ai-runtime/src/providers/shared.ts#L24-L63)).
- **Cloud Providers:** HTTPS-only endpoints verified via `validateCloudOrEndpointUrl` + `assertPublicDnsResolution` SSRF guards and `MW_AI_*` OS-keychain / env secret references; gated at tier `R3` (`cloud.provider_call`).
- **Classification Enforcement:** `restricted` and `local_only` payloads MUST NEVER route or silently fall back to cloud providers ([`isAllowedClassificationRoute`](../../../packages/orm-ai/src/validation.ts#L154-L177)).

### 5. Native OS Capabilities & Risk Tiers (`R0–R4`) via `window.__MW_DESKTOP__`

Every native capability exposed by `DesktopCapabilityBridge` (`window.__MW_DESKTOP__`) is evaluated by `DesktopRiskGate` before execution:

1. **Isolated Git Worktree Manager (`.mw-worktrees/run-<id>`):** Acquires a leased worktree per run ID (`GitWorktreeLease` with `fencingToken`), blocks concurrent writer conflicts, enforces `allowedPaths` prefixes, and generates SHA-256 verified unified patches (`WorktreeDiffSummary`).
2. **Path-Allowlisted File & Diff Inspector:** Validates canonical `fs.realpath` containment inside `.mw-worktrees/run-<id>`, rejects `..` traversal, UNC/device paths, out-of-root symlinks/junctions, and secret paths (`.env*`, `.git/*`, `.ssh/*`, `.aws/*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`).
3. **Bounded PTY / Terminal Runner:** Executes scoped commands (`BoundedPtyCommandRequest`) pinned inside the active worktree with scrubbed environment variables, hard timeout + process-tree termination, bounded stdout/stderr buffers, and SHA-256 output digests (`BoundedPtyCommandResult`).
4. **Local Stdio MCP Host / Gateway:** Hosts company-allowlisted stdio/loopback MCP servers (`LocalMcpServerConfig`), routing every invocation through capability grant, data classification, quota (`maxCallsPerRun`), and output redaction gates.
5. **Deterministic Risk Tiers (`R0–R4`):**
   - **`R0` (Read-Only):** `repo.read`, `repo.search`, `git.status`, `git.diff`, `sidecar.read`, `mcp.read`.
   - **`R1` (Scoped Local Worktree):** `worktree.create`, `worktree.write`, `worktree.test`, `pty.exec_local`, `mcp.local_write`.
   - **`R2` (Local State / Service):** `git.commit_local`, `sidecar.sync_local`, `service.local_start`.
   - **`R3` (External / Upstream Effect — Mandatory Single-Use `HumanApprovalToken`):** `git.push_remote`, `network.egress`, `cloud.provider_call`, `upstream.sync_push`, or any command/endpoint escalating to remote egress.
   - **`R4` (Unconditionally Prohibited):** `secret.read`, `system.destructive`, `worktree.escape`, `privilege.escalate`, sensitive secret paths, and destructive shell commands (`rm -rf /`, `sudo`, `printenv`).

---

## Alternatives Considered

1. **Electron Full Runtime (Bundled Chromium + Node Main/UtilityProcess):**
   - _Pros:_ Single JS process runtime for both windowing and Node native addons.
   - _Cons:_ Ships a ~150 MB duplicated Chromium binary per install and widens browser renderer attack surface compared to Tauri v2's `withGlobalTauri: false` + `freezePrototype: true` native WebView shell.
   - _Disposition:_ **Rejected for outer shell**; Tauri v2 provides a lighter, stricter native window while keeping a clean Node.js `24.x` harness sidecar (`@moonwitness/desktop`) for `@moonwitness/orm` and `@moonwitness/ai-runtime`.
2. **Pure Rust Sidecar Re-implementing `@moonwitness/orm` & `@moonwitness/ai-runtime`:**
   - _Pros:_ Single static binary.
   - _Cons:_ Duplicates 13+ ORM addon models, `isValidAiMutation`, `@moonwitness/jobs`, and `@moonwitness/ai-runtime` adapters in Rust, violating D2 (single ORM source of truth).
   - _Disposition:_ **Rejected**; Node.js `24.x` sidecar reuses all TypeScript workspace packages directly.
3. **Duplicating UI Views Inside `apps/desktop` Outside `apps/board`:**
   - _Pros:_ Faster initial prototyping.
   - _Cons:_ Guarantees visual drift, breaks `pnpm board:ui:check` discipline, and duplicates auth, query caching, and addon metadata renderers.
   - _Disposition:_ **Rejected** (`NO-OVERLAP-01`).
4. **Custom SQLite Schema / Separate Desktop Task DB:**
   - _Pros:_ Simpler local table definitions.
   - _Cons:_ Violates [ADR 0006](../../decisions/0006-mandatory-addon-thin-api.md) and [ADR 0007](../../decisions/0007-ai-corporation-addon-first-architecture.md) (D2); breaks schema parity, validation, and PCW sync integrity.
   - _Disposition:_ **Rejected**; `~/.moonwitness/local.db` MUST run `@moonwitness/orm` + identical addon manifests.
5. **Extending `@moonwitness/local-ai` With Shell/Git/MCP Tools:**
   - _Pros:_ One local AI package.
   - _Cons:_ Violates K0–K9 `LMI-01`..`LMI-13` tool-free isolation and `BASE.24`.
   - _Disposition:_ **Rejected** (`NO-OVERLAP-05`).

---

## Consequences

- **Positive:** Single UI system (`@moonwitness/ui` + `apps/board`), single domain schema (`@moonwitness/orm` + `@moonwitness/orm-ai`), lightweight Tauri v2 window CSP, full offline execution + cryptographic PCW sync to PostgreSQL, deterministic `R0–R4` containment, and zero security degradation to web-only `apps/board`.
- **Costs / Trade-offs:**
  - Requires bundling/launching the Node.js `24.x` harness sidecar alongside Tauri v2 (`apps/desktop/tauri.conf.json`) and testing `better-sqlite3` <-> `pg` serialization parity on every `@moonwitness/orm-ai` change.
  - Adds local IPC & OS-containment security surface (`DesktopCapabilityBridge`, worktrees, PTY, stdio MCP) requiring dedicated adversarial tests (`DSK-10`).
- **Review Triggers:** Revisit this ADR if multi-device CRDT collaborative editing on local SQLite rows is required beyond outbox event reconciliation, if Tauri IPC marshaling reveals throughput bottlenecks for high-frequency PTY streams, or if A2A peer-agent desktop federation is proposed (requires separate A2A ADR).
