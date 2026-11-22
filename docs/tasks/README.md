# MoonWitness TaskOS — Centralized Work Registry (`docs/tasks/`)

> **Recovery status (2026-11-23): TaskOS registry unavailable.** The tracked `docs/tasks/tasks.json` is zero-byte and invalid JSON. Do not treat TaskOS as canonical, run `tasks:sync`, or regenerate status from this empty file until the recovery plan is completed and validated.

## Current authority while TaskOS is unavailable

- **Task completion:** `ROADMAP.md` checkbox plus linked evidence.
- **Task identity, dependency and detail index:** `docs/roadmap/tasks.json`, validated by `pnpm automation:check:roadmap`.
- **Human triage, assignee, discussion and blocked notes:** GitHub Issues.
- **Delivery/release state:** exact source SHA, CI, promotion PR/merge and release metadata; never infer from completion checkboxes.
- **TaskOS registry:** intended expanded task registry, but currently unavailable pending safe reconstruction.

These are temporary recovery boundaries. The long-term canonical TaskOS model is documented in `tasks.schema.json`; recovery must preserve provenance and avoid inventing task records.

## Berkas inti

- `docs/tasks/tasks.schema.json`: JSON Schema Draft-07 untuk `moonwitness-tasks/v2`.
- `docs/tasks/tasks.json`: expected master task registry (currently zero bytes; restore before use).

## Perintah

```bash
# Validate canonical TaskOS (currently expected to fail due empty registry)
pnpm tasks:validate

# Status/index validation that does not depend on TaskOS
pnpm automation:check:roadmap

# Generate live roadmap progress from source checklist
pnpm roadmap:progress -- --format json
```

## Recovery

Follow [MW-XV Stabilization Plan](../roadmap/STABILIZATION-PLAN.md), work item S1. Do not populate this registry by copying only the M/K task index: TaskOS claims to include additional series and records that must be inventoried from their actual sources first.
