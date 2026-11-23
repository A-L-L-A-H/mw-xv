# Phase 0–6 Closeout and Local Acceptance Handoff

**Audit date:** 2026-11-23  
**Repository:** `A-L-L-A-H/mw-xv`  
**Target branch:** `dev`  
**Migration source SHA:** `0e90a59688386a6635c46f209b09d05296393148`  
**Stable baseline:** `main = 2a9d78333433b783a80bcb82f6ac7f7ad95f6c2d`

This report separates work completed remotely from gates that require a real local runtime, a data-owner decision, or a CODEOWNER/release approval. It is not a declaration that the product is released.

## Executive status

The stabilization and TaskOS recovery implementation is committed to `dev`; `main` remains unchanged. Phase 0 is verified on exact development SHA `def3df35b5d54d7359600e0471af5a6dd4cb7f29`: both push CI [45088485869](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45088485869) and pull-request CI [45088491241](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45088491241) completed all five jobs successfully. Active `protect-dev` and `protect-main` rulesets are present; the main ruleset requires a PR and the `quality-and-build`, `unit-tests`, and `knowledge-gate` checks.

Phase 1's 627-record TaskOS candidate was approved by the owner and installed as canonical on `dev`. The former 1,358-record registry is preserved byte-for-byte at `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json`. The migration commit adds exact-SHA CI validation for canonical TaskOS, deterministic projection and Visual Universe projections. The full native Desktop FLOW walkthrough, PR #37 review and M12.14 release approval remain separate owner-controlled gates.

## Phase register

| Phase | Scope | Verified outcome | Remaining acceptance |
|---|---|---|---|
| **0 — Stabilization** | Branch, CI, toolchain and safety baseline | `main` untouched; only `main` and `dev` are used; active branch rulesets prohibit deletion/non-fast-forward updates; main requires PR plus `quality-and-build`, `unit-tests`, and `knowledge-gate`; Docker/Corepack pnpm pin and drift regression test are in place; exact-SHA push and PR CI both pass all five jobs | **Remote Phase 0 complete.** Preserve the existing branch and release gates; no production deployment is implied |
| **1 — TaskOS recovery** | Rebuild from source provenance without data loss | Owner-approved 627-record candidate is installed as canonical; previous 1,358-record blob is preserved byte-for-byte at the archive path; full identity reconciliation and candidate SHA are recorded | Exact migration-SHA canonical validators, deterministic projection and Visual Universe projection check must pass in CI before Phase 1 is fully closed |
| **2 — Governance and documentation** | Roadmap, issue lifecycle, runtime support and canonical docs | Stabilization/active checkpoints refreshed; source-of-truth and review boundaries documented; runtime configuration cross-checked against upstream documentation | Formal maintainer refresh/sign-off of overdue runtime ledger entries; reconcile issue projections from exact evidence; do not mass-close issues |
| **3 — ROCKSOUL FLOW integration** | Repo Radar → Overlap → Plan → Packet → Dispatch → Worktree → Proof → Review → Sync | M13.09–M13.12 code/evidence exists; Board/Desktop boundary and server-authority contracts are documented; previous exact-SHA PostgreSQL integration lane passed | Local native Desktop end-to-end walkthrough with real isolated worktree; verify scope rejection, lease/fencing, redaction, human review and server-only acceptance |
| **4 — Roadmap completion** | Evidence-led task completion | M13.09–M13.12 are already recorded complete in the M13 roadmap and have evidence files; no duplicate implementation was started | Keep other M/K tasks at their actual source state; update status only with test/evidence proof; close M13 issue projections only after the full journey is accepted |
| **5 — Product/creative portfolio** | Preserve future initiatives without mixing them into the stabilization release | Issues #15–#22 remain separately scoped proposals: extension/community, MoonWitness shared experience, GOD PROMISE/ROCKSOUL editorial workflow, Asmaul Husna visual reference, artwork-first creative pipeline, research workflow, Desktop harness evaluation and AEQ/BABYDOLL concept | Maintainer acceptance and atomic TaskOS tasks are required before any feature expansion; no proposal is treated as implemented or release-blocking by implication |
| **6 — Release and handoff** | Exact-SHA verification, approvals, controlled promotion and local takeover | PR #37 remains open; promotion report is separate from deployment; release gates are explicit; closeout handoff is prepared | Current CI green on the final candidate SHA, TaskOS data reconciliation, local acceptance, CODEOWNER review and M12.14 approval. No automatic merge, tag, publication or deployment |

