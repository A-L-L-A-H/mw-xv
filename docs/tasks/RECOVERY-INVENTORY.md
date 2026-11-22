# TaskOS Recovery Inventory

**Snapshot:** `dev` repository source inventory reviewed on 2026-11-23.
**Registry status:** `docs/tasks/tasks.json` is zero-byte and remains unavailable.
**Purpose:** source-backed migration inventory and ownership contract. This document is not the task registry.

## Canonical ownership target

After the initial, reviewed migration, `docs/tasks/tasks.json` is the only canonical task lifecycle registry for this repository.

- Task ID, project, status, priority, owner, dependency graph, acceptance criteria, validation and provenance live in TaskOS.
- `ROADMAP.md`, `docs/roadmap/tasks.json`, root `todo.md`, and GitHub Issues are views, navigation or operational projections. Their task status must not be independently edited as a second authority after TaskOS recovery.
- The Visual Universe package's `task.json`, `TASKS.md`, and individual task cards are generated scoped projections from TaskOS. Project-specific fields are preserved in the TaskOS `metadata` field; TaskOS root fields own lifecycle state.
- Archived TODOs remain historical source evidence. Only explicitly identified, still-open records enter the migration, and they are imported as blocked pending revalidation.
- The import tool is a one-time recovery tool. Do not rerun it to overwrite an already populated canonical registry.

## Verified source inventory

| Source | Verified records | Current state | Migration treatment |
| --- | ---: | --- | --- |
| `docs/roadmap/tasks.json` + `ROADMAP.md` | 239 (174 M + 65 K) | 157 complete, 35 todo, 47 in progress; the Markdown checkboxes agree (157 checked, 82 open) | Import all; TaskOS becomes canonical lifecycle source |
| `todo-wa.md` | 112 | 72 checked, 40 open | Import all with stable `WA-` prefix |
| `todo-desktop.md` | 128 | All 128 checked | Import as completed history with source provenance |
| `docs/archive/todos/todo.md` | 7 open records | 854 other checklist rows checked; archive contains 861 checklist rows | Import only 7 unchecked MW records as blocked / needs re-triage; retain the archive |
| `moonwitness-ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md` | 14 PR lifecycle IDs | PR.01–PR.13 checked; PR.14 unchecked | Import 13 completed records and PR.14 as a human-owned blocked approval gate; AI0/AI1-style proposal IDs are not promoted as official tasks |
| `evolution/backlog.json` | 4 | 2 completed, 2 active | Import with completed/active status preserved |
| `AUDIT_TASKS` in `scripts/tasks/sweep-and-consolidate.mjs` | 14 | Explicit audit backlog entries | Import with provenance pointing to the source definition; later extract this data from code into a dedicated source file |
| `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/task.json` | 109 | 93 done, 3 skipped, 13 blocked | Import into project `visual-universe`; skipped is mapped to TaskOS done plus `status:skipped` tag, and the original task object is retained losslessly in `metadata` |

**Expected initial TaskOS projection: 627 task records** (239 + 112 + 128 + 7 + 14 + 4 + 14 + 109). This is a source-inventory expectation, not a claim that the registry has been restored or validated. The automated projection test must confirm the exact total and schema before the one-time write is allowed.

## Reviewed but excluded from active import

| Source | Observed state | Reason |
| --- | --- | --- |
| Root `todo.md` | 2,761-character pointer to `docs/tasks/tasks.json` | It is navigation only, not a source backlog. The importer verifies this contract and never parses it as tasks. |
| `todo-foundation.md` | 18/18 checkboxes checked | Historical completed checklist; preserve as source evidence, do not create a second active backlog. |
| `todo-ui.md` | 635/635 checkboxes checked | Historical completed design/implementation ledger; preserve, do not import as active tasks. |
| Other `AI0.*` / `AI1.*` lines in the AI Corporation checklist | Proposal IDs and baseline notes | The source explicitly says these IDs are proposals, not official master task IDs until a separate Phase 0 reconciliation. Only the explicit PR lifecycle IDs are imported. |

## Safety and validation rules

1. Required import sources must exist and parse. Missing/malformed sources fail the whole projection; there is no silent optional-source skip.
2. Duplicate task codes across sources are fatal and must be reconciled before import.
3. Every TaskOS task must carry a repository-relative `sourceRef.file`; the schema and validator enforce provenance.
4. Unknown project references, dependency references, block references, duplicate IDs and dependency cycles fail validation.
5. Root `todo.md` remains a pointer; archived open tasks enter as blocked, never as ready work.
6. The Visual Universe task projection must preserve its original delegated metadata. Its generated files are not independent lifecycle authorities.
7. The TaskOS import CLI defaults to dry-run. `--write` must only be used once on an empty registry after reviewing the complete source inventory and passing all projection tests.
8. `pnpm tasks:sync` refuses to run until the canonical registry passes schema, provenance, reference, dependency and roadmap parity validation.

## Recovery status

- [x] Source inventory for the documented migration inputs.
- [x] Fail-safe empty/malformed registry diagnostics.
- [x] Fail-closed TaskOS sync gate.
- [x] Required-source and duplicate-code checks in the importer.
- [x] Deterministic projection interface for a fixed `generatedAt`.
- [x] Global TaskOS mapping for Visual Universe task metadata and generated local projections.
- [ ] Execute `pnpm test:taskos` on a real checkout.
- [ ] Run TaskOS dry-run and inspect all 627 records, duplicate IDs and source references.
- [ ] Restore `docs/tasks/tasks.json` once, from the reviewed projection.
- [ ] Run `pnpm tasks:validate`, `pnpm tasks:sweep --check` (where still applicable), and `pnpm automation:check:roadmap`.
- [ ] Confirm Visual Universe `sync-task-state.mjs --check` reads the global registry and its local artifacts are byte-current.
- [ ] Record exact-SHA evidence and only then declare TaskOS canonical.

**Do not describe TaskOS as restored until the empty registry has been populated, the real validation commands pass, and the exact candidate SHA is recorded.**
