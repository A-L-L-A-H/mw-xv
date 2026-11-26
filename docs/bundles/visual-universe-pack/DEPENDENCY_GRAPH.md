# Visual Universe Task Graph

**Current state: canonical TaskOS active.** The owner-approved migration is complete. `docs/tasks/tasks.json` is the validated lifecycle authority with 679 records, including 109 Visual Universe tasks. The 1,358-record historical snapshot and immutable Visual Universe source remain preserved for audit. W9-001 through W9-005 and W10-001 through W10-003 are complete; W9-006 and dependent W10-004 remain blocked by the official Firefox/WebKit Board matrix (33/42 passed). Continue ready tasks in canonical dependency order and record blockers with evidence.

## Source preservation

- Immutable task source: `legacy/task-source-2026-11-23.json`.
- Original individual task cards: `legacy/task-cards-2026-11-23/`, indexed by `manifest.json` and preserved with Git blob SHAs.
- Pack configuration: `pack-manifest.json`.
- Local `task.json`, `TASKS.md`, dependency graph and task cards are generated views only. Do not read them as a live queue or update lifecycle state directly.

Regenerate this graph from the global `visual-universe` records after canonical TaskOS validates. Execution follows topological order of TaskOS `dependsOn` relationships. The renderer validates unique IDs, known dependencies, acyclic ordering and per-criterion status consistency before writing.

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
