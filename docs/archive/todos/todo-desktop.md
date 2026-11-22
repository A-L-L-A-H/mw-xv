# MoonWitness XV — `apps/desktop` Local-First Agent Harness TODO

> **Document type:** Granular engineering checklist / living work ledger (`DSK-0`–`DSK-10`)  
> **Scope:** `apps/desktop` (`@moonwitness/desktop`) — MoonWitness Local-First Agent Harness (inspired by Antigravity, Codex Desktop, and DeepSeek dsh-superagent; derived from `apps/board` with **zero overlap**)  
> **Architecture invariants:**
>
> - **Zero Overlap:** `apps/board` (`@moonwitness/board`) is the Control Plane & Shared UI Surface (`@moonwitness/ui`); `apps/desktop` (`@moonwitness/desktop`) is the Local-First Execution Plane & Native Harness Host (`Tauri v2` + Node `22.x` ESM sidecar).
> - **ORM Addon-First & Dual-Dialect Parity:** Local SQLite sidecar (`~/.moonwitness/local.db`) runs the exact same workspace addon manifests (`orm-base`, `orm-organization`, `jobs`, `orm-notification`, `orm-workflow`, `orm-storage`, `orm-knowledge`, `orm-ai`) as central `apps/api` PostgreSQL.
> - **Proof-Carrying Work (PCW):** Local execution never equates to `accepted` completion; evidence blobs (`~/.moonwitness/storage/`), `ai.artifact_manifest` (`ai.evidence_artifact` SHA-256 digests), `ai.agent_run`, and `base.outbox_event` sync via `PcwSyncEnvelope` to central `apps/api` for independent verification.
>   **Governing documents:**
> - [ADR 0008: Local-First Desktop Agent Harness](docs/architecture/adr/0008-local-first-desktop-agent-harness.md)
> - [Desktop Local-First Harness Architecture](docs/architecture/desktop-local-first-harness.md)
> - [Blueprint: AI Corporation Desktop Harness](moonwitness-ai-corporation-blueprint/docs/AI-CORPORATION-DESKTOP-HARNESS.md)
> - [ADR 0006: Mandatory Addon-First & Thin `apps/api`](docs/decisions/0006-mandatory-addon-thin-api.md)
> - [ADR 0007: AI Corporation Addon-First Architecture](docs/decisions/0007-ai-corporation-addon-first-architecture.md)
> - [Master Monorepo Transformation TODO](todo.md) · [AI Corporation TODO](moonwitness-ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md)

---

## Status Legend & Progress Summary

| Marker        | Meaning                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------- |
| `[x]`         | Completed and directly verified against current repository files / documentation             |
| `[ ]`         | Pending implementation, integration, or verification in `apps/desktop` / supporting packages |
| **INVARIANT** | Hard architectural or security rule; violations fail CI boundary gates                       |

| Phase     | Subsystem                                                                        | ID Range               | Completed `[x]` | Pending `[ ]` |   Total |
| --------- | -------------------------------------------------------------------------------- | ---------------------- | --------------: | ------------: | ------: |
| `DSK-0`   | Audit, ADR `0008`, Blueprint & Non-Overlap Freeze                                | `DSK-0.1`–`DSK-0.12`   |              11 |             1 |      12 |
| `DSK-1`   | `apps/desktop` Scaffold, Tauri v2 Window & Zero-Overlap `apps/board` Shell       | `DSK-1.1`–`DSK-1.12`   |              12 |             0 |      12 |
| `DSK-2`   | Dual-Dialect `@moonwitness/orm` Local SQLite Sidecar (`~/.moonwitness/local.db`) | `DSK-2.1`–`DSK-2.12`   |              12 |             0 |      12 |
| `DSK-3`   | Offline-First Sync Engine & Proof-Carrying Work (PCW) Reconciliation             | `DSK-3.1`–`DSK-3.12`   |              12 |             0 |      12 |
| `DSK-4`   | `window.__MW_DESKTOP__` (`DesktopCapabilityBridge`) & Hardened IPC Membrane      | `DSK-4.1`–`DSK-4.10`   |              10 |             0 |      10 |
| `DSK-5`   | Isolated Git Worktree Manager (`.mw-worktrees/run-<id>`) & Patch Engine          | `DSK-5.1`–`DSK-5.10`   |              10 |             0 |      10 |
| `DSK-6`   | Bounded PTY / Terminal Runner & `R0–R4` (`DesktopRiskGate`) Enforcement          | `DSK-6.1`–`DSK-6.12`   |              12 |             0 |      12 |
| `DSK-7`   | Path-Allowlisted File & Diff Inspector (Traversal & Symlink Protection)          | `DSK-7.1`–`DSK-7.10`   |              10 |             0 |      10 |
| `DSK-8`   | Local Stdio / Loopback MCP Host & `@moonwitness/ai-mcp` Integration              | `DSK-8.1`–`DSK-8.10`   |              10 |             0 |      10 |
| `DSK-9`   | Plan–Execute–Verify Loop & Local/Cloud Classification Routing                    | `DSK-9.1`–`DSK-9.14`   |              14 |             0 |      14 |
| `DSK-10`  | Threat-Model Security Suite, Offline/Sync Chaos Drills, Packaging & CI           | `DSK-10.1`–`DSK-10.14` |              14 |             0 |      14 |
| **Total** | **All Desktop Harness Phases**                                                   | **`DSK-0`–`DSK-10`**   |         **127** |         **1** | **128** |

---

## `DSK-0` — Architecture Audit, ADR `0008`, Blueprint & Non-Overlap Freeze

**Goal:** Lock the zero-overlap architecture between `apps/board`, `apps/api`, and `apps/desktop` against verified repository code before merging `apps/desktop`.

