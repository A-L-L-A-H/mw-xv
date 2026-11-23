---
name: mw-taskos
description: Query and summarize MoonWitness TaskOS — docs/tasks/tasks.json (format moonwitness-tasks/v2) with fields code/project/milestone/status/priority/dependsOn/blocks/acceptanceCriteria. Use when planning work, checking task status, or summarizing roadmap counts.
---

# MoonWitness TaskOS

## Data source

`docs/tasks/tasks.json` — format `moonwitness-tasks/v2`. Top-level shape:
`schemaVersion`, `format`, `generatedAt`, `projects[]` (slug, name, repos, statuses),
`tasks[]`.

## Task fields

| Field | Meaning |
| --- | --- |
| `code` | Stable task ID (e.g. `M0.01`) |
| `project` | Project slug (e.g. `moonwitness`, `visual-universe`) |
| `series` | Series letter the task belongs to |
| `milestone` | Milestone ID (e.g. `M0`) |
| `horizon` | Planning horizon |
| `status` | One of `backlog`, `todo`, `doing`, `review`, `blocked`, `done` |
| `priority` | Ordering weight within its series |
| `dependsOn` | Task codes this task depends on |
| `blocks` | Task codes this task unblocks |
| `acceptanceCriteria` | Conditions that must hold before `done` |

## Querying rules

- Read-only. Never mutate `docs/tasks/tasks.json` by hand — it is generated and validated
  by `pnpm tasks:validate` / `pnpm tasks:sync`.
- To summarize: group by `status` and by `project`; report totals per group.
- To plan: prefer tasks whose `dependsOn` are all `done` and whose `status` is `todo`.
- Blocked tasks (`status === 'blocked'`) must not be started; resolve blockers first.

## Tooling

The MCP server exposes `mw_taskos_summary` (read-only counts by status/project) over
`docs/tasks/tasks.json`. Schema changes to the task format go through
`scripts/tasks/validate-tasks.mjs`, not ad-hoc edits.
