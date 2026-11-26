# Wave 3 — Proof-Carrying Runner, Micro-Brief Compiler & TTL Leases (`T19`–`T23`)

**ADR Reference:** `.plan/plan-taskos-cognitive-workgraph/ADR-003-plan-taskos-cognitive-workgraph.md` (Decisions 3, 4, 5)
**Depends On:** `T11`, `T18`
**Hard Rule:** A micro-task MUST NEVER transition to `done` without runner-verified `verify[]` exit `0`, `git diff ⊆ owner_files`, and a sealed DAG-Merkle `evidence/*.proof.json`!

---

## - [x] T19 — Implement `O(1)` Cognitive Micro-Brief Compiler (`src/runner/brief-compiler.ts`)

- **Owner File(s):** `packages/plan-taskos/src/runner/brief-compiler.ts`
  - `packages/plan-taskos/src/runner/brief-compiler.ts` (CREATE)
- **Depends On:** `T14`, `T15`, `T16`
- **Exact Spec:** Export `compileCognitiveMicroBrief(store, bundle, taskId, options?: { maxChars?: number }): CognitiveMicroBrief`:
  - Export `compileCognitiveMicroBrief(store, bundle, taskId, options?: { maxChars?: number }): CognitiveMicroBrief`:
    - Extracts ONLY the single target task `PlanTaskIR` + its exact `specs/W{n}.md#<id>` section (never loads unrelated waves!).
    - Queries `queryTwoHopContext(store, task.urn)` and `recallPitfallsForPaths(store, task.graph.owner_files, 3)`.
    - Returns structured JSON AND compact rendered Markdown (`<= 3,200` chars / ~600 tokens target) containing:
      1. Identity (`urn`, `code`, `wave`, `model_tier`, `risk_tier`, `attempts/max_attempts`).
      2. Strict `owner_files` write allowlist + `read_only_refs`.
      3. Exact Spec & `DO / DO-NOT` excerpt.
      4. Binary `acceptance_criteria[]` + `verify[]` commands + `commit_template`.
      5. Cognitive Context: last 2 sibling proofs on same files, path-matched `INV-*` rules, linked `ADR` decision refs, and top-3 redacted episodic pitfalls!
- **DO NOT:** Dump full plan files or unrelated invariants into the Micro-Brief.
- **Acceptance Criteria:** Output stays `O(1)` regardless of whether the plan has 10 or 500 micro-tasks.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/runner/brief-compiler.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-3-proof-runner-and-briefs.md -m "feat(plan-taskos): T19 implement O(1) cognitive micro-brief compiler with 2-hop pitfall injection"
  ```

---

## - [x] T20 — Implement Atomic Multi-Agent TTL Lease Manager (`src/runner/lease-manager.ts`)

- **Owner File(s):** `packages/plan-taskos/src/runner/lease-manager.ts`
  - `packages/plan-taskos/src/runner/lease-manager.ts` (CREATE)
- **Depends On:** `T09`, `T12`
- **Exact Spec:** Export `claimTaskLease(store, { taskUrn, agentRuntime, sessionId, modelTier?, ttlSec = 900, nowIso? })`:
  - Export `claimTaskLease(store, { taskUrn, agentRuntime, sessionId, modelTier?, ttlSec = 900, nowIso? })`:
    - Executes inside `store.transactionImmediate(...)`: reaps expired leases (`expires_at <= now`), rejects with `LEASE_CONFLICT` if already held by another `sessionId`, otherwise inserts/renews lease atomically.
  - Export `renewTaskLease`, `releaseTaskLease`, `listActiveLeases`, and `reapExpiredLeases`.
  - Optionally mirrors active leases into gitignored `.plan/<plan-id>/.leases.local.json` for lightweight readers.
- **DO NOT:** Allow two different `sessionId` workers to hold an active unexpired lease on the same `taskUrn`.
- **Acceptance Criteria:** Concurrent claims return `1` winner and `N-1` `LEASE_CONFLICT`; expired leases are reaped deterministically.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/runner/lease-manager.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-3-proof-runner-and-briefs.md -m "feat(plan-taskos): T20 add atomic sqlite immediate-transaction ttl lease manager"
  ```

---

## - [x] T21 — Implement Runtime `git diff` Scope Membrane & Verification Executor (`src/runner/scope-gate.ts`)

- **Owner File(s):** `packages/plan-taskos/src/runner/scope-gate.ts`
  - `packages/plan-taskos/src/runner/scope-gate.ts` (CREATE)
- **Depends On:** `T04`, `T05`
- **Exact Spec:** Export `inspectChangedFiles(repoRoot, options?: { gitRunner? }): Promise<readonly string[]>`: collects staged + unstaged + untracked changed repo-relative POSIX paths (via `git status --porcelain`).
  - Export `inspectChangedFiles(repoRoot, options?: { gitRunner? }): Promise<readonly string[]>`: collects staged + unstaged + untracked changed repo-relative POSIX paths (via `git status --porcelain`).
  - Export `checkOwnerFileScope(changedFiles, ownerFiles, allowedPlanFiles)`: verifies every task-scoped file in `changedFiles` matches `ownerFiles` or `allowedPlanFiles`, returning `{ ok, ownedChanged, outOfScopeFiles }` (when running in dirty worktree mode, allows pre-existing unrelated dirty files ONLY if explicitly passed as `baselineDirtyFiles` snapshot from `claim` time, rejecting any NEW out-of-scope edits!).
  - Export `executeVerifyCommands(commands, { cwd, shell?, runner? })`: runs each command with timeout (`timeout_sec`), captures exit code, duration, `stdout_sha256`, `stderr_sha256`, and bounded redacted excerpt (`<= 400` chars). On Windows, invokes `powershell.exe -NoProfile -Command` cleanly (`INV-001` compliant).
