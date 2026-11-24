# MoonWitness TaskOS — Centralized Work Registry (`docs/tasks/`)

> **Live canonical status (2026-11-23):** `docs/tasks/tasks.json` is the canonical `moonwitness-tasks/v2` registry with **637 unique records**. The original 1,358-record registry remains preserved byte-for-byte at `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json`.

## Current registry

- Canonical registry: **637 unique task codes**; schema version `2.0.0`.
- Current lifecycle distribution at the audited `dev` blob: **468 `done`**, **49 `doing`**, **96 `todo`**, **24 `blocked`**.
- Source groups: roadmap 239; WhatsApp 112; Desktop 128; archived open MW 7; AI Corporation PR lifecycle 14; Evolution 4; audit 24; Visual Universe 109.
- Current audited `dev` task registry blob: `4d677b63b825f7d4da0bbd83ad5c08a5d51b167f`, generated at `2026-11-23T09:19:56.410Z`.
- Current `main` still carries the original **627-record** TaskOS snapshot at blob `8216b6503d154d635112be96c41939a9efd38390`. The ten additional `AUD-015`–`AUD-024` records are on `dev`; do not describe the main snapshot as the current dev registry.
- The original 1,358-record source registry is retained at `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json`, blob `d56499936761dcc062704d06588ee2679fd1aae2`.

The initial owner-approved migration reconciled **1,358 → 627** task identities. That migration checkpoint remains historically valid; the live `dev` registry subsequently grew to 637 when ten audit follow-ups (`AUD-015`–`AUD-024`) were added. The complete distinction and exact identity comparison are recorded in `RECOVERY-INVENTORY.md`. The 854 completed legacy rows remain in the preserved registry snapshot and archived checklist; the seven still-open legacy rows remain as `blocked` pending re-triage. No legacy record was silently discarded.

## Authority rules

- **Task identity and lifecycle:** `docs/tasks/tasks.json` is the sole canonical TaskOS registry on the branch being changed.
- **Roadmap completion:** `ROADMAP.md` checkboxes and linked evidence remain the completion proof for M/K work; TaskOS statuses must pass roadmap parity.
- **Human triage:** GitHub Issues own assignees, discussion and human approval gates.
- **Delivery/release:** exact source SHA, required CI, promotion PR/review and release metadata; never infer release readiness from checkboxes.
- **Projections:** `docs/roadmap/tasks.json`, root `docs/tasks/sources/todo.md`, and Visual Universe `task.json`, `TASKS.md` and individual task cards are views, not competing lifecycle authorities.

## Core files

- `docs/tasks/tasks.schema.json`: JSON Schema Draft-07 for `moonwitness-tasks/v2`.
- `docs/tasks/tasks.json`: current 637-record `dev` registry; `main` is currently at the 627-record snapshot.
- `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json`: immutable pre-migration 1,358-record snapshot; retain it for rollback and audit.
- `docs/tasks/RECOVERY-INVENTORY.md`: source inventory, complete identity reconciliation, migration evidence and live follow-up comparison.

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
node docs/bundles/visual-universe-pack/tools/sync-task-state.mjs --check

# Regenerate Visual Universe local views only after canonical validation
node docs/bundles/visual-universe-pack/tools/sync-task-state.mjs
```

The `--candidate` mode remains non-mutating and writes only outside the repository. The one-time `--write` importer is for an empty registry and refuses to overwrite a populated canonical file. Do not use it to replace the migrated registry. Canonical lifecycle changes must use the reviewed TaskOS workflow and must preserve source provenance and dependency integrity.

## Historical migration record

- Owner approval: 2026-11-23.
- Migration parent: `dev` SHA `0e90a59688386a6635c46f209b09d05296393148`.
- Pre-migration registry blob: `d56499936761dcc062704d06588ee2679fd1aae2` (1,358 records).
- Original post-migration candidate: 627 records, blob `8216b6503d154d635112be96c41939a9efd38390`.
- Ten subsequent audit follow-ups: `AUD-015`–`AUD-024`; source: `scripts/tasks/sources/audit-tasks.mjs`.
- The candidate JSON SHA-256 `13bc0b8ce445af5eff0b9e2057921c0ca73e1acc51dca02d25c848dd2b6a8776` refers to the original 627-record migration candidate, **not** the current 637-record live file.
- CI must continue to run TaskOS safety tests, canonical validation, deterministic source comparison, roadmap parity and Visual Universe projection validation on every candidate SHA.
