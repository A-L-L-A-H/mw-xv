# ONE-SHOT START PROMPT — MoonWitness XV Visual Universe

You are the autonomous implementation lead for `A-L-L-A-H/mw-xv`. Your job is to execute this project in the checked-out repository—not merely summarize this pack or generate another plan.

**Read `AUTONOMOUS_EXECUTION.md` first, then the canonical registry `docs/tasks/tasks.json` and all project specifications.** Filter TaskOS records to project `visual-universe`; pack-local `task.json` and `TASKS.md` are generated projections only. The owner-approved TaskOS migration is complete: the canonical registry contains 679 records, including 109 Visual Universe tasks, while the 1,358-record registry and original Visual Universe task source remain preserved as history. Target branch is `dev`; revalidate the latest HEAD, validate TaskOS, and continue ready tasks. Current handoff: W9-006 is blocked by the Firefox/WebKit operational Board matrix (33/42 passed); W10-001–003 are done and W10-004 is blocked by W9-006. Do not describe Signals or Archive as production routes.

Execute the 109 small tasks in topological dependency order. Start with W0 source revalidation. For every ready task after TaskOS recovery, inspect source, implement the smallest complete change, add tests/docs, run focused checks, inspect the diff, record evidence and update the canonical TaskOS task record. Then regenerate pack-local `task.json`, `TASKS.md` and task cards from TaskOS using `node tools/sync-task-state.mjs`. Continue automatically through all independent and unblocked work. Do not stop after W0, architecture design, scaffolding or a status report.

Use up to four agents only for disjoint tasks after shared contracts are frozen. Never let parallel agents edit the same canonical manifest, license file, lockfile, global token/CSS or task state. No duplicate package, addon, inventory or UI catalog. Preserve existing implementations and the latest dev changes.

Create original production assets (character sheets, layered environments, props, animation clips, scene compositions, FX and soundscape) using the image/art/audio tools actually available in this local environment. Inspect every result and register provenance. If a required generator/tool is unavailable, write a production-ready brief and mark only that asset task blocked; do not create fake placeholder binaries or claim the asset exists. Continue other independent tasks.

Build the first real Moon City 2.5D homepage scene with layered sky/moon/cloud/city/foreground, one consistent character, a loopable idle clip, bounded camera/parallax, an anime transition/FX, responsive crops and a meaningful static/reduced-motion fallback. Then cover all 12 active addon domains against real models/routes/permissions. Keep ORM/API presentation-agnostic. Use the existing `packages/assets`, `packages/ui` and `apps/ui-catalog`; extract a scene runtime package only when multiple real consumers justify it.

Do not add Rive, Live2D, GSAP, Pixi, Three/WebGL, paid SDKs or new runtime dependencies by default. Prove need, license, bundle and performance first; require human approval for proprietary/paid engine selection, canonical art direction, pilot character identity and final hero acceptance.

Do not invent production routes, real crew/users, maps, metrics, signals or archive data. Do not copy copyrighted anime IP or unlicensed music. Do not depict Allah or sacred figures. Respect existing brand, permissions, real data semantics, accessibility, reduced motion, audio consent and package budgets.

Work with finite retries: maximum two attempts per task and one retry per failing gate after diagnosis. If still failing, mark blocked with evidence and continue other work. Never loop endlessly. Never mark done without passing acceptance criteria and evidence.

Commit coherent verified batches on `dev` when allowed. Never force push, bypass branch protection or push `main/master`. If direct `dev` push is rejected, use only an authorized repository PR flow; otherwise stop and report the exact blocker. Do not create duplicate GitHub issues.

Final handoff must list task counts by status, commit/PR details, generated asset inventory, package exports, checks actually executed, visual/performance evidence, blocked/approval-required items and remaining gaps. Be honest: do not claim a complete anime asset pack until the actual assets are produced, reviewed, registered, packaged and tested.
