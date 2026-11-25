---
name: visual-swarm
description: Coordinate independent workstreams with capability-based delegation and an optional read-only task-DAG dashboard. Use for multi-agent execution, parallel implementation or research, dependency waves, isolated worktrees, or a visual progress snapshot; includes strict ownership, manifest, and verification rules.
argument-hint: <goal>
---

# Visual Swarm

Decompose a multi-part goal into conflict-free workstreams, delegate when the available tooling supports it, and keep an optional local dashboard as a read-only coordination snapshot. The coordinator owns planning, integration, and verification; worker reports are evidence to inspect, not proof of completion.

## When to use

Use this skill when a goal has at least two meaningfully independent workstreams, such as separate implementation slices, implementation plus focused tests, or research across unrelated areas. For a single straightforward task, work directly: a swarm would add overhead.

## Authority and safety boundaries

- Treat the manifest and dashboard as coordination metadata only. Updating them does not schedule, execute, retry, or observe product work.
- The dashboard is a read-only snapshot/viewer, not an orchestration, queue, job, monitoring, or observability authority.
- In MoonWitness, the API, ORM, jobs runtime, and Board remain authoritative. Do not create a second product/orchestration server, database, queue, or product UI.
- The optional `serve` command is only a temporary local viewer over the manifest. Prefer `render` when a live viewer is unnecessary.
- Never put secrets, credentials, private environment values, or sensitive user content in the manifest or dashboard.
- Do not commit, push, open pull requests, send external messages, or modify shared infrastructure unless the user explicitly requested that action. Do not add model-routing or commit automation to this skill.

## Non-negotiable rules

- Read relevant `AGENTS.md` files before changing code.
- Give every workstream an explicit file manifest and an explicit list of files or directories it must not touch.
- Allow only one writer per file or directory. Shared root files belong to the coordinator or a designated final verifier.
- Keep full-tree builds out of parallel workers. Use targeted checks, then run relevant broader verification once during integration.
- Do not fabricate completion. Inspect actual diffs and run or review targeted checks before marking work `done`.
- Prefer two to five concurrent workstreams, and only when their ownership is genuinely disjoint.
- Keep manifest writes atomic and serialized through the coordinator or another single designated writer.

## Portable setup

Resolve the directory containing this `SKILL.md` through the active tool's skill discovery. Set `SWARM_SKILL_DIR` to that directory in each shell; do not assume a tool-specific installation path.

POSIX shell:

```sh
export SWARM_SKILL_DIR="/absolute/path/to/visual-swarm"
node "$SWARM_SKILL_DIR/scripts/swarm-dashboard.mjs" --help
```

PowerShell:

```powershell
$env:SWARM_SKILL_DIR = "C:\absolute\path\to\visual-swarm"
node "$env:SWARM_SKILL_DIR\scripts\swarm-dashboard.mjs" --help
```

Manifest and output paths resolve from the current working directory unless `--dir` or `--output` is supplied, independently of where the skill is installed.

## Workflow

### 1. Scope and decompose

1. Restate the outcome and identify the smallest useful result.
2. Inspect the repository and relevant instructions with read-only exploration.
3. Define tasks with acceptance criteria, dependencies, and exact file ownership.
4. Use dependency waves when a shared contract must land before parallel work.
5. If ownership cannot be disjoint, narrow the tasks, use independent worktrees when available, or serialize the conflicting work.

### 2. Choose a delegation mode

- **Subagents available:** delegate only independent workstreams in the same dependency wave. Give each worker the brief below and collect its actual changed-file and check results.
- **No subagents:** execute the same DAG serially. Record the roles and transitions, but do not imply concurrent execution.
- **Independent worktrees available:** use them when isolation is useful. Review and integrate their changes before treating them as present in the main tree.

The coordinator remains responsible for ownership enforcement, manifest accuracy, integration, and final verification in every mode.

### 3. Initialize local state

Run from the repository root or chosen coordination directory:

```sh
node "$SWARM_SKILL_DIR/scripts/swarm-dashboard.mjs" init --name "Short swarm name" --goal "User-visible outcome"
```

This creates `.swarm/swarm.json` and an ignored `.swarm/` workspace. Use `--dir <path>` for another location. Do not overwrite existing state unless the user asks or `--force` is intentional.

### 4. Write the initial manifest

Populate `tasks`, `agents`, and `events`. Record planned roles, including coordinator and verifier, and use `ready` only when dependencies are complete.

A task has this shape:

