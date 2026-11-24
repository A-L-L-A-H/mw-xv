# Autonomous delivery foundation — verification and handoff

This document records the delivered foundation for Qoder plan `clever-bay-wagtail` tasks 12–18, the checks that prove each property locally, and the exact cross-workstream work still required for durable claims.

## Delivered surface

| Area | Files | Local proof |
| --- | --- | --- |
| Deterministic CI gate | `scripts/ci-gate.mjs` + test | `node --test scripts/ci-gate.test.mjs` |
| Main push policy | `scripts/main-ci-policy.mjs` + test | `node --test scripts/main-ci-policy.test.mjs` |
| Review evidence | `scripts/review-ci-evidence.mjs` + test | `node --test scripts/review-ci-evidence.test.mjs` |
| Lifecycle snapshot | `scripts/roadmap/collect-lifecycle-snapshot.mjs` + test | `node --test scripts/roadmap/collect-lifecycle-snapshot.test.mjs` |
| Governance rulesets | `.github/governance/rulesets.json`, `scripts/github-rulesets.mjs` + test | `node --test scripts/github-rulesets.test.mjs`; `node scripts/github-rulesets.mjs inspect --snapshot <api-snapshot.json>` |
| Promotion policy | `.github/workflows/promotion-policy.yml`, `scripts/promotion-policy-gate.mjs` + test | `node --test scripts/promotion-policy-gate.test.mjs` |
| Exact-SHA await | `scripts/release-await-ci.mjs` + test | `node --test scripts/release-await-ci.test.mjs` |
| Release/bot orchestration | `release*.yml`, `promote.yml`, `sync-main-to-dev.yml`, `self-evolving.yml`, `dependency-candidate.yml`, `desktop-release.yml` | `node --test scripts/release-*.test.mjs scripts/promotion-*.test.mjs scripts/check-workflow-checkout-trust.test.mjs` |
| Execution claim invariants | `scripts/execution-claim-gate.mjs` + test | `node --test scripts/execution-claim-gate.test.mjs` |
| Audit chain | `scripts/audit-chain.mjs` + test | `node --test scripts/audit-chain.test.mjs`; `node scripts/audit-chain.mjs verify <checkpoint.json>` |
| Fleet state / kill switch | `scripts/fleet-state.mjs`, `scripts/fleet-stop.mjs` + tests, `.github/workflows/fleet-stop.yml` | `node --test scripts/fleet-state.test.mjs scripts/fleet-stop.test.mjs` |

## Acceptance checks (local, no hosted writes)

```bash
node --test scripts/ci-gate.test.mjs scripts/main-ci-policy.test.mjs \
  scripts/review-ci-evidence.test.mjs scripts/github-rulesets.test.mjs \
  scripts/release-await-ci.test.mjs scripts/promotion-policy-gate.test.mjs \
  scripts/execution-claim-gate.test.mjs scripts/audit-chain.test.mjs \
  scripts/fleet-state.test.mjs scripts/fleet-stop.test.mjs \
  scripts/roadmap/collect-lifecycle-snapshot.test.mjs
node scripts/preflight-fast.mjs --json
git diff --check -- <owned paths>
```

Hosted acceptance still required (cannot be proven locally):

- `ci.yml` exposes a job named exactly `ci-gate` and listens on `merge_group`.
- `promotion-policy.yml` produces `policy-gate` on both PR and merge group SHAs.
- Ruleset API matches `.github/governance/rulesets.json` after a human apply; a scheduled drift check fails on divergence.
- `fleet-stop.yml` pause actually cancels active runs and the epoch bump invalidates an outstanding token.

## Rollout (plan phases 7.1–7.6)

