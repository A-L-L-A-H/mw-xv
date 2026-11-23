# Current stabilization checkpoint — 2026-11-23 (Phase 0–6 closeout)

- **Stable branch (`main`):** `2a9d78333433b783a80bcb82f6ac7f7ad95f6c2d`; no main write, merge, force push, release or deployment.
- **Development branch (`dev`):** implementation batch baseline `62e5ef656d58be11350e8a1d228da2205c5108eb`, 169 commits ahead of main and 0 behind at the last branch comparison. This checkpoint is source-SHA-bound; later documentation-only closeout commits may advance the branch.
- **Promotion PR #37:** remains open, mergeable, and directed to `main`; CODEOWNER review by `bjo163` and separate M12.14 stable-release approval remain required. Promotion is not deployment.
- **Toolchain correction in the implementation batch:** Docker Corepack now pins `pnpm@11.17.0`; `scripts/check-action-pins.mjs` includes Dockerfile in the pnpm drift check; a regression test covers the Docker pin. CI's candidate step now exports once in non-mutating `--candidate` mode and relies on the artifact rather than duplicating the projection or printing its Base64 payload.
- **Current exact-SHA CI:** run [45087066909](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45087066909) verifies the code and TaskOS legacy-ID regression test at source SHA `379c130092faaab96b9f6e42b9ad1d28c67de08d`; it was still running at the audit snapshot. The follow-up closeout documentation commits require a final CI run on their own latest SHA. Re-fetch that final run before claiming completion. On previous SHA `33750563145315fabeb902c565a0a9075e85ea0f`, knowledge-gate, PostgreSQL integration, quality/build and DX jobs passed; TaskOS safety tests and unit-test build passed, but candidate export had not completed before that run was superseded.
- **TaskOS source of truth:** the tracked `docs/tasks/tasks.json` is a valid 1,358-record legacy snapshot, not an empty file. 861 records still cite root `todo.md`, now a navigation pointer. The proposed source-backed projection is 627 records (468 done, 49 doing, 89 todo, 21 blocked). It has **not** been applied; 731 records of difference require a reviewed reconciliation and preserved backup.
- **Recovery safety:** only export a candidate outside the worktree, review it, and retain the legacy snapshot. Do not run `--write`, TaskOS sync, or Visual Universe projection generation until migration is approved and validated.
- **M13 / FLOW:** M13.09–M13.12 implementation and evidence exist. Full CI PostgreSQL integration passed on the earlier SHA; the new current-SHA CI is pending. The complete local Desktop journey still needs execution and evidence.
- **Full phase closeout record:** [PHASE-0-6-CLOSEOUT.md](PHASE-0-6-CLOSEOUT.md) distinguishes verified remote work from local acceptance and human release gates.

# MW-XV Stabilization & Source-of-Truth Recovery Plan

**Scope:** Clean, stabilize, and reconcile `A-L-L-A-H/mw-xv` without architectural rewrites or feature expansion.
**Baseline:** 2026-11-23 remote GitHub audit. This is a plan, not local build/test evidence.

## Principles

- Keep only `main` and `dev`; development and reconciliation work belongs on `dev`.
- `main` remains the promotion/release branch; never infer release readiness from branch equality.
- Do not force-push, rewrite history, or merge blindly.
- Do not fabricate task records, completion, CI status, evidence, approvals, or release state.
- Preserve existing architecture and completed work; fix drift, validation and integration first.
- Canonical completion requires roadmap checkbox plus evidence; task identity/dependency index must pass its validator. GitHub Issues are projections and human triage records.
- The current TaskOS file is a populated 1,358-record legacy registry; the 627-record source-backed projection is a candidate, not yet the migrated SOT.

## Work status

### S0 — Branch synchronization (DONE)
- [x] Verified `dev` was the exact source SHA for PR #31 promotion.
- [x] Fast-forwarded `dev` to the promotion merge commit `2a9d78333433b783a80bcb82f6ac7f7ad95f6c2d`, using expected-head protection.
- [x] No force push or history rewrite.
- [ ] Reconfirm `main` and `dev` equality after future pushes.