- [x] **DSK-0.1** Audit existing dual-dialect ORM installation (`better-sqlite3` and `pg`), composite indexes, `_orm_addons`, and `_orm_data` behavior in [`packages/orm/src/addon.ts`](packages/orm/src/addon.ts) and [`packages/orm/tests/orm-hardening.test.ts`](packages/orm/tests/orm-hardening.test.ts).
- [x] **DSK-0.2** Audit existing append-only SQLite/PostgreSQL triggers in [`packages/orm-workflow/src/manifest.ts`](packages/orm-workflow/src/manifest.ts) and [`packages/orm-knowledge/src/manifest.ts`](packages/orm-knowledge/src/manifest.ts) plus `supportsSkipLocked` SQLite fallback in [`packages/jobs/src/runtime.ts`](packages/jobs/src/runtime.ts).
- [x] **DSK-0.3** Audit `apps/board` standalone configuration (`output: 'standalone'`), security headers, proxy rewrites in [`apps/board/next.config.ts`](apps/board/next.config.ts), shared UI gate [`scripts/check-board-shared-ui.mjs`](scripts/check-board-shared-ui.mjs), and shell layout [`apps/board/src/components/layout/app-shell.tsx`](apps/board/src/components/layout/app-shell.tsx).
- [x] **DSK-0.4** Audit `apps/api` thin adapter registry [`apps/api/src/addons/registry.ts`](apps/api/src/addons/registry.ts), generic API `INTERNAL_PREFIXES` policy [`apps/api/src/auth/policy.ts`](apps/api/src/auth/policy.ts), and `pnpm api:addon:check` ([`scripts/check-api-addon-boundary.mjs`](scripts/check-api-addon-boundary.mjs)).
- [x] **DSK-0.5** Audit `@moonwitness/orm-ai` schema & validation foundations (`ai.agent`, `ai.provider_profile`, `ai.model_profile`, `ai.execution_policy`, `ai.capability_grant`, `ai.work_contract`, `ai.acceptance_criterion`, `ai.agent_run`, `ai.artifact_manifest`, `ai.obligation`, `isActiveCapabilityGrant`, `isAllowedClassificationRoute`) in [`packages/orm-ai/src/manifest.ts`](packages/orm-ai/src/manifest.ts) and [`packages/orm-ai/src/validation.ts`](packages/orm-ai/src/validation.ts).
- [x] **DSK-0.6** Audit `@moonwitness/ai-runtime` provider/redaction/secret primitives and verify isolation of K7 loopback-only `@moonwitness/local-ai` in [`packages/ai-runtime/src/types.ts`](packages/ai-runtime/src/types.ts), [`packages/ai-runtime/src/providers/ollama-adapter.ts`](packages/ai-runtime/src/providers/ollama-adapter.ts), [`packages/ai-runtime/src/redaction.ts`](packages/ai-runtime/src/redaction.ts), [`packages/ai-runtime/src/secrets.ts`](packages/ai-runtime/src/secrets.ts), and [`packages/local-ai/src/index.ts`](packages/local-ai/src/index.ts).
- [x] **DSK-0.7** Authoritative Desktop Architecture Decision Record created at [`docs/architecture/adr/0008-local-first-desktop-agent-harness.md`](docs/architecture/adr/0008-local-first-desktop-agent-harness.md).
- [x] **DSK-0.8** Detailed Desktop Local-First Architecture, Mermaid diagrams, sync protocol, and STRIDE threat model created at [`docs/architecture/desktop-local-first-harness.md`](docs/architecture/desktop-local-first-harness.md).
- [x] **DSK-0.9** AI Corporation Blueprint extension created at [`moonwitness-ai-corporation-blueprint/docs/AI-CORPORATION-DESKTOP-HARNESS.md`](moonwitness-ai-corporation-blueprint/docs/AI-CORPORATION-DESKTOP-HARNESS.md).
- [x] **DSK-0.10** Granular `DSK-0`–`DSK-10` checklist created at [`todo-desktop.md`](todo-desktop.md) and verified with [`scripts/check-docs.mjs`](scripts/check-docs.mjs) (zero broken Markdown links).
- [x] **DSK-0.11** Reconcile ADR numbering in `docs/decisions/` between Desktop Harness ADR (`0008`) and `M12.06` A2A ADR slot referenced in [`docs/roadmap/13-ai-corporation.md`](docs/roadmap/13-ai-corporation.md) before opening desktop code PRs.
- [ ] **DSK-0.12** Register desktop engineering track tasks in `docs/roadmap/tasks.json` and `ROADMAP.md` (only when maintainer activates desktop implementation batch under [`docs/decisions/0001-platform-contracts.md`](docs/decisions/0001-platform-contracts.md)).

---

## `DSK-1` — `apps/desktop` Scaffold, Tauri v2 Window & Zero-Overlap `apps/board` Shell

**Goal:** Scaffold `apps/desktop` (`@moonwitness/desktop`) as a hardened Tauri v2 native window + Node `22.x` ESM harness sidecar hosting `apps/board` with zero duplicated UI pages, zero duplicated CSS tokens, and zero duplicated ORM models.

