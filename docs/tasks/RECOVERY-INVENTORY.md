# TaskOS Recovery Inventory

**Historical source snapshot:** pre-migration `dev` SHA `0e90a59688386a6635c46f209b09d05296393148`, audited on 2026-11-23.
**Current registry status:** `docs/tasks/tasks.json` is the owner-approved 627-record canonical registry. The prior 1,358-record registry is preserved byte-for-byte at `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json` (Git blob `d56499936761dcc062704d06588ee2679fd1aae2`).
**Migration:** applied on 2026-11-23 after explicit owner approval. Candidate JSON SHA-256 `13bc0b8ce445af5eff0b9e2057921c0ca73e1acc51dca02d25c848dd2b6a8776`; canonical Git blob `8216b6503d154d635112be96c41939a9efd38390`.
**Purpose:** source inventory, complete identity reconciliation, migration evidence and ongoing TaskOS validation contract.

## Pre-migration legacy registry audit — dev parent 0e90a596

A direct Git blob audit of `docs/tasks/tasks.json` found 1,358 valid JSON records. The source-reference distribution is:

| Existing source reference | Records |
| --- | ---: |
| `docs/roadmap/tasks.json` | 239 |
| `audit` | 14 |
| `todo-wa.md` | 112 |
| `todo.md` | 861 |
| `todo-desktop.md` | 128 |
| `evolution/backlog.json` | 4 |
| **Total** | **1,358** |

Task codes are unique and every record has a `sourceRef.file`, but the 861 `todo.md` references are stale as current provenance because root `todo.md` is now a pointer. The source-backed candidate inventory intentionally uses the archived checklist and imports only its seven still-open records; it adds 14 promotion-governance and 109 Visual Universe records for a candidate total of 627.

**Historical pre-migration instruction:** the 1,358-record file was not to be overwritten before review. The owner subsequently approved the reconciled candidate; its exact previous Git blob is now retained at `${oldArchivePath}`. The canonical registry has been replaced once by a Git tree update, not by running the one-time `--write` importer. CI remains read-only and must never write to `docs/tasks/tasks.json`.

## Exact legacy TODO identity reconciliation — 2026-11-23

A direct blob read plus a line-by-line parse of the archived checklist proves the complete 861-record `todo.md` subset is reconciled by stable task code:

- Legacy registry blob: `d56499936761dcc062704d06588ee2679fd1aae2` (`docs/tasks/tasks.json` at the pre-closeout source tree).
- Archived checklist blob: `f29ec364530195484f668287c5616bf91984554f` (`docs/archive/todos/todo.md`).
- Legacy rows with `sourceRef.file === "todo.md"`: **861** (854 `done`, 7 `todo`, 0 `doing`).
- Archived checklist rows: **861** (854 checked, 7 unchecked).
- Checked archive IDs and the 854 legacy `done` IDs are identical; unchecked archive IDs and the 7 legacy `todo` IDs are identical. Both set comparisons have **zero missing and zero extra IDs**.
- All seven unchecked IDs are retained by the source-backed candidate as `blocked` pending owner re-triage:
  `MW-CFG-003.3`, `MW-CICD-002`, `MW-CICD-002.3`, `MW-CICD-004`, `MW-CICD-004.2`, `MW-CICD-004.3`, `MW-DOC-004.3`.

This resolves the old root-pointer provenance for that 861-record subset: 854 completed entries remain in the archived historical checklist; seven open entries are retained as blocked work. The full legacy registry is also preserved byte-for-byte at `${oldArchivePath}`. A regression assertion covering this exact identity mapping passed in the exact-SHA unit-test job.

## Full legacy-to-candidate ID reconciliation — 2026-11-23

The uploaded candidate was compared by task code against the complete legacy registry blob, not only by total record count.

