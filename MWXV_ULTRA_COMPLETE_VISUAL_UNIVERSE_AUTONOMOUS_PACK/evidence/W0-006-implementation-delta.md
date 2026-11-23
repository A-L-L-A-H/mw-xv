# W0-006 — Historical implementation delta

> **Historical evidence snapshot.** This report was captured against the earlier `dev` HEAD below. Its task-graph source-of-truth and deliverables claims are superseded by the 2026-11-23 TaskOS recovery audit. The immutable current source snapshot contains arrays for all 109 `deliverables` values; current lifecycle ownership and migration evidence are documented in `docs/tasks/RECOVERY-INVENTORY.md`. Do not use this report's old `task.json` authority statement as current execution guidance.


Audit basis: `dev` HEAD `e768079e4551c2f88b528f2a59acfc09ade4ba3e`, the preserved local changes present at audit time, the source reports `W0-001` through `W0-005`, and the project specifications. No existing feature was replaced.

## Reuse and gaps

- `packages/assets` and its v1 `manifest.json` / `licenses.json` remain the single canonical asset/provenance owners. Existing generators and 179 registered assets are real. There are nine registered artwork variants, but they do not constitute separable Moon City layers, a continuity-reviewed character sheet, or a production scene/idle clip.
- The untracked `raw_arts/` tree (363 files) includes masters, derivatives and generated image files but has not been linked to per-asset provenance, reviewed for content, or registered. It is not used as production evidence or imported into package exports.
- `packages/ui` already has a broad semantic component/effect set, reduced-motion rules, muted-by-default sound preference, and shared visibility behavior. Reuse these APIs; do not add a parallel Manga/FX/component family.
- `apps/board` already depends on Motion and provides a static responsive homepage hero. It is the only product scene consumer. Keep the first scene orchestration in Board and shared rendering contracts in UI; the evidence does not justify extracting a scene runtime package.
- `apps/ui-catalog` is the existing catalog. Extend it for the Creative Lab rather than creating another app.
- The API registry contains 12 manifested addon domains and a separate `system-health` runtime module. The domain map records existing route boundaries and marks absent dedicated screens as absent. ORM/API must remain presentation-agnostic.
- The current application does not yet contain the requested layered Moon City scene, its reviewed character identity/turnaround, a loopable idle clip, or the requested scene lifecycle/fallback integration. Do not infer those from the existing static homepage artwork.

## Task-graph integrity correction

The task schema requires `deliverables` to be a string array, but all 109 `task.json` records currently store it as a scalar string. The generated `TASKS.md` and individual task documents consequently render each deliverable character as a separate bullet. Normalize the canonical field to a one-entry array and regenerate the human mirror from `task.json`; keep every task ID and dependency unchanged. Validate all dependency IDs and acyclicity after normalization.

## Execution decisions

- Keep existing package boundaries and generators. No duplicate package, addon, manifest, license inventory, or UI catalog is warranted.
- Preserve current Motion/CSS/SVG and the static hero path. Avoid optional animation engines and new runtime dependencies absent measured need and required approval.
- Do not reuse unreviewed `raw_arts/` content as shipped assets. Any later asset use requires visual review, provenance/license record and canonical manifest entry.
- The available image generator can be evaluated during asset tasks. The available Runway sound-effect generator is explicitly paid-plan gated; no credit-consuming call is authorized by the local environment contract. If unavailable, prepare the asset brief and block only that sound task.
- W1-001 canonical art direction, W3 pilot identity and W9 final hero visual remain human approval gates. Work can prepare reviewable candidates, but those checkpoints cannot be recorded as approved by the agent.

## Verification and evidence

- `pnpm assets:validate` — exit 0.
- `pnpm test:ui` — exit 0 after aligning the UI package engine assertion with the current `>=24` manifest floor; 59 tests passed and packed-consumer checks passed.
- `pnpm test:ui-catalog` — exit 0 on the isolated retry; 25 browser tests passed.
- `pnpm --filter @moonwitness/api build` — exit 0 (`tsc`).
- `pnpm --filter @moonwitness/board typecheck` — exit 0.
- `pnpm board:ui:check` — exit 0.
- `git diff --check` — exit 0 before the W0-006 evidence/task-state changes; rerun after synchronization.
- The canonical graph contains 109 unique IDs, every dependency resolves, and Kahn topological validation visits all 109 tasks (acyclic).
- `deliverables` was normalized to the schema-declared array for all 109 tasks; `TASKS.md` and all individual task docs were regenerated from the canonical records. `node MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/tools/sync-task-state.mjs --check` passes.
- `git diff --cached --check` — exit 0 after task-board generation.
