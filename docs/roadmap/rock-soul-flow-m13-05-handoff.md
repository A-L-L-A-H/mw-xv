# Codex Handoff — M13.05 WorkContract Dependency Readiness Gate

**Repository:** `A-L-L-A-H/mw-xv`  
**Task:** `M13.05`  
**Branch:** existing `dev` only  
**Starting `dev` SHA at consolidation:** `7871a592db5488eafbaeeb0bfbbdc079a4231cfe` (the handoff is consumed from a later pushed docs commit on the same branch)  
**Mode:** one bounded API invariant + focused tests. This is not a Task Deck redesign.

## Why this task exists

The target currently has a canonical Project dependency graph. `GET /projects/:id/board` returns `dag.blocked_task_ids` and `dag.ready_task_ids`. The route fixture in `apps/api/tests/project.routes.test.ts` verifies that `task2` is blocked by an unresolved `blocks` edge. However, `POST /projects/tasks/:id/work-contract` in `apps/api/src/routes/project.routes.ts` loads the task by company and then creates a new `WorkContract` without checking DAG readiness. The same test later creates a WorkContract for that blocked `task2`.

This is a concrete mismatch between the read model and the server-side creation boundary.

## Read these exact owners first

- `docs/roadmap/14-desktop-engineering.md` — M13.05 card and acceptance.
- `docs/architecture/rock-soul-flow-reuse-map.md` — M13 capability findings.
- `docs/decisions/0007-ai-corporation-addon-first-architecture.md` — canonical owners and WorkContract authority.
- `docs/architecture/adr/0008-local-first-desktop-agent-harness.md` — Board / Desktop boundary.
- `packages/orm-project/src/sync.ts` — `buildProjectDependencyGraph` semantics.
- `packages/orm-project/src/models.ts` — dependency model and validation.
- `apps/api/src/routes/project.routes.ts` — existing WorkContract route.
- `apps/api/tests/project.routes.test.ts` — current DAG and WorkContract test.
- Current migration policy and [K0-006 evidence](evidence/K0-006.md): no legacy code/data/asset imports.

## Required behavior

1. Re-check the selected Project task and all graph inputs in the authenticated `companyId` scope.
2. Reuse `buildProjectDependencyGraph`; do not create a second readiness algorithm.
3. Before a **new** WorkContract is inserted, require the selected task to be ready in the canonical graph.
4. A task is blocked by an active `blocks` edge only while its blocker is neither `done` nor `cancelled`. Ignore inactive edges and `relates_to` edges. Respect explicit `blocked`, `done`, and `cancelled` task states as not ready for a new WorkContract.
5. Return a stable conflict/validation result and a safe reason. Any blocker IDs/details in the response must be selected only from the same company/project scope.
6. Preserve existing linked WorkContract idempotency. Returning an already-linked WorkContract is not the same as creating a new run; do not silently cancel or mutate an existing contract when dependencies change.
7. Identify the actual run-start boundary. Do not claim this creation endpoint protects a later execution endpoint that does not call the same guard.
8. Inspect existing transaction/locking patterns. Revalidate dependency state inside the safe creation boundary where supported. If dependency writers do not share a lock and a full race-proof invariant cannot be achieved in this slice, document the residual risk precisely and propose a separate bounded follow-up instead of claiming race safety.

## Bounded scope

Expected files:

- `apps/api/src/routes/project.routes.ts`
- `apps/api/tests/project.routes.test.ts`
- `docs/roadmap/evidence/M13.05.md`

A minimal helper in `packages/orm-project/src/sync.ts` is allowed only if a pure reusable helper is materially better than in-route orchestration. Do not add a model, route, addon or package. If ADR 0006 requires moving a domain route into an addon's `manifest.httpPlugins`, stop and describe the architecture decision needed; do not silently expand the scope into a route migration.

## Test cases

- Open active `blocks` edge: new WorkContract creation is denied.
- Ready task: new WorkContract creation succeeds.
- Repeated request for a ready task with an existing WorkContract: the same contract is returned, not duplicated.
- `relates_to` dependency: does not block.
- Inactive `blocks` dependency: does not block.
- Blocker task in `done` or `cancelled`: does not block.
- Explicit task `blocked`, `done`, or `cancelled`: new WorkContract creation is denied.
- Another company’s tasks/dependencies are neither considered nor exposed.
- Update the existing test fixture that currently creates a WorkContract for blocked `task2`; introduce a separate ready task for the successful WorkContract lifecycle assertions.

## Verification

Run the exact available package commands, checking `apps/api/package.json` first:

```sh
pnpm --filter @moonwitness/api exec vitest run tests/project.routes.test.ts
pnpm --filter @moonwitness/api build
```

Also run:

- Prettier on modified files.
- `git diff --check`.
- Isolated PostgreSQL/concurrency checks if transaction or locking semantics changed.

Report all checks as passed, failed, skipped or not run, with actual exit codes. Do not claim a pass from source inspection alone.

## Delivery rules

- Preserve user work; do not reset, clean or overwrite unrelated changes.
- Stay on `dev`; do not create a third branch.
- The observed `main` and `dev` refs are currently diverged. Do not merge, rebase or force-push either branch as part of M13.05.
- No local model install/download, no secret reads, no cloud fallback for `local_only` / `restricted`, no auto-push from the app, no self-approval and no application deployment.
- Commit with message containing `M13.05`, push normally to `dev`, verify remote SHA.
- Only then update roadmap/evidence status. Never mark complete before acceptance has been proven.

**Stop condition:** if the current source no longer has the stated gap, document exact source paths/tests and stop rather than rebuilding an existing feature.
