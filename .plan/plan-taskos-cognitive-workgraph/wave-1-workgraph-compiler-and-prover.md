# Wave 1 — WorkGraph Compiler, Disjoint Ownership Prover & DAG (`T06`–`T11`)

**ADR Reference:** `.plan/plan-taskos-cognitive-workgraph/ADR-003-plan-taskos-cognitive-workgraph.md` (Decisions 1, 3, 6)
**Depends On:** `T05`
**Hard Rule:** Every compile-time safety check MUST fail closed with exact task IDs and conflicting file paths.

---

## - [ ] T06 — Implement Dual-Format Bundle Loader (`src/core/loader.ts`)

- **Owner File(s):** `packages/plan-taskos/src/core/loader.ts`
  - `packages/plan-taskos/src/core/loader.ts` (CREATE)
- **Depends On:** `T05`
- **Exact Spec:** Export `discoverPlans(repoRoot: string): Promise<readonly LoadedPlanBundle[]>` and `loadPlanBundle(repoRoot: string, planId: string): Promise<LoadedPlanBundle | null>`.
  - Export `discoverPlans(repoRoot: string): Promise<readonly LoadedPlanBundle[]>` and `loadPlanBundle(repoRoot: string, planId: string): Promise<LoadedPlanBundle | null>`.
  - Support BOTH formats seamlessly:
    1. **v2 Plan-TaskOS Bundle** (detected when `.plan/<planId>/manifest.json` exists): reads `manifest.json`, all `waves/*.json`, `specs/*.md` (splitting sections by `^##\s+(?:(?:-\s+)?\[[ xX]\]\s+)?([A-Z]\d{2,3})\b`), `ADR-*.md`, and existing `evidence/*.proof.json`.
    2. **v1 Legacy Markdown Plan** (detected when `.plan/<planId>.md` exists without `manifest.json`): parses master checklist (`- [ ] **M01** — ...` and `#### - [ ] D01 — ...`), sibling `.plan/<planId>/*.md` wave playbooks (skipping `ADR-*.md`), extracting `Owner File(s)`, `Depends On`, `Exact Spec`, `Acceptance Criteria`, `Expected Output`, `Verify`, `Commit`, and synthesizing typed `PlanTaskIR` nodes with `format: 'legacy-markdown'`.
  - Redact all extracted narrative text via `redactSensitiveText`.
- **DO NOT:** Crash if `.plan/` does not exist (return `[]`).
- **Acceptance Criteria:** Loads `.plan/coolify-sovereign-paas-single-db.md` (`66` tasks), `.plan/desktop-agent-observatory-merge.md` (`16` tasks), and `.plan/plan-taskos-cognitive-workgraph.md` (`44` tasks) cleanly alongside v2 JSON bundles.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/core/loader.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-1-workgraph-compiler-and-prover.md -m "feat(plan-taskos): T06 implement dual v2 bundle and legacy markdown plan loader"
  ```

---

## - [ ] T07 — Implement AJV Schema, Spec-Parity & Invariant Path-Matcher Validator (`src/core/validator.ts`)

- **Owner File(s):** `packages/plan-taskos/src/core/validator.ts`
  - `packages/plan-taskos/src/core/validator.ts` (CREATE)
- **Depends On:** `T06`
- **Exact Spec:** Export `validatePlanBundle(bundle: LoadedPlanBundle, options?: { invariants?: readonly RepoInvariantRule[] }): PlanValidationResult`.
  - Export `validatePlanBundle(bundle: LoadedPlanBundle, options?: { invariants?: readonly RepoInvariantRule[] }): PlanValidationResult`.
  - Compile schemas from `../../schemas/{manifest,wave,proof,document}.schema.json` using `Ajv2020` (`ajv/dist/2020.js`) + `ajv-formats`.
  - Enforce 6 deterministic checks:
    1. Schema conformance on `manifest`, every `wave`, every loaded `proof`, and every `document`.
    2. Unique `urn` and unique `code` across all waves; every `depends_on` target exists.
    3. **1:1 Spec Parity:** every task with `spec_ref` (`specs/W1.md#T06`) MUST resolve to an existing heading section in that spec file (zero orphan specs or missing task sections!).
    4. **Path Containment:** every `owner_files[]` and `read_only_refs[]` passes `normalizeRepoPath` (no absolute paths or `..`).
    5. **Anti-Fake-Completion Check:** any task with `lifecycle.work_status === 'done'` in v2 mode MUST have an existing `evidence_ref` proof envelope with `owner_files_verified === true` and all mandatory `acceptance_criteria` marked `done: true`.
    6. **Path-Matched Invariants (`matchInvariantsForPaths`):** parses `.agents/rules/learned-invariants.md` or custom rules and computes which `INV-*` IDs apply to each task's `owner_files[]`.