**Source identities:**
- Legacy registry `docs/tasks/tasks.json`: blob SHA `d56499936761dcc062704d06588ee2679fd1aae2`; 1,358 unique task codes.
- Candidate source tree: synthetic PR merge commit `0ac65eb3df98a3c8a9d416dfcd9696e1410ad6da` (PR head `c433aad30da0e2593245ae375b532859f3b1f851` merged with base `2a9d78333433b783a80bcb82f6ac7f7ad95f6c2d`).
- Candidate JSON SHA-256: `46b3a89d31ed2079da598f12844d918d21a98bcc0f47a1912cd807b1e462f388`; artifact ID `14779558473`.

**Exact task-code set comparison:**

| Classification | Count | Treatment |
| --- | ---: | --- |
| Legacy codes present in candidate | 504 | Retain stable task identities |
| Legacy codes absent from candidate | 854 | All 854 are `done` and cite root `todo.md`; retain as historical checklist evidence |
| Candidate codes absent from legacy | 123 | Add 14 AI Corporation PR lifecycle IDs and 109 Visual Universe task IDs |
| Candidate duplicate codes | 0 | None |
| Candidate total | 627 | 504 retained + 123 new |

The 854 removed codes are exactly the completed subset of the 861 root-`todo.md` records. The remaining seven open IDs are included in the candidate under `docs/archive/todos/todo.md` and are mapped from legacy `todo` to TaskOS `blocked` pending re-triage. The 854 completed checklist entries remain in the immutable archive and in the byte-for-byte legacy registry backup at `${oldArchivePath}` after the owner-approved migration.

Arithmetic: **1,358 - 854 + 123 = 627**. This accounts for the full net change of 731 records; it is not an unexplained deletion. The 497 other legacy records (roadmap, audit, WhatsApp, Desktop and Evolution source groups) plus the seven archived open MW items account for the 504 retained identities.

**Candidate validations:**
- 627 unique codes, 2 declared projects, every project reference resolves, every record has repository-relative source provenance.
- Exact source counts: roadmap 239, audit 14, WhatsApp 112, archived open MW 7, AI Corporation PR 14, Desktop 128, Evolution 4, Visual Universe 109.
- Status counts: done 468, doing 49, todo 89, blocked 21.
- Independent artifact inspection found no missing dependency or block IDs, non-reciprocal dependency edges, or dependency cycles.
- Hosted CI run [45087443105](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45087443105) completed all five jobs successfully and uploaded the validated candidate artifact. The artifact itself remains a review candidate, not the canonical registry.

**Migration decision:** Owner approval was received on 2026-11-23. The 627-record projection was applied as canonical on `dev`; the prior 1,358-record blob `d56499936761dcc062704d06588ee2679fd1aae2` is preserved at `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json`. New canonical blob: `8216b6503d154d635112be96c41939a9efd38390`. Candidate JSON SHA-256: `13bc0b8ce445af5eff0b9e2057921c0ca73e1acc51dca02d25c848dd2b6a8776`. Post-migration validation is enforced by the new CI checks; record exact-SHA outcomes below after the run completes.

## Canonical ownership target

`docs/tasks/tasks.json` is now the only canonical task lifecycle registry for this repository. The pre-migration registry is a read-only backup, not a second active queue.

- Task ID, project, status, priority, owner, dependency graph, acceptance criteria, validation and provenance live in TaskOS.
- `ROADMAP.md`, `docs/roadmap/tasks.json`, root `todo.md`, and GitHub Issues are views, navigation or operational projections. Their task status must not be independently edited as a second authority after TaskOS recovery.
- The Visual Universe package's `task.json`, `TASKS.md`, and individual task cards are generated scoped projections from TaskOS. The original 109-task source is preserved immutably at `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/legacy/task-source-2026-11-23.json`; original 109 task cards are preserved byte-for-byte in nine chunks under `legacy/task-cards-2026-11-23/`. Two non-generic card notes (W1-001 and W5-012) are preserved in `notes-addendum.json` and imported into TaskOS metadata with original blob SHA provenance. The 91 repeated generic 'keep task atomic' notes remain preserved in the card snapshots and need not be copied into every active task record. Project-specific fields are retained in TaskOS `metadata`. Pack configuration is stored separately in `pack-manifest.json`. The nine-chunk archive is indexed by `legacy/task-cards-2026-11-23/manifest.json`; an independent Git blob SHA verification matched all 109/109 archived files. Task-card generation no longer reads prior card content; it derives status, per-criterion completion and notes only from the TaskOS projection, while showing imported historical notes separately.
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
| `scripts/tasks/sources/audit-tasks.mjs` | 14 | Explicit audit backlog entries | Import with provenance pointing to the dedicated source data file; importer logic remains separate |
| `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/legacy/task-source-2026-11-23.json` | 109 | 93 done, 3 skipped, 13 blocked | Import into project `visual-universe`; skipped is mapped to TaskOS done plus `status:skipped` tag, and the original task object is retained losslessly in `metadata` |

