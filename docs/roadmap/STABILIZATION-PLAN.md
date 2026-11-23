# Current stabilization checkpoint — 2026-11-23 (Phase 0–6 closeout)

- **Stable branch (`main`):** `2a9d78333433b783a80bcb82f6ac7f7ad95f6c2d`; unchanged. No merge, release or deployment was performed.
- **Development branch (`dev`):** migration source head `0e90a59688386a6635c46f209b09d05296393148`; the owner-approved 627-record migration is now committed on top. Development remains dev-first; no history rewrite or force push is used.
- **Branch rules:** active `protect-dev` and `protect-main` rulesets. Both prohibit deletion/non-fast-forward updates; `main` additionally requires a PR and the `quality-and-build`, `unit-tests`, and `knowledge-gate` status checks. GitHub API access to the legacy branch-protection endpoint is restricted, but the active ruleset definitions were readable.
- **Promotion PR #37:** remains open and mergeable, directed to `main`; it follows the new migration head. CODEOWNER/release approval remains a separate gate. Promotion is not deployment.
- **Toolchain correction:** Docker Corepack pins `pnpm@11.17.0`; `scripts/check-action-pins.mjs` checks Dockerfile; a regression test covers the exact Docker pin. CI candidate export is non-mutating and does not print the payload.
- **Exact-SHA CI:** push run [45088485869](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45088485869) and PR run [45088491241](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45088491241) both completed all five jobs successfully against `def3df35b5d54d7359600e0471af5a6dd4cb7f29`: quality/build, unit tests (including `pnpm test:taskos` and candidate validation/upload), knowledge gate, DX and PostgreSQL integration.
- **TaskOS source of truth:** `docs/tasks/tasks.json` is now the owner-approved 627-record canonical registry (468 done, 49 doing, 89 todo, 21 blocked). The former 1,358-record registry is preserved byte-for-byte at `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json` (blob `d56499936761dcc062704d06588ee2679fd1aae2`). Full ID reconciliation is recorded; the 854 completed legacy rows remain historical and seven open records remain blocked.
- **Recovery safety:** the one-time migration has been applied after owner approval; never rerun `--write`. Keep the legacy snapshot immutable. Continue with canonical validation, deterministic projection comparison and Visual Universe projection checks.
- **M13 / FLOW:** M13.09–M13.12 implementation and evidence exist. The full local Desktop journey still needs execution and evidence; it is not part of the TaskOS registry migration.
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

### S1 — TaskOS migration (P0, owner-approved canonical write applied)

- [x] Audited the pre-migration registry blob: 1,358 unique records; 861 records referenced root `todo.md`, now a pointer.
- [x] Inventoried all eight authoritative sources and built the deterministic 627-record candidate.
- [x] Reconciled all task IDs: 504 shared, 854 completed historical IDs archived, and 123 reviewed IDs added; all seven still-open legacy IDs are retained as blocked.
- [x] Preserved the exact legacy registry blob `d56499936761dcc062704d06588ee2679fd1aae2` at `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json`.
- [x] Applied the approved 627-record candidate to canonical `docs/tasks/tasks.json`; blob SHA `8216b6503d154d635112be96c41939a9efd38390`, candidate JSON SHA-256 `13bc0b8ce445af5eff0b9e2057921c0ca73e1acc51dca02d25c848dd2b6a8776`.
- [x] Added deterministic CI timestamp pinning via source commit timestamp.
- [x] Verify `pnpm tasks:validate`, `pnpm automation:check:roadmap`, and `pnpm tasks:sweep -- --check` on exact implementation SHA `e1b216eeb2bcca131a9efbb14fe91865cd6ee3fc`; both push and PR unit-test jobs passed.
- [x] Regenerate and commit the TaskOS-driven Visual Universe projections; `sync-task-state.mjs --check` passed on exact SHA `e1b216eeb2bcca131a9efbb14fe91865cd6ee3fc` (109 cards across 11 phases, plus `task.json` and `TASKS.md`).
- [x] Record exact-SHA CI: push run [45095239162](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45095239162) and PR run [45095243555](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45095243555) both passed all five jobs.