- **DO NOT:** Silently ignore missing `spec_ref` sections or invalid proof hashes.
- **Acceptance Criteria:** Returns `{ valid: boolean, errors: ValidationIssue[], warnings: ValidationIssue[] }` with exact task IDs and paths.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/core/validator.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-1-workgraph-compiler-and-prover.md -m "feat(plan-taskos): T07 add ajv schema, spec-parity, proof, and invariant path validator"
  ```

---

## - [ ] T08 — Implement Compile-Time Disjoint Write-Ownership Prover (`src/core/disjoint-prover.ts`)

- **Owner File(s):** `packages/plan-taskos/src/core/disjoint-prover.ts`
  - `packages/plan-taskos/src/core/disjoint-prover.ts` (CREATE)
- **Depends On:** `T05`
- **Exact Spec:** Export `proveDisjointOwnership(tasks: readonly PlanTaskIR[]): DisjointOwnershipProof`:
  - Export `proveDisjointOwnership(tasks: readonly PlanTaskIR[]): DisjointOwnershipProof`:
    1. Build directed reachability map (transitive closure of `depends_on` where `kind === 'blocks'`).
    2. For every unordered pair `(Ti, Tj)` where `Ti` and `Tj` are NOT terminal (`done`/`skipped`/`cancelled`):
       - If NEITHER `Tj` is reachable from `Ti` NOR `Ti` is reachable from `Tj` (i.e. `Ti` and `Tj` are concurrently schedulable!):
         - Check every `(patA in Ti.graph.owner_files, patB in Tj.graph.owner_files)` using `globsMayOverlap(patA, patB)`.
         - Unless BOTH tasks share an explicit `mutex_resources` lock token, emit a hard `OwnershipConflict { taskA, taskB, patternA, patternB, reason }`.
    3. Return `{ disjoint: conflicts.length === 0, checkedPairs, conflicts, proofSha256 }`.
- **DO NOT:** Skip glob overlap checks (e.g., `packages/orm-cloud/src/**` vs `packages/orm-cloud/src/http.ts` MUST be flagged as overlapping!).
- **Acceptance Criteria:** Two concurrent tasks touching overlapping files/globs without a dependency edge produce `disjoint: false` with exact conflicting patterns; adding `depends_on` between them produces `disjoint: true`.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/core/disjoint-prover.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-1-workgraph-compiler-and-prover.md -m "feat(plan-taskos): T08 add compile-time disjoint write-ownership prover over concurrent dag pairs"
  ```

---

## - [ ] T09 — Implement DAG Scheduler, Boss Critical Path & Swarm Wave Partitioner (`src/core/dag.ts`)

- **Owner File(s):** `packages/plan-taskos/src/core/dag.ts`
  - `packages/plan-taskos/src/core/dag.ts` (CREATE)
- **Depends On:** `T08`
- **Exact Spec:** Export `buildWorkGraphDag(tasks: readonly PlanTaskIR[], options?: { activeLeases?: ReadonlySet<string>; dirtyFiles?: readonly string[] }): WorkGraphDagResult`:
  - Export `buildWorkGraphDag(tasks: readonly PlanTaskIR[], options?: { activeLeases?: ReadonlySet<string>; dirtyFiles?: readonly string[] }): WorkGraphDagResult`:
    - Cycle detection (returns exact cycle chains `cycles: string[][]` without infinite recursion).
    - Memoized topological `depth` per task.
    - Derived node runtime state: `done | active | ready | blocked | skipped`.
    - **Boss Critical Path (`criticalPathIds`)**: longest remaining pending dependency chain starting from any `ready`/`active` node.
    - **Parallel Frontier (`selectDisjointFrontier(dag, maxParallel)`)**: returns up to `maxParallel` `ready` tasks whose `owner_files` are pairwise disjoint and not currently leased, prioritized by Critical Path membership -> `priority` (`p0..p3`) -> `wave` order.
- **DO NOT:** Schedule any task whose blocking `depends_on` predecessor is `todo`, `in_progress`, `review`, or `blocked`.
- **Acceptance Criteria:** Cycle-safe, deterministic ordering, and guaranteed disjoint parallel batch selection.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/core/dag.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-1-workgraph-compiler-and-prover.md -m "feat(plan-taskos): T09 implement cycle-safe dag engine, critical path, and disjoint frontier scheduler"
  ```

---

## - [ ] T10 — Implement Split-Authority Field-Plane Reconciler (`src/core/authority.ts`)

- **Owner File(s):** `packages/plan-taskos/src/core/authority.ts`
  - `packages/plan-taskos/src/core/authority.ts` (CREATE)
- **Depends On:** `T05`
- **Exact Spec:** Define canonical `FIELD_AUTHORITY_MAP` assigning every field group to its single authoritative `AuthorityPlane` (`git_spec`, `proof_runner`, `ci_delivery`, `orm_enterprise`, `github_human`, `docs_knowledge`).
  - Define canonical `FIELD_AUTHORITY_MAP` assigning every field group to its single authoritative `AuthorityPlane` (`git_spec`, `proof_runner`, `ci_delivery`, `orm_enterprise`, `github_human`, `docs_knowledge`).
  - Export `reconcileTaskPlanes(current: PlanTaskIR, incoming: Partial<PlanTaskIR>, sourcePlane: AuthorityPlane)`:
    - Accepts ONLY mutations to fields owned by `sourcePlane`; rejects/flags unauthorized cross-plane overwrites (e.g., `github_human` cannot mark a code task `done` without `proof_runner` -> emits `{ needsTriage: true, rejectedFields }`).
    - Computes normalized `planeHash` (SHA-256 over canonical JSON of owned fields) so identical inputs return `{ changed: false, noop: true }`.
  - Export bijective status/priority converters: `mapWorkStatusToOrm`, `mapWorkStatusToTaskosV2`, `mapWorkStatusToWorkContract`, `mapDeliveryToGitHubState`.
- **DO NOT:** Allow `github_human` or `orm_enterprise` planes to overwrite `owner_files`, `verify`, or `evidence_ref`.
- **Acceptance Criteria:** Zero-loop idempotency (`reconcile(reconcile(x))` yields `noop: true`) and unauthorized plane writes rejected deterministically.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/core/authority.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-1-workgraph-compiler-and-prover.md -m "feat(plan-taskos): T10 implement split-authority field-plane reconciler and lifecycle maps"
  ```

---

## - [ ] T11 — Add Wave 1 Unit Tests & Pass Wave 1 Build/Test Gate

- **Owner File(s):** `packages/plan-taskos/tests/loader-validator.test.ts`, `packages/plan-taskos/tests/disjoint-prover.test.ts`, `packages/plan-taskos/tests/dag-authority.test.ts`
  - `packages/plan-taskos/tests/loader-validator.test.ts` (CREATE)
  - `packages/plan-taskos/tests/disjoint-prover.test.ts` (CREATE)
  - `packages/plan-taskos/tests/dag-authority.test.ts` (CREATE)
- **Depends On:** `T06`, `T07`, `T08`, `T09`, `T10`
- **Exact Spec:** `loader-validator.test.ts`: tests v2 bundle loading, legacy `.plan/*.md` loading (on real `.plan/` fixtures + temp fixtures), missing `spec_ref` rejection, `..` traversal rejection, and anti-fake-completion (`done` without proof) rejection.
  - `loader-validator.test.ts`: tests v2 bundle loading, legacy `.plan/*.md` loading (on real `.plan/` fixtures + temp fixtures), missing `spec_ref` rejection, `..` traversal rejection, and anti-fake-completion (`done` without proof) rejection.
  - `disjoint-prover.test.ts`: tests glob overlap detection (`src/**` vs `src/http.ts`), serialization via `depends_on` resolving conflict, `mutex_resources` serialization, and multi-wave parallel safety.
  - `dag-authority.test.ts`: tests cycle detection, Boss Critical Path selection, disjoint parallel frontier picking, zero-loop `authority.ts` idempotency, and `github_human` `done` rejection (`needsTriage: true`).
- **Acceptance Criteria:** All Wave 1 Vitest suites pass in `< 10s` with zero warnings or open handles.
- **Expected Output:** Build and all tests exit `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos build; if ($?) { bun --filter @moonwitness/plan-taskos test }`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/tests/loader-validator.test.ts packages/plan-taskos/tests/disjoint-prover.test.ts packages/plan-taskos/tests/dag-authority.test.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-1-workgraph-compiler-and-prover.md -m "test(plan-taskos): T11 add wave 1 unit tests for loader, validator, disjoint prover, dag, and authority"
  ```