**Expected initial TaskOS projection: 627 task records** (239 + 112 + 128 + 7 + 14 + 4 + 14 + 109). This is a source-inventory expectation, not a claim that the registry has been restored or validated. The automated projection test must confirm the exact total and schema before the one-time write is allowed.

### Expected canonical status distribution

The source statuses resolve to this expected TaskOS distribution after import:

| TaskOS status | Records | Derivation |
| --- | ---: | --- |
| `done` | 468 | 157 roadmap + 72 WhatsApp + 128 Desktop + 13 PR governance + 2 Evolution + 96 Visual Universe (including 3 explicitly tagged skipped) |
| `doing` | 49 | 47 roadmap in progress + 2 active Evolution |
| `todo` | 89 | 35 roadmap + 40 WhatsApp + 14 audit |
| `blocked` | 21 | 7 archived legacy + 1 PR.14 human approval + 13 Visual Universe |
| **Total** | **627** | No duplicate IDs across the eight source groups |

The three Visual Universe tasks originally marked `skipped` are represented as TaskOS `done` plus the explicit `status:skipped` tag and preserved original metadata. They remain distinguishable in the generated pack projection. These are calculated migration expectations, not live restored-registry counts.

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
6. The Visual Universe task projection must preserve original delegated metadata, plus the two task-specific notes from the immutable task-card addendum. The complete original cards are archived with blob SHAs; local `task.json`, `TASKS.md` and task cards are generated views, not independent lifecycle authorities.
7. The original Visual Universe source snapshot must not be edited; the local task projection remains non-authoritative until the reviewed candidate is applied. The TaskOS import CLI defaults to dry-run. Use `--candidate <path>` to export a validated candidate outside the worktree; `--write` must not be used against the existing populated registry.
8. `pnpm tasks:sync` refuses to run until the canonical registry passes schema, provenance, reference, dependency and roadmap parity validation.

## Recovery status

- [x] Source inventory for the documented migration inputs.
- [x] Fail-safe empty/malformed registry diagnostics.
- [x] Fail-closed TaskOS sync gate.
- [x] Required-source and duplicate-code checks in the importer.
- [x] Deterministic projection interface for a fixed `generatedAt`.
- [x] Global TaskOS mapping for Visual Universe task metadata and generated local projections.
- [x] Run `pnpm test:taskos` in the unit-test job on exact-`dev` push and pull-request CI runs.
- [x] Run source-backed TaskOS tests for all 627 records, duplicate IDs and source references.
- [x] Export exact-`dev` candidate artifact 14780700916 and reconcile the complete 1,358-to-627 task-code identity set.
- [ ] Obtain explicit data-owner approval, preserve the legacy registry as the rollback snapshot, and restore `docs/tasks/tasks.json` once from the accepted projection.
- [ ] Run `pnpm tasks:validate` and `pnpm automation:check:roadmap` against the selected canonical registry after the approved migration. Run `pnpm tasks:sweep --check` only after the candidate is deliberately applied.
- [ ] Confirm Visual Universe `sync-task-state.mjs --check` reads the global registry and its local artifacts are byte-current after migration.
- [x] Record exact-SHA evidence for candidate generation/validation; canonical TaskOS status remains pending the approved write.

