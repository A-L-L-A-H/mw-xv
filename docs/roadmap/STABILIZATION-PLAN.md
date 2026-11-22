## Promotion candidate freshness correction

- PR #37 head SHA was observed as `b16f6f4ef57942f710f605c6f5814af563ec017b`, 22 commits ahead of main.
- The PR's managed promotion report still references earlier source `b2951b4`; associated CI runs `45055213276` and `45055208613` are both **cancelled**. The commit status API has no statuses for observed head `b16f6f4`.
- This is a source/report mismatch. Do not merge PR #37 until promotion automation refreshes the report and required CI runs complete on the exact current head. Any subsequent docs commit will move the head again, so use the latest PR head SHA and checks at review time.
- Issues #40–#43 are open; work status is complete, delivery stage remains planned, and the blocker is CI/approval.

## Progress reconciliation — 2026-11-23

- **S0:** Fast-forward sync from main to dev completed earlier. Current development is now 19 commits ahead of main and has an open promotion PR #37; keep it unmerged until approval and exact-source CI finish.
- **S2:** M13.01 and M13.02–M13.08 issues were reconciled and closed after exact-source CI success and promotion. Missing issues M13.02 and M13.03 were created (#38 and #39). New dev milestones M13.09–M13.12 now have open issues #40–#43; work is recorded complete, delivery remains planned until candidate CI/promotion is verified.
- **S3:** README, support policy, Desktop TODO, Desktop architecture and Node support review ledger now consistently reflect configured Node.js 24 (root engines, Docker, CI and Desktop package). Runtime support review for other toolchain components is still overdue.
- **S4:** Promotion PR #37 is open and requires approval. Latest known exact-source CI run [45055213276](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45055213276) was running on candidate `b2951b4`; verify the latest run after this docs commit because each push refreshes the promotion candidate.
- **S5:** Current dev evidence covers M13.01–M13.12. M13.09–M13.12 narrow checks are recorded as passed, but full PostgreSQL and Playwright E2E were not run in the milestone evidence. Visual DNA core is implemented; external-repository profile intake/export remains a follow-up gap.
- **S1:** TaskOS recovery remains blocked: `docs/tasks/tasks.json` is still zero-byte. No task records were fabricated.

## Current branch update — 2026-11-23

- `main`: `2a9d78333433b783a80bcb82f6ac7f7ad95f6c2d`.
- `dev`: latest promotion candidate source is `0a33aff64d79d51e30e2298ff64d6a68da5ce6a4`; branch comparison reports 16 commits ahead of main.
- Open promotion PR [#37](https://github.com/A-L-L-A-H/mw-xv/pull/37) carries M13.09–M13.12. Exact-source CI run [45054939356](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45054939356) was cancelled; risk report requires approval. Do not merge or claim verified-dev/in-main for these tasks yet.
- M13.09–M13.12 have narrow implementation evidence (local package/API tests, typecheck/lint/UI boundary checks), but full PostgreSQL integration and Playwright Chromium E2E are explicitly not run in those evidence batches.
- TaskOS remains zero-byte at the current dev source. Its README now documents the temporary SOT boundary; registry reconstruction remains blocked on source inventory and provenance.

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

### S1 — TaskOS recovery (P0, BLOCKED until source inventory)
- [ ] Confirm zero-byte `docs/tasks/tasks.json` is the remote file and identify when/why it became empty.
- [ ] Inventory all legitimate task sources: ROADMAP checklist/index, detailed cards, DSK ledger, autonomous packs, governance/audit registers, evolution tasks and any migration ledgers.
- [ ] Map task sources and owners; identify which records are canonical vs historical/archive/generated.
- [ ] Rebuild registry from authoritative sources only; preserve stable task codes, status, dependencies, project/series, acceptance and provenance. Never synthesize 1,346 records from a count claim.
- [x] Update schema/validator only as required; add an explicit empty-file guard and useful diagnostics before JSON parsing (implemented; tests added, hosted/local test execution pending).
- [ ] Make generator/rebuild procedure deterministic, idempotent, lossless for human-owned fields, and previewable.
- [ ] Validate duplicate codes, unknown dependencies, DAG cycles, orphan references, status parity, source provenance and record counts.
- [ ] Run `pnpm tasks:validate`, `pnpm tasks:sync --dry-run` (if supported) and relevant tests; do not apply sync until the source map is approved.
- [ ] Record restoration evidence and exact SHA. Until then, TaskOS is **unavailable**, not authoritative.

### S2 — Roadmap and Issue lifecycle reconciliation (P1)
- [ ] Recompute task counts from `ROADMAP.md` and `docs/roadmap/tasks.json`; remove stale static totals.
- [ ] Cross-check M13.01–M13.08 source status and evidence.
- [ ] Reconcile issues #32–#36 against exact source/evidence/merged SHA and delivery lifecycle; update managed fields only, preserve human fields/comments, then close only when contract permits.
- [ ] Audit stale open/closed issues and duplicate task markers; no mass-close.
- [ ] Ensure roadmap index, evidence links, managed Issue blocks and generated progress artifacts agree.

### S3 — Runtime/toolchain documentation (P1)
- [ ] Reconcile all Node references to Node 24 where root engines, Docker, CI setup and Desktop package agree.
- [ ] Refresh runtime support review ledger (Node reviewed; other overdue entries remain separately due).
- [ ] Validate README Quickstart, support policy, Desktop architecture, Desktop TODO and Docker/CI statements.
- [ ] Keep exact pnpm version/config consistent with Corepack, CI and package-manager policy.

### S4 — Release/CI truth audit (P1)
- [ ] Inspect required checks and rulesets on `main` and `dev`; record access/API limitations.
- [ ] Fetch PR #31 CI runs and verify all required jobs on exact source SHA; resolve pending/ambiguous checks.
- [ ] Verify M12.14 approval, CODEOWNER and release blockers from source/evidence; don't infer from merge.
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
