# Autonomous Execution Contract

## Mission

Implement the project described in this pack in the existing `A-L-L-A-H/mw-xv` repository, starting from the latest `dev` branch. Finish real code, assets, docs and tests—not only plans or mock screenshots.

## Mandatory first actions

1. `git status --short --branch`
2. `git rev-parse HEAD`
3. Confirm root is the expected repository and current branch is `dev`.
4. Read current `package.json`, `pnpm-workspace.yaml`, relevant package manifests, latest changes and CI workflow.
5. Compare current source to `AUDIT_BASELINE.md`. Pack baseline SHA is `0b89060602c659efdd5e9e1a12c166fee237418e`; it is a starting point, not permission to overwrite later work.
6. Preserve all user changes and dirty files. Never reset, clean, stash-drop, force checkout or overwrite unknown work.
7. Reconcile tasks against current code. If a capability is already implemented, verify it and mark the task `skipped` with evidence or `done` only if all acceptance criteria are actually met. Do not duplicate it.

## Autonomous execution loop (finite)

For each ready task:

1. Verify all dependencies are `done` or explicitly accepted as non-blocking.
2. Read the task, relevant source, tests and package ownership boundaries.
3. Make the smallest coherent implementation that meets the task.
4. Add/update focused tests and docs in the same task.
5. Run focused checks first; then relevant package/consumer gates.
6. Inspect the actual diff for regressions, generated files, exports, bundle implications and unintended changes.
7. Record evidence in the task object and `evidence/` (command, exit code, artifact path, SHA).
8. Mark `done` only when every acceptance criterion passes. Otherwise mark `blocked` with exact reason and continue independent work.
9. Commit coherent completed batches; do not create empty commits.

**Bounded retry policy:** at most 2 implementation attempts per task and 1 retry per failed gate after diagnosing a concrete cause. If still failing, mark `blocked`, preserve logs, and move on. Never repeat the same command endlessly or claim the whole program is complete.

## Multi-agent policy

- Maximum 4 agents.
- Use roles: architect, asset-pipeline engineer, character/environment artist, animation engineer, UI engineer, addon-domain mapper, QA/performance, technical writer.
- One writer at a time for `manifest.json`, `licenses.json`, package manifests/lockfile, global tokens/CSS, shared docs and task state.
- Parallelize only after contracts are frozen and file scopes are disjoint.
- Each agent receives one task ID, allowed file scope, dependencies, acceptance criteria and verification command. No open-ended assignments.
- The orchestrator owns dependency tracking, integration, conflict resolution and final evidence.
- Do not have agents create overlapping features or duplicate assets.

## Repository and branch safety

- Target `dev` only. Never push directly to `main` or `master`.
- Do not bypass branch protection, required reviews, CI or repository rules.
- Avoid unnecessary branches. If `dev` is protected against direct push, use only the repository-approved PR process when allowed. If authorization/workflow is unavailable, stop pushing and report the exact blocker; do not weaken protections.
- Do not force-push or rewrite shared history.
- Do not create duplicate GitHub issues. Use this task graph as the execution source unless the repository owner explicitly requests issue synchronization.
- Do not bump package versions per task. Follow existing release/version policy for substantive release batches.

## Architecture boundaries

- `packages/assets` owns source and generated media, font/audio binaries, canonical manifest, provenance and asset build/validation tooling.
- `packages/ui` owns visual tokens, typed primitives, reusable FX, accessibility and presentation contracts.
- The `apps/board` app may orchestrate Motion-based scene behavior using its existing dependency, subject to current source verification and budget tests.
- Only extract a scene runtime package if a stable shared API and multiple real consumers justify it. Do not create speculative packages.
- ORM/addon packages own business data, models, views, permissions and domain semantics—not visual files, sprite sheets or UI presentation.
- `apps/api` serves domain/API lifecycle. It must not import browser rendering or image-generation runtimes.
- Static project artwork is build-time/package content, not a DB seed, migration, user attachment or ORM model.
- User-uploaded media remains on existing attachment/storage provider paths and permissions.
- Do not add visual dependencies to all apps. Add only to actual consumers.

## Asset and IP safety

- Do not copy copyrighted anime characters, franchise marks, screenshots, music, sound effects or proprietary assets.
- Reference images define broad art direction only; create original MoonWitness material.
- Every asset must have creator/source/method/license/terms/provenance and stable asset ID/path.
- Verify current licenses for external fonts, software SDKs, art, sound and model formats before distribution.
- AI-generated assets are not automatically accepted: inspect anatomy, artifacts, continuity, text contamination, alpha edges, focal crops and style consistency.
- No text, controls, stats, dates, logos or dynamic product values inside generated artwork.
- Do not invent real users, crew profiles, maps, counts, signals, archive entries or production routes.
- Never create visual depictions of Allah or sacred figures; use textual references only when the product content calls for them.

## Runtime and performance safety

- Prefer the existing Motion + CSS/SVG foundation for the first vertical slice.
- Sprite sequences are the first portable frame-by-frame fallback.
- Rive/Live2D/GSAP/Pixi/Three/WebGL are optional investigations, never mandatory by assumption. Paid/proprietary SDK selection needs explicit human approval and license/bundle review.
- Do not use video/GIF as a substitute for every animation. Use them only when technically justified and measured.
- Avoid permanent motion on operational screens. Scene runtime must pause offscreen, dispose resources, obey reduced-motion and have static fallbacks.
- No scroll hijacking, autoplay sound or motion that blocks controls/content.
- Preserve current budgets. If a budget is insufficient, measure, explain and propose a narrowly scoped change; do not inflate thresholds to hide regressions.

## Task state and evidence

The repository owner approved the TaskOS migration on 2026-11-23. The validated canonical registry at `docs/tasks/tasks.json` contains 679 records across two projects; 109 belong to `visual-universe`. The original Visual Universe source is preserved immutably at `legacy/task-source-2026-11-23.json`, while the prior 1,358-record TaskOS snapshot is archived at `docs/tasks/archives/tasks-legacy-1358-2026-11-23.json`. Pack configuration lives in `pack-manifest.json`. The Moon City homepage slice is delivered; W9-001–W9-005 and W10-001–W10-003 are done. W9-006 remains blocked by 9 remaining failures (7 Firefox, 2 WebKit) (official matrix 33/42); W10-004 is dependent on that gate. See the dated W9/W10 evidence reports for exact outcomes. `task.json`, `TASKS.md`, and `tasks/<phase>/*.md` are generated local projections. Do not edit their status or dependency fields directly. Rebuild them from canonical TaskOS with `node docs/bundles/visual-universe-pack/tools/sync-task-state.mjs` after the registry validates.

Allowed statuses: `todo`, `in_progress`, `blocked`, `done`, `skipped`.

Every `done` task must include:

- Actual commands executed and exit code.
- Test/report/screenshot artifact paths where applicable.
- Commit SHA if committed.
- Notes on any acceptance criterion requiring human review.

`skipped` requires a reason plus evidence that capability is already present or out of scope. `blocked` requires exact blocker and next action. A green build does not prove subjective art acceptance.

## Definition of complete

Only report completion when all applicable tasks are done or honestly blocked/skipped, all quality gates relevant to changed areas pass, asset/license inventory is valid, first immersive scene works with reduced-motion fallback, domain coverage is evidenced, and docs/changelog/handoff are updated. List residual gaps explicitly.