**Do not describe TaskOS as migrated/canonical until the data owner approves the reconciled candidate, the one-time write is performed with a preserved rollback snapshot, and post-migration validators pass. The current 1,358-record legacy registry is populated and remains unchanged.**


## Visual Universe task-card preservation check — 2026-11-23

- [x] Preserved the original 109-task source manifest separately from pack configuration.
- [x] Preserved all 109 original individual task cards byte-for-byte in nine JSON chunks with original Git blob SHAs.
- [x] Verified all 109 archived card contents reproduce their recorded Git blob SHA (109/109 match).
- [x] Preserved the two task-specific legacy notes for W1-001 and W5-012 in a source-pinned notes addendum; 91 repeated generic atomicity notes remain in the immutable card archive.
- [x] Added importer validation that re-reads every archived chunk, verifies Git blob SHA, exact path coverage and task-specific note text before accepting the Visual Universe source.
- [x] Extracted pure TaskOS-driven Board/card renderers and added contract tests for per-criterion status, canonical notes, archived notes and honest missing-exit-code output.
- [x] Run `pnpm test:taskos` and the full CI suite on exact, non-cancelled pre-migration dev SHA `def3df35b5d54d7359600e0471af5a6dd4cb7f29` (runs [45088485869](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45088485869) and [45088491241](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45088491241)); all five jobs passed.


## Exact development-head candidate evidence — 2026-11-23

- Source: `dev` SHA `def3df35b5d54d7359600e0471af5a6dd4cb7f29`; push CI run [45088485869](https://github.com/A-L-L-A-H/mw-xv/actions/runs/45088485869), artifact ID `14780700916`.
- Candidate JSON SHA-256: `7be52787d8eacfde6d17ff2320c8d5a750ec410b802635125e0ebbd9057a2dc1`.
- Candidate: 627 unique task IDs; source counts roadmap 239, WhatsApp 112, Desktop 128, archived open MW 7, AI Corporation PR lifecycle 14, Evolution 4, audit 14, Visual Universe 109.
- Status counts: 468 done, 49 doing, 89 todo, 21 blocked.
- Structural inspection: zero missing project references, source references, dependency IDs or block IDs; zero non-reciprocal edges; zero dependency cycles.
- Exact-SHA push and PR CI each passed quality/build, unit tests (including TaskOS recovery candidate generation/validation), knowledge gate, DX, and PostgreSQL integration.
- At this historical checkpoint, `docs/tasks/tasks.json` was still 1,358 records (blob SHA `d56499936761dcc062704d06588ee2679fd1aae2`). The owner subsequently approved and applied the 627-record candidate; the old blob is preserved at `${oldArchivePath}`.


## Owner-approved TaskOS migration applied — 2026-11-23

- Approval: explicit owner approval in chat on 2026-11-23.
- Source candidate: push CI artifact `14781137522` from exact pre-migration `dev` SHA `0e90a59688386a6635c46f209b09d05296393148`.
- Candidate JSON SHA-256: `13bc0b8ce445af5eff0b9e2057921c0ca73e1acc51dca02d25c848dd2b6a8776`; `generatedAt` is pinned to `2026-11-23T00:45:36.000Z`, the source commit timestamp.
- New canonical Git blob: `8216b6503d154d635112be96c41939a9efd38390`; canonical path: `docs/tasks/tasks.json`.
- Previous 1,358-record Git blob `d56499936761dcc062704d06588ee2679fd1aae2` was not reserialized or edited; the Git tree now references this exact blob at `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json` to preserve byte-for-byte rollback.
- Candidate contains 627 unique records: 468 done, 49 doing, 89 todo, 21 blocked; source groups total 627 across all eight reviewed sources.
- Exact legacy identity arithmetic remains `1,358 - 854 + 123 = 627`; 854 completed historical rows remain recoverable in the backup/archive, seven open legacy items remain as blocked, and 123 reviewed IDs were added.
- Next gates: canonical validation, roadmap parity, deterministic source comparison, and Visual Universe task projection checks on the migration commit's exact SHA.
