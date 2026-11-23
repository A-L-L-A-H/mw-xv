# MoonWitness TaskOS — Centralized Work Registry (`docs/tasks/`)

> **Canonical status (2026-11-23): migrated and owner-approved.** `docs/tasks/tasks.json` is now the canonical `moonwitness-tasks/v2` registry with **636 records**. The former 1,358-record registry is preserved byte-for-byte at `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json` for rollback and historical audit.

## Current registry

- Canonical registry: 636 unique task codes; schema version `2.0.0`.
- Lifecycle distribution: 468 `done`, 49 `doing`, 96 `todo`, 23 `blocked`.
- Source groups: roadmap 239, WhatsApp 112, Desktop 128, archived open MW 7, AI Corporation PR lifecycle 14, Evolution 4, audit 23, Visual Universe 109.
- Exact previous registry backup blob: `d56499936761dcc062704d06588ee2679fd1aae2`, retained at `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json`.

The owner approved the one-time migration in chat on 2026-11-23. The full 1,358-to-627 task-code reconciliation is recorded in `RECOVERY-INVENTORY.md`. The 854 completed legacy rows removed from the active set remain in the preserved registry snapshot and archived checklist; the seven still-open legacy rows remain present as `blocked` pending re-triage. No legacy record was silently discarded.

- Canonical registry now contains 636 records; the nine new audit follow-ups remain `todo` until implementation evidence is recorded.

## Authority rules

- **Task identity and lifecycle:** `docs/tasks/tasks.json` is the sole canonical TaskOS registry.
- **Roadmap completion:** `ROADMAP.md` checkboxes and linked evidence remain the completion proof for M/K work; TaskOS statuses must pass roadmap parity.
- **Human triage:** GitHub Issues own assignees, discussion and human approval gates.
- **Delivery/release:** exact source SHA, required CI, promotion PR/review and release metadata; never infer release readiness from checkboxes.
- **Projections:** `docs/roadmap/tasks.json`, root `todo.md`, and Visual Universe `task.json`, `TASKS.md` and individual task cards are views, not competing lifecycle authorities.

## Core files

- `docs/tasks/tasks.schema.json`: JSON Schema Draft-07 for `moonwitness-tasks/v2`.
- `docs/tasks/tasks.json`: canonical 627-record lifecycle registry.
- `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json`: immutable pre-migration 1,358-record snapshot; retain it for rollback and audit.
- `docs/tasks/RECOVERY-INVENTORY.md`: source inventory, complete identity reconciliation, migration evidence and validation gates.

## Safe commands

```bash
# Run focused registry, provenance, import and projection tests
pnpm test:taskos

# Validate the canonical registry and roadmap parity
pnpm tasks:validate
pnpm automation:check:roadmap

# Confirm the registry exactly matches its deterministic source projection
pnpm tasks:sweep -- --check

# Confirm the Visual Universe views are generated from canonical TaskOS
node MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/tools/sync-task-state.mjs --check

# Regenerate Visual Universe local views only after canonical validation
node MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/tools/sync-task-state.mjs
```

The `--candidate` mode remains non-mutating and writes only outside the repository. The one-time `--write` importer is for an empty registry and refuses to overwrite a populated canonical file. Do not use it to replace the migrated registry. Canonical lifecycle changes must use the reviewed TaskOS workflow and must preserve source provenance and dependency integrity.

## Migration record

- Owner approval: 2026-11-23.
- Migration parent: `dev` SHA `0e90a59688386a6635c46f209b09d05296393148`.
- Previous registry blob: `d56499936761dcc062704d06588ee2679fd1aae2` (1,358 records).
- New audit follow-up tasks `AUD-015`–`AUD-023` cover asset review status, SceneLab provenance, homepage boundary tests and visual-audit documentation.
- Candidate JSON SHA-256: `13bc0b8ce445af5eff0b9e2057921c0ca73e1acc51dca02d25c848dd2b6a8776`.
- CI must continue to run TaskOS safety tests, canonical validation, deterministic source comparison, roadmap parity and Visual Universe projection validation on every candidate SHA.
