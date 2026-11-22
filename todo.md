# MoonWitness TaskOS — Work Entry Point

> **Recovery status: BLOCKED.** The canonical registry `docs/tasks/tasks.json` is tracked but currently zero-byte. Do not run TaskOS sync, start autonomous task execution, or treat old TODO snapshots as independent active backlogs.

## Canonical source of truth

The intended single task lifecycle registry is:

- `docs/tasks/tasks.json` — canonical task identity, project, status, priority, ownership, dependencies, acceptance criteria, validation and provenance.

Current recovery references:

- `docs/tasks/README.md` — TaskOS usage and authority rules.
- `docs/tasks/RECOVERY-INVENTORY.md` — verified source inventory, record counts and migration decisions.
- `docs/roadmap/STABILIZATION-PLAN.md` — recovery gates and repository stabilization sequence.
- `docs/roadmap/tasks.json` and `ROADMAP.md` — temporary M/K task index and checklist source while TaskOS remains unavailable.

## Recovery commands

Run from a checked-out repository:

```bash
pnpm test:taskos
pnpm tasks:sweep
pnpm tasks:validate
pnpm automation:check:roadmap
```

- `pnpm tasks:sweep` is a read-only source projection preview and must pass full schema, provenance, graph and roadmap parity validation.
- `pnpm tasks:validate` must pass after the registry is restored.
- `pnpm tasks:sync` is fail-closed and must not run while the registry is empty or invalid.
- `pnpm tasks:sweep -- --write` is a one-time recovery write only. Use it only after the dry-run, tests and exact-SHA CI pass and the source inventory has been reviewed. It refuses to overwrite a non-empty registry.

## Temporary migration sources

The current migration inputs are frozen snapshots, not permanent parallel backlogs: `todo-wa.md`, `todo-desktop.md`, `docs/archive/todos/todo.md`, the AI Corporation PR checklist, `evolution/backlog.json`, `scripts/tasks/sources/audit-tasks.mjs`, and the immutable Visual Universe source snapshot.

After TaskOS restoration, update task lifecycle through TaskOS only. Roadmap, GitHub Issues and Visual Universe local task files are projections or operational views. Preserve source snapshots and human-owned approval gates; never fabricate task records from totals.

**Do not resume autonomous implementation from any legacy TODO or Visual Universe task card until TaskOS recovery and validation are complete.**