- [x] **DSK-1.1** Create `apps/desktop/package.json` (`@moonwitness/desktop`, `"version": "1.0.0-rc.1"`, `"private": true`, ESM `"type": "module"`, scripts for `build`, `test`, `typecheck`) referencing `@moonwitness/types` and `@moonwitness/orm` (core foundation wired; remaining runtime integrations `@moonwitness/orm-*`, `@moonwitness/jobs`, `@moonwitness/ai-runtime`, `@moonwitness/local-ai`, `@moonwitness/logger` pending) without duplicating UI or model files.
- [x] **DSK-1.2** Configure `apps/desktop/tsconfig.json`, `apps/desktop/tsconfig.check.json`, and `apps/desktop/vitest.config.ts` extending `tsconfig.base.json` with strict TypeScript (`noImplicitAny`, zero explicit `any` per `@moonwitness/eslint-config`).
- [x] **DSK-1.3** Author `apps/desktop/tauri.conf.json` (`com.moonwitness.desktop`) binding `devUrl: http://127.0.0.1:5173/board` and `frontendDist: ../board/.next/standalone/apps/board` directly to `apps/board` with single-window navigation containment.
- [x] **DSK-1.4** Enforce hardened Tauri v2 security flags in `tauri.conf.json`: `withGlobalTauri: false`, `freezePrototype: true`, `dangerousDisableAssetCspModification: false`, `frame-ancestors: ['none']`, `object-src: ['none']`, and `connect-src` allowlisting `'self'`, loopback (`127.0.0.1` / `localhost` on `3000`, `5173`, `11434`), and `ipc:` / `http://ipc.localhost`.
- [x] **DSK-1.5** Implement Node `22.x` ESM sidecar entrypoint (`apps/desktop/src/index.ts`, `apps/desktop/src/bridge.ts`) managing `createDesktopHarnessBridge`, crash-safe lifecycle disposal (`dispose()`), and single-instance sidecar coordination.
- [x] **DSK-1.6** Wire Tauri native Rust shell (`src-tauri/`) / sidecar launcher spawning the hardened Node `22.x` `@moonwitness/desktop` harness process and forwarding validated `window.__MW_DESKTOP__` commands.
- [x] **DSK-1.7** **INVARIANT:** Add `scripts/check-desktop-non-overlap.mjs` (`pnpm desktop:ui:check`) asserting `apps/desktop` contains zero forked `apps/board` page routes, zero raw HTML form controls (`<button>`, `<input>`, `<select>`, `<textarea>`, `<svg>`), zero `defineModel`/`defineAddon` calls, and `apps/board` contains zero `better-sqlite3`, `node-pty`, `node:fs`, or Tauri runtime imports.
- [x] **DSK-1.8** Extend `apps/board` Mission Control & shell (`apps/board/src/components/layout/app-shell.tsx` and future `/board/ai/*` views) with progressive-enhancement detection of `window.__MW_DESKTOP__` to mount Desktop Harness drawers (Worktree Diff, Bounded PTY Console, SQLite Sync Status, Local MCP Inspector) purely using `@moonwitness/ui` primitives.
- [x] **DSK-1.9** Verify `apps/board` passes `pnpm board:ui:check`, `pnpm --filter @moonwitness/board typecheck`, `pnpm --filter @moonwitness/board lint`, and `pnpm board:budget` unchanged when `window.__MW_DESKTOP__` is undefined (web mode).
- [x] **DSK-1.10** Implement OS keychain secret store adapter in the native host keyed to `MW_AI_*` secret references; ensure webview renderer never reads decrypted credentials.
- [x] **DSK-1.11** Implement native `R3` human-confirmation dialog / `HumanApprovalToken` issuer outside webview DOM so XSS cannot forge `R3` approval tokens.
- [x] **DSK-1.12** Wire `@moonwitness/logger` (Pino with `AI_LOGGER_REDACT_PATHS` and rotating local log directory `~/.moonwitness/logs/`) with bounded disk retention.

---

## `DSK-2` — Dual-Dialect `@moonwitness/orm` Local SQLite Sidecar (`~/.moonwitness/local.db`)

**Goal:** Run the exact same `@moonwitness/orm` addon manifests offline/local-first inside `~/.moonwitness/local.db` with 100% schema, constraint, trigger, and company-isolation parity against PostgreSQL.

- [x] **DSK-2.1** Verify `@moonwitness/orm` `installAddons` / `syncModel` supports `better-sqlite3` table creation, composite `(company_id, active, id)` indexes, `_orm_addons`, and `_orm_data` idempotency (`packages/orm/src/addon.ts`).
- [x] **DSK-2.2** Verify `@moonwitness/orm-workflow` and `@moonwitness/orm-knowledge` `addon.setup` hooks install SQLite `BEFORE UPDATE` / `BEFORE DELETE` append-only triggers alongside PostgreSQL triggers.
- [x] **DSK-2.3** Verify `@moonwitness/jobs` `supportsSkipLocked` switches cleanly between PostgreSQL `FOR UPDATE SKIP LOCKED` and SQLite transactional claiming (`packages/jobs/src/runtime.ts`).
- [x] **DSK-2.4** Verify `@moonwitness/orm-storage` `LocalFileAttachmentStorage` writes atomic temp-then-rename UUID blobs with SHA-256 verification and symlink checks (`packages/orm-storage/src/index.ts`).
- [x] **DSK-2.5** Implement `LocalSidecar` controller (`apps/desktop/src/local-sidecar.ts`) resolving `~/.moonwitness/local.db` (Windows `%USERPROFILE%\.moonwitness\local.db`, POSIX `$HOME/.moonwitness/local.db`, override `MW_DESKTOP_HOME`), configuring `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`, `PRAGMA foreign_keys = ON`, and `PRAGMA busy_timeout = 5000`.
- [x] **DSK-2.6** Implement single-writer OS lockfile (`~/.moonwitness/local.db.lock` with PID + start-time liveness check) to serialize DDL/addon upgrades and job claiming across accidental duplicate desktop launches (compensating for SQLite lacking `pg_advisory_xact_lock`).
- [x] **DSK-2.7** Assemble canonical `DESKTOP_ADDONS` list (`orm-base`, `orm-organization`, `jobs`, `orm-notification`, `orm-workflow`, `orm-storage`, `orm-knowledge`, `orm-ai`) and run `installAddons(sqliteDb, DESKTOP_ADDONS)` + `registerAddons` on sidecar startup.
- [x] **DSK-2.8** Audit and normalize dual-dialect column/type edge cases between `pg` and `better-sqlite3` (boolean `0/1` vs `true/false`, ISO-8601 UTC string timestamps, JSON column serialization, `ALTER TABLE` FK limits on SQLite in `syncModel`).
- [x] **DSK-2.9** Bind `LocalFileAttachmentStorage` root at `~/.moonwitness/storage/` inside `ServiceContainer` (`Environment.services`) for local `ai.artifact_manifest` evidence storage prior to central upload.
- [x] **DSK-2.10** Add company-partition enforcement on all local SQLite queries (`company_id` filter + active session scrub when switching companies) so multi-company developers never leak cached company A rows to company B.
- [x] **DSK-2.11** Implement optional SQLite-at-rest encryption / OS-protected key binding design review and backup/export command (`~/.moonwitness/backups/`) compatible with `addon.upgrade`.
- [x] **DSK-2.12** Write dual-dialect parity tests executing `@moonwitness/orm-ai`, `@moonwitness/jobs`, and `DESKTOP_ADDONS` conformance identically against `better-sqlite3` (`~/.moonwitness/local.db` fixture) and PostgreSQL.