1. Bootstrap: human applies rulesets, creates `release` and break-glass App credentials, sets `GOVERNANCE_BREAK_GLASS` only for the bootstrap PR.
2. Canary: one agent, documentation/test-only scope, claim required on every commit.
3. Two agents with disjoint normalized path prefixes; `resolvePathLock` must grant only one.
4. Add provider/model diversity and independent proof review; audit correlation must be complete.
5. Enable normal promotion/release automation after exact-SHA gates are green on hosted CI.
6. Allow general R1 workloads only inside proven capability scopes.

## Rollback

Never force-push, reset, or move a tag. To stop the fleet, dispatch `fleet-stop.yml` with `action=pause`, `confirm=STOP` and an incident reason; the workflow compares and swaps the protected ref, cancels active runs, and advances the epoch. Recovery is a separate `resume` dispatch that advances the epoch again. If governance drift or a release identity mismatch is observed, leave the fleet paused and revert to manual dispatch with the old epoch invalidated.

## Handoff: persistent claim storage (task #16)

The deterministic decision layer is implemented in `scripts/execution-claim-gate.mjs`, but durable persistence, transactional path locks and scoped credential issuance require ORM/runtime changes in workstreams currently owned by other agents. **Do not edit those files from this workstream.** The following concrete changes are needed after those agents finish:

| File | Change needed |
| --- | --- |
| `packages/orm-ai/src/models/execution-claims.ts` (new) | Define `ExecutionClaim` with `task_code`, `contract_id`, `agent_id`, `agent_run_id`, `job_run_id`, `trace_id`, `provider_profile`, `worktree`, `path_prefixes` (JSON text), `fencing_token`, `fleet_epoch`, `lease_until`, `status` (`active`/`expired`/`released`/`revoked`), unique `(task_code, status)` partial constraint, and an addon manifest registering the model. Mirror the field conventions in `packages/jobs/src/models.ts`. |
| `packages/orm-ai/src/models/work.ts` | Relate `WorkContract`/`WorkforceAssignment` to `ExecutionClaim` so a claim can resolve its contract and capability grant in one query. |
| `packages/orm-ai/src/models/runs.ts` | Add `fleet_epoch` and `fencing_token` to `AgentRun` so heartbeats can reject stale runs and bump the token atomically. |
| `packages/orm-ai/src/ai-corporation-http.ts` | Before minting any App installation token, load the live `FleetState` and call `isMutationAllowed`, then call `authorizeCredentialMint` from `scripts/execution-claim-gate.mjs`; cap TTL at 900 seconds and restrict scopes to the allowlist. |
| `packages/jobs/src/runtime.ts` | Wrap `claimNext` in a transaction with the workspace advisory lock; insert the `ExecutionClaim`, check `resolvePathLock` against other active claims, and reject overlapping scopes. Bump `fencing_token` on lease renewal and on expiry; a stale token must fail at commit/push/publish. |
| `packages/jobs/src/index.ts` | Export the new claim/lease module once the other workstream's drain/health exports are settled. |
| `apps/desktop/src/worktree-sandbox.ts` | Bind the sandbox worktree path to `claim.worktree`; refuse commands whose cwd escapes the normalized `path_prefixes`. |
| `apps/desktop/src/risk-gate.ts` | Call `verifyClaimedDiff` on the staged diff before allowing commit/push, and require `verifyCommitTrailers` on every claim-bound commit. |
| `.githooks/commit-msg` | Require the five trailers (`Task-Id`, `Agent-Id`, `Agent-Run-Id`, `Trace-Id`, `Base-Sha`) for claim-bound commits; keep non-agent commits unaffected. |
| `apps/agent-observability/` | Consume `audit-chain.mjs` checkpoints as a redacted read projection; never store secrets or become the system of record. |

The decision functions already exported for that integration are `normalizePathScope`, `resolvePathLock`, `verifyExecutionClaim`, `authorizeCredentialMint`, `verifyCommitTrailers`, `verifyClaimedDiff`, `compareFencing`, `isMutationAllowed`, `verifyChain`, `mergeCheckpoints` and `projectCorrelation`.
