# Current stabilization checkpoint — 2026-11-23

- **Stable branch:** `main` remains at `2a9d78333433b783a80bcb82f6ac7f7ad95f6c2d`.
- **Development branch:** `dev` is 149 commits ahead and 0 behind at `cb5056585539a3702bc44f89e772b113edf74fb9`; no force push or history rewrite.
- **PR #37:** open promotion PR head is `cb5056585539a3702bc44f89e772b113edf74fb9`, base `2a9d78333433`. Report is current. Risk classification requires maintainer/CODEOWNER approval; no submitted review is recorded.
- **CI:** Workflow run [45065672654](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45065672654) is tied to exact candidate `cb5056585539a3702bc44f89e772b113edf74fb9`. `knowledge-gate` and `dx-test` passed; `quality-and-build` failed only at the generated-reference check (four generated docs outputs stale); `unit-tests` and `postgres-integration` are still in progress. The registry remains empty; no restore write occurred.
- **TaskOS:** `docs/tasks/tasks.json` is still zero-byte. The documented 627-record/8-source inventory remains a candidate migration projection only. `pnpm test:taskos` is included in the unit runner and is currently under hosted verification.
- **Visual Universe:** immutable 109-task source and all 109 original task cards are preserved; every card's stored Git blob SHA was independently reproduced (109/109). Local queue files are now non-authoritative projections and currently empty/placeholder while TaskOS recovery is blocked.
- **Recovery logic:** importer and validator are fail-closed; full candidate schema, provenance, project, reciprocal graph, dependency-cycle and roadmap parity validation is required before restore. Sync separates registry integrity preflight from projection parity and verifies parity after writing.
- **Documentation blocker:** generator CI found four stale outputs (`generated-api.md`, `generated-models.md`, `generated-platform.json`, `generated-platform.md`). Run `pnpm docs:generate` on the actual built checkout, commit the resulting outputs, then require a fresh full CI run.
- **M13 / Release:** M13.09–M13.12 remain pending full exact-SHA CI and promotion approval. M12.14 stable-release approval remains unresolved; promotion is not deployment.


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
- The expanded TaskOS registry is currently zero-byte. It is unavailable as a SOT until restored and validated.

## Work status

### S0 — Branch synchronization (DONE)
- [x] Verified `dev` was the exact source SHA for PR #31 promotion.
- [x] Fast-forwarded `dev` to the promotion merge commit `2a9d78333433b783a80bcb82f6ac7f7ad95f6c2d`, using expected-head protection.
- [x] No force push or history rewrite.
- [ ] Reconfirm `main` and `dev` equality after future pushes.

### S1 — TaskOS recovery (P0, implementation prepared; execution/restore blocked)
- [x] Confirmed `docs/tasks/tasks.json` is tracked and zero-byte on the current dev tree. The historical cause of truncation is not yet established.
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
- `docs/tasks/tasks.json` remains zero-byte. No registry records were written and no claim of restored SOT is made.

## Additional implementation notes — 2026-11-23

- Added a shared TaskOS-to-roadmap status map so `review` projects to `in_progress` (not silently to `todo`); the validator now compares exact lifecycle values against `docs/roadmap/tasks.json` as well as ROADMAP checkboxes.
- Dependency and `blocks` edges must be reciprocal and unique, not merely reference existing IDs.
- Visual Universe projection now applies canonical TaskOS evidence paths/commit/owner/notes/risk and cleared fields; retained source metadata no longer overrides an intentional canonical clear.
- Regression tests cover skipped state, canonical evidence additions, absent exit-code metadata, cleared canonical values and status mappings.
- The unit CI runner includes `pnpm test:taskos`. These test definitions are committed; execution remains pending.

