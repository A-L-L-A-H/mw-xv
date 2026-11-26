# MoonWitness TaskOS — Work Entry Point

> **Registry status: RECOVERED / ACTIVE.** `docs/tasks/tasks.json` is tracked, schema-valid and non-empty (679 tasks on `dev`: 482 done, 49 doing, 119 todo, 11 blocked, 18 backlog at the latest validation). TaskOS is the single authority for task lifecycle; legacy TODO snapshots are historical references only.

## Canonical source of truth

- `docs/tasks/tasks.json` — canonical task identity, project, status, priority, ownership, dependencies, acceptance criteria, validation and provenance.
- `docs/tasks/tasks.schema.json` — schema enforced by `pnpm tasks:validate`.
- `docs/tasks/README.md` — TaskOS usage and authority rules.

Historical recovery context (read-only, not active backlogs):

- `docs/tasks/RECOVERY-INVENTORY.md` — verified source inventory and migration decisions.
- `docs/roadmap/STABILIZATION-PLAN.md` — stabilization gates used during recovery.
- `docs/roadmap/tasks.json` and `ROADMAP.md` — roadmap projection of TaskOS, not a second registry.

## Routine commands

Run from a checked-out repository:

```bash
pnpm test:taskos
pnpm tasks:sweep
pnpm tasks:validate
pnpm automation:check:roadmap
```

- `pnpm tasks:sweep` is a read-only source projection preview and must pass schema, provenance, graph and roadmap parity validation.
- `pnpm tasks:validate` must pass before any sync or autonomous execution. It also rejects a stale recovery narrative in this file.
- `pnpm tasks:sync` updates GitHub/roadmap projections from the validated registry; it remains fail-closed on an empty or invalid registry.
- `pnpm tasks:sweep -- --write` is **not** a routine command. It is a one-time recovery write that refuses to overwrite a non-empty registry.

## Legacy migration sources

The historical migration inputs are frozen snapshots, not permanent parallel backlogs: `docs/tasks/sources/todo-wa.md`, `docs/tasks/sources/todo-desktop.md`, `docs/archive/todos/todo.md`, the AI Corporation PR checklist, `evolution/backlog.json`, `scripts/tasks/sources/audit-tasks.mjs`, and the immutable Visual Universe source snapshot.

Update task lifecycle through TaskOS only. Roadmap, GitHub Issues and Visual Universe local task files are projections or operational views. Preserve source snapshots and human-owned approval gates; never fabricate task records from totals or read status from stale snapshots.
