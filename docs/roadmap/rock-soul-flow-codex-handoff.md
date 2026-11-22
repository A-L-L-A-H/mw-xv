# ROCKSOUL FLOW — Local Codex Handoff

**Repository:** `A-L-L-A-H/mw-xv`  
**Branch contract:** use the existing `dev` branch only; `main` remains protected. Do not create a third branch.  
**Task:** `M13.01` — ROCKSOUL FLOW capability audit and first vertical-slice selection.  
**Mode:** read-only source audit followed by documentation/evidence output. This task does not authorize feature implementation.

## Mission

Compare the eight ROCKSOUL FLOW capabilities with the real implementation in this repository. Reuse existing MoonWitness owners wherever possible. Produce a source-backed reuse map and choose exactly one smallest genuinely missing vertical slice for a later task.

## Start safely

1. Run `git status --short --branch`. Do not reset, clean, overwrite, stash automatically, or discard uncommitted user work. If the checkout is dirty or diverged, preserve it and report the condition before changing anything.
2. Read every applicable `AGENTS.md` from the repository root down to the directories you inspect.
3. Fetch the latest `origin/dev` and record its exact SHA. Only fast-forward a clean local `dev` checkout when it is a straightforward fast-forward. Do not force-push, rewrite history, merge `main` into `dev`, or create another branch.
4. Read:
   - `docs/roadmap/EXECUTION.md`
   - `docs/roadmap/ACTIVE-PLAN.md`
   - `docs/roadmap/14-desktop-engineering.md`
   - `docs/architecture/adr/0008-local-first-desktop-agent-harness.md`
   - `docs/architecture/desktop-local-first-harness.md`
   - `docs/decisions/0007-ai-corporation-addon-first-architecture.md`
   - `todo-desktop.md`
   - `docs/migration/SOURCE-MIGRATION-MATRIX.md`
   - relevant AI runtime, PCW, ORM-AI and Desktop package READMEs/source/test files.

## Legacy source handling

The source candidate is `https://github.com/bjo163/rocksouldx` on its documented `dev` branch. Inspect it read-only. Resolve and record the real repository HEAD commit SHA and inspect its license/notices before relying on any implementation. The value `3157a62...` in the migration matrix is a README **blob** SHA, not the source commit.

Treat the legacy repository as an idea/specification reference only for this task. Do not bulk-copy code, assets, prompts, fixtures or data. Do not add a submodule, package dependency, remote runtime fetch, CI fetch, or hidden dependency on `bjo163`. Do not port the old MoonQL/D00–D13 architecture. Any future code reuse requires a separate rights/provenance review and an explicit implementation card.

## Audit these eight capability areas

1. Repo Radar
2. Overlap Detector
3. Plan Forge
4. Prompt Forge
5. Task Deck
6. Proof Gate
7. Memory Ledger
8. Visual DNA Lab

For each area, inspect actual target files, exported APIs, callers, tests and any current Board/Desktop surface. Record one of these states: `implemented`, `partial`, `missing`, or `blocked`. Include exact file paths and test names; explain what the evidence proves and what it does not prove.

Map each capability to its canonical owner. Inspect, rather than assume, the likely owners: `apps/desktop`, `packages/ai-runtime`, `packages/ai-evaluation`, `packages/orm-ai`, `packages/orm-project`, `packages/orm-workflow`, `packages/jobs`, `packages/assets`, `packages/ui`, the existing Board and Desktop bridges, PCW verifier, capability gateway and risk gate.

## Hard boundaries

- No second ORM, identity system, project/task authority, AI runtime, agent runner, memory database or UI framework.
- Preserve Board as Control Plane and Desktop as Local-First Execution Plane.
- Respect tenant/company scope, capability grants, data classification, R0–R4 risk policy, bounded execution, human approval and PCW evidence.
- Do not turn `@moonwitness/local-ai` into a shell/tool agent. It is the separate, tool-free suggestion boundary.
- Do not download, install, register or benchmark a local model. Model registry and model selection are outside this task.
- Do not expose secrets, environment values, private user data or unrelated local files.
- No app deployment, release, protected-branch bypass or promotion to `main`.

## Required deliverables

Create:

1. `docs/architecture/rock-soul-flow-reuse-map.md`
   - Exact target `dev` SHA and legacy source commit SHA.
   - Eight-row capability matrix with target owners, code paths, test evidence, status, gaps and risk boundaries.
   - Explicit duplicate-authority and license/provenance findings.
   - Exactly one recommended next vertical slice, its bounded file scope, dependencies, acceptance criteria and focused tests.
2. `docs/roadmap/evidence/M13.01.md`
   - Task ID, source SHAs, changed files, commands and actual exit codes.
   - Distinguish passed, failed, skipped and not-run checks.
   - Record source-review limitations and the reason the next slice was selected.

Do not change `M13.01` to complete unless both deliverables exist and every acceptance criterion in `docs/roadmap/14-desktop-engineering.md` is verified. Do not pre-create implementation code or mark future feature work complete.

## Verification

First inspect the actual scripts in root `package.json`, then run the relevant available checks. Expected narrow checks include:

- roadmap task/index validation;
- `pnpm automation:check:roadmap`;
- `node scripts/check-docs.mjs`;
- Prettier check on all changed files;
- `git diff --check`.

If any command is unavailable, fails, or is skipped, report it accurately. A docs-only audit does not require a full application build or unrelated PostgreSQL/browser suite.

## Delivery

When the audit is complete and the checkout is safe:

- Review the complete diff for accidental code/data imports, duplicate ownership, secrets and unrelated files.
- Commit the bounded documentation/evidence batch with task ID `M13.01`.
- Push normally to `dev` only after verification; never force-push.
- Confirm the remote `dev` SHA and report the exact commit, checks and remaining blockers.

**Stop condition:** If the audit finds that a candidate feature already exists, do not rebuild it. Document the evidence and move to the next genuine gap. If rights, source identity or architecture ownership is unclear, mark it blocked and ask for maintainer review instead of importing.