- **DO NOT:** Print or store unredacted command stdout/stderr.
- **Acceptance Criteria:** Editing a file outside `owner_files` fails closed with exact `outOfScopeFiles`; secrets in command output are scrubbed.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/runner/scope-gate.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-3-proof-runner-and-briefs.md -m "feat(plan-taskos): T21 add runtime git diff scope membrane and redacted verify executor"
  ```

---

## - [x] T22 — Implement Proof-Carrying Task Runner & Bounded-Attempt Circuit Breaker (`src/runner/proof-runner.ts`)

- **Owner File(s):** `packages/plan-taskos/src/runner/proof-runner.ts`
  - `packages/plan-taskos/src/runner/proof-runner.ts` (CREATE)
- **Depends On:** `T16`, `T17`, `T20`, `T21`
- **Exact Spec:** Export `completeMicroTask(store, repoRoot, planId, taskId, options)` & `recordMicroTaskFailure(store, repoRoot, planId, taskId, failureInfo)`:
  - Export `completeMicroTask(store, repoRoot, planId, taskId, options)` & `recordMicroTaskFailure(store, repoRoot, planId, taskId, failureInfo)`:
    1. Confirm all `depends_on` predecessors are `done` (or `skipped`) and collect their sealed `envelope_sha256` into `parent_proof_hashes`.
    2. Run `checkOwnerFileScope` (`require_clean_scope: true` -> reject if new out-of-scope edits exist!).
    3. Execute all `verify[]` commands via `executeVerifyCommands`.
    4. **On Failure (Bounded-Attempt Circuit Breaker):**
       - Increment `task.governance.attempts`.
       - Record redacted `failure_pattern` episode in `episodic_memory` + `.plan/memory/episodes.jsonl`.
       - Escalate `model_tier` along `execution_policy.escalation_chain` (`flash -> neon -> argon`) when `attempts < max_attempts`.
       - When `attempts >= max_attempts`: transition `work_status = 'blocked'`, set `blocked_reason`, release lease, persist wave JSON, and return next disjoint ready frontier!
    5. **On Success (Proof Sealing):**
       - Mark verified mandatory `acceptance_criteria[].done = true`.
       - Seal `ProofEnvelope` via `sealProofEnvelope(...)` and write `.plan/<plan-id>/evidence/<taskId>.proof.json`.
       - Record `fixed_by` episode if `attempts > 0` (learned root cause!).
       - Update wave JSON (`status: 'done'`, `evidence_ref`, `commit_sha`), update `proof_ledger`, release lease.
       - When `options.autoCommit === true`: run atomic `git commit --only <ownedChanged + planFiles> -m <commit_template>` (with single retry on pre-commit `eslint --fix` auto-format; NEVER `git add -A`, NEVER `--no-verify`!).
- **DO NOT:** Allow `completeMicroTask` to write `done` if any `verify[]` command exits non-zero or scope check fails.
- **Acceptance Criteria:** End-to-end state machine enforces proof sealing, scope containment, retry escalation, circuit breaking, and atomic `git commit --only`.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/runner/proof-runner.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-3-proof-runner-and-briefs.md -m "feat(plan-taskos): T22 add proof-carrying task runner with circuit breaker and atomic commit"
  ```

---

## - [x] T23 — Add Wave 3 Unit Tests & Pass Wave 3 Runner Gate

- **Owner File(s):** `packages/plan-taskos/tests/brief-compiler.test.ts`, `packages/plan-taskos/tests/lease-lock.test.ts`, `packages/plan-taskos/tests/proof-runner.test.ts`
  - `packages/plan-taskos/tests/brief-compiler.test.ts` (CREATE)
  - `packages/plan-taskos/tests/lease-lock.test.ts` (CREATE)
  - `packages/plan-taskos/tests/proof-runner.test.ts` (CREATE)
- **Depends On:** `T19`, `T20`, `T21`, `T22`
- **Exact Spec:** `brief-compiler.test.ts`: asserts `O(1)` bounded char budget, exact spec slicing, 2-hop sibling proof inclusion, matched `INV-*` injection, and top-3 pitfall recall.
  - `brief-compiler.test.ts`: asserts `O(1)` bounded char budget, exact spec slicing, 2-hop sibling proof inclusion, matched `INV-*` injection, and top-3 pitfall recall.
  - `lease-lock.test.ts`: tests atomic `LEASE_CONFLICT`, renew, release, and TTL expiry reaping.
  - `proof-runner.test.ts`: tests using injectable command/git runners in `os.tmpdir()`:
    - Out-of-scope file mutation -> rejected (`status` stays `in_progress`, zero proof file written).
    - Failing verify attempt #1 -> escalates `flash -> neon` + records redacted episode.
    - Failing verify attempt #2 -> trips circuit breaker to `blocked` + releases lease + exposes next ready task.
    - Passing verify -> seals DAG-Merkle `evidence/T02.proof.json` containing `T01` parent hash + passes `verifyProofChain`.
- **Acceptance Criteria:** All Wave 1–3 tests pass offline in `< 10s`.
- **Expected Output:** Build and test suite exit `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos build; if ($?) { bun --filter @moonwitness/plan-taskos test }`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/tests/brief-compiler.test.ts packages/plan-taskos/tests/lease-lock.test.ts packages/plan/taskos/tests/proof-runner.test.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-3-proof-runner-and-briefs.md -m "test(plan-taskos): T23 add wave 3 tests for micro-briefs, leases, scope gate, and proof runner"
  ```
