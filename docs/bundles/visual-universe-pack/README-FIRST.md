# MoonWitness XV — Ultra Complete Visual Universe & Asset Ecosystem

**Autonomous implementation pack for local AI / Codex / multi-agent coding systems**

- Repository: `https://github.com/A-L-L-A-H/mw-xv`
- Target branch: `dev`
- Pack baseline: `0b89060602c659efdd5e9e1a12c166fee237418e`
- Task count: **109 atomic tasks**
- Canonical lifecycle registry: `docs/tasks/tasks.json` (679 records across two projects; 109 Visual Universe tasks. The prior 1,358-record snapshot is preserved at `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json`)
- Pack configuration: `pack-manifest.json`
- Immutable migration source snapshot: `legacy/task-source-2026-11-23.json`
- Generated local machine projection: `task.json` (derived from canonical TaskOS using `tools/sync-task-state.mjs`)
- Generated human-readable projection: `TASKS.md` (derived view; not an independent lifecycle authority)

## Start here

1. Open the repository and read `AUTONOMOUS_EXECUTION.md` completely.
2. Read `PROJECT_CHARTER.md`, `AUDIT_BASELINE.md`, `ARCHITECTURE.md`, `VISUAL_BIBLE.md`, and `ASSET_PACK_SPEC.md`.
3. Read `ADDON_ASSET_MATRIX.md`, `ANIMATION_RUNTIME.md`, `CREATIVE_LAB.md`, and `QA_ACCEPTANCE.md`.
4. Revalidate current `dev` HEAD and workspace. The repository may have moved since pack creation.
5. Load the `visual-universe` project records from canonical `docs/tasks/tasks.json`; execute tasks in dependency order. Do not edit `task.json`, `TASKS.md` or individual task cards as independent status sources. Verify projections with `node tools/sync-task-state.mjs --check`; regenerate only from the canonical registry with `node tools/sync-task-state.mjs`.
6. Work autonomously on non-blocked tasks; do not ask broad questions. Only request human approval at the explicit approval gates.

## Current delivery — 2026-11-25

The first production Moon City homepage slice is implemented. The canonical layered environment, responsive rules, anonymous `crew-01` idle loop, static/reduced-motion fallback, provenance and owner authorization are recorded in the repository. W9-001 through W9-005 are complete in canonical TaskOS.

W9-006 remains blocked: the latest official 42-case Board visual matrix reports 33 passed and 9 failures (7 Firefox crashes/baselines, 2 WebKit dashboard baselines). The Moon City homepage passes Chromium/WebKit; Firefox Axe crashes reproducibly at mobile. Save-Data passes all three browsers. W10-001 through W10-003 are complete with production cold-load measurements, bounded scene caching, and reduced-motion/Save-Data behavior. W10-004 records homepage visual/a11y evidence and remains blocked by W9-006. Signals and Archive remain catalog-only concepts because the product routes and data contracts do not exist. See the [W9 scene evidence](evidence/W9-001-W9-004-hero-route-blockers.md), [operational gate report](evidence/W9-005-W9-006-operational-coverage.md), and W10 evidence for [performance](evidence/W10-001-runtime-performance-baseline.md), [loading/cache](evidence/W10-002-scene-loading-and-cache.md), [motion modes](evidence/W10-003-motion-and-save-data.md), and [homepage visual/a11y](evidence/W10-004-home-accessibility-matrix.md).

This pack remains the architecture, execution backlog, validation contract and production handoff for the broader visual universe. Task cards, `task.json`, and `TASKS.md` are generated projections; the repository-wide `docs/tasks/tasks.json` remains the only lifecycle authority.

## Main architectural rule

Evolve `packages/assets` and `packages/ui`; preserve the ORM/addon architecture. Do not create one asset package per addon. Keep static visual assets out of ORM migrations/seeds. Backend and ORM packages must remain presentation-agnostic.

## Delivered first visible milestone

One approved Moon City homepage scene: independent visual layers, one consistent anonymous character, controlled environment motion, bounded camera/parallax, reduced-motion fallback, and responsive composition. Continue expansion only on existing product routes and supported data contracts.
