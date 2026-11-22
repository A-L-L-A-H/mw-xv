# Task Dependency Graph

The machine-readable dependency graph is in `task.json` (`depends_on`). Execution must follow a topological order.

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