## TaskOS data contract

The current canonical registry is **627 records**. The prior 1,358-record registry (Git blob `d56499936761dcc062704d06588ee2679fd1aae2`) is preserved at `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json`. Its 861 historical references to root `todo.md` were reconciled: 854 completed IDs remain as historical evidence and seven open IDs are retained as blocked.

The source-backed migration design contains **627 records**:

| Source group | Records |
|---|---:|
| Roadmap | 239 |
| WhatsApp checklist | 112 |
| Desktop checklist | 128 |
| Archived open MW items | 7 |
| AI Corporation PR lifecycle | 14 |
| Evolution backlog | 4 |
| Audit backlog | 14 |
| Visual Universe | 109 |
| **Candidate total** | **627** |

Expected candidate state distribution: **468 done, 49 doing, 89 todo, 21 blocked**.

A complete identity check has already reconciled the 861 legacy rows whose `sourceRef.file` was the root `todo.md`: all 854 legacy `done` IDs match the 854 checked entries in the archived checklist, and all 7 legacy `todo` IDs match the 7 unchecked archive entries, with zero missing/extra IDs. The seven retained open IDs are `MW-CFG-003.3`, `MW-CICD-002`, `MW-CICD-002.3`, `MW-CICD-004`, `MW-CICD-004.2`, `MW-CICD-004.3`, and `MW-DOC-004.3`; they map to `blocked` pending re-triage. Legacy blob SHA: `d56499936761dcc062704d06588ee2679fd1aae2`; archive blob SHA: `f29ec364530195484f668287c5616bf91984554f`. A regression test for this exact mapping is committed and passed in the exact-SHA unit-test job on both push and pull-request CI runs [45088485869](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45088485869) and [45088491241](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45088491241).

The 731-record difference is fully reconciled, not an unexplained deletion. The canonical replacement was approved by the owner; do not rerun the one-time importer with `--write` or modify the archived legacy blob. The seven archived open rows remain blocked pending re-triage.

## Exact development-head TaskOS candidate verification — 2026-11-23

The non-cancelled push CI run [45088485869](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45088485869) and pull-request CI run [45088491241](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45088491241) both tested the exact `dev` head `def3df35b5d54d7359600e0471af5a6dd4cb7f29`. All five jobs passed in each run: quality/build, unit tests, knowledge gate, DX and PostgreSQL integration. The unit-test job ran `pnpm test:taskos`, built the workspace, ran unit tests, generated the candidate in non-mutating mode, validated it and uploaded the artifact.

Exact development-head candidate:
- Workflow artifact: [14780700916](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45088485869) (`taskos-candidate-def3df35b5d54d7359600e0471af5a6dd4cb7f29`).
- Candidate JSON SHA-256: `7be52787d8eacfde6d17ff2320c8d5a750ec410b802635125e0ebbd9057a2dc1`.
- Downloaded artifact ZIP SHA-256: `75e926dd4d2f27cb64aff50ccbb2a05c7352cd7d690f3276cd0b879f9e85a2a7`.
- Candidate metadata: `moonwitness-tasks/v2`, schema `2.0.0`, 627 task records, 627 unique task codes.
- State counts: 468 `done`, 49 `doing`, 89 `todo`, 21 `blocked`.
- Source groups: roadmap 239; WhatsApp 112; Desktop 128; archived open MW 7; AI Corporation PR lifecycle 14; Evolution 4; audit 14; Visual Universe 109.
- Structural inspection: 0 missing project references, source references, dependency IDs or block IDs; 0 non-reciprocal edges; 0 dependency cycles.

The exact-`dev` candidate is now generated with `SOURCE_DATE_EPOCH` derived from the source commit timestamp. Reruns for a fixed source SHA therefore reproduce the same `generatedAt` value; the migration artifact selected for canonical installation carries that deterministic timestamp.

The full legacy-to-candidate identity reconciliation remains:
- Legacy registry: 1,358 unique codes.
- Shared legacy/candidate identities: 504.
- Excluded: exactly 854 legacy `done` records with the stale root-`todo.md` source reference; they remain in the archived checklist and untouched legacy registry snapshot.
- Added: 123 new identities (14 AI Corporation PR lifecycle + 109 Visual Universe).
- The seven open legacy IDs remain in the candidate as `blocked`, pending re-triage.
- Arithmetic: `1,358 - 854 + 123 = 627`.