### S2 — Roadmap and Issue lifecycle reconciliation (P1)

- [x] Recompute task counts from `ROADMAP.md` and `docs/roadmap/tasks.json`. Exact result: 239 tasks; roadmap checkboxes 157 checked / 82 unchecked; source statuses 157 complete / 47 in-progress / 35 todo. No current tracked generated progress dashboard was found to rewrite; old counts in dated audit narratives remain historical.
- [x] Cross-check M13.01–M13.12 source status and evidence. All 12 are marked complete; each evidence file and every listed source/deliverable path exists in the exact audited tree.
- [x] Reconcile completed issue lifecycle #32–#36 against promoted sources/evidence; preserve human fields and comments.
- [x] Audit stale/open/closed issues and duplicate task markers. Snapshot before the TaskOS recovery issue was closed: 23 issues (15 open, 8 closed), with 12 managed markers for M13.01–M13.12; no duplicate markers, malformed blocks, or orphan task IDs among those 12. All 12 managed projections have stale/missing source SHA (11 old SHAs, M13.01 none); 227/239 roadmap task IDs have no managed issue marker. After the snapshot, issue #44 alone was updated with accepted migration evidence and closed as completed; no other issue was mutated and no mass-close was performed.
- [ ] Reconcile missing/stale managed Issue projections from current exact evidence, and verify roadmap index/evidence links/generated progress artifacts agree. Use bounded, reviewed issue-sync batches; preserve human-owned fields and never mass-close.

### S3 — Runtime/toolchain documentation (P1)

- [x] Align primary Node policy references across root engines, Docker, CI setup, Desktop package and docs to Node 24; runtime ledger refresh remains a separate review.
- [ ] Refresh runtime support review ledger (Node reviewed; other overdue entries remain separately due).
- [x] Validate README Quickstart/badge, support policy, active Desktop architecture and TODO, Docker and CI statements. The conflicting Node 22 references in the current Desktop ADR/blueprint and README badge were corrected; archived TODO snapshots remain unchanged.
- [x] Keep exact pnpm `11.17.0` consistent across root `packageManager`, CI setup, Docker Corepack and package-manager drift checks; exact-SHA CI passed on `9aa6ca7d2b93767d864825b97b217f24881a0796`.

### S4 — Release/CI truth audit (P1)

- [x] Inspect required checks and rulesets on `main` and `dev`; record the active `protect-main` / `protect-dev` rulesets and the restricted legacy branch-protection endpoint.
- [x] Fetch PR #31 CI runs and verify all required jobs on exact source SHA: source `a3fa6da5b6b4e47e42240c8ec2c9ef8561416064`, push run [45053735229](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45053735229), PR run [45053738507](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45053738507); both passed all five jobs.
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
- This historical checkpoint recorded only the fail-safe diagnostic change; no records were written at that time. Subsequent source inventory, candidate generation and exact-SHA validation are documented in the TaskOS recovery addendum below. The populated legacy registry remains untouched.
- Validation execution was not possible in this remote edit session. Run `node --test scripts/tasks/validate-tasks.test.mjs` and `pnpm tasks:validate` on a checked-out dev candidate; the latter should fail safely with the recovery message until registry recovery.

## Consolidated SOT work — 2026-11-23

- Source-backed TaskOS inventory is documented in `docs/tasks/RECOVERY-INVENTORY.md`; the expected initial projection is 627 unique records. This is not registry restoration.
- Task schema now requires `sourceRef.file` and supports lossless delegated metadata. Validator fails on empty/malformed files, missing source files, unknown project/dependency/block references, duplicate IDs and DAG cycles.
- TaskOS sync now validates before any write. The one-time importer is fail-closed, defaults to dry-run and refuses to overwrite a populated registry.
- The Visual Universe project is mapped into global TaskOS; its local `task.json`, `TASKS.md` and task cards are projections from the global registry. Local projection tests were added.
- `pnpm test:taskos` passed in the unit-test job on both non-cancelled exact-SHA CI runs [45088485869](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45088485869) and [45088491241](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45088491241), with the latter also exercising candidate build/validation/upload.
- The owner-approved 627-record registry is canonical; the former 1,358-record blob is preserved at the archive path. Post-migration checks are tracked in S1.

