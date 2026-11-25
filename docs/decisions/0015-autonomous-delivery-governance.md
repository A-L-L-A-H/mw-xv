# ADR 0015 — Autonomous Delivery Governance Plane

- Status: Accepted (bootstrap pending human break-glass apply)
- Date: 2026-11-24
- Scope: CI/policy gates, GitHub rulesets, release orchestration, multi-agent claims, audit chain, fleet kill switch

## Context

The repository already has release verification, proof gates, TaskOS, ORM-backed jobs and artifact attestation, but they do not form one autonomous delivery system. Before this ADR: `dev` did not require PR/CI, three different gate names were checked by three scripts, rulesets existed only as untracked API state, bots dispatched downstream workflows without awaiting exact-SHA CI, agents had no durable claim bound to task/agent/run/trace/fencing/path scope, and there was no fleet-wide stop.

## Decision

1. **One gate, one truth.** `ci-gate` is the only aggregate technical check. `scripts/ci-gate.mjs` owns the canonical job list and name; `main-ci-policy.mjs`, `review-ci-evidence.mjs` and `collect-lifecycle-snapshot.mjs` import the same constant. Missing, renamed, skipped, cancelled and non-success results fail closed. Configuration may add known optional lanes but never remove a required one.
2. **Policy gate is a separate required check.** `.github/workflows/promotion-policy.yml` runs on `pull_request` and `merge_group`, emits a job literally named `policy-gate`, and verifies exact head/base/merge SHAs, same-repository provenance, TaskOS validity, diff scope and dependency provenance.
3. **Governance is code and is immutable from inside the fleet.** `.github/governance/rulesets.json` is the desired state; `scripts/github-rulesets.mjs` supports `inspect`/`plan`/`apply`. `apply` refuses to run when `CI`, `GITHUB_ACTIONS` or `AGENT_RUN_ID` is present and requires `GOVERNANCE_BREAK_GLASS=1` plus an allowlisted `GOVERNANCE_ACTOR`. Every apply snapshots the live API before and after and fails on residual drift. Rulesets require `ci-gate` + `policy-gate`, strict checks, merge queue, PR-only promotion, and immutable `v*` tags with no routine bypass actors.
4. **All writes go through exact-SHA orchestration.** Release preparation, sync, evolution and dependency bots dispatch CI, await the exact resulting SHA via `scripts/release-await-ci.mjs`, and only then dispatch promotion with an `expected_sha` binding. Promotion itself re-verifies the exact-SHA aggregate before enabling auto-merge and refuses stale/superseded evidence.
5. **Claims are durable, scoped and fenced.** `scripts/execution-claim-gate.mjs` binds `taskId`, `agentId`, `agentRunId`, `jobRunId`, `traceId`, `baseSha`, path prefixes, lease expiry, fencing token and fleet epoch. Overlapping scopes are serialized by a deterministic lowest-claim-id rule. Credentials are minted only after a valid claim, with a maximum 900-second TTL and an explicit scope allowlist. Commit trailers and PR diffs are re-verified against the claim before merge.
6. **The audit chain is append-only and hash-linked.** `scripts/audit-chain.mjs` canonicalizes events, redacts secret-like fields before hashing, links each record to the previous head, rejects forks during merge, and reports missing correlation stages (`task → agent → run → commit → PR → CI → artifact → tag → release`) rather than inventing them.
7. **One durable kill switch.** `FleetState` lives on the protected `refs/heads/governance/fleet-state` ref (excluded from the two-branch ruleset). `scripts/fleet-state.mjs` advances the epoch on _every_ transition, including resume, so old leases and tokens cannot revive. `.github/workflows/fleet-stop.yml` writes state only with a dedicated `FLEET_BREAK_GLASS_TOKEN`, compare-and-swaps the ref, verifies convergence, and cancels active runs when pausing. Promotion, release orchestration and publication call `probe` and fail closed while paused.

## Consequences

- Steady-state R0/R1 changes can merge without human approval because the rulesets require zero human reviewers; the approval comes from deterministic gates.
- Governance changes, credential changes and release signing remain human break-glass operations outside the fleet.
- Bootstrap requires: a human ruleset apply, the `release` and break-glass environments/App token, `GOVERNANCE_BREAK_GLASS` set only for the bootstrap PR, and the ORM-side claim persistence described in `docs/roadmap/AUTONOMOUS-DELIVERY-FOUNDATION.md`.
- A missing or stale gate stops delivery; there is deliberately no bypass for agents.

## Alternatives considered

- Reusing `ci-technical-gate` as the canonical name: rejected because the live `main` ruleset requires the exact context `ci-gate`, and a second name splits authority.
- Storing fleet state in a repository file on `dev`: rejected because an agent could rewrite it in an ordinary PR. A dedicated ref with CAS and a dedicated App token keeps it outside fleet mutation paths.
- Letting bots merge on push events alone: rejected because dispatch chains lose events; downstream runs are now awaited by exact SHA.
