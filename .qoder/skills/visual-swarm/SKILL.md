---
name: visual-swarm
description: Coordinate a small team of parallel Qoder agents on independent, conflict-free workstreams and visualize the task DAG, agent progress, and activity in a live local mission-control dashboard. Use when the user asks for a swarm, multi-agent execution, an agent graph, Antigravity-style orchestration, or a cool visual overview of parallel work.
argument-hint: <goal>
---

# Visual Swarm

Turn a multi-part goal into a dependency-aware agent swarm with a live visual dashboard. Use the existing Qoder `Agent` tool for execution; the dashboard is a visualization and audit trail, not a replacement for verifying work on disk.

## When to use

Use this skill when the goal has at least two meaningfully independent workstreams, such as parallel implementation slices, a feature plus tests, or research across separate areas. If the work is a single straightforward task, do it directly and explain that a swarm would add overhead.

## Non-negotiable rules

- Read relevant `AGENTS.md` files before changing code.
- Never put secrets, credentials, private environment values, or sensitive user content in the manifest.
- Give every agent an explicit file manifest and a list of files or directories it must not touch.
- Do not run two writers against the same file. Shared root files belong to the coordinator or a final verifier.
- Do not commit, push, open pull requests, send messages, or modify shared infrastructure unless the user explicitly requested that action.
- Do not fabricate agent completion. Inspect actual changes and run targeted checks before marking work `done`.
- Prefer two to five concurrent agents. Add more only when the workstreams are genuinely independent.
- Keep full-tree builds out of parallel workers; use targeted checks and run broader verification once at the end.

## Workflow

### 1. Scope and decompose

1. Restate the outcome and identify the smallest useful result.
2. Inspect the repository and relevant instructions. Use read-only exploration for broad searches.
3. Split the goal into tasks with clear acceptance criteria and dependencies.
4. Assign exact file ownership. Use a DAG wave when a shared contract must land before parallel work.
5. If ownership cannot be made disjoint, narrow the tasks, use isolated worktrees, or serialize the conflicting work.

### 2. Initialize local state

Run from the repository root:

```bash
node .qoder/skills/visual-swarm/scripts/swarm-dashboard.mjs init --name "Short swarm name" --goal "User-visible outcome"
```

This creates `.swarm/swarm.json` and an ignored `.swarm/` workspace. Use `--dir <path>` for a different location. Do not overwrite an existing manifest unless the user asks or `--force` is intentional.

### 3. Write the initial manifest

Populate `tasks`, `agents`, and `events` in `.swarm/swarm.json`. Create all planned agents up front, including the coordinator and verifier. Use `ready` for tasks whose dependencies are complete and `pending` for tasks that are not yet runnable.

A minimal task looks like:

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

Write the complete JSON document in one operation so the live server never sees a partial update. Keep event IDs unique and append events for meaningful transitions only.

### 4. Start the visual dashboard

Validate and launch the local server:

```bash
node .qoder/skills/visual-swarm/scripts/swarm-dashboard.mjs validate
node .qoder/skills/visual-swarm/scripts/swarm-dashboard.mjs serve --port 4177
```

Run `serve` with Bash `run_in_background: true`. Report the printed local URL to the user. If the port is occupied, choose another port. Keep the default loopback host unless the user explicitly needs network access.

When the user explicitly requests public-IP access, bind all interfaces and report the machine's reachable interface IP:

```bash
node .qoder/skills/visual-swarm/scripts/swarm-dashboard.mjs serve --host 0.0.0.0 --port 4177
```

The dashboard has no authentication. Expose it only after confirming the manifest contains no sensitive data and that inbound TCP access to the chosen port is allowed by the host or cloud firewall.

The dashboard updates from manifest changes. If a live server is not appropriate, use:

```bash
node .qoder/skills/visual-swarm/scripts/swarm-dashboard.mjs render
```

Then open `.swarm/dashboard.html`; it is a static snapshot.

### 5. Fan out independent agents

Launch all agents in the same dependency wave with parallel `Agent` tool calls. Use `general-purpose` for multi-step implementation and `Explore` for read-only discovery. Use background execution only when the coordinator has useful independent work to do; otherwise wait for results.

Each brief must include:

- The exact outcome and acceptance criteria.
- The exact files the agent owns and must not touch.
- Relevant dependencies and interfaces already established.
- Required targeted tests or checks.
- A prohibition on commits and unrelated refactors.
- The required return format: changed files, checks run, results, risks, and follow-ups.
- Worktree instructions when isolation is needed. Changes in an isolated worktree are not in the main tree until reviewed and integrated.

Before launch, set each task and agent to `running` and append a `started` event. Do not launch a task whose dependencies are incomplete.

### 6. Track and verify

When an agent completes:

1. Inspect its actual diff and confirm it respected file ownership.
2. Run or review the targeted checks.
3. Update its task and agent status, progress, message, and `updatedAt`.
4. Append a concise `done`, `failed`, or `blocked` event.
5. Unblock dependent tasks and launch the next wave.

When an agent fails, record the failure and either retry with a smaller scope, reassign the work, or stop and ask the user if the risk changed. Never silently mark failed work complete.

### 7. Finish with one verification pass

After all workers finish, run the relevant broader checks once, fix integration issues in the coordinator-owned files, and update the final manifest. Render a static snapshot for persistence:

```bash
node .qoder/skills/visual-swarm/scripts/swarm-dashboard.mjs render
```

Summarize the outcome, verification, dashboard location, and any unresolved risks. Stop the local server if it is no longer useful; otherwise tell the user it remains available.

## Manifest contract

| Field                    | Meaning                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `version`                | Always `1`.                                                                                    |
| `name`, `goal`           | Short dashboard title and user-visible outcome.                                                |
| `startedAt`, `updatedAt` | ISO timestamps.                                                                                |
| `tasks`                  | DAG nodes with `id`, `title`, `status`, `dependsOn`, optional `owner`, `files`, and `summary`. |
| `agents`                 | Workers with `id`, `name`, `role`, `status`, `progress`, `taskIds`, and optional `message`.    |
| `events`                 | Audit entries with unique `id`, ISO `at`, `type`, `message`, and optional `agentId`/`taskId`.  |

Task statuses: `pending`, `ready`, `running`, `blocked`, `done`, `failed`.

Agent statuses: `idle`, `running`, `done`, `failed`, `stopped`.

Useful event types: `info`, `started`, `progress`, `done`, `error`, `blocked`, `message`.

The validator rejects duplicate IDs, missing references, self-dependencies, cycles, invalid progress, and conflicting file ownership. It allows unknown extra fields so the manifest can evolve without breaking older dashboards.

## Resources

- `scripts/swarm-dashboard.mjs` — initialization, validation, static rendering, and live SSE server.
- `assets/dashboard.html` — self-contained interactive mission-control UI.