---

## `DSK-3` — Offline-First Sync Engine & Proof-Carrying Work (PCW) Reconciliation

**Goal:** Synchronize assigned work contracts, policies, capability grants, and approved knowledge snapshots down to `~/.moonwitness/local.db`, and reliably push hashed Proof-Carrying Work (`PcwSyncEnvelope` covering `ai.agent_run`, `ai.artifact_manifest` / `ai.evidence_artifact` SHA-256 digests, `base.outbox_event`) back to central `apps/api` PostgreSQL.

- [x] **DSK-3.1** Define and export canonical PCW sync contracts (`LocalSidecarState`, `PcwSyncEnvelope`, `PcwArtifactDigest`, `UpstreamPcwSyncTransport`, `PcwSyncBatchResult`, `PcwOutboxModelName`) across `apps/desktop/src/types.ts` and `@moonwitness/types`.
- [x] **DSK-3.2** Add dedicated company-scoped desktop sync endpoints in an addon Fastify plugin (mounted via `API_ADDONS`, never generic `/api/ai.*` CRUD since `'ai.'` is in `INTERNAL_PREFIXES`): `POST /api/ai/desktop/lease`, `GET /api/ai/desktop/pull`, `POST /api/ai/desktop/pcw-sync`, `POST /api/ai/desktop/artifacts/upload`.
- [x] **DSK-3.3** Implement upstream pull sync in `apps/desktop`: pulls company-scoped `ai.work_contract`, `ai.acceptance_criterion`, `ai.execution_policy`, active `ai.capability_grant`, `ai.provider_profile` / `ai.model_profile` metadata, and read-only `knowledge.*` releases via `@moonwitness/client`.
- [x] **DSK-3.4** Implement central worker lease claiming (`base.job` `lease_owner: desktop:<hostId>`, monotonic `fencingToken`) before executing shared central `ai.work_contract` items offline, preventing split-brain duplicate runs across devices.
- [x] **DSK-3.5** Support locally initiated draft runs offline (`setOfflineMode(true)`) using deterministic `envelopeSha256` and client UUID `idempotency_key` (`unique: [['company', 'idempotency_key']]` on `ai.agent_run`), reconciling server IDs cleanly upon reconnect without PK collisions.
- [x] **DSK-3.6** Implement atomic local persistence (`Environment.runInTransaction` on SQLite): commit `ai.agent_run` state, `ai.artifact_manifest` (`sha256`, `storage_key`, `size_bytes`, `source_sha`, `verification_status: 'produced' | 'checked'`), criterion results, and `base.outbox_event` together via `enqueuePcwEnvelope`.
- [x] **DSK-3.7** Implement resilient outbox drain loop (`syncPending(transport)`) using exponential backoff, online/offline connectivity check (`/readyz`), `R3` `upstream.sync_push` policy evaluation, and ordered streaming upload of blobs from `~/.moonwitness/storage/` to `apps/api` `AttachmentStorage`.
- [x] **DSK-3.8** Enforce server-side SHA-256 verification during PCW ingestion on `apps/api`: recompute digest of every uploaded stream, verify match against `ai.artifact_manifest.sha256` and `envelopeSha256` (returning `outcome: 'conflict'` on mismatch), verify grant validity & `fencingToken` monotonicity, and persist transactionally.
- [x] **DSK-3.9** **INVARIANT:** Enforce server-only `accepted` transitions: local SQLite sync payloads can never set `ai.work_contract.status = 'accepted'` or bypass `orm-workflow` `requireDifferentActor: true`.
- [x] **DSK-3.10** Implement grant-revocation & emergency-stop propagation: central revocations (`CapabilityGrant.revoked_at`, `Agent.is_emergency_stopped`) immediately invalidate local cached grants and fire `AbortSignal` on active local runs.
- [x] **DSK-3.11** Implement conflict quarantine UI & outbox inspection (`conflictOutboxCount`, `failedOutboxCount`, `listEnvelopes`) with operator retry/discard actions.
- [x] **DSK-3.12** Implement local storage & SQLite GC (`reconcileAttachmentStorage` / `pruneOrphanAttachmentStorage` after `synced` receipt + retention expiry).

---

## `DSK-4` — `window.__MW_DESKTOP__` (`DesktopCapabilityBridge`) & Hardened IPC Membrane

**Goal:** Expose native desktop capabilities to `apps/board` strictly via a frozen, versioned, schema-validated `window.__MW_DESKTOP__` bridge (`DesktopCapabilityBridge` / `DesktopHarnessBridge`) with zero raw IPC leaks.

