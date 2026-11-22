# MoonWitness TaskOS — Centralized Work Registry (`docs/tasks/`)

> **Recovery status (2026-11-23): TaskOS registry unavailable.** The tracked `docs/tasks/tasks.json` is zero-byte and invalid JSON. Do not treat TaskOS as canonical, run `tasks:sync`, or regenerate status from this empty file until the recovery plan is completed and validated.

## Current authority while TaskOS is unavailable

- **Task completion:** `ROADMAP.md` checkbox plus linked evidence.
- **Task identity, dependency and detail index:** `docs/roadmap/tasks.json`, validated by `pnpm automation:check:roadmap`.
- **Human triage, assignee, discussion and blocked notes:** GitHub Issues.
- **Delivery/release state:** exact source SHA, CI, promotion PR/merge and release metadata; never infer from completion checkboxes.
- **TaskOS registry:** intended expanded task registry, but currently unavailable pending safe reconstruction.

These are temporary recovery boundaries. The long-term canonical TaskOS model is documented in `tasks.schema.json`; recovery must preserve provenance and avoid inventing task records.

## Canonical ownership target

After the reviewed one-time migration, `docs/tasks/tasks.json` is the single canonical lifecycle registry across repository projects. Project-specific fields are retained under `metadata`; lifecycle, dependency, acceptance and provenance fields remain at the TaskOS task root.

Generated or operational projections must not become competing status authorities:
- `ROADMAP.md` and `docs/roadmap/tasks.json` are roadmap projections.
- Root `todo.md` is a pointer, not a task source.
- Visual Universe `task.json`, `TASKS.md` and individual task cards are generated scoped projections from TaskOS.
- GitHub Issues are operational/human triage projections; they do not override canonical task state.

## Berkas inti

- `docs/tasks/tasks.schema.json`: JSON Schema Draft-07 for `moonwitness-tasks/v2`; every task requires a repository-relative `sourceRef.file`.
- `docs/tasks/tasks.json`: canonical task registry (currently zero bytes; unavailable until recovery is validated).
- `docs/tasks/RECOVERY-INVENTORY.md`: actual source inventory, record counts, import/exclusion decisions and restoration gates.

## Perintah

```bash
# Run focused TaskOS registry/provenance/import tests
pnpm test:taskos

# Preview the one-time source projection; does not write files
pnpm tasks:sweep

# Only after inventory review, CI and approval, recover an empty registry once
pnpm tasks:sweep -- --write

# Validate the populated canonical registry and projections
pnpm tasks:validate
pnpm automation:check:roadmap

# Sync roadmap projections (refuses to run until TaskOS validates)
pnpm tasks:sync

# Generate live roadmap progress
pnpm roadmap:progress -- --format json
```

## Recovery

The validator rejects an empty/whitespace registry with a recovery-specific diagnostic and malformed JSON with a separate error. The roadmap sync gate validates the complete registry before any write. The importer now requires all declared sources, rejects duplicate IDs, preserves source provenance, supports deterministic fixed-timestamp output, and defaults to dry-run. `--write` refuses to overwrite a non-empty registry.

The source inventory currently resolves to 627 candidate records across M/K, WA, DSK, archived MW, PR governance, evolution, audit and Visual Universe work. This is an expected projection count, not proof that a populated registry exists. The Visual Universe package now projects its local task board from TaskOS while retaining source-specific fields losslessly.

Follow [MW-XV Stabilization Plan](../roadmap/STABILIZATION-PLAN.md), work item S1. Do not call TaskOS restored until `pnpm test:taskos`, the source projection, schema/provenance/dependency validation and roadmap parity all pass on the exact candidate SHA.
