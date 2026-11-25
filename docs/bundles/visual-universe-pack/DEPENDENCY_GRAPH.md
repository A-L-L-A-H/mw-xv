# Visual Universe Task Graph

**Current state: migration-gated.** The repository-wide `docs/tasks/tasks.json` contains 1,358 legacy records, including 861 records that still reference root `docs/tasks/sources/todo.md`, now only a pointer. A source-backed 627-record migration candidate is defined and covered by importer tests, but its export and 1,358-to-627 reconciliation review are not yet complete. The 109-task Visual Universe project is therefore not an approved canonical execution queue. Keep autonomous execution stopped until exact-SHA CI is green, the candidate is reviewed, the legacy snapshot is preserved, and canonical migration is explicitly approved.

## Source preservation

- Immutable task source: `legacy/task-source-2026-11-23.json`.
- Original individual task cards: `legacy/task-cards-2026-11-23/`, indexed by `manifest.json` and preserved with Git blob SHAs.
- Pack configuration: `pack-manifest.json`.
- Local `task.json`, `TASKS.md`, dependency graph and task cards are generated views only. Do not read them as a live queue or update lifecycle state directly.

After TaskOS recovery and validation, regenerate this graph from the global `visual-universe` records. Execution must follow topological order of TaskOS `dependsOn` relationships. The renderer validates unique IDs, known dependencies, acyclic ordering and per-criterion status consistency before writing.

## Phase gates

- **W0** baseline and current-source revalidation; must precede implementation.
- **W1** Visual Bible; establishes style and accessibility rules.
- **W2** canonical manifest and generators; establishes asset contracts.
- **W3/W4** character and environment production; can partially proceed in parallel after design/schema gates.
- **W5/W6** runtime and effects; depend on metadata/visual contracts.
- **W7** Creative Lab; uses real asset/runtime contracts.
- **W8** addon-domain coverage; can parallelize by disjoint domain once mappings and manifest conventions are stable.
- **W9** production scene/integration; uses approved pilot assets and runtime.
- **W10** final acceptance and release.

## Parallel safety

Maximum four agents. Do not allow multiple agents to edit shared manifests, lockfiles, global token/CSS files, package manifests or task state concurrently. Parallelize by separate domain pack folders or isolated tests only after contracts are frozen. One integration owner merges each workstream.