## Additional implementation notes — 2026-11-23

- Added a shared TaskOS-to-roadmap status map so `review` projects to `in_progress` (not silently to `todo`); the validator now compares exact lifecycle values against `docs/roadmap/tasks.json` as well as ROADMAP checkboxes.
- Dependency and `blocks` edges must be reciprocal and unique, not merely reference existing IDs.
- Visual Universe projection now applies canonical TaskOS evidence paths/commit/owner/notes/risk and cleared fields; retained source metadata no longer overrides an intentional canonical clear.
- Regression tests cover skipped state, canonical evidence additions, absent exit-code metadata, cleared canonical values and status mappings.
- The unit CI runner includes `pnpm test:taskos`. These test definitions are committed; execution remains pending.

## Audit correction and isolated candidate export — 2026-11-23

Earlier zero-byte registry statements were incorrect for the exact dev tree. A direct Git blob read confirms that `docs/tasks/tasks.json` parses as 1,358 records. Its legacy source distribution includes 861 entries attributed to root `todo.md`; root `todo.md` is now a pointer, so those records require reconciliation against the archived checklist.

The initial isolated candidate implementation was added in `9a4d994` and CI was adjusted in `7efba2c`. Its first exact-head TaskOS test run exposed one defect in the new CLI output: the trailing newline was double-escaped and produced invalid JSON. The regression test caught this before build/unit tests or registry mutation. The newline correction is applied in the current stabilization patch; a fresh exact-SHA CI run must verify it.

The 627-record candidate was accepted and installed after the complete old/new diff was reviewed; the previous 1,358-record blob is preserved at the documented archive path.

## Phase 0–1 exact-head verification addendum — 2026-11-23

- Phase 0 remote acceptance is complete on `def3df35b5d54d7359600e0471af5a6dd4cb7f29`: branch rulesets were inspected; main remained unchanged; both push and pull-request CI completed all five jobs successfully.
- Phase 1 candidate acceptance was completed on the pre-migration head: the final artifact contained 627 unique records and the expected lifecycle/source counts, with no missing references, non-reciprocal dependency edges or cycles.
- The owner approved the candidate and it is now installed as canonical. New canonical blob SHA: `8216b6503d154d635112be96c41939a9efd38390`; candidate JSON SHA-256: `13bc0b8ce445af5eff0b9e2057921c0ca73e1acc51dca02d25c848dd2b6a8776`.
- The former 1,358-record blob `d56499936761dcc062704d06588ee2679fd1aae2` is preserved byte-for-byte at `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json`.
- The CI candidate job pins `SOURCE_DATE_EPOCH` to the timestamp of `GITHUB_SHA`; exact-SHA CI now also runs canonical validation and deterministic source comparison.

## Owner-approved TaskOS migration record — 2026-11-23

- User approval received before the write.
- Canonical registry: 627 records, blob `8216b6503d154d635112be96c41939a9efd38390`; source candidate SHA-256 `13bc0b8ce445af5eff0b9e2057921c0ca73e1acc51dca02d25c848dd2b6a8776`.
- Rollback snapshot: original 1,358-record blob `d56499936761dcc062704d06588ee2679fd1aae2`, archived byte-for-byte at `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json`.
- Statuses: 468 done / 49 doing / 89 todo / 21 blocked.
- Post-migration CI validation gates: `pnpm tasks:validate`, `pnpm automation:check:roadmap`, deterministic `pnpm tasks:sweep -- --check`, and Visual Universe `sync-task-state.mjs --check`.