**Owner-approved migration is applied.** New canonical registry blob: `8216b6503d154d635112be96c41939a9efd38390`; candidate JSON SHA-256: `13bc0b8ce445af5eff0b9e2057921c0ca73e1acc51dca02d25c848dd2b6a8776`. Previous registry blob `d56499936761dcc062704d06588ee2679fd1aae2` is preserved byte-for-byte at `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json`. Do not rerun the one-time importer with `--write`. Migration-SHA CI now verifies `pnpm tasks:validate`, `pnpm automation:check:roadmap`, `pnpm tasks:sweep -- --check`, and the Visual Universe projection check.

## Runtime and toolchain notes

The source review supports the configured Node 24 + pnpm 11 combination: Node 24 is LTS, and pnpm 11 supports Node 24. pnpm 12 is now the current line, but it should be evaluated as a separate controlled upgrade rather than adopted implicitly. PostgreSQL 16 remains supported; upstream lists 16.16 as current minor and 2028-11-09 as its final release date. Playwright's published requirements include Node 24 and Ubuntu 24.04. GitHub's migration of `ubuntu-latest` to Ubuntu 26.04 was scheduled to complete by 2026-11-19, so retaining an explicit `ubuntu-24.04` pin avoids an unreviewed runner change.

Sources:
- [Node.js releases](https://nodejs.org/en/about/previous-releases)
- [pnpm compatibility](https://pnpm.io/installation)
- [PostgreSQL versioning](https://www.postgresql.org/support/versioning/)
- [Playwright system requirements](https://playwright.dev/docs/intro)
- [GitHub runner Ubuntu 26.04 migration](https://github.com/actions/runner-images/issues/14748)

The machine-readable `docs/engineering/runtime-support-review.json` still shows overdue pnpm/PostgreSQL/Playwright/runner review dates. This report does not silently rewrite the accountable maintainer's review dates or sign on their behalf. The maintainer must confirm the read-through and update the ledger.

## Local Codex handoff — post-migration

The TaskOS canonical migration has been applied to `dev`. In the owner checkout, do not reset, clean or overwrite unowned changes. First fetch the current `origin/dev` and inspect the exact SHA before local acceptance.

Run these checks on the migration commit:

```powershell
pnpm test:taskos
pnpm tasks:validate
pnpm automation:check:roadmap
pnpm tasks:sweep -- --check
node MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/tools/sync-task-state.mjs --check
```

If the Visual Universe projection check reports stale files, review its deterministic output and regenerate only those projections from canonical TaskOS; do not edit `task.json`, `TASKS.md`, or individual task cards as independent status sources. Keep the previous registry backup untouched.

The native Desktop FLOW walkthrough remains a separate acceptance gate: use one disposable task/worktree, verify Repo Radar, Overlap, Plan, Dispatch, lease/fencing, Proof Gate, human review and server-authoritative Sync. Do not merge PR #37, create a release, publish trusted docs or deploy as part of this migration.

## Documentation publication gate

Issue [#2](https://github.com/A-L-L-A-H/mw-xv/issues/2) remains open for the trusted documentation publication incident on `main`. The Pages workflow supports safe `dev` previews, but preview success is not a production publication. Since PR #37 has not been merged and `main` is intentionally unchanged, do not close the incident or publish from an untrusted ref. Re-run the trusted Pages workflow only after the promotion/release owner authorizes a verified `main` SHA or stable release tag.

## Release blockers and decision owners

- **TaskOS post-migration verification:** exact-SHA canonical validators and Visual Universe projection check must be green; the previous 1,358-record snapshot is already preserved.
- **PR #37:** CODEOWNER/repository maintainer review is required on the final exact source SHA.
- **M12.14:** stable-release approval remains a separate human-controlled gate.
- **Desktop end-to-end acceptance:** local Codex/maintainer must run the real native journey in the owner checkout.
- **Runtime review ledger:** accountable maintainer must confirm due entries and update the dates.
- **Security/Pages/release policies:** only the designated repository/security/release owners may disposition private alerts, publication settings and production release state.

**No production release or deployment is implied by completion of this closeout report.**