- [x] **DSK-4.1** Align `DesktopCapabilityBridge` interface (`protocolVersion: '1.0'`, `hostSurface: 'apps/board'`, `getStatus`, `worktree`, `pty`, `risk`, `sidecar`, `mcp`, `dispose`) across `apps/desktop/src/types.ts` and `@moonwitness/types`.
- [x] **DSK-4.2** Augment `Window` type cleanly (`__MW_DESKTOP__?: DesktopCapabilityBridge`) so `apps/board` safely typechecks with optional chaining in both browser and Tauri contexts.
- [x] **DSK-4.3** Implement Tauri / bridge attachment layer (`apps/desktop/src/bridge.ts`) attaching an `Object.freeze(...)` `DesktopCapabilityBridge` instance onto `window.__MW_DESKTOP__` with `freezePrototype: true` active in `tauri.conf.json`.
- [x] **DSK-4.4** Enforce sender origin & window-label verification on every bridge command (origin must match `boardOrigin` / loopback `127.0.0.1` / `localhost` allowlist; reject external origins and subframes).
- [x] **DSK-4.5** Validate every IPC / bridge argument payload with strict schema checks (`coerceTypes: false`, bounded string/array lengths, UUID/pattern checks) before invoking native managers.
- [x] **DSK-4.6** Implement `useDesktopBridge()` hook in `apps/board` returning `{ isDesktop: boolean; bridge: DesktopCapabilityBridge | null }` with SSR safety (`typeof window !== 'undefined'`).
- [x] **DSK-4.7** Implement streaming event backpressure & unsubscribe cleanup for PTY output and harness step progress so closed tabs/drawers never leak listeners.
- [x] **DSK-4.8** Bind opaque `runId` / `leaseId` tokens in the sidecar host so webview code cannot fabricate arbitrary OS PIDs, arbitrary `cwd` paths, or unvalidated `HumanApprovalToken` objects.
- [x] **DSK-4.9** Write automated bridge security tests verifying `withGlobalTauri: false`, invalid origin rejection, oversized payload rejection, and frozen prototype tampering resistance (`Object.isFrozen(window.__MW_DESKTOP__)`).
- [x] **DSK-4.10** Document the full `DesktopCapabilityBridge` contract and error codes for `apps/board` Mission Control contributors.

---

## `DSK-5` — Isolated Git Worktree Manager (`.mw-worktrees/run-<id>`) & Patch Engine

**Goal:** Give every write-capable agent run an isolated Git worktree (`GitWorktreeLease`) so parallel or speculative agent work never corrupts the developer's active working directory.

- [x] **DSK-5.1** Implement `GitWorktreeSandbox` (`apps/desktop/src/worktree-sandbox.ts`) invoking `git` exclusively via `execFile('git', args, { shell: false })` with explicit `repoRoot` allowlist validation.
- [x] **DSK-5.2** Provision per-run isolated worktrees at `<repoRoot>/.mw-worktrees/run-<id>` (or configured `worktreeBaseDir`) on dedicated branch `mw/run-<id>` pinned to verified `baseRef` / `headCommit`.
- [x] **DSK-5.3** Enforce exclusive per-worktree writer lease (`GitWorktreeLease` with monotonic `fencingToken`) and validate base repo state before `git worktree add`.
- [x] **DSK-5.4** Auto-ensure `.mw-worktrees/` is ignored locally (`.git/info/exclude`) without silently modifying tracked `.gitignore`.
- [x] **DSK-5.5** Implement deterministic diff & patch generator (`WorktreeDiffSummary`: `files[]`, `patch`, 64-hex `patchSha256`) storing patch artifacts in `LocalFileAttachmentStorage` -> `ai.artifact_manifest`.
- [x] **DSK-5.6** Enforce `R2` (`git.commit_local`) and `R3` (`git.push_remote` with `HumanApprovalToken`) boundaries via `DesktopRiskGate` before committing or promoting worktree changes.
- [x] **DSK-5.7** Handle merge/apply conflicts cleanly: abort partial apply on conflict, preserve the run worktree intact, and surface structured conflict hunks in `apps/board` diff drawer.
- [x] **DSK-5.8** Implement deterministic worktree release & prune (`git worktree remove --force` + branch pruning) on run cancellation, expiry, or `release(runId)`, including Windows file-handle retry/backoff (`EBUSY` / `EPERM`).
- [x] **DSK-5.9** Build Worktree Diff Inspector drawer in `apps/board` (using `@moonwitness/ui` primitives, keyboard navigation, and `reducedMotion` compliance) powered by `bridge.worktree.diff(runId)`.
- [x] **DSK-5.10** Test concurrent multi-run worktree isolation (`run-1` and `run-2` editing distinct files simultaneously without collision, clean teardown, and `R3` gate denial without approval token).

---

## `DSK-6` — Bounded PTY / Terminal Runner & `R0–R4` (`DesktopRiskGate`) Enforcement

**Goal:** Execute verification commands and scoped build/test tools inside a bounded runner gated at execution time by `DesktopRiskGate` (`R0–R4`) and active `ai.capability_grant` records.

