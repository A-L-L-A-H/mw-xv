# How to operate the autonomous delivery fleet

This runbook covers the steady-state path, the break-glass stop, and recovery. It assumes the bootstrap in [ADR 0015](../../decisions/0015-autonomous-delivery-governance.md) is complete.

## Normal delivery path

1. An agent claims a task and receives a scoped, short-lived credential. The claim binds `task`, `agent`, `run`, `trace`, `fencing token`, `fleet epoch` and normalized path prefixes. No write is allowed before a valid claim.
2. Commits carry `Task-Id`, `Agent-Id`, `Agent-Run-Id`, `Trace-Id` and `Base-Sha` trailers. The staged diff is re-verified against the claim scope.
3. A PR to `dev` triggers two required checks: `ci-gate` (technical aggregate from `ci.yml`) and `policy-gate` (exact head/base/merge SHA, same-repository provenance, TaskOS validity, diff scope, dependency provenance).
4. After the PR merges, promotion dispatches CI for the resulting exact dev SHA, awaits it, and only then enables auto-merge on the dev→main PR. The main ruleset additionally requires a merge queue and strict checks.
5. Release orchestration requires the newest successful exact-main-push `ci-gate` before tagging or publishing. Publication is a separate dispatch on the immutable tag.

If any gate is missing, stale, skipped, cancelled or unsuccessful, delivery stops. There is no agent bypass.

## Inspect governance drift

```bash
node scripts/github-rulesets.mjs inspect --json
node scripts/github-rulesets.mjs plan --json
```

Both commands are read-only and exit 1 on drift. `plan` prints the deterministic create/update/delete operations; an unmanaged ruleset requires an explicit `--prune` during apply. To check an offline API snapshot, pass `--snapshot <file>`.

Only a human break-glass operator may apply:

```bash
GOVERNANCE_BREAK_GLASS=1 GOVERNANCE_ACTOR=<owner> \
  node scripts/github-rulesets.mjs apply \
    --snapshot-before before.json --snapshot-after after.json
```

`apply` refuses to run under `CI=true`, `GITHUB_ACTIONS=true`, or when `AGENT_RUN_ID` is set, and it fails if drift remains after the write.

## Stop the fleet (break-glass)

Dispatch `.github/workflows/fleet-stop.yml` on `main` with:

- `action=pause`
- `reason` — an incident identifier of at least 8 characters
- `confirm=STOP`
- optionally `expect_epoch` — the epoch that must still be current
- optionally `dry_run=true` — compute the transition without writing

The actor must be in `GOVERNANCE_BREAK_GLASS_ACTORS`, and `FLEET_BREAK_GLASS_TOKEN` (a dedicated App token with write access to the governance ref) must be configured. The job:

1. validates the actor, reason and confirmation;
2. reads `refs/heads/governance/fleet-state` and computes the next state;
3. writes the state through a compare-and-swap git-ref update;
4. re-reads and verifies the transition;
5. cancels in-flight workflow runs.

Within one minute of the write, all mutation paths (claim, heartbeat, token mint, commit/push, promotion, publication) observe `paused=true` or a stale epoch and reject the operation.

## Check whether the fleet is paused

```bash
node scripts/fleet-stop.mjs probe --repo <owner/repo>
```

The command exits 0 only when the durable state is valid and not paused. To bind a specific claim epoch, use `check --repo <owner/repo> --epoch <n>`; a mismatched epoch always fails.

## Recover

Dispatch `fleet-stop.yml` again with `action=resume` and a new incident reason. Recovery **always advances the epoch**, so leases, fencing tokens and credentials issued under the previous epoch stay invalid. Re-run the hosted checks in `docs/roadmap/AUTONOMOUS-DELIVERY-FOUNDATION.md` before re-enabling normal promotion and release automation.

## Audit trail

Checkpoint files are verified with:

```bash
node scripts/audit-chain.mjs verify <checkpoint.json>
```

The command checks hash continuity, sequence integrity, duplicate events and per-record hashes, and reports which correlation stages (`task`, `agent`, `run`, `commit`, `pr`, `ci`, `artifact`, `tag`, `release`) are missing. A partial trail is never reported as complete. Secret-like keys and values are redacted before they are hashed, so the checkpoint can be committed to a protected ref safely.

## Escalation

Contact the coordinator if: the ruleset API diverges from `.github/governance/rulesets.json`, an agent holds a valid claim after a pause, an audit checkpoint fork is detected, or a release identity mismatch appears. Do not force-push, reset, retag, or delete the governance ref.
