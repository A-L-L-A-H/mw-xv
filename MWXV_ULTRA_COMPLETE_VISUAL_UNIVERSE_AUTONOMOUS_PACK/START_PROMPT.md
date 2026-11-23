# ONE-SHOT START PROMPT — MoonWitness XV Visual Universe

You are the autonomous implementation lead for `A-L-L-A-H/mw-xv`. Your job is to execute this project in the checked-out repository—not merely summarize this pack or generate another plan.

**Read `AUTONOMOUS_EXECUTION.md` first, then the canonical registry `docs/tasks/tasks.json` and all project specifications.** Filter TaskOS records to project `visual-universe`; pack-local `task.json` and `TASKS.md` are generated projections only. The global TaskOS registry currently contains a valid 1,358-record legacy snapshot; 861 entries still cite root `todo.md`, now only a pointer. A source-backed 627-record migration candidate is defined but has not yet been exported, reconciled against the legacy records, or approved as canonical. Do not start autonomous implementation, edit mirrored lifecycle state, or run the projection script until exact-SHA CI passes, the migration diff is reviewed, the legacy snapshot is preserved, and canonical migration is explicitly approved. Target branch is `dev`; revalidate the exact latest HEAD.

Execute the 109 small tasks in topological dependency order. Start with W0 source revalidation. For every ready task after TaskOS recovery, inspect source, implement the smallest complete change, add tests/docs, run focused checks, inspect the diff, record evidence and update the canonical TaskOS task record. Then regenerate pack-local `task.json`, `TASKS.md` and task cards from TaskOS using `node tools/sync-task-state.mjs`. Continue automatically through all independent and unblocked work. Do not stop after W0, architecture design, scaffolding or a status report.

Use up to four agents only for disjoint tasks after shared contracts are frozen. Never let parallel agents edit the same canonical manifest, license file, lockfile, global token/CSS or task state. No duplicate package, addon, inventory or UI catalog. Preserve existing implementations and the latest dev changes.

Create original production assets (character sheets, layered environments, props, animation clips, scene compositions, FX and soundscape) using the image/art/audio tools actually available in this local environment. Inspect every result and register provenance. If a required generator/tool is unavailable, write a production-ready brief and mark only that asset task blocked; do not create fake placeholder binaries or claim the asset exists. Continue other independent tasks.

Build the first real Moon City 2.5D homepage scene with layered sky/moon/cloud/city/foreground, one consistent character, a loopable idle clip, bounded camera/parallax, an anime transition/FX, responsive crops and a meaningful static/reduced-motion fallback. Then cover all 12 active addon domains against real models/routes/permissions. Keep ORM/API presentation-agnostic. Use the existing `packages/assets`, `packages/ui` and `apps/ui-catalog`; extract a scene runtime package only when multiple real consumers justify it.

Do not add Rive, Live2D, GSAP, Pixi, Three/WebGL, paid SDKs or new runtime dependencies by default. Prove need, license, bundle and performance first; require human approval for proprietary/paid engine selection, canonical art direction, pilot character identity and final hero acceptance.

Do not invent production routes, real crew/users, maps, metrics, signals or archive data. Do not copy copyrighted anime IP or unlicensed music. Do not depict Allah or sacred figures. Respect existing brand, permissions, real data semantics, accessibility, reduced motion, audio consent and package budgets.

Work with finite retries: maximum two attempts per task and one retry per failing gate after diagnosis. If still failing, mark blocked with evidence and continue other work. Never loop endlessly. Never mark done without passing acceptance criteria and evidence.

Commit coherent verified batches on `dev` when allowed. Never force push, bypass branch protection or push `main/master`. If direct `dev` push is rejected, use only an authorized repository PR flow; otherwise stop and report the exact blocker. Do not create duplicate GitHub issues.

Final handoff must list task counts by status, commit/PR details, generated asset inventory, package exports, checks actually executed, visual/performance evidence, blocked/approval-required items and remaining gaps. Be honest: do not claim a complete anime asset pack until the actual assets are produced, reviewed, registered, packaged and tested.
