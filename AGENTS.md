# AGENTS.md — MoonWitness (mw-xv) Agent Orchestration Rules

## Mandatory Swarm / Sub-Agent Orchestration

**ALL non-trivial work MUST use `/swarm` or sub-agent orchestration.** No exceptions.

### Coordinator Protocol
- Coordinator **never does technical work inline** (no code edits, no builds, no tests, no file reads >50 lines).
- Coordinator **only**: plans, delegates via `swarm add`, integrates worker output via `sync`, verifies acceptance criteria.
- Every worker brief **must be self-contained**: objective, owner files (disjoint), acceptance criteria, done definition.
- Workers run on `workspace: "share"` for parallel edits; `workspace: "inherit"` for read-only.

### Disjoint File Ownership (Enforced)
| Partition | Paths | Owner |
|-----------|-------|-------|
| MW-XV CORE | `apps/api/src/commands/*`, `apps/api/src/lifecycle/*`, `packages/orm/src/services.ts` | **NEVER TOUCH** (D12 isolation) |
| PROTECTED GOV | `.githooks/*`, `.github/workflows/promote*.yml`, `.github/workflows/release*.yml`, `.github/workflows/sync-main-to-dev.yml`, `scripts/release-*.mjs`, `scripts/sync-main-to-dev.mjs`, `.github/CODEOWNERS` | Owner approval required |
| MW-XV REPO | `README.md`, `isp/**`, `docs/**`, `.plan/**`, `packages/plan-taskos/**`, `scripts/ci/**` | C-SYNC / C-PLAN |
| MW-TASKOS | Entire `z:\repo\mw-taskos\**` (standalone) | C-SYNC (git init) → C-PLAN (execution) |
| MW-LAB | `z:\repo\mw-lab\**` | C-LAB |
| FLEET REPOS | `fleet/mw-*/**` (pocket, rocksoul-cli, core, stack, ww) | C-CI / C-PLAN (per wave `owner_files`) |

### Worker Lifecycle
1. `swarm add` with complete brief → worker posts `@coordinator [done]` with evidence
2. Coordinator **verifies** (runs acceptance commands, checks proofs) before `swarm kill`
3. No silent waiting — if blocked, post `@coordinator [blocked]` with reason
4. Land work before kill (upload for review, or merge branch); never push without explicit ask

### Continuous Flash Loop (Overnight /goal-Style)
- `plan-taskos reindex` every 15 min via cron
- `plan-taskos next --claim` → next ready micro-task (1-3 files)
- Frontier ≥2 ready + disjoint `owner_files` → `export-swarm --max-parallel 4`
- Workers execute autonomously; coordinator integrates via `sync`
- Loop until DAG empty or blocked

### Protected Surfaces (Never Modify Without @bjo163 Written Approval)
- Local proportional Git hooks: `.githooks/pre-commit`, `.githooks/pre-push`, `.githooks/commit-msg`, `scripts/setup-git-hooks.mjs`
- Autonomous promotion & sync: `.github/workflows/promote.yml`, `.github/workflows/sync-main-to-dev.yml`, `.github/workflows/promotion-policy.yml`, `scripts/sync-main-to-dev.mjs`
- Autonomous release: `.github/workflows/release-orchestrate.yml`, `.github/workflows/release-prepare.yml`, `.github/workflows/release.yml`, `scripts/release-orchestrator.mjs`, `scripts/release-plan.mjs`
- Governance variables: `AUTONOMOUS_PROMOTE`, `AUTONOMOUS_STABLE_RELEASE`, `AUTO_HEAL_RETRY`, `AUTOMATION_APP_CLIENT_ID`
- This file: `.agents/rules/autonomous-git-release-lock.md`, `.github/CODEOWNERS`

### Swarm Board
- Live: `[Open the Swarm UI](sidecar://swarm/swarm_board/?auto_open=false)`
- End every coordinator turn with board link when swarm active
- Add `monitor` worker per `native_swarm` skill: "Load swarm_monitor skill. Post only to break a stall."

---
*Enforced by repository governance. Violations = immediate work stop.*