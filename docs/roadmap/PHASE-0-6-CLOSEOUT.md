# Phase 0–6 Closeout and Local Acceptance Handoff

**Audit date:** 2026-11-23  
**Repository:** `A-L-L-A-H/mw-xv`  
**Target branch:** `dev`  
**Implementation batch baseline:** `62e5ef656d58be11350e8a1d228da2205c5108eb`  
**Stable baseline:** `main = 2a9d78333433b783a80bcb82f6ac7f7ad95f6c2d`

This report separates work completed remotely from gates that require a real local runtime, a data-owner decision, or a CODEOWNER/release approval. It is not a declaration that the product is released.

## Executive status

The remote stabilization batch is committed to `dev`. It fixes an exact pnpm version mismatch in Docker, extends the drift checker to cover Dockerfile, adds a regression test, and simplifies the TaskOS candidate CI path. The repository's main branch was not changed.

**Not complete yet:** the 627-record TaskOS candidate has not been accepted as canonical; the full local Desktop workflow has not been run in the owner's checkout; and PR #37 / M12.14 remain human approval gates. CI run [45086573530](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45086573530) is the exact-SHA hosted verification to recheck before release claims.

## Phase register

| Phase | Scope | Verified outcome | Remaining acceptance |
|---|---|---|---|
| **0 — Stabilization** | Branch, CI, toolchain and safety baseline | `main` unchanged; development remains dev-first; Docker pins Corepack to `pnpm@11.17.0`; checker scans Dockerfile; regression test added; candidate CI no longer duplicates the export or prints its full payload to logs | Recheck all jobs on the new exact SHA; preserve protected branch/release rules |
| **1 — TaskOS recovery** | Rebuild from source provenance without data loss | Source inventory, fail-closed validator, deterministic isolated candidate mode, and TaskOS safety tests exist. Legacy registry is valid JSON with 1,358 records; candidate design has 627 records | Obtain candidate artifact; inspect every 1,358→627 difference; preserve a byte-for-byte legacy backup; obtain maintainer acceptance; only then perform one-time migration and rerun validators |
| **2 — Governance and documentation** | Roadmap, issue lifecycle, runtime support and canonical docs | Stabilization/active checkpoints refreshed; source-of-truth and review boundaries documented; runtime configuration cross-checked against upstream documentation | Formal maintainer refresh/sign-off of overdue runtime ledger entries; reconcile issue projections from exact evidence; do not mass-close issues |
| **3 — ROCKSOUL FLOW integration** | Repo Radar → Overlap → Plan → Packet → Dispatch → Worktree → Proof → Review → Sync | M13.09–M13.12 code/evidence exists; Board/Desktop boundary and server-authority contracts are documented; previous exact-SHA PostgreSQL integration lane passed | Local native Desktop end-to-end walkthrough with real isolated worktree; verify scope rejection, lease/fencing, redaction, human review and server-only acceptance |
| **4 — Roadmap completion** | Evidence-led task completion | M13.09–M13.12 are already recorded complete in the M13 roadmap and have evidence files; no duplicate implementation was started | Keep other M/K tasks at their actual source state; update status only with test/evidence proof; close M13 issue projections only after the full journey is accepted |
| **5 — Product/creative portfolio** | Preserve future initiatives without mixing them into the stabilization release | Issues #15–#22 remain separately scoped proposals: extension/community, MoonWitness shared experience, GOD PROMISE/ROCKSOUL editorial workflow, Asmaul Husna visual reference, artwork-first creative pipeline, research workflow, Desktop harness evaluation and AEQ/BABYDOLL concept | Maintainer acceptance and atomic TaskOS tasks are required before any feature expansion; no proposal is treated as implemented or release-blocking by implication |
| **6 — Release and handoff** | Exact-SHA verification, approvals, controlled promotion and local takeover | PR #37 remains open; promotion report is separate from deployment; release gates are explicit; closeout handoff is prepared | Current CI green on the final candidate SHA, TaskOS data reconciliation, local acceptance, CODEOWNER review and M12.14 approval. No automatic merge, tag, publication or deployment |

## TaskOS data contract

The current tracked registry is **1,358 legacy records**, not an empty file. Its 861 historical references to root `todo.md` are stale as current provenance because root `todo.md` is now a pointer.

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

The 731-record difference is a reconciliation problem, not permission to delete. Do not:
- replace `docs/tasks/tasks.json` with the 627-record candidate without a complete diff review and preserved legacy copy;
- run the one-time importer with `--write`;
- run `pnpm tasks:sync` or regenerate Visual Universe task projections before the canonical migration passes validation and receives owner approval;
- promote archived checklist rows to ready work without re-triage.

## Runtime and toolchain notes