### S1 — TaskOS migration (P0, candidate generation implemented; test correction and migration review pending)
- [x] Audited the exact Git blob: `docs/tasks/tasks.json` contains 1,358 valid JSON records; 861 legacy records still cite root `todo.md`, now a pointer.
- [x] Inventory the current migration sources and counts in [TaskOS Recovery Inventory](../tasks/RECOVERY-INVENTORY.md), including the Visual Universe scoped task pack.
- [x] Map source ownership: 627 candidate records across 8 source groups; root todo.md is a pointer, old completed lists remain historical, and Visual Universe metadata is preserved as a TaskOS project.
- [ ] Rebuild registry from authoritative sources only; preserve stable task codes, status, dependencies, project/series, acceptance and provenance. Never synthesize 1,346 records from a count claim.
- [x] Update schema/validator only as required; add an explicit empty-file guard and useful diagnostics before JSON parsing (implemented; tests added, hosted/local test execution pending).
- [x] Rework the one-time importer: required-source fail-closed behavior, duplicate-ID rejection, fixed-timestamp deterministic output, lossless Visual Universe metadata, dry-run by default, and refusal to overwrite a populated registry.
- [ ] Run automated validation for duplicate codes, unknown dependencies, DAG cycles, orphan references, status parity, source provenance and exact 627-record count. Static source inventory preflight found 627 unique IDs and no unknown roadmap/Visual Universe/AUD dependency references; CI/test execution is still required.
- [ ] Run `pnpm test:taskos`, `pnpm tasks:sweep` (dry-run), `pnpm tasks:validate`, `pnpm tasks:sync` fail-closed tests and `pnpm automation:check:roadmap`; do not apply sync until review.
- [ ] Record restoration evidence and exact SHA. Until then, TaskOS is **unavailable**, not authoritative.

### S2 — Roadmap and Issue lifecycle reconciliation (P1)
- [ ] Recompute task counts from `ROADMAP.md` and `docs/roadmap/tasks.json`; remove stale static totals.
- [ ] Cross-check M13.01–M13.08 source status and evidence.
- [x] Reconcile completed issue lifecycle #32–#36 against promoted sources/evidence; preserve human fields and comments.
- [ ] Audit stale open/closed issues and duplicate task markers; no mass-close.
- [ ] Ensure roadmap index, evidence links, managed Issue blocks and generated progress artifacts agree.

### S3 — Runtime/toolchain documentation (P1)
- [x] Align primary Node policy references across root engines, Docker, CI setup, Desktop package and docs to Node 24; runtime ledger refresh remains a separate review.
- [ ] Refresh runtime support review ledger (Node reviewed; other overdue entries remain separately due).
- [ ] Validate README Quickstart, support policy, Desktop architecture, Desktop TODO and Docker/CI statements.
- [ ] Keep exact pnpm version/config consistent with Corepack, CI and package-manager policy.

### S4 — Release/CI truth audit (P1)
- [ ] Inspect required checks and rulesets on `main` and `dev`; record access/API limitations.
- [ ] Fetch PR #31 CI runs and verify all required jobs on exact source SHA; resolve pending/ambiguous checks.
- [x] Confirm M12.14 stable-release approval remains a separate unresolved human gate; do not infer from merge.
- [ ] Confirm promotion workflow cannot promote stale heads and promotion report correctly distinguishes pending, failed, skipped and success.
- [ ] Confirm release tagging/publication remains gated and deployment is not implicitly authorized.

### S5 — ROCKSOUL FLOW current-state matrix (P1)
- [ ] Preserve M13.01 as historical audit baseline.
- [ ] Update current statuses for M13.02–M13.08 from implementation/evidence, not directory existence.
- [ ] Record current gaps: Visual DNA profile exporter and any integration gaps discovered by source/runtime tests.
- [ ] Check the full user journey in Board/Desktop: Repo Radar → Overlap → Plan → Packet → Dispatch → Worktree → Proof → Review → Sync.
- [ ] Keep capability boundaries, redaction, scope, human approval and canonical ORM/task authority intact.

### S6 — Clean/stable verification (P1)
- [ ] Run roadmap/task/docs validators.
- [ ] Run package-level tests for changed areas first.
- [ ] Run workspace build, unit tests, PostgreSQL integration, Board/desktop checks and E2E according to affected risk and required CI.
- [ ] Fix all reproducible failures; no skipped tests counted as pass.
- [ ] Recheck exact branch HEAD after CI and produce source-SHA-bound audit report.
- [ ] Promotion only after reviewed diff, required checks, approvals and release gates.

