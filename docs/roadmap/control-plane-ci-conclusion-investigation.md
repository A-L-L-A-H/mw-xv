# CF-024 — conflicting CI conclusions for the same dev SHA

**Status:** read-only investigation record for [issue #79 (CF-024)](https://github.com/A-L-L-A-H/mw-xv/issues/79).
**Inspected branch / exact SHA:** `dev` @ `4a8a249e1b37d93917942fd18a98695952e455e7` (`git rev-parse HEAD`).
**Audit date:** 2026-11-24 (UTC; Actions/REST evidence collected through `2026-11-24T06:03Z`).
**Related:** [CF-001 gap map](../architecture/cloud-control-plane-gap-map.md), [CF-023 reconciliation](control-plane-checkpoint-reconciliation.md).

> No workflow, source, configuration, or deployment was changed. Run re-execution or `workflow_dispatch` was not attempted; all evidence below is from `gh run list`, `gh api` read-only queries, job-step records and logs.

## 1. Evidence reported in the issue

[Issue #79](https://github.com/A-L-L-A-H/mw-xv/issues/79) recorded two conclusions for dev SHA `28c8242c139c51f7ee1aaa080dd7d65900e5ed59` (the head promoted by PR [#48](https://github.com/A-L-L-A-H/mw-xv/pull/48)):

- [run 45113638954](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45113638954) — reported `success`.
- [run 45113829472](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45113829472) — reported `failure`.

## 2. What is observable now for `28c8242`

| Query                                                          | Result at 06:03Z                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gh api /actions/runs/45113638954`                             | `CI`, event `push`, branch `dev`, `status: completed`, `conclusion: success`, created `2026-11-23T04:44:30Z`, updated `04:52:22Z`, attempt 1                                                                                     |
| Jobs of 45113638954                                            | five jobs, all `success`: `dx-test`, `postgres-integration`, `unit-tests`, `quality-and-build`, `knowledge-gate` (`quality-and-build` has one skipped conditional step, `Emit generated docs for exact one-time reconciliation`) |
| `gh api /actions/runs/45113829472` and `/jobs?per_page=100`    | **HTTP 404 Not Found** for both the run and its jobs                                                                                                                                                                             |
| `gh api /actions/runs?head_sha=28c8242…&per_page=100`          | exactly four runs, all `success`: `CI` 45113638954, `Promote dev to main` 45113638947, `Roadmap progress report` 45113638955, `Documentation Pages` 45113638957 (attempt 1, created 04:44:30Z)                                   |
| `gh api /actions/runs?created=2026-11-23T04:40:00Z..05:00:00Z` | same four `28c8242` runs plus `Refresh promotion report` 45114384323 on `c1d7868b…` (main); no failed run in the window                                                                                                          |
| `gh api /commits/28c8242…/check-runs`                          | all entries completed: the five CI jobs `success`, Docs `Build and verify documentation` `success` with five downstream `skipped` jobs, `promote` `success`, `report` `success`                                                  |
| `gh api /commits/28c8242…/check-suites`                        | four suites, all `completed` / `success`                                                                                                                                                                                         |

**Finding:** the conflicting failure is **not reproducible from retained evidence**. Run `45113829472` has no retrievable run or job record, so no failing job or step can be named for that SHA. Plausible explanations are a deleted/expired run record, a mistyped run ID, or a superseded pull-request/duplicate run that was removed; none can be confirmed. This is explicitly **not** evidence of a real regression at `28c8242`, and it is also not a basis for declaring that SHA green on the strength of a single successful run.

## 3. Reproducible same-SHA conflict at `04fc12f`

The [CF-023 checkpoint](ACTIVE-PLAN.md) describes the same pattern on an earlier dev SHA:

| Run                                                                        | Event                   | Conclusion | Job evidence                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ----------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [45296415128](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45296415128) | `push` on `dev`         | `success`  | nine jobs `success` (`secret-scan`, static-analysis Go and JS/TS, `dependency-audit`, `knowledge-gate`, `quality-and-build`, `unit-tests`, `dx-test`, `postgres-integration`) |
| [45296465315](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45296465315) | `pull_request` on `dev` | `failure`  | `total_count: 0` jobs returned by the Jobs API; created `2026-11-24T00:21:15Z`, updated `00:28:15Z`                                                                           |

The PR run's failure conclusion exists but its job/step evidence does not; it cannot be attributed to a regression or to an expected duplicate trigger with certainty. A duplicate `pull_request` execution of `ci.yml` on the same head SHA is the most likely mechanism, because both `push` and `pull_request` trigger the same workflow (see §5).

## 4. Current pinned SHA — a real, explainable failure (not an aggregation artifact)

For `4a8a249e1b37d93917942fd18a98695952e455e7` both duplicate CI runs agree on `failure`:

| Run                                                                        | Event                                                 | Conclusion | Jobs                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | ----------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [45312069426](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45312069426) | `push`, `dev`, created `2026-11-24T02:23:56Z`         | `failure`  | `secret-scan`, static-analysis (go), static-analysis (javascript-typescript): `success`; `dependency-audit`, `quality-and-build`, `unit-tests`, `knowledge-gate`, `dx-test`, `postgres-integration`: `failure` |
| [45312081273](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45312081273) | `pull_request`, `dev`, created `2026-11-24T02:24:02Z` | `failure`  | same nine conclusions; the six failing jobs all fail in step `Install frozen workspace dependencies`                                                                                                           |

**Job/step root cause** (from the log of job `138169973506`, `dependency-audit`, at `2026-11-24T02:24:30Z`):

```text
pnpm install --frozen-lockfile --no-runtime
[ERR_PNPM_OUTDATED_LOCKFILE] Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with <ROOT>/packages/orm-storage/package.json
  specifiers in the lockfile don't match specifiers in package.json:
  * 1 dependencies were added: @moonwitness/orm-base@workspace:*
```

The six failing jobs in both runs stop at the same install step; `secret-scan` and both CodeQL/static-analysis lanes pass because they do not depend on that install step. The `@moonwitness/orm-base@workspace:*` dependency is present in [packages/orm-storage/package.json](../../packages/orm-storage/package.json) on the pinned tree. This is a genuine source/lockfile drift at `4a8a249`, **not** a duplicate-trigger artifact, and the SHA must be called **red** until the exact-SHA required checks pass.

## 5. Why duplicate runs can disagree

[.github/workflows/ci.yml:3](../../.github/workflows/ci.yml#L3) triggers the same `CI` workflow on `push` to `dev`/`main`, `pull_request` to `dev`/`main`, `merge_group`, and `workflow_dispatch`. Its concurrency group is:

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

A push run uses `refs/heads/dev` and a pull-request run uses `refs/pull/<n>/merge`, so they are **different concurrency groups**: both can run for the same head SHA and both publish identically named check runs (`delta-test`, `quality-and-build`, …) in different check suites. A required-check policy that keys only on check _name_ can therefore see one suite green and another red for the same commit. GitHub's commit check list for `28c8242` showed four successful suites (CI push, Docs, Promote, Roadmap) with no surviving failed suite, which explains why the historical issue report and the current API view disagree.

## 6. Recommended deterministic gate fix (proposal only — no workflow edits made)

1. **One canonical required check per SHA.** Add a small aggregator check (e.g. `required-sha-gate`) as the only required status check. It must call `GET /repos/{owner}/{repo}/commits/{head_sha}/check-runs`, group by required check name, and return green **only** when every required check for the exact SHA is `success` (or an explicitly allowed `skipped`), with no missing/expired run record. A `404` or zero-job failure is `unverified` → fail closed, never green.
2. **Never let duplicates mask a failure.** The aggregator must be `AND`-policy across all required checks for the SHA: one failed required check keeps the gate red even if another run with the same check name succeeded. Informational/PR-only runs should use distinct check names or be excluded from the required set by explicit allowlist.
3. **Collapse duplicate triggers.** In `ci.yml`, key the concurrency group on the head SHA (for example `ci-${{ github.workflow }}-${{ github.event.pull_request.head.sha || github.sha }}`) with `cancel-in-progress: true`, or make `push`/`pull_request` mutually exclusive, so a single canonical `CI` run exists per workflow per SHA. Keep the workflow path and trigger list otherwise unchanged; this is a maintainer-owned edit, not part of this audit.
4. **Evidence retention.** Require that required checks expose their job records; if a run record can disappear, the gate must use a durable per-job status artifact rather than a possibly deleted Actions run. Do not infer green from a successful sibling run.
5. **Regression coverage / reproducible validation procedure.** Add table-driven tests for the gate with four cases: (a) all required checks success → green, (b) one required failure plus duplicate success for the same check name → red, (c) missing/404 run → red, (d) two same-SHA trigger events → one canonical run after concurrency collapse. After the maintainer applies the change, validate once on a controlled test commit with `workflow_dispatch`, assert one `CI` run for that SHA, assert the gate is red when any required check is red, and assert it turns green only when all required checks pass. No deployment action is part of this procedure.

## 7. Acceptance-criteria disposition (CF-024)

| Criterion                                                            | Disposition                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root cause documented with job/step evidence                         | Met for the current SHA (`ERR_PNPM_OUTDATED_LOCKFILE`, six jobs, shared install step). The issue's cited failed run `45113829472` returns 404, so its root cause cannot be documented; the ambiguity itself and its likely mechanism are documented in §2/§5. |
| Required-check aggregation has one unambiguous policy                | Proposed in §6.1–6.2; **not applied** because acceptance requires a workflow/branch-protection edit.                                                                                                                                                          |
| Duplicate triggers do not mask a required failed check               | Proposed AND-policy and SHA-keyed concurrency in §6.2–6.3; **not applied**.                                                                                                                                                                                   |
| Workflow change has regression coverage or reproducible validation   | Procedure and test cases given in §6.5; no workflow change made by this audit.                                                                                                                                                                                |
| Status called green only when all required checks for exact SHA pass | Stated as policy; current `4a8a249` is **red**, and the historical `28c8242` is not re-certified green by this document.                                                                                                                                      |
| Verification: re-run on controlled test commit                       | Not possible without workflow/branch-protection changes and dispatch rights; listed as maintainer validation in §6.5.                                                                                                                                         |