The source review supports the configured Node 24 + pnpm 11 combination: Node 24 is LTS, and pnpm 11 supports Node 24. pnpm 12 is now the current line, but it should be evaluated as a separate controlled upgrade rather than adopted implicitly. PostgreSQL 16 remains supported; upstream lists 16.16 as current minor and 2028-11-09 as its final release date. Playwright's published requirements include Node 24 and Ubuntu 24.04. GitHub's migration of `ubuntu-latest` to Ubuntu 26.04 was scheduled to complete by 2026-11-19, so retaining an explicit `ubuntu-24.04` pin avoids an unreviewed runner change.

Sources:
- [Node.js releases](https://nodejs.org/en/about/previous-releases)
- [pnpm compatibility](https://pnpm.io/installation)
- [PostgreSQL versioning](https://www.postgresql.org/support/versioning/)
- [Playwright system requirements](https://playwright.dev/docs/intro)
- [GitHub runner Ubuntu 26.04 migration](https://github.com/actions/runner-images/issues/14748)

The machine-readable `docs/engineering/runtime-support-review.json` still shows overdue pnpm/PostgreSQL/Playwright/runner review dates. This report does not silently rewrite the accountable maintainer's review dates or sign on their behalf. The maintainer must confirm the read-through and update the ledger.

## Local Codex handoff

Run this in the actual owner checkout. Do not discard or overwrite existing local changes.

### 1. Establish the checkout

PowerShell:

```powershell
git status --short --branch
git fetch origin
git branch --show-current
git rev-parse HEAD
git rev-parse origin/dev
node --version
pnpm --version
```

Expected branch is `dev`. The checkout should match the latest `origin/dev` SHA before testing. Use Node.js 24.x and pnpm 11.17.0. If the worktree is dirty, stop and inspect it; do not reset, clean, or stash blindly.

### 2. Export and inspect a non-mutating TaskOS candidate

```powershell
$sha = (git rev-parse HEAD).Trim()
$candidate = Join-Path $env:TEMP "taskos-candidate-$sha.json"
pnpm tasks:sweep --candidate $candidate
node -e "const r=JSON.parse(require('node:fs').readFileSync(process.argv[1],'utf8')); const s=Object.fromEntries(['done','doing','todo','blocked'].map(k=>[k,r.tasks.filter(t=>t.status===k).length])); console.log({count:r.tasks.length,status:s}); if(r.tasks.length!==627||JSON.stringify(s)!==JSON.stringify({done:468,doing:49,todo:89,blocked:21})) process.exit(1)" $candidate
```

Keep the candidate outside the repository. Inspect and report its SHA-256, source counts, state counts, duplicate IDs, unresolved dependencies, cycles, provenance failures and the full diff against the legacy snapshot. Do not install it as canonical during this verification run.

### 3. Run focused validation

```powershell
pnpm test:taskos
pnpm automation:check:roadmap
pnpm tasks:validate
pnpm --filter @moonwitness/desktop test
pnpm --filter @moonwitness/board typecheck
pnpm dx:test
```

Record each command's exit code and exact HEAD. If PostgreSQL integration is required, build first and use the repository's isolated test database/service configuration; never point tests at user or production data.

### 4. Execute the complete FLOW acceptance journey

In the real Desktop-capable checkout, walk one disposable project/task through:

1. Repo Radar: read-only snapshot pinned to a repository revision; sensitive paths excluded and evidence redacted.
2. Overlap Detector: deterministic advisory result; no automatic mutation.
3. Plan Forge: compile a bounded WorkContract/Execution Packet with explicit scope and acceptance criteria.
4. Dispatch: accept only an eligible ready task and preserve dependency DAG constraints.
5. Worktree lease: acquire an isolated worktree and verify lease/fencing token behavior.
6. Proof Gate: prove changed paths remain in scope; reject out-of-scope drift and missing required evidence.
7. Review: an independent human review is required; automated advisory output cannot self-approve.
8. Sync: only the server-authoritative accepted state may sync; retain an auditable evidence trail.

Capture redacted logs, test output, commit SHA, worktree status and screenshots only where useful. Do not expose secrets or private task payloads.

### 5. Return evidence; do not bypass gates

Return the exact tested SHA, worktree status before/after, command outputs, candidate file hash, candidate-vs-legacy reconciliation report, PostgreSQL/browser/desktop result, and any failures. Make no canonical registry write, mass issue close, merge, tag, release or deployment without the relevant owner approval.

## Release blockers and decision owners

- **TaskOS migration:** repository maintainer/data owner must accept the reconciled candidate and preserved legacy snapshot.
- **PR #37:** CODEOWNER/repository maintainer review is required on the final exact source SHA.
- **M12.14:** stable-release approval remains a separate human-controlled gate.
- **Desktop end-to-end acceptance:** local Codex/maintainer must run the real native journey in the owner checkout.
- **Runtime review ledger:** accountable maintainer must confirm due entries and update the dates.
- **Security/Pages/release policies:** only the designated repository/security/release owners may disposition private alerts, publication settings and production release state.

**No production release or deployment is implied by completion of this closeout report.**