- [x] **DSK-6.1** Implement bounded command/PTY runner (`apps/desktop/src/worktree-sandbox.ts` / `pty.execute`) supporting Windows (direct `execFile` / PowerShell 5.1 safe spawning without `&&` assumptions) and macOS/Linux (`node-pty` / POSIX process groups).
- [x] **DSK-6.2** **INVARIANT:** Evaluate `DesktopRiskGate.assertAllowed(...)` (`apps/desktop/src/risk-gate.ts`) and [`isActiveCapabilityGrant`](packages/orm-ai/src/validation.ts#L200-L226) (`companyId`, `agentId`, `workContractId`, `expectedPolicyVersion`, `expiresAt`, `revokedAt`, `maxCallsPerRun`) at **execution time** for every command.
- [x] **DSK-6.3** Enforce deterministic `DesktopRiskGate` (`R0–R4`) action classification (`BASE_ACTION_TIER` + dynamic path/command/URL escalation):
  - `R0`: `repo.read`, `repo.search`, `git.status`, `git.diff`, `sidecar.read`, `mcp.read` (PTY denied).
  - `R1`: `worktree.create`, `worktree.write`, `worktree.test`, `pty.exec_local`, `mcp.local_write` (scoped inside `.mw-worktrees/run-<id>`).
  - `R2`: `git.commit_local`, `sidecar.sync_local`, `service.local_start`.
  - `R3`: `git.push_remote`, `network.egress`, `cloud.provider_call`, `upstream.sync_push`, or remote egress commands (`curl`, `wget`, `iwr`, `git push`) -> requires single-use `HumanApprovalToken`.
  - `R4`: `secret.read`, `system.destructive`, `worktree.escape`, `privilege.escalate`, `.env*`/key paths, `rm -rf /`, `sudo`, `printenv` -> unconditionally blocked (`RISK_R4_PROHIBITED`).
- [x] **DSK-6.4** Pin `cwd` strictly inside verified `realpath` of `.mw-worktrees/run-<id>` via `cwdRelative`; reject external or traversal `cwd` inputs.
- [x] **DSK-6.5** Construct scrubbed child environment allowlist (`PATH`, `HOME`/`USERPROFILE`, `TEMP`/`TMP`, `LANG`, `NODE_ENV`), stripping all `MW_AI_*`, `JWT_SECRET`, `METRICS_TOKEN`, `WHATSAPP_*`, and cloud credentials (and rejecting forbidden `envOverrides`).
- [x] **DSK-6.6** Enforce hard `timeoutMs` wall-clock deadline and `AbortSignal` cancellation with cross-platform full process-tree termination (`taskkill /PID <pid> /T /F` on Windows, `process.kill(-pid, 'SIGKILL')` on POSIX).
- [x] **DSK-6.7** Enforce bounded `maxOutputBytes` stdout/stderr truncation (`truncated: true`) with real-time `redactSensitiveText` / [`createRedactor()`](packages/ai-runtime/src/redaction.ts#L207-L244) scrubbing and compute `stdoutSha256` & `stderrSha256`.
- [x] **DSK-6.8** Record every PTY evaluation and execution (`RiskAuditRecord` + `BoundedPtyCommandResult` digests) into `~/.moonwitness/local.db` + `base.audit_log`.
- [x] **DSK-6.9** Enforce `maxCallsPerRun` quota tracking (`RUN_QUOTA_EXCEEDED`) and concurrent process cap per run to prevent fork bombs or quota exhaustion.
- [x] **DSK-6.10** Build Bounded PTY Console drawer in `apps/board` (using `@moonwitness/ui` scroll/badge/button primitives + `Stop` emergency kill button).
- [x] **DSK-6.11** Test Windows PowerShell 5.1 / POSIX process-tree cleanup (child spawned grandchild processes are terminated on timeout or Emergency Stop with zero orphan processes).
- [x] **DSK-6.12** Test grant revocation & `HumanApprovalToken` replay rejection: revoked grants and reused `R3` approval tokens throw `AccessDeniedError` (`GRANT_REVOKED` / `HUMAN_APPROVAL_REPLAYED`).

---

## `DSK-7` — Path-Allowlisted File & Diff Inspector (Traversal & Symlink Protection)

**Goal:** Provide fast, bounded filesystem inspection and diff viewing for agents and operators while guaranteeing zero traversal, symlink/junction escape, or secret-file leakage.

- [x] **DSK-7.1** Implement path containment guard in `apps/desktop/src/worktree-sandbox.ts` validating explicit per-contract `allowedPathPrefixes` and `grant.allowedPaths` inside `.mw-worktrees/run-<id>`.
- [x] **DSK-7.2** Reject null bytes (`\0`), Windows UNC paths (`\\server\share`), Windows device namespaces (`\\.\`, `\\?\`), cross-drive paths, and explicit `..` traversal attempts before filesystem access.
- [x] **DSK-7.3** Perform `fs.lstat` + `fs.realpath` resolution on both allowlisted root and every path segment / final target, verifying `path.relative(realRoot, realTarget)` stays inside `realRoot`—blocking both POSIX symlinks and Windows NTFS directory junctions pointing outside the workspace.
- [x] **DSK-7.4** Enforce `isSecretOrSensitivePath` / `SENSITIVE_PATH_PATTERNS` blocking `.env*`, `.git/*`, `.ssh/*`, `.aws/*`, `.npmrc`, `.netrc`, `id_rsa`, `id_ed25519`, `credentials.json`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, and `~/.moonwitness/local.db*` (`R4` `RISK_R4_PROHIBITED`).
- [x] **DSK-7.5** Implement bounded UTF-8 reader (`worktree.readFile`) returning `WorktreeFileContent` with `sha256`, `sizeBytes`, line-range slicing, and binary/NUL-byte guard.
- [x] **DSK-7.6** Implement allowlisted directory tree lister respecting `.gitignore` / `.mw-worktrees` filters and deterministic entry caps to prevent context flooding.
- [x] **DSK-7.7** Implement `worktree.writeFile(runId, relativePath, content, auth)` requiring `DesktopActionAuthContext`, `PathAllowlist` + `grant.allowedPaths` validation, and atomic temp-file write inside `.mw-worktrees/run-<id>` only.
- [x] **DSK-7.8** Apply `redactSensitiveText` / [`createRedactor()`](packages/ai-runtime/src/redaction.ts#L207-L244) safety scan on inspected content before returning across IPC or logging.
- [x] **DSK-7.9** Build Path-Allowlisted File & Diff Inspector panel in `apps/board` (accessible keyboard navigation, line-range citations linking to `PcwArtifactDigest`).
- [x] **DSK-7.10** Write comprehensive traversal & symlink/junction escape tests (`../`, symlink to `/etc/passwd` or `C:\Windows\System32`, Windows NTFS junction escape, `.env` read denial, binary file rejection).

---

## `DSK-8` — Local Stdio / Loopback MCP Host & `@moonwitness/ai-mcp` Integration

**Goal:** Host local stdio/loopback MCP servers (including `@moonwitness/ai-mcp`) inside `apps/desktop` (`apps/desktop/src/mcp-host.ts`) behind `DesktopRiskGate`, ensuring MCP servers never bypass authorization, quotas, schemas, or company isolation.

- [x] **DSK-8.1** Implement `LocalMcpHost` (`apps/desktop/src/mcp-host.ts`) managing allowlisted `LocalMcpServerConfig` entries (`stdio` spawned via `execFile` with `shell: false` and scrubbed env, or `loopback_http` verified via `isLoopbackEndpointUrl`).
- [x] **DSK-8.2** Frame JSON-RPC 2.0 stdio transport (`Content-Length` / NDJSON per MCP `2026-07-28` spec) with strict message-size limits, initialization handshake validation, and health-probe heartbeats.
- [x] **DSK-8.3** Wire `@moonwitness/ai-mcp` in stdio mode so local agents can invoke MoonWitness domain tools (assigned `ai.work_contract`, approved `knowledge.*` retrieval, `ai.artifact_manifest` refs, and scoped idempotent writes) backed by `apps/api` or local sidecar services—never direct raw SQL.
- [x] **DSK-8.4** Route **every** `mcp.invoke(LocalMcpToolInvocationRequest)` through `DesktopRiskGate`: re-check `isActiveCapabilityGrant`, `companyId`, `workContractId`, `expectedPolicyVersion`, `maxCallsPerRun`, `allowedDataClassifications`, and `maxRiskTier` (`R0–R4`) at execution time.
- [x] **DSK-8.5** Validate tool inputs and outputs against declared JSON Schemas (`validateJsonSchema` in `@moonwitness/ai-runtime`); reject malformed arguments or oversized outputs deterministically.
- [x] **DSK-8.6** Tag all MCP tool outputs as **untrusted external data** in prompt framing and run `redactSensitiveValue` before recording `outputSha256` or returning `LocalMcpToolInvocationResult`.
- [x] **DSK-8.7** Require explicit `R3` `HumanApprovalToken` for external-effect MCP tools and enforce `idempotency_key` deduplication on retryable local write tools.
- [x] **DSK-8.8** Audit every allowed and denied MCP invocation (`RiskAuditRecord` + `callCountForRun` + `durationMs`) to `~/.moonwitness/local.db` + `base.audit_log`.
- [x] **DSK-8.9** Build Local MCP Host Inspector panel in `apps/board` showing connected server health, tool catalog with risk tiers, and redacted call audit trail.
- [x] **DSK-8.10** Write adversarial MCP tests covering malicious tool output prompt injection, unauthorized tool invocation, expired/revoked grant mid-run, non-loopback `endpointUrl` rejection, and server crash recovery.

---

## `DSK-9` — Plan–Execute–Verify Loop & Local/Cloud Classification Routing

**Goal:** Implement the complete bounded Plan–Execute–Verify `AgentHarness` loop inside `@moonwitness/ai-runtime` / `apps/desktop`, routing Ollama, local DeepSeek / vLLM, and cloud providers strictly by data classification while preserving `@moonwitness/local-ai`'s K7 isolation.

- [x] **DSK-9.1** Verify `@moonwitness/ai-runtime` defines `AiProvider`, `ModelProfileConfig`, `AgentHarness`, `ProviderError`, and `DataClassification` (`local_only`, `cloud_eligible`, `restricted`) (`packages/ai-runtime/src/types.ts`).
- [x] **DSK-9.2** Verify `OllamaAdapter` implements `/api/tags` health check, `/api/chat` & `/api/generate`, loopback URL validation (`localhost`, `127.0.0.1`, `::1`), `redirect: 'error'`, and streaming/non-streaming bounds (`packages/ai-runtime/src/providers/ollama-adapter.ts`).
- [x] **DSK-9.3** Verify [`isAllowedClassificationRoute`](packages/orm-ai/src/validation.ts#L154-L177) blocks cloud routing for `local_only` and `restricted` classifications and verify `@moonwitness/local-ai` remains tool-free (`AI_MODE=disabled` default).
- [x] **DSK-9.4** Add OpenAI-compatible local loopback adapter support in `@moonwitness/ai-runtime` (for local **DeepSeek**, **vLLM**, **llama.cpp** endpoints pinned strictly via `validateLoopbackEndpointUrl`, distinct from external HTTPS `openai` adapter).
- [x] **DSK-9.5** Implement `DataClassificationRouter` (`packages/ai-runtime/src/router.ts`) enforcing fail-closed provider selection: zero silent fallback from `local_only` / `restricted` to cloud; SSRF DNS resolution check (`assertPublicDnsResolution`) on HTTPS cloud calls.
- [x] **DSK-9.6** Implement `PlanExecuteVerifyHarness` (`AgentHarness.execute(...)`) in `@moonwitness/ai-runtime` wired to `apps/desktop`:
  - **Plan:** Emit JSON-Schema-validated structured plan (`PlanEnvelope`) referencing `ai.acceptance_criterion[]` and `ExecutionPolicy` budgets (`max_steps`, `max_wall_clock_seconds`, `max_tokens_per_run`, `max_cost_micros_per_run`).
  - **Execute:** Bounded tool loop dispatching worktree, file inspector, PTY, and MCP tools via `DesktopCapabilityBridge` + `DesktopRiskGate`, checkpointing `checkpoint_cursor` + `checkpoint_json` on `ai.agent_run` after each safe step boundary.
  - **Verify:** Run deterministic verifier hooks (`automated_test`, `schema_check`, `source_inspection`) against `.mw-worktrees/run-<id>` and assemble SHA-256 `evidence_bundle` (`PcwSyncEnvelope`).
- [x] **DSK-9.7** Wire `@moonwitness/jobs` durable job handler (`ai.desktop_agent_run@v1`) in `apps/desktop` sidecar with lease heartbeat, `fencingToken` checks (`LeaseLostError`), `AbortSignal` cancellation propagation to provider & PTY, and safe crash resume from `checkpoint_cursor`.
- [x] **DSK-9.8** Enforce untrusted-data prompt separation: repository files, git diffs, MCP tool outputs, and retrieved `ai.memory_candidate` items are encapsulated as untrusted data blocks that can never expand `CapabilityGrant` or override `systemPolicy`.
- [x] **DSK-9.9** Implement local-AI K7 non-interference integration: allow `apps/board` desktop research panels to query `@moonwitness/local-ai` K7 suggestion routes independently without ever passing `DesktopCapabilityBridge` tools into `@moonwitness/local-ai`.
- [x] **DSK-9.10** Implement independent reviewer & `ai.obligation` workflow handoff: after local `Verify` succeeds, mark local criteria `checked` (never `accepted`), sync `PcwSyncEnvelope` to `apps/api`, and trigger independent reviewer / `orm-workflow` (`requireDifferentActor: true`).
- [x] **DSK-9.11** Implement local provider health probe & model-profile auto-discovery (`Ollama` `/api/tags`, local DeepSeek/vLLM `/v1/models` on `127.0.0.1` only) surfaced in `apps/board` Provider Health drawer without transmitting prompt content.
- [x] **DSK-9.12** Implement token & micro-USD cost tracking (`estimated` vs `provider_reported` per `TokenUsage`) with hard pre-step budget cutoff (`status: 'budget_exhausted'`).
- [x] **DSK-9.13** Run deterministic `MockProvider` end-to-end tests of `PlanExecuteVerifyHarness` covering `R0` read-only inspection, `R2` worktree fix + verify pass, false-completion rejection (missing test evidence), and budget/timeout cutoff.
- [x] **DSK-9.14** Run local loopback `OllamaAdapter` / DeepSeek-vLLM contract tests (graceful `unavailable` handling when local model daemon is offline; zero SQLite state corruption).

---

## `DSK-10` — Threat-Model Security Suite, Offline/Sync Chaos Drills, Packaging & CI

**Goal:** Prove security containment, offline durability, dual-dialect sync correctness, reproducible desktop packaging, and automated CI gates before shipping `apps/desktop`.

- [x] **DSK-10.1** Build adversarial prompt-injection & tool-poisoning suite (malicious repo files & MCP responses attempting `.env` exfil, `R4` commands, or capability escalation -> **0** unauthorized actions).
- [x] **DSK-10.2** Build adversarial filesystem containment suite (POSIX symlinks, Windows NTFS junctions, `..` traversal, UNC paths, `.git/config` & `local.db` read attempts -> **100%** blocked & audited).
- [x] **DSK-10.3** Build data-classification egress test suite (`local_only` and `restricted` runs with offline local provider and mocked cloud fallback -> guaranteed `DATA_CLASSIFICATION_VIOLATION` / `CLASSIFICATION_EGRESS_BLOCKED`, zero outbound network calls).
- [x] **DSK-10.4** Build webview/IPC security test suite (`withGlobalTauri: false`, `freezePrototype: true`, CSP enforcement, origin spoofing rejection, secret scrubbing verification in logs and bridge responses).
- [x] **DSK-10.5** Build offline/online chaos & crash-recovery drills:
  - Worker crash mid-execute -> safe resume from `ai.agent_run.checkpoint_cursor`.
  - Network disconnect mid-PCW upload -> idempotent outbox retry on reconnect (`syncPending`) with zero duplicate artifacts.
  - Tampered SHA-256 blob upload -> server rejects (`conflict`) and quarantines envelope (`conflictOutboxCount`).
  - Concurrent revocation during active PTY -> immediate `AbortSignal` process-tree termination.
- [x] **DSK-10.6** Add Node `22.x` LTS native ABI rebuild verification for `better-sqlite3` and `node-pty` alongside Tauri v2 sidecar bundling on Windows and Linux/macOS CI runners.
- [x] **DSK-10.7** Configure reproducible Tauri v2 desktop packaging (`tauri build` / unsigned CI bundle check + platform signing hooks for Windows Authenticode / macOS notarization without committing signing secrets).
- [x] **DSK-10.8** Add desktop Playwright E2E harness launching `apps/desktop` / `apps/board` with `window.__MW_DESKTOP__` attached against mock `apps/api` + `MockProvider` verifying worktree diff review, bounded PTY execution, and offline sync banner.
- [x] **DSK-10.9** Add `apps/desktop` checks to CI (`.github/workflows/ci.yml` using SHA-pinned actions): `pnpm --filter @moonwitness/desktop build`, `typecheck`, `lint`, `test`, and `pnpm desktop:ui:check`.
- [x] **DSK-10.10** Verify `pnpm api:addon:check`, `pnpm board:ui:check`, `pnpm board:budget`, `pnpm test:addon-conformance`, and `node scripts/check-docs.mjs` remain 100% green after `apps/desktop` additions.
- [x] **DSK-10.11** Verify zero explicit `any` across all `apps/desktop` TypeScript files (`pnpm lint`) and Prettier compliance (`pnpm format:check`).
- [x] **DSK-10.12** Add operator runbook for desktop troubleshooting (`~/.moonwitness/local.db` diagnostics, lockfile recovery, worktree GC, secret rotation via OS keychain) and register in `docs/guide/navigation.json`.
- [x] **DSK-10.13** Run full `pnpm verify` + `POSTGRES_TEST_URL` integration tests proving end-to-end SQLite sidecar -> Fastify `apps/api` -> PostgreSQL PCW reconciliation.
- [x] **DSK-10.14** Record final release verification evidence and update all checkboxes `[x]` only from observed test runs on the target `dev` SHA.
