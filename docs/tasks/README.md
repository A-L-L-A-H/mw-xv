# MoonWitness TaskOS — Centralized Work Registry (`docs/tasks/`)

> **Current status (2026-11-23): migration is not yet applied.** The exact `dev` tree contains a valid, non-empty legacy registry (1,358 records, approximately 2.52 MB). It is not the new source-backed 627-record projection. Do not overwrite it automatically.

## Current registry and migration boundary

The tracked `docs/tasks/tasks.json` currently contains 1,358 historical records. A Git blob-level audit found unique task codes and source references, but 861 records still cite root `todo.md`; that file is now only a pointer to this registry. Those records need explicit provenance reconciliation rather than being treated as a current active source.

The reviewed migration inventory defines a new projection of 627 records from eight sources. It replaces the stale root-`todo.md` ingestion with seven still-open archived MW records, and adds the reviewed promotion-governance and Visual Universe task groups. The candidate is not canonical until it has been exported, reviewed against the existing registry, and deliberately applied with the previous registry preserved in Git history or an explicit archive.

## Authority rules

- **Task identity and lifecycle:** `docs/tasks/tasks.json` remains the current on-disk registry, but the 1,358-record legacy state is not approved as the post-migration source of truth.
- **Roadmap completion:** `ROADMAP.md` checkboxes plus linked evidence remain the completion proof for M/K work.
- **Human triage:** GitHub Issues own assignees, discussion and human approval gates.
- **Delivery/release:** exact source SHA, required CI, promotion PR/review and release metadata; never infer release readiness from checkboxes.
- **Projections:** `docs/roadmap/tasks.json`, root `todo.md`, and Visual Universe `task.json`, `TASKS.md` and cards are views, not competing lifecycle authorities.

## Core files

- `docs/tasks/tasks.schema.json`: JSON Schema Draft-07 for `moonwitness-tasks/v2`.
- `docs/tasks/tasks.json`: existing legacy registry; do not overwrite until the 627-record migration is reviewed.
- `docs/tasks/RECOVERY-INVENTORY.md`: source inventory, source ownership, migration decisions and validation gates.

## Safe commands

```bash
# Run focused registry, provenance, import and projection tests
pnpm test:taskos

# Preview the 627-record source projection without writing anything
pnpm tasks:sweep

# Export a validated candidate outside the repository (recommended)
node scripts/tasks/sweep-and-consolidate.mjs \
  --candidate /tmp/taskos-candidate.json

# Validate the currently committed registry
pnpm tasks:validate

# Compare the committed registry to the deterministic projection only
# after the candidate has intentionally become canonical
pnpm tasks:sweep -- --check

# Sync roadmap projections only after canonical TaskOS validation
pnpm tasks:sync
pnpm automation:check:roadmap
```

The `--candidate` mode validates the generated projection and writes it only outside the repository worktree. It never edits `docs/tasks/tasks.json`. The `--write` mode remains a one-time operation for an empty registry and correctly refuses to replace a non-empty file. CI exports the candidate to `RUNNER_TEMP`, verifies its record count and status distribution, and uploads it as a workflow artifact; CI does not apply the migration.

## Migration exit criteria

The expected candidate is 627 unique task records with lifecycle counts of 468 `done`, 49 `doing`, 89 `todo`, and 21 `blocked`. Before applying it, compare the full candidate with the existing registry, preserve the previous 1,358-record snapshot, verify provenance for the 861 legacy `todo.md` records against the archived source, then run schema, graph, dependency, roadmap-parity and projection validation on the exact candidate SHA.

Do not describe TaskOS as migrated until the candidate is reviewed, the intentional historical-record reduction is documented, the canonical file is replaced deliberately, and exact-SHA validation passes.