## Exit criteria

- [ ] No empty or invalid canonical task registry.
- [ ] One clear authority per field/task status and no stale static progress claims.
- [ ] Branch refs and promotion source are reconciled and documented.
- [ ] Toolchain policy agrees across package, CI, Docker and documentation.
- [ ] Issue lifecycle agrees with evidence/source/promotion without losing human-owned metadata.
- [ ] Required checks are verified against exact current SHA.
- [ ] All current capability gaps are explicit; no false completion claims.
- [ ] Build/test verification evidence exists for the exact candidate SHA.

**No feature expansion until S1–S4 are completed or explicitly accepted as blocked with a maintainer decision.**

## TaskOS guard implementation — 2026-11-23

- Added `parseTasksRegistry()` in `scripts/tasks/validate-tasks.mjs`: empty/whitespace registry and malformed JSON now return a clear recovery diagnostic instead of an opaque JSON parse failure.
- Added tests for empty, whitespace-only, malformed and valid JSON inputs in `scripts/tasks/validate-tasks.test.mjs`.
- This is a fail-safe diagnostic fix only. **TaskOS is still unavailable**; no records were reconstructed, and sync/rebuild remains prohibited until provenance inventory is complete.
- Validation execution was not possible in this remote edit session. Run `node --test scripts/tasks/validate-tasks.test.mjs` and `pnpm tasks:validate` on a checked-out dev candidate; the latter should fail safely with the recovery message until registry recovery.

## Consolidated SOT work — 2026-11-23

- Source-backed TaskOS inventory is documented in `docs/tasks/RECOVERY-INVENTORY.md`; the expected initial projection is 627 unique records. This is not registry restoration.
- Task schema now requires `sourceRef.file` and supports lossless delegated metadata. Validator fails on empty/malformed files, missing source files, unknown project/dependency/block references, duplicate IDs and DAG cycles.
- TaskOS sync now validates before any write. The one-time importer is fail-closed, defaults to dry-run and refuses to overwrite a populated registry.
- The Visual Universe project is mapped into global TaskOS; its local `task.json`, `TASKS.md` and task cards are projections from the global registry. Local projection tests were added.
- `pnpm test:taskos` is included in the unit-test runner, but has not yet been observed passing on a complete, non-cancelled exact-SHA CI run.
- The existing 1,358-record legacy registry remains unchanged. No 627-record migration has been applied; TaskOS is not yet declared migrated.

## Additional implementation notes — 2026-11-23

- Added a shared TaskOS-to-roadmap status map so `review` projects to `in_progress` (not silently to `todo`); the validator now compares exact lifecycle values against `docs/roadmap/tasks.json` as well as ROADMAP checkboxes.
- Dependency and `blocks` edges must be reciprocal and unique, not merely reference existing IDs.
- Visual Universe projection now applies canonical TaskOS evidence paths/commit/owner/notes/risk and cleared fields; retained source metadata no longer overrides an intentional canonical clear.
- Regression tests cover skipped state, canonical evidence additions, absent exit-code metadata, cleared canonical values and status mappings.
- The unit CI runner includes `pnpm test:taskos`. These test definitions are committed; execution remains pending.



## Audit correction and isolated candidate export — 2026-11-23

Earlier zero-byte registry statements were incorrect for the exact dev tree. A direct Git blob read confirms that `docs/tasks/tasks.json` parses as 1,358 records. Its legacy source distribution includes 861 entries attributed to root `todo.md`; root `todo.md` is now a pointer, so those records require reconciliation against the archived checklist.

The initial isolated candidate implementation was added in `9a4d994` and CI was adjusted in `7efba2c`. Its first exact-head TaskOS test run exposed one defect in the new CLI output: the trailing newline was double-escaped and produced invalid JSON. The regression test caught this before build/unit tests or registry mutation. The newline correction is applied in the current stabilization patch; a fresh exact-SHA CI run must verify it.

The 627-record candidate is not a canonical replacement until the complete old/new diff is reviewed and the previous 1,358-record registry is preserved.
