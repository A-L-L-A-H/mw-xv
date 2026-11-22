# M13 — Desktop Engineering & ROCKSOUL FLOW

Status: **activated 2026-11-22** as a separate, maintainer-authorized engineering workstream. This workstream does not change the first-stable-release blockers or authorize application deployment.

M13 extends the existing MoonWitness Desktop local-first harness. It does not create a second desktop shell, agent runner, ORM, task authority, AI runtime, memory store, or design system.

## M13.01 — ROCKSOUL FLOW capability audit and first vertical-slice selection

- **Status:** complete (2026-11-22; audit deliverables and evidence verified on `dev` base `f3abe0937894b1fd309f675bd7bd86a15ee46e70`; no feature code implemented in M13.01)
- **Prerequisites:** M12.05, M12.06, M12.07, M12.11, M12.13; Desktop architecture baseline ADR 0008 is accepted.
- **Granular activation item:** DSK-0.12 in [the Desktop engineering ledger](../../todo-desktop.md).
- **Source reference:** [bjo163/rocksouldx](https://github.com/bjo163/rocksouldx), catalogued as `ADAPT` in the [source migration matrix](../migration/SOURCE-MIGRATION-MATRIX.md). The matrix's `3157a62...` value is a README blob SHA, **not** a repository commit SHA; resolve and record the actual source commit before relying on any source file.
- **Deliverables:** `docs/architecture/rock-soul-flow-reuse-map.md` and `docs/roadmap/evidence/M13.01.md`.
- **Codex handoff:** [ROCKSOUL FLOW — local Codex instructions](rock-soul-flow-codex-handoff.md).

### Goal

Establish an exact-source, evidence-backed map of ROCKSOUL FLOW ideas against the current target implementation and select one smallest, genuinely missing vertical slice for a later implementation card.

### Capability areas to inspect

| ROCKSOUL FLOW area | Existing target owners to inspect first                                                                                 | Audit question                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Repo Radar         | `apps/desktop`, `packages/ai-runtime` (including repository inspection), isolated worktree and file-inspector contracts | Which repository facts are already indexed/read safely, and what is still missing?              |
| Overlap Detector   | `packages/ai-runtime`, `packages/ai-evaluation`, repository inspection and existing tests                               | Is there a deterministic duplicate/overlap signal, or only an unverified proposal?              |
| Plan Forge         | `packages/ai-runtime` workforce planner, `packages/orm-ai`, `packages/orm-project`, `packages/orm-workflow`             | Can a plan be represented by existing work contracts and project/workflow records?              |
| Prompt Forge       | AI runtime prompt/skill contracts, evaluation fixtures and documentation                                                | Is there a real versioning or review gap without creating another prompt registry?              |
| Task Deck          | `packages/orm-project`, `packages/orm-workflow`, `packages/jobs`, existing Board/AI views and Desktop bridge            | Can existing task/work-contract projections serve the experience?                               |
| Proof Gate         | PCW verifier, evidence artifact manifests, independent-review workflow and Desktop risk gate                            | Which proof checks are already authoritative, and what evidence remains absent?                 |
| Memory Ledger      | `packages/orm-ai` memory candidates/skill versions, memory evaluation and revocation rules                              | What is already canonical, and which memory states must remain candidate-only?                  |
| Visual DNA Lab     | `packages/assets`, `packages/ui`, UI Catalog and existing visual-review workflows                                       | Can artwork-first assets and current UI contracts cover the idea without a new rendering stack? |

This table is an inspection guide, not a claim that any listed capability is complete. Verify exact implementation files, public exports, callers and tests on the candidate SHA.

### Execution steps

1. Inspect the target checkout's exact `dev` SHA, clean/dirty state, applicable `AGENTS.md` files, package scripts and current roadmap status.
2. Read ADR 0008, the Desktop architecture, ADR 0007, the AI runtime/PCW contracts, `todo-desktop.md`, and the ROCKSOUL migration disposition.
3. Inspect the legacy ROCKSOUL FLOW source read-only. Record the exact source repository, branch, commit SHA, relevant paths and applicable licenses/notices. Do not mistake a README blob SHA for a commit SHA.
4. For each capability, record: requirement, target owner, exact source paths, caller/API, tests, status (`implemented`, `partial`, `missing`, or `blocked`), duplicate-authority risk, security/risk boundary, and evidence gap.
5. Recommend exactly one smallest next vertical slice with bounded files, acceptance criteria, dependencies, tests and rollback considerations. Do not implement that slice in M13.01; it becomes a separately reviewed M13.02 (or later) card after the audit.
6. Write the reuse map and evidence report. Keep unresolved rights, license or source-provenance findings explicit.

### Acceptance criteria

- All eight capability areas above have source-backed findings; no status is inferred from a directory name or README alone.
- Findings cite exact target file paths and tests, plus the exact legacy source commit/path where relevant.
- Existing owners and zero-overlap boundaries are explicit. A new package, addon, ORM model, agent runner or persistent registry is not proposed without a demonstrated responsibility gap.
- The selected vertical slice is genuinely missing or materially incomplete, testable in isolation, and does not depend on an unapproved legacy code import.
- The recommended slice preserves capability grants, tenant isolation, risk tiers, human approval, PCW evidence and independent acceptance wherever applicable.
- The handoff and evidence identify all unverified assumptions and skipped checks. No application test is claimed as passed unless it was run on the exact source.
- No legacy repositories are archived/deleted, no private or personal data is imported, and no application deployment or promotion to `main` occurs.

### Verification

For this documentation/audit-only task, run the narrow repository checks that are available in the checkout: roadmap task validation, roadmap/automation consistency, documentation links, formatting for changed files and `git diff --check`. Run package or application tests only if the audit uncovers an actual code change (which is outside M13.01).

M13.01 is complete: the reuse map and evidence file are present; the read-only audit selected M13.02 as the first implementation slice.

## M13.02 — Read-only revision-pinned Repo Radar Snapshot

- **Status:** complete (2026-11-22; verified on detached worktree over `origin/dev` base `ac1198e`)
- **Prerequisites:** M13.01 (`docs/architecture/rock-soul-flow-reuse-map.md` §3).
- **Deliverables:** `packages/ai-runtime/src/repo-snapshot.ts`, `apps/desktop/src/worktree-sandbox.ts`, and `docs/roadmap/evidence/M13.02.md`.

### Goal

Deliver a deterministic, read-only, revision-pinned `RepoSnapshot` builder in `@moonwitness/ai-runtime` (strictly over `ReadOnlyRepoInspector` and `createRedactor()`) and an `R0` `WorktreeSandbox.inspectRepoSnapshot` surface in `apps/desktop` gated by `DesktopRiskGate` (`repo.read` / `git.status`).

### Bounded file scope

- `packages/ai-runtime/src/repo-snapshot.ts` and `packages/ai-runtime/src/index.ts`
- `packages/ai-runtime/tests/repo-snapshot.test.ts`
- `apps/desktop/src/worktree-sandbox.ts` and `apps/desktop/src/types.ts`
- `apps/desktop/tests/desktop-harness.test.ts`
- `docs/roadmap/evidence/M13.02.md`

### Acceptance criteria

- `buildRepoSnapshot` operates strictly through `ReadOnlyRepoInspector` (no direct `fs` calls outside allowlist/containment guards, no shell execution inside `@moonwitness/ai-runtime`).
- Every manifest, script, and doc claim in `RepoSnapshot` cites an exact relative path and SHA-256 digest; direct observations are separated from inferred metadata.
- Sensitive paths (`.env*`, `.git/*`, keys, credentials) are excluded unconditionally and values pass through `createRedactor()`.
- File count or byte caps set `incomplete: true` with explicit `omittedReasons`.
- `apps/desktop` `inspectRepoSnapshot` enforces `DesktopRiskGate` at `R0` (`repo.read` / `git.status`), pins `headCommit` + `branch` + `dirty` via `execFile('git', ..., { shell: false })`, and preserves tenant `companyId` + `CapabilityGrant` validation.
- Output is deterministic for identical inputs (stable sorted arrays and reproducible `snapshotSha256`).

### Verification

- `pnpm --filter @moonwitness/ai-runtime build` and `pnpm --filter @moonwitness/ai-runtime exec vitest run tests/repo-snapshot.test.ts`
- `pnpm --filter @moonwitness/desktop build` and `pnpm --filter @moonwitness/desktop exec vitest run tests/desktop-harness.test.ts`
- `pnpm desktop:ui:check`, `pnpm automation:check:roadmap`, `pnpm tasks:validate`, and `node scripts/check-docs.mjs`

## M13.03 — Read-only Overlap Detector & offline benchmark

- **Status:** complete (2026-11-22; verified on detached worktree over `origin/dev` base `327c32b`)
- **Prerequisites:** M13.02 (`packages/ai-runtime/src/repo-snapshot.ts`).
- **Deliverables:** `packages/ai-runtime/src/overlap-detector.ts`, `packages/ai-evaluation/src/index.ts`, and `docs/roadmap/evidence/M13.03.md`.

### Goal

Deliver a stateless `R0` requirement-to-repository Overlap Detector (`detectCapabilityOverlap` and `toOverlapArtifactPayload`) in `@moonwitness/ai-runtime` and an offline 6-state benchmark (`runOverlapDetectorBenchmark`) in `@moonwitness/ai-evaluation`.

### Bounded file scope

- `packages/ai-runtime/src/overlap-detector.ts` and `packages/ai-runtime/src/index.ts`
- `packages/ai-runtime/tests/overlap-detector.test.ts`
- `packages/ai-evaluation/src/index.ts` and `packages/ai-evaluation/tests/ai-evaluation.test.ts`
- `docs/roadmap/evidence/M13.03.md`

### Acceptance criteria

- Deterministically classifies requirements into `implemented`, `partial`, `missing`, `overlapping`, `conflicting`, and `deprecated` without direct `fs` or shell access inside `@moonwitness/ai-runtime`.
- All findings carry `advisoryOnly: true`, `automatedMutationsAllowed: false`, and redacted evidence citations with reproducible `contentSha256`.
- `runOverlapDetectorBenchmark` verifies all 6 states offline with exit code 0.

### Verification

- `pnpm --filter @moonwitness/ai-runtime exec vitest run tests/overlap-detector.test.ts tests/prompt-forge.test.ts tests/repo-snapshot.test.ts tests/ai-runtime.test.ts`
- `pnpm --filter @moonwitness/ai-evaluation exec vitest run tests/ai-evaluation.test.ts`

## M13.04 — Read-only Prompt Forge Execution Packet compiler

- **Status:** complete (2026-11-22; verified on detached worktree over `origin/dev` base `327c32b`)
- **Prerequisites:** M13.02 (`packages/ai-runtime/src/repo-snapshot.ts`), M13.03.
- **Deliverables:** `packages/ai-runtime/src/prompt-forge.ts`, `apps/desktop/src/worktree-sandbox.ts`, and `docs/roadmap/evidence/M13.04.md`.

### Goal

Compile a deterministic, redacted, scope-validated Markdown/JSON Execution Packet from a locked `WorkContract` and revision-pinned `RepoSnapshot` at tier `R0` inside `@moonwitness/ai-runtime` and `apps/desktop`.

### Bounded file scope

- `packages/ai-runtime/src/prompt-forge.ts` and `packages/ai-runtime/src/index.ts`
- `packages/ai-runtime/tests/prompt-forge.test.ts`
- `apps/desktop/src/{types.ts,worktree-sandbox.ts,bridge.ts,index.ts}`
- `apps/desktop/tests/desktop-harness.test.ts`
- `docs/roadmap/evidence/M13.04.md`

### Acceptance criteria

- `compileExecutionPacket` fails closed on empty/unlocked acceptance criteria, `..`/absolute/`.env` scope paths, protected boundary conflicts, missing verification commands, and `R4` destructive commands.
- `WorktreeSandbox.compileExecutionPacket` and `bridge.worktree.compileExecutionPacket` enforce company match, lease `allowedPaths` containment, and `R0` `inspectRepoSnapshot` gating.
- All values pass through `createRedactor()`, and `contentSha256` is deterministic across timestamps.

### Verification

- `pnpm --filter @moonwitness/ai-runtime exec vitest run tests/prompt-forge.test.ts`
- `pnpm --filter @moonwitness/desktop exec vitest run tests/desktop-harness.test.ts tests/desktop-adversarial.test.ts tests/desktop-dual-dialect.test.ts`
- `pnpm desktop:ui:check`, `pnpm api:addon:check`, `pnpm automation:check:roadmap`, `pnpm tasks:validate`, and `node scripts/check-docs.mjs`

## M13.05 — Gate WorkContract creation on project-task dependency readiness

- **Status:** complete (2026-11-23; verified over `origin/dev` base `f92978b` with sibling INV-014 `workflow`/`project` `manifest.httpPlugins` migration tracked in `M13.07`)
- **Prerequisite:** M13.04.
- **Implemented owner:** [`packages/orm-project/src/http-plugin.ts`](../../packages/orm-project/src/http-plugin.ts) (preserving all `/projects/*` and `/api/projects/*` paths previously served by deleted `apps/api/src/routes/project.routes.ts`) reusing canonical [`buildProjectDependencyGraph`](../../packages/orm-project/src/sync.ts).
- **Canonical graph:** `buildProjectDependencyGraph` in `packages/orm-project/src/sync.ts` treats only active `blocks` edges as blockers, considers blocker tasks with status `done` or `cancelled` resolved, ignores inactive edges and `relates_to` links, and marks explicit `blocked`, `done`, and `cancelled` task statuses as not ready.
- **Codex handoff:** [M13.05 focused implementation brief](rock-soul-flow-m13-05-handoff.md).

### Goal

Fail closed when a caller attempts to create a **new** WorkContract for a Project task that is not ready according to the canonical dependency DAG. Preserve the existing company boundary, idempotency and WorkContract authority. This route creates or returns a WorkContract; it is not itself proof that a local agent run has started.

### Bounded file scope

- `packages/orm-project/src/http-plugin.ts` (replacing legacy `apps/api/src/routes/project.routes.ts`)
- `apps/api/tests/project.routes.test.ts`
- `docs/roadmap/evidence/M13.05.md` and this roadmap card.

Do not add another dependency graph, task database, route, model, ORM addon or workflow engine. Any new route, durable model or ownership move requires a separate architecture review under ADR 0006/0007.

### Required behavior

1. Keep the existing company-scoped task lookup. Read the active tasks and dependency edges needed to build the project's canonical DAG.
2. Reuse `buildProjectDependencyGraph`; do not implement a second interpretation of dependency semantics.
3. Before inserting a new WorkContract, reject a task whose DAG node is not ready. Return a stable conflict/validation response with a non-sensitive reason and only company-scoped blocker references.
4. Preserve existing WorkContract idempotency. An already-linked contract may be returned without creating a second contract; this endpoint must not silently cancel or mutate an existing run/contract merely because dependencies changed later.
5. Do not claim this creation gate also protects a later run-start path. Identify and document the separate run-start boundary if one exists.
6. Inspect the existing transaction/locking conventions. Revalidate dependency readiness within the safe creation boundary where supported. If a race cannot be eliminated because dependency writers do not share the same lock/transaction, document the residual limitation and propose a separate bounded follow-up rather than claiming full race safety.

### Acceptance criteria

- A task with an active unresolved `blocks` dependency cannot create a new WorkContract.
- Inactive edges and `relates_to` links do not block; blockers in `done` or `cancelled` state are resolved; an explicitly `blocked`, `done` or `cancelled` task cannot start a new WorkContract.
- The check is company/tenant scoped and does not reveal another company's task IDs or details.
- Tests prove denial for a blocked task, creation for a ready task, idempotent retrieval for an existing linked contract, dependency-edge semantics, and company isolation.
- The existing test fixture that currently creates a WorkContract for its blocked `task2` is updated to use a separate ready task or otherwise assert the intended blocked behavior.
- Any transaction/locking limitation is recorded explicitly in evidence.

### Focused verification

- `pnpm --filter @moonwitness/api exec vitest run tests/project.routes.test.ts`
- `pnpm --filter @moonwitness/api build`
- Add isolated PostgreSQL/concurrency coverage only if the implementation changes transaction or locking semantics.

### Non-goals

No Board redesign, no local-agent UI binding, no auto-dispatch, no auto-commit/push, no approval bypass, no new package/model/route, and no changes to `@moonwitness/local-ai`. Those are separate decisions after this server-side invariant is proven.

## M13.06 — Proof Gate v2 — 5-State Check Matrix & Diff-Scope Drift Guard

- **Status:** complete (2026-11-23; verified over `origin/dev` base `f92978b`)
- **Prerequisites:** M13.02 (`packages/ai-runtime/src/repo-snapshot.ts`), M13.04 (`packages/ai-runtime/src/prompt-forge.ts`), M13.05.
- **Deliverables:** `packages/ai-runtime/src/pcw-verifier.ts`, `apps/desktop/src/worktree-sandbox.ts`, and `docs/roadmap/evidence/M13.06.md`.

### Goal

Upgrade the PCW Proof Gate to a deterministic 5-state check matrix (`pass`, `fail`, `skipped`, `not_applicable`, `not_run`) with a strict diff-scope drift guard (`validateDiffScope`) that blocks out-of-scope edits, unsafe paths, and unjustified skips across `@moonwitness/ai-runtime` and `apps/desktop`.

### Bounded file scope

- `packages/ai-runtime/src/pcw-verifier.ts` and `packages/ai-runtime/src/index.ts`
- `packages/ai-runtime/tests/pcw-proof-gate.test.ts`
- `apps/desktop/src/worktree-sandbox.ts` and `apps/desktop/src/types.ts`
- `apps/desktop/tests/desktop-harness.test.ts`
- `docs/roadmap/evidence/M13.06.md`

### Acceptance criteria

- Evaluates every check into one of the 5 canonical `PcwCheckStatus` states (`pass`, `fail`, `skipped`, `not_applicable`, `not_run`) with fail-closed rejection (`MISSING_SKIP_REASON`, `MANDATORY_CHECK_NOT_PASSED`).
- Diff-scope drift guard (`validateDiffScope` and `WorktreeSandbox.inspectDiff`) detects modified or untracked files outside lease `allowedPaths` and unsafe paths, blocking acceptance (`OUT_OF_SCOPE_DIFF_DETECTED`, `scopeClean: false`).
- Preserves deterministic `reportSha256` digesting and full backwards compatibility when optional check-matrix/diff-scope inputs are omitted.

### Verification

- `pnpm --filter @moonwitness/ai-runtime build` and `pnpm --filter @moonwitness/ai-runtime exec vitest run`
- `pnpm --filter @moonwitness/desktop build` and `pnpm --filter @moonwitness/desktop exec vitest run --no-file-parallelism`
- `pnpm desktop:ui:check`, `pnpm automation:check:roadmap`, `pnpm tasks:validate`, and `node scripts/check-docs.mjs`

## M13.07 — Desktop `R0` Overlap Bridge, Board Cockpit Parity & INV-014 `workflow`/`project` HTTP Plugin Migration

- **Status:** complete (2026-11-23; verified over `origin/dev` base `f92978b`)
- **Prerequisites:** M13.03 (`packages/ai-runtime/src/overlap-detector.ts`), M13.05, M13.06.
- **Deliverables:** `packages/orm-workflow/src/http-plugin.ts`, `packages/orm-project/src/http-plugin.ts`, `apps/desktop/src/{types.ts,worktree-sandbox.ts,bridge.ts,index.ts}`, `apps/board/src/{lib/desktop-bridge.ts,components/ai/desktop-harness-drawer.tsx}`, and `docs/roadmap/evidence/M13.07.md`.

### Goal

Expose the `R0` Overlap Detector bridge in `apps/desktop` (`bridge.worktree.detectOverlap`), surface Board Cockpit Drawer parity (Radar & Overlap, Prompt Packet, and Out-of-Scope Drift badges) in `apps/board`, and migrate `workflow` and `project` HTTP routes into INV-014 ORM addon `manifest.httpPlugins`.

### Bounded file scope

- `packages/orm/src/addon.ts`
- `packages/orm-workflow/src/{http-plugin.ts,manifest.ts,index.ts}`
- `packages/orm-project/src/{http-plugin.ts,manifest.ts,index.ts}`
- `apps/api/src/addons/registry.ts` and `apps/api/tests/{project.routes.test.ts,research-review.routes.test.ts}`
- Deletion of legacy `apps/api/src/routes/workflow.routes.ts` and `apps/api/src/routes/project.routes.ts`
- `scripts/check-api-addon-boundary.mjs` and `scripts/check-api-addon-boundary.test.mjs`
- `apps/desktop/src/{types.ts,worktree-sandbox.ts,bridge.ts,index.ts}` and `apps/desktop/tests/desktop-harness.test.ts`
- `apps/board/src/{lib/desktop-bridge.ts,components/ai/desktop-harness-drawer.tsx}`
- `docs/roadmap/evidence/M13.07.md`

### Acceptance criteria

- `workflow` and `project` routes are registered via INV-014 ORM addon `manifest.httpPlugins`, with both legacy route files removed from `LEGACY_DOMAIN_ROUTE_ALLOWLIST` and passing `pnpm api:addon:check`.
- Desktop bridge exposes `bridge.worktree.detectOverlap` at tier `R0` with tenant `companyId`, realpath containment, and capability grant enforcement.
- Board desktop harness drawer renders `Radar & Overlap`, `Prompt Packet`, and `Out-of-Scope Drift` UI using `@moonwitness/ui` primitives while keeping `pnpm board:ui:check` and `pnpm desktop:ui:check` clean.

### Verification

- `pnpm --filter @moonwitness/orm build`, `pnpm --filter @moonwitness/orm-workflow build`, `pnpm --filter @moonwitness/orm-project build`
- `pnpm --filter @moonwitness/orm-workflow test` and `pnpm --filter @moonwitness/orm-project test`
- `pnpm --filter @moonwitness/api exec vitest run tests/project.routes.test.ts tests/research-review.routes.test.ts tests/workflow.test.ts` and `pnpm --filter @moonwitness/api build`
- `pnpm --filter @moonwitness/board typecheck` and `pnpm --filter @moonwitness/board lint`
- `pnpm api:addon:check`, `pnpm board:ui:check`, and `pnpm desktop:ui:check`

## M13.08 — Plan Forge Markdown Projection/Reconciler & Memory Ledger Doc-Proposal Export

- **Status:** complete (2026-11-23; verified over `origin/dev` base `f92978b`)
- **Prerequisites:** M13.04, M13.06, M13.07.
- **Deliverables:** `packages/ai-runtime/src/plan-markdown.ts`, `packages/ai-runtime/src/memory-doc-proposal.ts`, and `docs/roadmap/evidence/M13.08.md`.

### Goal

Provide a deterministic Plan Forge Markdown projection/reconciler (`plan-markdown.ts`) and an advisory, human-approved Memory Ledger doc-proposal exporter (`memory-doc-proposal.ts`) in `@moonwitness/ai-runtime`.

### Bounded file scope

- `packages/ai-runtime/src/plan-markdown.ts`
- `packages/ai-runtime/src/memory-doc-proposal.ts`
- `packages/ai-runtime/src/index.ts`
- `packages/ai-runtime/tests/plan-markdown.test.ts`
- `packages/ai-runtime/tests/memory-doc-proposal.test.ts`
- `docs/roadmap/evidence/M13.08.md`

### Acceptance criteria

- Plan Forge Markdown projection and reconciler round-trip deterministically without mutating canonical task/work-contract authority directly or deleting/reopening completed tasks.
- Memory Ledger doc-proposal export filters strictly to approved company-scoped records (`advisoryOnly: true`, `requiresHumanApproval: true`, `automatedWritesAllowed: false`), deduplicates against existing docs, redacts secrets via `createRedactor()`, and computes deterministic `contentSha256` hashes.

### Verification

- `pnpm --filter @moonwitness/ai-runtime build` and `pnpm --filter @moonwitness/ai-runtime exec vitest run`
- `pnpm automation:check:roadmap`, `pnpm tasks:validate`, and `node scripts/check-docs.mjs`