```json
{
  "id": "api-contract",
  "title": "Define the API contract",
  "status": "ready",
  "dependsOn": [],
  "owner": "architect",
  "files": ["packages/example/src/contract.ts"],
  "summary": "Export the request and response types with validation."
}
```

Write the complete JSON document in one operation. Never truncate or partially rewrite the live manifest: write a temporary file in the same directory, flush it, and atomically rename it over the previous document. Keep event IDs unique and append only meaningful transitions. The CLI's `init` and `render` outputs already use atomic writes.

### 5. Validate and view

```sh
node "$SWARM_SKILL_DIR/scripts/swarm-dashboard.mjs" validate
node "$SWARM_SKILL_DIR/scripts/swarm-dashboard.mjs" render
```

Open `.swarm/dashboard.html` for a static snapshot. It has no live updates and creates no product service.

For an explicitly useful live view, the optional server defaults to loopback:

```sh
node "$SWARM_SKILL_DIR/scripts/swarm-dashboard.mjs" serve --port 4177
```

Use available background-process support, report the printed local URL, and choose another port if occupied. The viewer has no authentication. Bind all interfaces only when the user explicitly requests network access, after confirming the manifest has no sensitive data and inbound TCP access is allowed by the host or cloud firewall:

```sh
node "$SWARM_SKILL_DIR/scripts/swarm-dashboard.mjs" serve --host 0.0.0.0 --port 4177
```

Do not expose the viewer publicly by default. Stop it when it is no longer useful, or tell the user it remains available.

### 6. Delegate each ready wave

Each worker brief must include:

- Exact outcome and acceptance criteria.
- Exact owned paths and prohibited paths.
- Relevant dependencies and established interfaces.
- Required targeted tests or checks.
- A prohibition on commits, unrelated refactors, and manifest writes.
- Worktree instructions when isolation is needed.
- Required return format: changed files, checks run, results, risks, and follow-ups.

Before starting work, mark its task and assigned role `running` and append a `started` event. Never launch a task whose dependencies are incomplete. Without delegation support, perform the brief yourself in DAG order.

### 7. Track, integrate, and verify

When a workstream completes:

1. Inspect its actual diff or serial changes and confirm ownership was respected.
2. Run or review its targeted checks; reproduce important claims when needed.
3. Update task and agent status, progress, message, and `updatedAt` atomically.
4. Append a concise `done`, `failed`, or `blocked` event.
5. Unblock dependent tasks and start the next wave.

Record failures explicitly. Retry with smaller scope, reassign, serialize, or stop if the risk changed; never silently mark failed work complete.

After all workstreams finish, the coordinator performs one integration verification pass: review combined changes, run relevant broader checks once, resolve integration issues in coordinator-owned files, and update the final manifest. Render a final snapshot:

```sh
node "$SWARM_SKILL_DIR/scripts/swarm-dashboard.mjs" validate
node "$SWARM_SKILL_DIR/scripts/swarm-dashboard.mjs" render
```

Summarize the outcome, verification evidence, dashboard location, and unresolved risks.

## Manifest contract

| Field                    | Meaning                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `version`                | Always `1`.                                                                                            |
| `name`, `goal`           | Short dashboard title and user-visible outcome.                                                        |
| `startedAt`, `updatedAt` | ISO timestamps.                                                                                        |
| `tasks`                  | DAG nodes with `id`, `title`, `status`, `dependsOn`, required `files`, and optional `owner`/`summary`. |
| `agents`                 | Roles with `id`, `name`, `role`, `status`, `progress`, `taskIds`, and optional `message`.              |
| `events`                 | Audit entries with unique `id`, ISO `at`, `type`, `message`, and optional `agentId`/`taskId`.          |

Task statuses: `pending`, `ready`, `running`, `blocked`, `done`, `failed`.

Agent statuses: `idle`, `running`, `done`, `failed`, `stopped`.

Useful event types: `info`, `started`, `progress`, `done`, `error`, `blocked`, `message`.

The validator bounds input size and text length and rejects malformed JSON, invalid timestamps or statuses, duplicate IDs, missing references, self-dependencies, cycles, invalid progress, and conflicting file ownership. It allows unknown extra fields so the manifest can evolve without breaking older dashboards.

## Resources

- `scripts/swarm-dashboard.mjs` — initialization, validation, static rendering, and an optional loopback SSE viewer.
- `scripts/swarm-dashboard.test.mjs` — deterministic CLI tests using only `node:test`.
- `assets/dashboard.html` — self-contained viewer used by render and serve.
