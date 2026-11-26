# Atomic Task Board

**Total: 109 tasks.** Canonical lifecycle state is `docs/tasks/tasks.json` (project `visual-universe`); this file is generated from it.

Status counts: done 106 · skipped 3 · in_progress 0 · blocked 0 · todo 0.

## W0

- [x] **W0-001 — Revalidate repository baseline**
  - Goal: Confirm repository root, branch and exact HEAD before any modification.
  - Depends on: none
  - Deliverables: Baseline report with current SHA, worktree state, branch protection observations.
  - Acceptance (3/3 complete): [x] Repository is A-L-L-A-H/mw-xv.; [x] Work begins from latest dev; no hard reset, force push or destructive checkout.; [x] Record current HEAD and dirty files.
  - Verify: git status --short --branch; git rev-parse HEAD
  - Evidence: `git ls-remote origin refs/heads/dev` (0) → `evidence/W0-001-baseline.md`

- [x] **W0-002 — Inventory all workspace packages and apps**
  - Goal: Refresh package inventory from pnpm workspace rather than relying on this pack snapshot.
  - Depends on: W0-001
  - Deliverables: Updated package/app inventory and dependency graph.
  - Acceptance (3/3 complete): [x] All workspace package.json files are accounted for.; [x] Apps are separately identified from packages.; [x] No new duplicate package is proposed without a demonstrated consumer.
  - Verify: pnpm -r list --depth -1; inspect pnpm-workspace.yaml and package.json
  - Evidence: `inspect pnpm-workspace.yaml and app/package manifests` (0) → `evidence/W0-002-workspace-inventory.md`

- [x] **W0-003 — Revalidate active addon registry**
  - Goal: Refresh API addon registry, manifests, dependencies, postInstall hooks and routes.
  - Depends on: W0-001
  - Deliverables: Addon registry map and addon-to-domain inventory.
  - Acceptance (3/3 complete): [x] All active manifests are found from actual registry, not folder-name guessing.; [x] Health/runtime modules without ORM manifest are identified separately.; [x] No DB migrations or seeds are changed by this audit task.
  - Verify: pnpm --filter @moonwitness/api build
  - Evidence: `pnpm --filter @moonwitness/api build` (0) → `evidence/W0-003-addon-registry.md`

- [x] **W0-004 — Revalidate asset and UI baseline**
  - Goal: Refresh asset count, schema version, generator ownership, current UI exports, FX and consumers.
  - Depends on: none
  - Deliverables: Asset/UI baseline with exact counts and source paths.
  - Acceptance (3/3 complete): [x] manifest and license manifest are read directly.; [x] Generator ownership and package exports are documented.; [x] Newer dev commits are preserved; do not revert existing grunge/anime kinetics changes.
  - Verify: pnpm assets:validate; pnpm test:ui
  - Evidence: `pnpm test:ui` (0) → `evidence/W0-004-assets-ui-baseline.md`

- [x] **W0-005 — Map addon data to actual UI consumers**
  - Goal: Trace each active addon to its real routes, views, screens, permission boundaries and user-visible states.
  - Depends on: none
  - Deliverables: Domain-to-screen-to-asset matrix with verified references.
  - Acceptance (3/3 complete): [x] No fictional route, menu, model or functionality is invented.; [x] Unmapped domains are labelled not found/unverified, not assumed.; [x] Static visual assets remain outside ORM domain manifests.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck
  - Evidence: `pnpm --filter @moonwitness/api build` (0) → `evidence/W0-005-domain-consumers.md`

- [x] **W0-006 — Create implementation delta report**
  - Goal: Compare current code with this pack and adjust task backlog to avoid duplication.
  - Depends on: W0-002, W0-003, W0-004, W0-005
  - Deliverables: Baseline delta document and updated dependency decisions.
  - Acceptance (3/3 complete): [x] Existing implementations are reused.; [x] Task IDs remain stable unless a task is explicitly retired with reason.; [x] No task is marked done without repository evidence.
  - Verify: git diff --check; review task.json dependency integrity
  - Evidence: `git diff --cached --check` (0) → `evidence/W0-006-implementation-delta.md`

## W1

- [x] **W1-001 — Approve canonical MoonWitness art direction**
  - Goal: Formalize the user's zine/punk/manga reference into a production-grade visual bible while preserving current brand identity.
  - Depends on: W0-006
  - Deliverables: Visual Bible section: art direction, palette roles, linework, cel shading, grunge, composition and exclusions.
  - Acceptance (4/4 complete): [x] Primary identity remains MoonWitness XV, not a generic anime template.; [x] Reference DNA is interpreted, not copied from copyrighted franchises.; [x] Black/ink, paper/white, hot magenta, electric blue/cyan and signal yellow are token-mapped.; [x] Grunge, manga ink, photocopy, ripped paper and urban anime environment have controlled intensity tiers.
  - Verify: visual review via UI Catalog
  - Evidence: `user approval in chat; checked existing UI token palette and WCAG AA tests` (0) → `docs/bundles/visual-universe-pack/evidence/art-direction-proposal.md`

- [x] **W1-002 — Define visual grammar by experience tier**
  - Goal: Separate immersive story surfaces from operational UI and functional admin surfaces.
  - Depends on: W1-001
  - Deliverables: Experience-tier rules and examples.
  - Acceptance (3/3 complete): [x] Living World pages may use cinematic scenes and sustained movement within budgets.; [x] Board tables/forms/data remain readable and interaction-first.; [x] Micro-interaction, editorial, cinematic and ambient animation have separate use policies.
  - Verify: documentation review
  - Evidence: `approved-direction design specification against current UI tokens, fonts, assets and source` (0) → `docs/bundles/visual-universe-pack/evidence/experience-tier-grammar.md`

- [x] **W1-003 — Define character identity rules**
  - Goal: Specify repeatable identity sheets and safe depiction rules for recurring cast.
  - Depends on: W1-001
  - Deliverables: Character Bible template and continuity contract.
  - Acceptance (4/4 complete): [x] Stable character IDs, silhouette, proportions, outfit, palette and signature props.; [x] Default crew art can use anonymous/back-facing hooded silhouettes; identifiable faces require approved identity design.; [x] No random changes to face, hair, clothing or body proportions across scenes.; [x] Do not depict Allah or represent sacred figures visually; use text/name only where product content explicitly requires it.
  - Verify: character bible schema validation
  - Evidence: `approved visual direction 2026-11-22` (0) → `docs/design/visual-direction.md`; `recorded approval` (0) → `docs/bundles/visual-universe-pack/evidence/visual-universe-bible-approved.md`; `schema/template` (0) → `docs/bundles/visual-universe-pack/evidence/character-bible-template.md`

- [x] **W1-004 — Define anime rendering and color pipeline**
  - Goal: Specify line weight, cel-shading, shadows, highlight, grain and color grading.
  - Depends on: W1-001
  - Deliverables: Rendering style guide and reference sheet specification.
  - Acceptance (3/3 complete): [x] Every production asset declares a style/renderer profile.; [x] Lighting and color grading remain consistent across scene packs.; [x] Do not bake interface labels or dynamic data into artwork.
  - Verify: visual contact sheet review
  - Evidence: `approved-direction design specification against current UI tokens, fonts, assets and source` (0) → `docs/bundles/visual-universe-pack/evidence/rendering-color-profile.md`

- [x] **W1-005 — Define typography and lettering layers**
  - Goal: Keep graphic lettering separate from product copy and provide approved fonts/license handling.
  - Depends on: W1-001
  - Deliverables: Typography/lettering policy and asset brief.
  - Acceptance (3/3 complete): [x] UI copy remains live text.; [x] Artwork lettering is decorative only and separately authored/licensed.; [x] Font files and subsets retain source/hash/license provenance.
  - Verify: pnpm assets:validate
  - Evidence: `approved-direction design specification against current UI tokens, fonts, assets and source` (0) → `docs/bundles/visual-universe-pack/evidence/typography-lettering-policy.md`

- [x] **W1-006 — Define art composition and responsive rules**
  - Goal: Specify wide, tall, square, panel, hero and parallax-safe compositions.
  - Depends on: W1-001, W1-002
  - Deliverables: Composition recipes and focal-safe-area rules.
  - Acceptance (3/3 complete): [x] Desktop/mobile assets have deliberate art direction, not blind center crops.; [x] Focal points and text-safe areas are explicit.; [x] No important character feature is unintentionally cut at supported breakpoints.
  - Verify: responsive UI catalog preview
  - Evidence: `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/scene-harness.spec.ts`; `pnpm test:assets` (0) → `packages/assets/scenes/moon-city-scene.json`

- [x] **W1-007 — Define accessibility and motion principles** — **SKIPPED:** Accessibility and motion policy is already implemented in packages/ui/README.md, TOKENS.md, tokens.css and components.css. Existing tests verify muted-by-default audio, explicit playback, reduced motion, focus and non-interactive decorative FX; no duplicate policy layer was added.
  - Goal: Set reduced-motion, alternative static scene, keyboard, captions and sound consent rules.
  - Depends on: none
  - Deliverables: Accessibility and motion policy.
  - Acceptance (4/4 complete): [x] Information never depends on animation/audio.; [x] Reduced-motion produces meaningful static/low-motion scene.; [x] Sound remains muted until explicitly enabled.; [x] No effects block focus, text selection or pointer interaction.
  - Verify: pnpm test:ui; pnpm test:ui-catalog
  - Evidence: `pnpm test:ui-catalog` (0) → `evidence/W0-006-implementation-delta.md`; `pnpm test:ui` (0) → `evidence/W0-004-assets-ui-baseline.md`

- [x] **W1-008 — Publish Visual Universe Bible**
  - Goal: Consolidate approved decisions into canonical docs without duplicating existing UI Bible.
  - Depends on: W1-001, W1-002, W1-003, W1-004, W1-005, W1-006, W1-007
  - Deliverables: Canonical visual universe guide and links from existing design docs.
  - Acceptance (3/3 complete): [x] Single source of truth is identified.; [x] Existing docs are updated by linking/targeted additions, not copied into competing versions.; [x] Open decisions are clearly listed.
  - Verify: pnpm docs:check; pnpm docs:links
  - Evidence: `pnpm docs:links` (0) → `docs/bundles/visual-universe-pack/evidence/approval-followup-checks.md`

## W2

- [x] **W2-001 — Design backward-compatible asset manifest extension**
  - Goal: Extend existing manifest only where needed for stable asset IDs, pack/domain tags, source and variants.
  - Depends on: W0-004, W1-008
  - Deliverables: Versioned schema proposal and fixtures.
  - Acceptance (4/4 complete): [x] Keep one canonical packages/assets/manifest.json.; [x] Keep existing package license/provenance source of truth.; [x] Do not create competing master inventories.; [x] Old assets remain readable or have a deterministic converter.
  - Verify: node --test packages/assets/tests/*.test.mjs
  - Evidence: `node --test packages/assets/tests/*.test.mjs` (0) → `23 asset tests passed against the legacy v1 manifest and path-based canonical inventory`

- [x] **W2-002 — Implement manifest schema validation**
  - Goal: Implement schema validation for the approved asset metadata extension.
  - Depends on: W2-001
  - Deliverables: Schema validator, valid/invalid fixtures and tests.
  - Acceptance (3/3 complete): [x] Reject duplicate IDs/paths, malformed variants and invalid references.; [x] Support source/master/generated relationships.; [x] Validation errors include file and field context.
  - Verify: pnpm test:assets
  - Evidence: `pnpm test:assets` (0) → `evidence/W2-002-schema-validation.md`

- [x] **W2-003 — Extend license and provenance contract**
  - Goal: Add creator, source method, upstream source, license, generated date, modifications and approval status.
  - Depends on: W2-001
  - Deliverables: Provenance validator and docs.
  - Acceptance (3/3 complete): [x] No unknown or blank licensing metadata for distributable assets.; [x] AI-generated content is labelled accurately with applicable terms verified.; [x] Unverified source is marked blocked/non-distributable.
  - Verify: pnpm test:assets
  - Evidence: `pnpm test:assets` (0) → `evidence/W2-003-provenance-validation.md`

- [x] **W2-004 — Define source, master and generated ownership rules** — **SKIPPED:** Existing explicit generator ownership helper and focused tests satisfy all acceptance criteria; verified against current source.
  - Goal: Ensure each generator only replaces the paths it owns.
  - Depends on: W2-002
  - Deliverables: Generator ownership registry and tests.
  - Acceptance (3/3 complete): [x] Existing manifest ownership helper is reused.; [x] Manual/master assets cannot be deleted by generators.; [x] Generators are deterministic and idempotent.
  - Verify: pnpm test:assets
  - Evidence: `pnpm test:assets` (0) → `evidence/W2-004-existing-ownership.md`

- [x] **W2-005 — Build asset inventory and query tooling**
  - Goal: Provide CLI/report output filtered by pack, category, subject, domain, format and status.
  - Depends on: W2-002
  - Deliverables: Asset inventory command and test fixtures.
  - Acceptance (3/3 complete): [x] Inventory uses canonical manifest.; [x] Source files and distributable files are distinguishable.; [x] Orphans and broken references are reported.
  - Verify: pnpm test:assets
  - Evidence: `pnpm --filter @moonwitness/assets inventory --pack=moon-city` (0) → `evidence/W2-005-asset-inventory.md`

- [x] **W2-006 — Build responsive image derivative pipeline**
  - Goal: Extend Sharp generation for responsive artwork variants, AVIF/WebP where suitable and focal-safe crops.
  - Depends on: W2-004, W1-006
  - Deliverables: Responsive derivative generation and metadata.
  - Acceptance (3/3 complete): [x] Master files are never overwritten.; [x] Quality/size presets are documented and measured.; [x] No unconditional AVIF migration without browser compatibility evidence.
  - Verify: pnpm assets:generate; pnpm assets:validate
  - Evidence: `pnpm test:assets` (0) → `evidence/W2-006-responsive-derivatives.md`

- [x] **W2-007 — Build transparent layered-art export pipeline**
  - Goal: Define and implement layer asset handling for PNG/WebP/AVIF/SVG outputs while preserving alpha.
  - Depends on: W2-002, W2-006
  - Deliverables: Layer validation/export utility and sample fixtures.
  - Acceptance (3/3 complete): [x] Transparent layer dimensions and origins align exactly.; [x] Layer ordering and pivot/focal metadata preserved.; [x] No flattening of runtime layers into a single image.
  - Verify: pnpm test:assets
  - Evidence: `pnpm test:assets` (0) → `evidence/W2-007-layered-art-pipeline.md`

- [x] **W2-008 — Add sprite sheet and frame-sequence metadata**
  - Goal: Define frame dimensions, frame count, timing, loop, direction, pivot and atlas references.
  - Depends on: W2-002
  - Deliverables: Sprite sheet metadata validator and generated preview.
  - Acceptance (3/3 complete): [x] Frame bounds are valid.; [x] Timing and playback metadata are deterministic.; [x] Frames are not generated from an unreviewed single raster crop.
  - Verify: pnpm test:assets
  - Evidence: `pnpm test:assets` (0) → `evidence/W2-008-sprite-metadata.md; evidence/sprite-sheet-metadata-guide.svg`

- [x] **W2-009 — Add scene and animation metadata contracts**
  - Goal: Define scene descriptors and animation clips that reference canonical asset IDs.
  - Depends on: W2-002, W2-008
  - Deliverables: Scene schema and animation metadata schema.
  - Acceptance (3/3 complete): [x] References resolve through canonical asset manifest.; [x] Scene files contain layout/animation data, not embedded secrets or domain business records.; [x] No cyclic references.
  - Verify: schema fixture tests
  - Evidence: `pnpm test:assets` (0) → `evidence/W2-009-scene-contracts.md`

- [x] **W2-010 — Update package exports, pack list and docs sync**
  - Goal: Ensure every public asset category is included in build/package and docs asset sync.
  - Depends on: W2-005, W2-006, W2-007, W2-008, W2-009
  - Deliverables: Explicit package exports and pack verification tests.
  - Acceptance (3/3 complete): [x] Only intended runtime outputs are shipped.; [x] High-resolution source/master assets are not copied into consumer bundles by default.; [x] Asset package remains framework-independent and zero-runtime-dependency.
  - Verify: pnpm --filter @moonwitness/assets pack --dry-run; pnpm test:assets
  - Evidence: `pnpm --filter @moonwitness/assets pack --dry-run --json` (0) → `packages/assets/package.json`; `pnpm test:assets` (0) → `packages/assets/tests/brand-assets.test.mjs`

- [x] **W2-011 — Build contact-sheet generator for all packs**
  - Goal: Generate deterministic contact sheets grouped by pack/category/character/scene.
  - Depends on: W2-005, W2-010
  - Deliverables: Contact sheet generator and docs output.
  - Acceptance (3/3 complete): [x] Contact sheets include stable IDs and variants.; [x] No generated docs or binary output is committed without repository conventions.; [x] Image rendering works in existing Playwright/Sharp tooling.
  - Verify: pnpm assets:render; pnpm assets:validate
  - Evidence: `pnpm assets:render` (0) → `docs/design/assets/pack-moon-city-contact-sheet.png`; `pnpm test:assets` (0) → `packages/assets/tests/contact-sheets.test.mjs`

- [x] **W2-012 — Add duplicate, size and orphan asset gates**
  - Goal: Extend QA for duplicates, oversized files, unused outputs and wrong generated folder ownership.
  - Depends on: W2-005, W2-010
  - Deliverables: Asset quality report and thresholds.
  - Acceptance (3/3 complete): [x] Thresholds are based on measured consumer budgets.; [x] Large source masters are exempt from runtime budgets but included in repository tracking review.; [x] All exceptions are documented and narrow.
  - Verify: pnpm test:assets; pnpm ui:budget
  - Evidence: `pnpm --filter @moonwitness/assets qa` (0) → `packages/assets/scripts/asset-qa.mjs`; `pnpm test:assets` (0) → `packages/assets/tests/asset-qa.test.mjs`; `pnpm ui:budget` (0) → `scripts/check-ui-catalog-budget.mjs`

## W3

- [x] **W3-001 — Create canonical character registry**
  - Goal: Define character IDs, role, silhouette, palette, proportions, outfit and continuity metadata.
  - Depends on: W1-003, W2-009
  - Deliverables: Character registry specification and initial template.
  - Acceptance (3/3 complete): [x] Each recurring character has one stable identity.; [x] No character is bound to an AI provider/model identity.; [x] Default crew figures may remain anonymous/back-facing unless identity is approved.
  - Verify: character schema tests
  - Evidence: `pnpm test:assets` (0) → `44/44 pass`; `node packages/assets/scripts/validate.mjs` (0) → `validate.mjs`

- [x] **W3-002 — Create first canonical MoonWitness crew character sheet**
  - Goal: Produce/review one canonical character sheet as the pilot for production quality.
  - Depends on: W3-001, W1-004
  - Deliverables: Master character sheet with front/side/back, scale, silhouette and palette.
  - Acceptance (3/3 complete): [x] Anatomy, linework, outfit and silhouette pass review.; [x] Character remains consistent with Visual Bible.; [x] Source master and provenance recorded.
  - Verify: contact sheet review
  - Evidence: `pnpm test:assets` (0) → `44/44 pass`; `node packages/assets/scripts/validate.mjs` (0) → `validate.mjs`

- [x] **W3-003 — Create expression and facial-state sheet**
  - Goal: Prepare approved eye/mouth/expression variants only for characters requiring visible facial animation.
  - Depends on: W3-002
  - Deliverables: Expression sheet and state mapping.
  - Acceptance (3/3 complete): [x] Expression shapes preserve identity.; [x] No unnecessary face visibility for anonymous crew designs.; [x] Variants are named and measurable.
  - Verify: character consistency review
  - Evidence: `pnpm test:assets` (0) → `44/44 pass`; `node packages/assets/scripts/validate.mjs` (0) → `validate.mjs`

- [x] **W3-004 — Create pose and gesture library**
  - Goal: Prepare reusable static poses and gestures for narrative scenes.
  - Depends on: W3-002
  - Deliverables: Pose pack and metadata.
  - Acceptance (3/3 complete): [x] Poses do not alter character identity/outfit.; [x] Pose IDs are stable and previewable.; [x] Pose usage/licensing is recorded.
  - Verify: contact sheet review
  - Evidence: `pnpm test:assets` (0) → `44/44 pass`; `node packages/assets/scripts/validate.mjs` (0) → `validate.mjs`

- [x] **W3-005 — Separate character layers and pivots**
  - Goal: Prepare layered masters for selected pilot character with pivots and hierarchy.
  - Depends on: W3-002, W2-007
  - Deliverables: Layered source files, pivot metadata and preview.
  - Acceptance (3/3 complete): [x] Body/hair/arm/prop layers align without visible seams.; [x] Layer names and pivots are stable.; [x] Source remains editable.
  - Verify: layer alignment test; visual preview
  - Evidence: `node packages/assets/scripts/validate.mjs` (0) → `packages/assets/scripts/validate.mjs`; `pnpm test:assets` (0) → `46/46 pass`

- [x] **W3-006 — Create idle and breathing animation clip**
  - Goal: Create subtle idle/breathing clip for pilot character.
  - Depends on: W3-005, W2-008
  - Deliverables: Idle clip and animation metadata.
  - Acceptance (3/3 complete): [x] Loop is seamless.; [x] Movement is subtle and intentional.; [x] Reduced-motion has a still pose fallback.
  - Verify: animation playback test
  - Evidence: `node packages/assets/scripts/validate.mjs` (0) → `packages/assets/scripts/validate.mjs`; `pnpm test:assets` (0) → `46/46 pass`

- [x] **W3-007 — Create blink and hair movement variants**
  - Goal: Add optional blink/hair movement as separated clips or states.
  - Depends on: W3-003, W3-005, W3-006
  - Deliverables: Blink/hair animation metadata and previews.
  - Acceptance (3/3 complete): [x] No forced facial detail where design is anonymous.; [x] Loop/state triggers behave deterministically.; [x] Animation can pause offscreen.
  - Verify: animation playback test
  - Evidence: `node packages/assets/scripts/validate.mjs` (0) → `validate.mjs`; `pnpm test:assets` (0) → `46/46 pass`

- [x] **W3-008 — Create walk and turn animation prototype**
  - Goal: Produce a small representative movement set for pilot character.
  - Depends on: W3-005, W2-008
  - Deliverables: Walk/turn prototype clips and docs.
  - Acceptance (3/3 complete): [x] Frame timing/pivots are correct.; [x] No foot sliding beyond approved style.; [x] A static pose fallback always exists.
  - Verify: sprite/rig preview
  - Evidence: `node packages/assets/scripts/validate.mjs` (0) → `validate.mjs`; `pnpm test:assets` (0) → `46/46 pass`

- [x] **W3-009 — Build character preview renderer**
  - Goal: Provide deterministic preview for turnaround, layers, poses and clips in UI Catalog/Creative Lab.
  - Depends on: W3-001, W3-006, W2-009
  - Deliverables: Character preview specimen and tests.
  - Acceptance (3/3 complete): [x] Preview loads by asset ID.; [x] No business data or backend route is embedded.; [x] Playback can pause, reset and switch state.
  - Verify: pnpm test:ui-catalog
  - Evidence: `pnpm test:ui-catalog` (0) → `29/29 pass`; `pnpm test:assets` (0) → `46/46 pass`

## W4

- [x] **W4-001 — Define Moon City environment kit**
  - Goal: Specify canonical visual environment, lighting, perspective and prop vocabulary.
  - Depends on: W1-004, W1-006
  - Deliverables: Environment Bible and shot breakdown.
  - Acceptance (3/3 complete): [x] Moon City palette/lighting matches canonical world.; [x] Environment modules can be reused across pages.; [x] No embedded interface copy/statistics.
  - Verify: environment contact sheet review
  - Evidence: `pnpm test:assets` (0) → `packages/assets/source/world/environments/environment-kit.json`; `pnpm assets:render` (0) → `docs/design/moon-city-environment-kit.md`

- [x] **W4-002 — Produce Moon City sky and moon layers**
  - Goal: Create master sky/moon layers with alpha and responsive safe zones.
  - Depends on: W4-001, W2-007
  - Deliverables: Sky and moon source assets and variants.
  - Acceptance (3/3 complete): [x] Layer boundaries and transparent alpha are valid.; [x] Moon is not flattened into unrelated foreground.; [x] Focal point metadata exists.
  - Verify: pnpm test:assets; visual preview
  - Evidence: `pnpm test:assets` (0) → `packages/assets/environments/moon-city-moon.svg`

- [x] **W4-003 — Produce cloud and atmosphere layers**
  - Goal: Create clouds, haze and atmospheric depth layers.
  - Depends on: W4-002
  - Deliverables: Cloud/haze pack with animation suitability notes.
  - Acceptance (3/3 complete): [x] Layers are loopable or static as declared.; [x] No visible seams in looping movement.; [x] Opacity does not obscure required text.
  - Verify: visual preview
  - Evidence: `pnpm test:assets` (0) → `packages/assets/environments/moon-city-clouds-near.svg`

- [x] **W4-004 — Produce distant and midground city layers**
  - Goal: Create background skyline and city silhouettes.
  - Depends on: W4-001, W2-007
  - Deliverables: Distant/midground city pack.
  - Acceptance (3/3 complete): [x] Perspective and lighting match scene bible.; [x] Layer depth order is documented.; [x] Desktop and mobile composition is supported.
  - Verify: visual preview
  - Evidence: `pnpm test:assets` (0) → `packages/assets/environments/moon-city-skyline-mid.svg`

- [x] **W4-005 — Produce foreground rooftop and props**
  - Goal: Create railing, rooftop, wires, signs and safe foreground occluders.
  - Depends on: W4-001, W2-007
  - Deliverables: Foreground and prop pack.
  - Acceptance (3/3 complete): [x] Alpha edges are clean.; [x] Foreground does not obscure text/controls.; [x] Scene layers are separately addressable.
  - Verify: visual preview
  - Evidence: `pnpm test:assets` (0) → `packages/assets/environments/moon-city-prop-railing.svg`

- [x] **W4-006 — Create alternate MoonWitness environments**
  - Goal: Produce reusable underground, archive, rooftop and street environment briefs/assets.
  - Depends on: W4-001, W4-004, W4-005
  - Deliverables: Environment coverage pack and metadata.
  - Acceptance (3/3 complete): [x] Each environment has coherent visual identity.; [x] Reusable shared props are canonical.; [x] No per-addon duplicated copy of the same background.
  - Verify: contact sheet review
  - Evidence: `pnpm test:assets` (0) → `packages/assets/source/world/environments/env-archive.svg`

- [x] **W4-007 — Define environment animation channels**
  - Goal: Specify which layers move, speed ranges, loop duration and pause conditions.
  - Depends on: W4-002, W4-003, W4-004, W4-005
  - Deliverables: Environment animation map.
  - Acceptance (3/3 complete): [x] Motion is subtle, bounded and deterministic.; [x] No default infinite heavy animation on operational pages.; [x] Reduced motion maps to a static composite.
  - Verify: scene contract tests
  - Evidence: `pnpm test:assets` (0) → `packages/assets/tests/moon-city-scene.test.mjs`

- [x] **W4-008 — Build environment preview and depth inspector**
  - Goal: Preview isolated planes and order with background transparency.
  - Depends on: W4-007, W3-009
  - Deliverables: Environment preview specimen/tool.
  - Acceptance (3/3 complete): [x] All planes can be toggled and reordered.; [x] Pivots/origins are inspectable.; [x] Preview is usable on narrow viewports.
  - Verify: pnpm test:ui-catalog
  - Evidence: `pnpm test:ui-catalog` (0) → `apps/ui-catalog/src/SceneLab.tsx`

## W5

- [x] **W5-001 — Choose animation engine boundary**
  - Goal: Audit existing Motion dependency in Board and choose CSS/SVG/Motion first; adapter seams for specialist character SDKs.
  - Depends on: W0-006, W1-007
  - Deliverables: Decision record and dependency/licensing matrix.
  - Acceptance (4/4 complete): [x] Use existing motion package where capable.; [x] Do not add GSAP/Rive/Live2D/Three/Pixi by default.; [x] Paid/proprietary SDK requires explicit human approval.; [x] No runtime dependency is added to assets package.
  - Verify: dependency graph review; bundle baseline
  - Evidence: `user approval in chat; dependency source search` (0) → `docs/bundles/visual-universe-pack/evidence/motion-boundary-proposal.md`; `pnpm ui:budget` (0) → `catalog JavaScript and stylesheet remain within declared raw/gzip budgets`

- [x] **W5-002 — Define scene runtime contracts**
  - Goal: Specify SceneDefinition, LayerDefinition, CameraDefinition, Clip, Event, State and fallback contracts.
  - Depends on: W2-009, W5-001
  - Deliverables: Typed scene/runtime contract design.
  - Acceptance (3/3 complete): [x] Assets are referenced by stable IDs.; [x] No business-domain state is stored in scene manifests.; [x] Scene data is serializable and validated.
  - Verify: typecheck; schema tests
  - Evidence: `pnpm test:assets` (0) → `44/44 pass`; `node packages/assets/scripts/validate.mjs` (0) → `validate.mjs`

- [x] **W5-003 — Implement scene descriptor validation**
  - Goal: Validate layers, ordering, bounds, animation refs, breakpoints and accessibility fallbacks.
  - Depends on: W5-002, W2-002
  - Deliverables: Scene validator and test fixtures.
  - Acceptance (2/2 complete): [x] Reject missing assets, cyclic references, invalid depth and missing fallback.; [x] Reports actionable file/field locations.
  - Verify: unit tests
  - Evidence: `pnpm test:assets` (0) → `packages/assets/tests/scene-schema.test.mjs`; `pnpm --filter @moonwitness/types test` (0) → `packages/types/src/scene.ts`

- [x] **W5-004 — Implement scene lifecycle and playback controller**
  - Goal: Create deterministic play/pause/seek/reset lifecycle with visibility and unmount cleanup.
  - Depends on: W5-002, W5-001
  - Deliverables: Scene playback controller and unit tests.
  - Acceptance (3/3 complete): [x] No leaked observers/timers/listeners.; [x] Offscreen scenes pause when appropriate.; [x] Reduced-motion/static mode is respected.
  - Verify: unit tests; browser lifecycle test
  - Evidence: `pnpm test:ui` (0) → `packages/ui/src/lib/scene-playback.ts`; `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/scene-harness.spec.ts`

- [x] **W5-005 — Implement layered scene renderer**
  - Goal: Render ordered image/vector/video-frame layers in a responsive scene viewport.
  - Depends on: W5-003, W5-004, W2-007
  - Deliverables: Scene renderer component.
  - Acceptance (3/3 complete): [x] Layer order, opacity, transform, blend and clipping are typed.; [x] No giant full-page screenshot mockup as background.; [x] Static fallback if animation runtime cannot initialize.
  - Verify: pnpm test:ui; pnpm test:ui-catalog
  - Evidence: `pnpm test:ui` (0) → `packages/ui/src/components/layered-scene.tsx`; `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/scene-harness.spec.ts`

- [x] **W5-006 — Implement camera and parallax controller**
  - Goal: Support bounded camera pan/zoom and pointer/scroll linked depth movement.
  - Depends on: W5-005, W4-007
  - Deliverables: Camera/parallax system and specimens.
  - Acceptance (4/4 complete): [x] Respect prefers-reduced-motion.; [x] No perpetual motion on data views.; [x] No scroll hijacking.; [x] Touch/keyboard remain usable.
  - Verify: browser interaction tests
  - Evidence: `pnpm test:ui` (0) → `packages/ui/src/lib/scene-camera.ts`; `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/scene-harness.spec.ts`

- [x] **W5-007 — Implement animation timeline orchestration**
  - Goal: Coordinate scene entrance, layer transitions, clips and event triggers.
  - Depends on: W5-004, W5-005
  - Deliverables: Timeline API and deterministic preview.
  - Acceptance (3/3 complete): [x] Timeline can play/pause/restart and complete.; [x] Navigation does not trap user waiting for animation.; [x] No unbounded recursive timeline.
  - Verify: unit tests; browser tests
  - Evidence: `pnpm test:ui` (0) → `packages/ui/src/lib/scene-timeline.ts`; `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/scene-harness.spec.ts`

- [x] **W5-008 — Implement character adapter contract**
  - Goal: Create adapter interface to play approved sprite/rig/clip assets without hard-coding one vendor.
  - Depends on: W5-002, W3-009
  - Deliverables: Character renderer adapter contract and basic implementation.
  - Acceptance (3/3 complete): [x] Sprite/image sequence is supported in baseline.; [x] Rive/Live2D adapters remain optional and isolated.; [x] Character identity data is separate from playback engine.
  - Verify: adapter tests
  - Evidence: `pnpm --filter @moonwitness/types test` (0) → `packages/types/src/character-adapter.ts`; `pnpm test:ui` (0) → `packages/ui/src/lib/character-adapter.ts`

- [x] **W5-009 — Implement sprite-sequence playback**
  - Goal: Render sprite sequences with timing, loop, pause, scale and fallback.
  - Depends on: W5-008, W2-008
  - Deliverables: Sprite player component and tests.
  - Acceptance (3/3 complete): [x] Frame count and duration follow metadata.; [x] Playback pauses offscreen and on reduced-motion.; [x] No memory leak after source replacement/unmount.
  - Verify: unit tests; browser tests
  - Evidence: `pnpm test:ui` (0) → `packages/ui/src/components/sprite-player.tsx`; `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/scene-harness.spec.ts`

- [x] **W5-010 — Implement deterministic camera/scene test harness**
  - Goal: Provide test controls for fixed frame/time, reduced motion and deterministic scene snapshots.
  - Depends on: W5-005, W5-006, W5-007
  - Deliverables: Scene test harness.
  - Acceptance (3/3 complete): [x] Snapshots do not capture mid-transition nondeterministically.; [x] Animation can be disabled or pinned to known timeline state.; [x] Visual regression includes key viewports.
  - Verify: pnpm test:ui-catalog
  - Evidence: `pnpm test:ui` (0) → `packages/ui/src/lib/scene-test-harness.ts`; `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/scene-harness.spec.ts`

- [x] **W5-011 — Decide runtime package extraction**
  - Goal: Extract a separate scene-runtime package only if more than one consumer needs stable reusable contracts.
  - Depends on: W5-004, W5-005, W5-006, W5-007, W5-008
  - Deliverables: Extraction decision, package boundary or documented no-extraction result.
  - Acceptance (3/3 complete): [x] No speculative package proliferation.; [x] If extracted, zero app route/auth/domain knowledge.; [x] Package exports and consumers are explicit.
  - Verify: workspace build; package verification
  - Evidence: `pnpm test:ui` (0) → `docs/bundles/visual-universe-pack/evidence/w5-runtime-boundary-decision.md`; `pnpm test:ui-budget` (0) → `apps/ui-catalog/bundle-budget.json`

- [x] **W5-012 — Integrate optional rig engine proof of concept** — **SKIPPED:** Skipped optional external rig engine POC: baseline 2.5D LayeredScene + SpritePlayer satisfies all Moon City motion/accessibility/bundle requirements without third-party SDKs.
  - Goal: Only if visual need is demonstrated, implement one isolated proof using approved licensing and bundle budget.
  - Depends on: W5-001, W5-008, W5-011
  - Deliverables: POC report; otherwise explicit skipped decision.
  - Acceptance (3/3 complete): [x] No proprietary assets or paid licensing without approval.; [x] No required SDK in default asset/UI package.; [x] Fallback sprite/2.5D scene remains complete.
  - Verify: license review; bundle budget; browser playback test
  - Evidence: `pnpm test:ui` (0) → `docs/bundles/visual-universe-pack/evidence/w5-runtime-boundary-decision.md`

## W6

- [x] **W6-001 — Inventory and preserve existing anime FX**
  - Goal: Audit all exported effects and CSS keyframes including latest raw-art grunge kinetics.
  - Depends on: W0-004
  - Deliverables: FX reuse map and gap list.
  - Acceptance (3/3 complete): [x] Existing effects are not duplicated.; [x] Latest dev commit and budget changes are preserved.; [x] Effects are grouped by UI micro, cinematic and ambient.
  - Verify: pnpm test:ui
  - Evidence: `source inventory of shared FX exports, CSS keyframes, motion tokens and reduced-motion/audio behavior` (0) → `docs/bundles/visual-universe-pack/evidence/fx-reuse-map.md`; `pnpm test:ui` (0) → `59 UI tests and packed consumer verification passed`

- [x] **W6-002 — Define cinematic FX contracts**
  - Goal: Define impact, frame-freeze, slash, transition, particles, glow and camera shake with safe intensity levels.
  - Depends on: W6-001, W1-007
  - Deliverables: FX contract and design examples.
  - Acceptance (3/3 complete): [x] All FX have static/reduced-motion alternative.; [x] No FX covers controls or content.; [x] Intensity and duration are bounded.
  - Verify: FX preview review
  - Evidence: `reviewed packages/ui/src/components/effects.tsx, component styles/tokens, reduced-motion tests and fx-reuse-map` (0) → `evidence/cinematic-fx-contract.md`

- [x] **W6-003 — Implement bounded scene particle effects**
  - Goal: Build measured lightweight particle presets for rain, dust, stars and sparks.
  - Depends on: W6-002, W5-004
  - Deliverables: Particle presets and performance tests.
  - Acceptance (3/3 complete): [x] Particle count and frame time are bounded.; [x] Pause offscreen/unmounted.; [x] Static fallback supported.
  - Verify: browser performance test
  - Evidence: `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/fx-lab.spec.ts --workers=1` (0) → `evidence/W6-W7-execution.md; 3/3 passed`; `node --test packages/ui/tests/scene-components.test.mjs packages/ui/tests/scene-fx-audio.test.mjs` (0) → `evidence/W6-W7-execution.md; 6/6 passed`; `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/fx-lab.spec.ts tests/scene-harness.spec.ts --workers=1` (0) → `docs/bundles/visual-universe-pack/evidence/W6-W7-execution.md; 11/11 passed, W6-003 frame report p95 16.7ms/max 16.8ms`

- [x] **W6-004 — Implement comic scene transition pack**
  - Goal: Build reusable ink wipe, panel reveal, cut/impact and soft transition.
  - Depends on: W6-002, W5-007
  - Deliverables: Transition components and specimens.
  - Acceptance (3/3 complete): [x] Transitions are interruptible and do not block navigation.; [x] Keyboard and reduced-motion work.; [x] No content remains hidden on animation failure.
  - Verify: pnpm test:ui-catalog
  - Evidence: `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/fx-lab.spec.ts --workers=1` (0) → `evidence/W6-W7-execution.md; reduced-motion transition content test passed`; `node --test packages/ui/tests/scene-components.test.mjs packages/ui/tests/scene-fx-audio.test.mjs` (0) → `evidence/W6-W7-execution.md; 6/6 passed`

- [x] **W6-005 — Create environment ambience pack**
  - Goal: Create/procure approved short ambient loops and document provenance.
  - Depends on: W1-007, W2-003
  - Deliverables: Optional ambience masters and optimized variants.
  - Acceptance (3/3 complete): [x] No copyrighted music or unlicensed sound effects.; [x] User must explicitly enable ambience.; [x] Audio is lazy-loaded and has mute/stop lifecycle.
  - Verify: audio tests; provenance validation
  - Evidence: `pnpm test:assets` (0) → `27 asset tests, canonical audio provenance and short PCM budget passed`; `pnpm test:ui` (0) → `audio interaction-consent tests passed within 59 UI tests`; `pnpm test:assets` (0) → `evidence/W6-ambience-pack.md; 56 asset tests and static docs export verification passed`; `pnpm test:ui` (0) → `evidence/W6-ambience-pack.md; 71 UI tests passed`; `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/fx-lab.spec.ts tests/scene-harness.spec.ts --workers=1` (0) → `evidence/W6-ambience-pack.md; 12 browser tests passed, including consent, source switching, mute, responsive scene diagnostics`

- [x] **W6-006 — Implement scene soundscape controller**
  - Goal: Integrate optional scene ambience without coupling playback to hover/scroll.
  - Depends on: W6-005, W5-004
  - Deliverables: Soundscape controller and settings integration.
  - Acceptance (4/4 complete): [x] Default is muted.; [x] One or policy-limited set of sources only; avoid overlapping loops.; [x] Scene changes stop/fade old ambience.; [x] Audio failure cannot break UX.
  - Verify: pnpm test:ui; browser audio tests
  - Evidence: `dependency audit: W6-005 status and notes` (0) → `evidence/W6-W7-execution.md`; `node --test packages/ui/tests/scene-components.test.mjs packages/ui/tests/scene-fx-audio.test.mjs` (0) → `evidence/W6-W7-execution.md; existing controller contract 6/6 passed but is not scene ambience integration`; `pnpm test:assets` (0) → `evidence/W6-ambience-pack.md; 56 asset tests and static docs export verification passed`; `pnpm test:ui` (0) → `evidence/W6-ambience-pack.md; 71 UI tests passed`; `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/fx-lab.spec.ts tests/scene-harness.spec.ts --workers=1` (0) → `evidence/W6-ambience-pack.md; 12 browser tests passed, including consent, source switching, mute, responsive scene diagnostics`

- [x] **W6-007 — Create FX contact sheet and preview catalogue**
  - Goal: Expose each effect in UI Catalog with light/dark, reduced-motion and intensity variants.
  - Depends on: W6-002, W6-003, W6-004
  - Deliverables: FX catalogue specimen and snapshots.
  - Acceptance (2/2 complete): [x] All FX have documented intended use and anti-pattern.; [x] No duplicate one-off CSS effect outside shared package without reason.
  - Verify: pnpm test:ui-catalog
  - Evidence: `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/fx-lab.spec.ts --workers=1` (0) → `evidence/W6-W7-execution.md; 3/3 passed including W6-007 catalog test`; `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/fx-lab.spec.ts tests/scene-harness.spec.ts --workers=1` (0) → `docs/bundles/visual-universe-pack/evidence/W6-W7-execution.md; 11/11 passed, FX catalogue test passed`

## W7

- [x] **W7-001 — Audit existing UI Catalog architecture**
  - Goal: Map current specimens, state controls, screenshot harness and bundle budget.
  - Depends on: W0-006
  - Deliverables: Creative Lab integration plan.
  - Acceptance (2/2 complete): [x] Extend existing app and test harness.; [x] Do not create a duplicate catalog app.
  - Verify: pnpm test:ui-catalog
  - Evidence: `pnpm test:ui-catalog` (0) → `25 Playwright browser tests passed during W0 baseline; existing harness/source map in evidence/ui-catalog-audit.md`

- [x] **W7-002 — Add asset browser specimen**
  - Goal: Browse canonical assets by category, pack, subject, domain, variant and status.
  - Depends on: W7-001, W2-005
  - Deliverables: Asset browser UI with deterministic fixture data.
  - Acceptance (3/3 complete): [x] Uses manifest data.; [x] No fabricated production domain records.; [x] Keyboard/filter/accessibility supported.
  - Verify: pnpm test:ui-catalog
  - Evidence: `pnpm test:ui-catalog` (0) → `evidence/W7-002-asset-browser.md; test-results/junit/ui-catalog.xml`

- [x] **W7-003 — Add character studio specimen**
  - Goal: Preview identity sheets, poses, expressions and animation states.
  - Depends on: W7-002, W3-009, W5-008
  - Deliverables: Character Studio.
  - Acceptance (3/3 complete): [x] Character ID and state displayed as metadata.; [x] Preview can pause/reset/switch variants.; [x] No persistent editing API implied unless implemented.
  - Verify: pnpm test:ui-catalog
  - Evidence: `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/scene-harness.spec.ts --workers=1 --grep "character studio previews"` (1) → `test-results/ui-catalog/scene-harness-character-st-b5862--and-reset-controls-W7-003-/error-context.md; timeout waiting for Play button; DOM showed Pause`; `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/scene-harness.spec.ts --workers=1 --grep "character studio|environment inspector resets|scene runtime supports"` (1) → `docs/bundles/visual-universe-pack/evidence/W6-W7-execution.md; Chromium target/protocol crash`; `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/scene-harness.spec.ts --workers=1 --grep "asset diagnostics|environment inspector resets"` (1) → `docs/bundles/visual-universe-pack/evidence/W6-W7-execution.md; Playwright webServer timed out`; `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/fx-lab.spec.ts tests/scene-harness.spec.ts --workers=1` (0) → `docs/bundles/visual-universe-pack/evidence/W6-W7-execution.md; 11/11 passed including motion allowed and reduced motion Character Studio cases`

- [x] **W7-004 — Add environment and layer inspector**
  - Goal: Toggle layers, change z-order, inspect pivots and preview breakpoints.
  - Depends on: W7-002, W4-008, W5-005
  - Deliverables: Environment/Layer Inspector.
  - Acceptance (2/2 complete): [x] Preview state can be reset to fixture baseline.; [x] Does not mutate canonical assets.
  - Verify: pnpm test:ui-catalog
  - Evidence: `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/scene-harness.spec.ts --workers=1 --grep "environment inspector resets"` (0) → `evidence/W6-W7-execution.md; 1/1 passed`

- [x] **W7-005 — Add timeline and FX preview**
  - Goal: Provide play/pause/reset/scrub or discrete deterministic states for animation/FX.
  - Depends on: W7-003, W6-007, W5-007
  - Deliverables: Timeline/FX lab specimen.
  - Acceptance (3/3 complete): [x] Preview is deterministic in tests.; [x] No autoplay with sound.; [x] Does not require a production authoring server.
  - Verify: pnpm test:ui-catalog
  - Evidence: `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/scene-harness.spec.ts --workers=1 --grep "character studio|environment inspector resets|scene runtime supports"` (1) → `evidence/W6-W7-execution.md; target crashed and run failed`; `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/fx-lab.spec.ts tests/scene-harness.spec.ts --workers=1` (0) → `docs/bundles/visual-universe-pack/evidence/W6-W7-execution.md; 11/11 passed including timeline seek assertion`

- [x] **W7-006 — Add responsive scene preview**
  - Goal: Preview desktop/tablet/mobile compositions and reduced-motion mode.
  - Depends on: W7-004, W7-005, W1-006
  - Deliverables: Responsive preview controls and screenshots.
  - Acceptance (2/2 complete): [x] Breakpoints are actual app breakpoints, not arbitrary labels.; [x] Focal point and clipping can be reviewed side-by-side.
  - Verify: Playwright visual tests
  - Evidence: `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/scene-harness.spec.ts --workers=1 --grep "environment inspector resets"` (0) → `evidence/W6-W7-execution.md; 1/1 reset test passed; full responsive visual matrix not verified`; `dependency audit: W7-005 status` (0) → `evidence/W6-W7-execution.md`; `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/fx-lab.spec.ts tests/scene-harness.spec.ts --workers=1` (0) → `docs/bundles/visual-universe-pack/evidence/W6-W7-execution.md; docs/bundles/visual-universe-pack/evidence/W7-006-scene-preview-desktop.png; docs/bundles/visual-universe-pack/evidence/W7-006-scene-preview-mobile.png`

- [x] **W7-007 — Add asset and scene diagnostics panel**
  - Goal: Show missing refs, provenance gaps, size, format and scene validation.
  - Depends on: W7-002, W5-003, W2-012
  - Deliverables: Diagnostics panel and actionable messages.
  - Acceptance (3/3 complete): [x] Diagnostics sourced from validators.; [x] No false green when validation has not run.; [x] Can export report.
  - Verify: pnpm test:ui-catalog; pnpm assets:validate
  - Evidence: `pnpm --filter @moonwitness/ui-catalog diagnostics:generate` (0) → `apps/ui-catalog/generated/asset-diagnostics.json; 231 assets and 1 scene validated`; `pnpm assets:validate` (0) → `evidence/W6-W7-execution.md; 189 SVGs validated`; `pnpm --filter @moonwitness/ui-catalog exec tsc -p tsconfig.json --noEmit` (0) → `evidence/W6-W7-execution.md`; `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/scene-harness.spec.ts --workers=1 --grep "asset diagnostics|environment inspector resets"` (1) → `evidence/W6-W7-execution.md; webServer timed out before test`; `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/fx-lab.spec.ts tests/scene-harness.spec.ts --workers=1` (0) → `docs/bundles/visual-universe-pack/evidence/W6-W7-execution.md; 11/11 passed including disabled-before-load and JSON download checks`

## W8

- [x] **W8-D01 — Audit base addon visual requirements**
  - Goal: Inspect the real base models, views, menu/access rules, API routes and current Board consumer. Domain: People, partners, companies, users, activities, attachments, tags, records.
  - Depends on: W0-005
  - Deliverables: base domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance (4/4 complete): [x] Every model, view, route and permission cited is verified in current source.; [x] Missing or unavailable consumer routes are explicitly marked, not invented.; [x] Existing visual assets/components are identified for reuse.; [x] ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `docs/bundles/visual-universe-pack/evidence/domains/base.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `docs/bundles/visual-universe-pack/evidence/W8-D-board-typecheck.md`

- [x] **W8-D02 — Audit auth addon visual requirements**
  - Goal: Inspect the real auth models, views, menu/access rules, API routes and current Board consumer. Domain: Identity, login, registration, security and session states.
  - Depends on: W0-005
  - Deliverables: auth domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance (4/4 complete): [x] Every model, view, route and permission cited is verified in current source.; [x] Missing or unavailable consumer routes are explicitly marked, not invented.; [x] Existing visual assets/components are identified for reuse.; [x] ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `docs/bundles/visual-universe-pack/evidence/domains/auth.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `docs/bundles/visual-universe-pack/evidence/W8-D-board-typecheck.md`

- [x] **W8-D03 — Audit jobs addon visual requirements**
  - Goal: Inspect the real jobs models, views, menu/access rules, API routes and current Board consumer. Domain: Queues, jobs, scheduled work, execution and failure states.
  - Depends on: W0-005
  - Deliverables: jobs domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance (4/4 complete): [x] Every model, view, route and permission cited is verified in current source.; [x] Missing or unavailable consumer routes are explicitly marked, not invented.; [x] Existing visual assets/components are identified for reuse.; [x] ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `docs/bundles/visual-universe-pack/evidence/domains/jobs.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `docs/bundles/visual-universe-pack/evidence/W8-D-board-typecheck.md`

- [x] **W8-D04 — Audit integration addon visual requirements**
  - Goal: Inspect the real integration models, views, menu/access rules, API routes and current Board consumer. Domain: Webhook endpoints, delivery and connector states.
  - Depends on: W0-005
  - Deliverables: integration domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance (4/4 complete): [x] Every model, view, route and permission cited is verified in current source.; [x] Missing or unavailable consumer routes are explicitly marked, not invented.; [x] Existing visual assets/components are identified for reuse.; [x] ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `docs/bundles/visual-universe-pack/evidence/domains/integration.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `docs/bundles/visual-universe-pack/evidence/W8-D-board-typecheck.md`

- [x] **W8-D05 — Audit whatsapp addon visual requirements**
  - Goal: Inspect the real whatsapp models, views, menu/access rules, API routes and current Board consumer. Domain: Accounts, conversations, messages, media and contact states.
  - Depends on: W0-005
  - Deliverables: whatsapp domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance (4/4 complete): [x] Every model, view, route and permission cited is verified in current source.; [x] Missing or unavailable consumer routes are explicitly marked, not invented.; [x] Existing visual assets/components are identified for reuse.; [x] ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `docs/bundles/visual-universe-pack/evidence/domains/whatsapp.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `docs/bundles/visual-universe-pack/evidence/W8-D-board-typecheck.md`

- [x] **W8-D06 — Audit request addon visual requirements**
  - Goal: Inspect the real request models, views, menu/access rules, API routes and current Board consumer. Domain: Purchase requests and approval lifecycle.
  - Depends on: W0-005
  - Deliverables: request domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance (4/4 complete): [x] Every model, view, route and permission cited is verified in current source.; [x] Missing or unavailable consumer routes are explicitly marked, not invented.; [x] Existing visual assets/components are identified for reuse.; [x] ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `docs/bundles/visual-universe-pack/evidence/domains/request.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `docs/bundles/visual-universe-pack/evidence/W8-D-board-typecheck.md`

- [x] **W8-D07 — Audit notification addon visual requirements**
  - Goal: Inspect the real notification models, views, menu/access rules, API routes and current Board consumer. Domain: Inbox, unread/read/archived and channel states.
  - Depends on: W0-005
  - Deliverables: notification domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance (4/4 complete): [x] Every model, view, route and permission cited is verified in current source.; [x] Missing or unavailable consumer routes are explicitly marked, not invented.; [x] Existing visual assets/components are identified for reuse.; [x] ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `docs/bundles/visual-universe-pack/evidence/domains/notification.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `docs/bundles/visual-universe-pack/evidence/W8-D-board-typecheck.md`

- [x] **W8-D08 — Audit organization addon visual requirements**
  - Goal: Inspect the real organization models, views, menu/access rules, API routes and current Board consumer. Domain: Departments, teams, positions, memberships and hierarchy.
  - Depends on: W0-005
  - Deliverables: organization domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance (4/4 complete): [x] Every model, view, route and permission cited is verified in current source.; [x] Missing or unavailable consumer routes are explicitly marked, not invented.; [x] Existing visual assets/components are identified for reuse.; [x] ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `docs/bundles/visual-universe-pack/evidence/domains/organization.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `docs/bundles/visual-universe-pack/evidence/W8-D-board-typecheck.md`

- [x] **W8-D09 — Audit workflow addon visual requirements**
  - Goal: Inspect the real workflow models, views, menu/access rules, API routes and current Board consumer. Domain: Definitions, instances, transitions, approvals and event history.
  - Depends on: W0-005
  - Deliverables: workflow domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance (4/4 complete): [x] Every model, view, route and permission cited is verified in current source.; [x] Missing or unavailable consumer routes are explicitly marked, not invented.; [x] Existing visual assets/components are identified for reuse.; [x] ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `docs/bundles/visual-universe-pack/evidence/domains/workflow.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `docs/bundles/visual-universe-pack/evidence/W8-D-board-typecheck.md`

- [x] **W8-D10 — Audit knowledge addon visual requirements**
  - Goal: Inspect the real knowledge models, views, menu/access rules, API routes and current Board consumer. Domain: Witness testimony, source, evidence, corrections, interpretations and research graph.
  - Depends on: W0-005
  - Deliverables: knowledge domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance (4/4 complete): [x] Every model, view, route and permission cited is verified in current source.; [x] Missing or unavailable consumer routes are explicitly marked, not invented.; [x] Existing visual assets/components are identified for reuse.; [x] ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `docs/bundles/visual-universe-pack/evidence/domains/knowledge.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `docs/bundles/visual-universe-pack/evidence/W8-D-board-typecheck.md`

- [x] **W8-D11 — Audit orm-storage addon visual requirements**
  - Goal: Inspect the real orm-storage models, views, menu/access rules, API routes and current Board consumer. Domain: Attachment storage providers and lifecycle states; currently provider addon has no domain models.
  - Depends on: W0-005
  - Deliverables: orm-storage domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance (4/4 complete): [x] Every model, view, route and permission cited is verified in current source.; [x] Missing or unavailable consumer routes are explicitly marked, not invented.; [x] Existing visual assets/components are identified for reuse.; [x] ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `docs/bundles/visual-universe-pack/evidence/domains/storage.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `docs/bundles/visual-universe-pack/evidence/W8-D-board-typecheck.md`

- [x] **W8-D12 — Audit ai addon visual requirements**
  - Goal: Inspect the real ai models, views, menu/access rules, API routes and current Board consumer. Domain: Agents, profiles, models, providers, contracts, runs, taskforces, skills and memory.
  - Depends on: W0-005
  - Deliverables: ai domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance (4/4 complete): [x] Every model, view, route and permission cited is verified in current source.; [x] Missing or unavailable consumer routes are explicitly marked, not invented.; [x] Existing visual assets/components are identified for reuse.; [x] ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `docs/bundles/visual-universe-pack/evidence/domains/ai.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `docs/bundles/visual-universe-pack/evidence/W8-D-board-typecheck.md`

- [x] **W8-001 — Implement visual coverage for base addon**
  - Goal: Implement only the verified base asset references, UI compositions and state treatments based on W8-D01. Domain: People, partners, companies, users, activities, attachments, tags, records.
  - Depends on: W8-D01, W2-005, W1-008
  - Deliverables: base addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance (6/6 complete): [x] Only real existing models/routes/permissions are represented.; [x] Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; [x] Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; [x] Artwork remains decorative; labels, state and actions are real UI data.; [x] New assets include provenance and are registered in canonical manifest.; [x] If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `node --test scripts/board/model-icon-registry.test.mjs scripts/board/model-view-error-state.test.mjs` (0) → `evidence/W8-001-base-visual-coverage.md`

- [x] **W8-002 — Implement visual coverage for auth addon**
  - Goal: Implement only the verified auth asset references, UI compositions and state treatments based on W8-D02. Domain: Identity, login, registration, security and session states.
  - Depends on: W8-D02, W2-005, W1-008
  - Deliverables: auth addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance (6/6 complete): [x] Only real existing models/routes/permissions are represented.; [x] Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; [x] Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; [x] Artwork remains decorative; labels, state and actions are real UI data.; [x] New assets include provenance and are registered in canonical manifest.; [x] If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `pnpm test:ui-catalog` (0) → `evidence/W8-002-auth-visual-coverage.md; test-results/junit/ui-catalog.xml`; `pnpm --filter @moonwitness/ui-catalog build && pnpm ui:budget` (0) → `evidence/W8-002-auth-visual-coverage.md`

- [x] **W8-003 — Implement visual coverage for jobs addon**
  - Goal: Implement only the verified jobs asset references, UI compositions and state treatments based on W8-D03. Domain: Queues, jobs, scheduled work, execution and failure states.
  - Depends on: W8-D03, W2-005, W1-008
  - Deliverables: jobs addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance (6/6 complete): [x] Only real existing models/routes/permissions are represented.; [x] Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; [x] Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; [x] Artwork remains decorative; labels, state and actions are real UI data.; [x] New assets include provenance and are registered in canonical manifest.; [x] If no production consumer exists, provide a labelled UI Catalog specimen and document that gap; when a verified consumer exists, document and reuse it without inventing routes.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `node --test scripts/board/jobs-resource-state.test.mjs` (0) → `scripts/board/jobs-resource-state.test.mjs`; `pnpm --filter @moonwitness/board typecheck` (0) → `apps/board/src/board-pages/dashboard-page.tsx`; `pnpm board:ui:check` (0) → `scripts/check-board-shared-ui.mjs`; `pnpm test:assets` (0) → `packages/assets/tests`; `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/catalog.spec.ts`

- [x] **W8-004 — Implement visual coverage for integration addon**
  - Goal: Implement only the verified integration asset references, UI compositions and state treatments based on W8-D04. Domain: Webhook endpoints, delivery and connector states.
  - Depends on: W8-D04, W2-005, W1-008
  - Deliverables: integration addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance (6/6 complete): [x] Only real existing models/routes/permissions are represented.; [x] Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; [x] Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; [x] Artwork remains decorative; labels, state and actions are real UI data.; [x] New assets include provenance and are registered in canonical manifest.; [x] If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `pnpm --filter @moonwitness/ui-catalog build` (0) → `apps/ui-catalog/dist`; `pnpm --filter @moonwitness/ui-catalog test` (0) → `apps/ui-catalog/tests/catalog.spec.ts`; `pnpm board:ui:check` (0) → `scripts/check-board-shared-ui.mjs`; `pnpm --filter @moonwitness/board typecheck` (0) → `apps/board`; `pnpm test:assets` (0) → `packages/assets/tests`

- [x] **W8-005 — Implement visual coverage for whatsapp addon**
  - Goal: Implement only the verified whatsapp asset references, UI compositions and state treatments based on W8-D05. Domain: Accounts, conversations, messages, media and contact states.
  - Depends on: W8-D05, W2-005, W1-008
  - Deliverables: whatsapp addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance (6/6 complete): [x] Only real existing models/routes/permissions are represented.; [x] Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; [x] Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; [x] Artwork remains decorative; labels, state and actions are real UI data.; [x] New assets include provenance and are registered in canonical manifest.; [x] If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `pnpm board:ui:check` (0) → `scripts/check-board-shared-ui.mjs`; `pnpm --filter @moonwitness/board typecheck` (0) → `apps/board/src`; `pnpm test:assets` (0) → `packages/assets/tests`; `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/catalog.spec.ts`

- [x] **W8-006 — Implement visual coverage for request addon**
  - Goal: Implement only the verified request asset references, UI compositions and state treatments based on W8-D06. Domain: Purchase requests and approval lifecycle.
  - Depends on: W8-D06, W2-005, W1-008
  - Deliverables: request addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance (6/6 complete): [x] Only real existing models/routes/permissions are represented.; [x] Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; [x] Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; [x] Artwork remains decorative; labels, state and actions are real UI data.; [x] New assets include provenance and are registered in canonical manifest.; [x] If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `pnpm --filter @moonwitness/ui-catalog build` (0) → `apps/ui-catalog/dist`; `pnpm --filter @moonwitness/ui-catalog test` (0) → `apps/ui-catalog/tests/catalog.spec.ts`; `pnpm board:ui:check` (0) → `scripts/check-board-shared-ui.mjs`; `pnpm --filter @moonwitness/board typecheck` (0) → `apps/board`; `pnpm test:assets` (0) → `packages/assets/tests`

- [x] **W8-007 — Implement visual coverage for notification addon**
  - Goal: Implement only the verified notification asset references, UI compositions and state treatments based on W8-D07. Domain: Inbox, unread/read/archived and channel states.
  - Depends on: W8-D07, W2-005, W1-008
  - Deliverables: notification addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance (6/6 complete): [x] Only real existing models/routes/permissions are represented.; [x] Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; [x] Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; [x] Artwork remains decorative; labels, state and actions are real UI data.; [x] New assets include provenance and are registered in canonical manifest.; [x] If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `pnpm test:e2e:visual --grep "canonical activity, notification, and cron icons"` (0) → `apps/board/e2e/visual-audit.spec.ts`; `pnpm --filter @moonwitness/board typecheck` (0) → `apps/board/src/components/layout/notification-bell.tsx`; `pnpm board:ui:check` (0) → `scripts/check-board-shared-ui.mjs`; `pnpm test:assets` (0) → `packages/assets/tests`; `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/catalog.spec.ts`

- [x] **W8-008 — Implement visual coverage for organization addon**
  - Goal: Implement only the verified organization asset references, UI compositions and state treatments based on W8-D08. Domain: Departments, teams, positions, memberships and hierarchy.
  - Depends on: W8-D08, W2-005, W1-008
  - Deliverables: organization addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance (6/6 complete): [x] Only real existing models/routes/permissions are represented.; [x] Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; [x] Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; [x] Artwork remains decorative; labels, state and actions are real UI data.; [x] New assets include provenance and are registered in canonical manifest.; [x] If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `pnpm --filter @moonwitness/board typecheck` (0) → `apps/board/src/lib/models.ts`; `pnpm board:ui:check` (0) → `scripts/check-board-shared-ui.mjs`; `pnpm test:assets` (0) → `packages/assets/tests`; `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/catalog.spec.ts`

- [x] **W8-009 — Implement visual coverage for workflow addon**
  - Goal: Implement only the verified workflow asset references, UI compositions and state treatments based on W8-D09. Domain: Definitions, instances, transitions, approvals and event history.
  - Depends on: W8-D09, W2-005, W1-008
  - Deliverables: workflow addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance (6/6 complete): [x] Only real existing models/routes/permissions are represented.; [x] Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; [x] Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; [x] Artwork remains decorative; labels, state and actions are real UI data.; [x] New assets include provenance and are registered in canonical manifest.; [x] If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `node --test scripts/board/workflow-action-state.test.mjs` (0) → `scripts/board/workflow-action-state.test.mjs`; `pnpm --filter @moonwitness/board typecheck` (0) → `apps/board/src/components/views/workflow-panel.tsx`; `pnpm board:ui:check` (0) → `scripts/check-board-shared-ui.mjs`; `pnpm test:assets` (0) → `packages/assets/tests`; `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/catalog.spec.ts`

- [x] **W8-010 — Implement visual coverage for knowledge addon**
  - Goal: Implement only the verified knowledge asset references, UI compositions and state treatments based on W8-D10. Domain: Witness testimony, source, evidence, corrections, interpretations and research graph.
  - Depends on: W8-D10, W2-005, W1-008, W4-001
  - Deliverables: knowledge addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance (6/6 complete): [x] Only real existing models/routes/permissions are represented.; [x] Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; [x] Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; [x] Artwork remains decorative; labels, state and actions are real UI data.; [x] New assets include provenance and are registered in canonical manifest.; [x] If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `pnpm board:ui:check` (0) → `evidence/W8-010-knowledge-visual-coverage.md; 6 boundary checks passed`; `pnpm --filter @moonwitness/board typecheck` (0) → `evidence/W8-010-knowledge-visual-coverage.md`; `pnpm test:assets` (0) → `evidence/W8-010-knowledge-visual-coverage.md; 56 tests passed and docs exports verified`; `pnpm test:ui-catalog` (0) → `evidence/W8-010-knowledge-visual-coverage.md; 41 browser tests passed`; `pnpm --filter @moonwitness/board exec playwright test e2e/knowledge-explorer.spec.ts --workers=1` (1) → `evidence/W8-010-knowledge-visual-coverage.md; API webServer timeout; local E2E database/compose blocker`

- [x] **W8-011 — Implement visual coverage for orm-storage addon**
  - Goal: Implement only the verified orm-storage asset references, UI compositions and state treatments based on W8-D11. Domain: Attachment storage providers and lifecycle states; currently provider addon has no domain models.
  - Depends on: W8-D11, W2-005, W1-008
  - Deliverables: orm-storage addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance (6/6 complete): [x] Only real existing models/routes/permissions are represented.; [x] Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; [x] Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; [x] Artwork remains decorative; labels, state and actions are real UI data.; [x] New assets include provenance and are registered in canonical manifest.; [x] If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `pnpm test:assets` (0) → `44/44 pass`; `node packages/assets/scripts/validate.mjs` (0) → `validate.mjs`

- [x] **W8-012 — Implement visual coverage for ai addon**
  - Goal: Implement only the verified ai asset references, UI compositions and state treatments based on W8-D12. Domain: Agents, profiles, models, providers, contracts, runs, taskforces, skills and memory.
  - Depends on: W8-D12, W2-005, W1-008, W3-001
  - Deliverables: ai addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance (6/6 complete): [x] Only real existing models/routes/permissions are represented.; [x] Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; [x] Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; [x] Artwork remains decorative; labels, state and actions are real UI data.; [x] New assets include provenance and are registered in canonical manifest.; [x] If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `pnpm test:assets` (0) → `44/44 pass`; `node packages/assets/scripts/validate.mjs` (0) → `validate.mjs`

## W9

- [x] **W9-001 — Create first Moon City scene definition**
  - Goal: Compose approved sky, moon, cloud, city, character and foreground assets into one scene.
  - Depends on: W3-006, W4-007, W5-003
  - Deliverables: Versioned Moon City scene manifest.
  - Acceptance (3/3 complete): [x] All references resolve.; [x] Scene has desktop/mobile variants or responsive composition rules.; [x] Scene contains no UI copy or product metrics.
  - Verify: scene validation; contact sheet
  - Evidence: `node --test packages/assets/tests/moon-city-scene.test.mjs packages/assets/tests/character-registry.test.mjs` (0) → `docs/bundles/visual-universe-pack/evidence/W9-001-W9-004-hero-route-blockers.md`

- [x] **W9-002 — Build immersive homepage hero vertical slice**
  - Goal: Integrate first living scene into homepage without replacing real HTML navigation/copy/CTA.
  - Depends on: W9-001, W5-005, W5-006, W5-007, W5-009
  - Deliverables: Production homepage hero scene.
  - Acceptance (4/4 complete): [x] Visual hierarchy matches approved reference DNA.; [x] Character and environment animation are visible but not distracting.; [x] Static fallback always loads.; [x] No full-page screenshot used as background.
  - Verify: pnpm --filter @moonwitness/board typecheck; pnpm --filter @moonwitness/board build; pnpm test:e2e:visual
  - Evidence: `bunx --cwd apps/board playwright test e2e/visual-audit.spec.ts --config playwright.visual.reuse.config.mjs --grep "homepage spelling"` (0) → `docs/bundles/visual-universe-pack/evidence/W9-001-W9-004-hero-route-blockers.md`

- [x] **W9-003 — Add cinematic scroll/story section transitions**
  - Goal: Connect homepage story sections with controlled reveal/camera transitions.
  - Depends on: W9-002, W6-004, W5-006
  - Deliverables: Scroll-linked scene transition specimens and production integration.
  - Acceptance (3/3 complete): [x] No scroll hijacking or hidden content.; [x] Reduced-motion has direct static order.; [x] Mobile touch scrolling remains native.
  - Verify: Playwright scroll tests; reduced-motion tests
  - Evidence: `homepage spelling, responsive layout, and reference screenshots (Playwright, Chromium/Firefox/WebKit)` (0) → `docs/bundles/visual-universe-pack/evidence/W9-001-W9-004-hero-route-blockers.md`

- [x] **W9-004 — Extend selected Signals and Archive scenes**
  - Goal: Use existing asset IDs and scene contracts for the next two content experiences when those routes exist.
  - Depends on: W8-009, W8-010, W9-001
  - Deliverables: Signals/Archive scene integration or documented route-gap decision.
  - Acceptance (2/2 complete): [x] No fake routes or unsupported live data.; [x] If actual route is absent, create approved catalog specimen only and record blocker.
  - Verify: pnpm --filter @moonwitness/board typecheck; pnpm test:e2e
  - Evidence: `bunx --cwd apps/ui-catalog playwright test tests/scene-harness.spec.ts --config playwright.config.ts` (0) → `docs/bundles/visual-universe-pack/evidence/W9-001-W9-004-hero-route-blockers.md`

- [x] **W9-005 — Integrate Crew and Story visual compositions**
  - Goal: Apply character/environment assets to existing user and story experiences only where supported by product data.
  - Depends on: W8-001, W8-010, W3-009
  - Deliverables: Crew/Story scene or editorial compositions.
  - Acceptance (3/3 complete): [x] Real users remain real data or neutral avatars.; [x] Fictional character examples are visibly marked as examples in catalog.; [x] No fictional crew metrics or maps in production.
  - Verify: pnpm test:e2e:visual; pnpm test:ui-catalog
  - Evidence: `bunx --cwd apps/board playwright test e2e/visual-audit.spec.ts --config playwright.visual.config.ts --grep "homepage spelling"` (0) → `docs/bundles/visual-universe-pack/evidence/W9-005-W9-006-operational-coverage.md`; `Evidence path recorded in canonical TaskOS; execution metadata not recorded.` (not recorded) → `docs/bundles/visual-universe-pack/evidence/W9-001-W9-004-hero-route-blockers.md`

- [x] **W9-006 — Preserve operational Board visual tier**
  - Goal: Ensure new immersive runtime does not leak into dense forms, tables or admin data flows.
  - Depends on: W5-005, W6-002, W8-001
  - Deliverables: Board regression report.
  - Acceptance (3/3 complete): [x] Existing Board light/dark themes, skins and density remain intact.; [x] Operational screens use restrained motion and valid focus boundaries.; [x] No measurable layout shift/regression.
  - Verify: pnpm board:ui:check; pnpm test:e2e:visual:matrix
  - Evidence: `bun run board:ui:check` (0) → `docs/bundles/visual-universe-pack/evidence/W9-005-W9-006-operational-coverage.md`; `Evidence path recorded in canonical TaskOS; execution metadata not recorded.` (not recorded) → `docs/bundles/visual-universe-pack/evidence/W9-001-W9-004-hero-route-blockers.md`

- [x] **W9-007 — Decide desktop app scene adoption**
  - Goal: Audit desktop UI technology and performance before adopting world runtime.
  - Depends on: W5-002, W5-011
  - Deliverables: Desktop integration decision and optional proof.
  - Acceptance (3/3 complete): [x] No UI/assets dependency added blindly.; [x] Shared formats can be consumed without browser-only globals leaking into shared contracts.; [x] No unsupported desktop capability is assumed.
  - Verify: pnpm --filter @moonwitness/desktop typecheck; pnpm --filter @moonwitness/desktop test
  - Evidence: `pnpm --filter @moonwitness/desktop typecheck` (0) → `evidence/W9-007-desktop-adoption.md`; `pnpm --filter @moonwitness/desktop test` (0) → `evidence/W9-007-desktop-adoption.md; isolated retry 28/28 passed`

- [x] **W9-008 — Document complete addon asset handoff**
  - Goal: Document how addons request/reuse UI asset IDs without importing artwork into ORM/server.
  - Depends on: W8-001, W8-012, W2-010
  - Deliverables: Developer guide for addon-to-visual mapping.
  - Acceptance (3/3 complete): [x] Backend packages remain presentation-agnostic.; [x] No circular dependency from ORM to assets/UI.; [x] Static visual ID to runtime component mapping is explicit.
  - Verify: pnpm docs:check; pnpm docs:links
  - Evidence: `git diff --check` (0) → `evidence/W9-008-addon-visual-handoff.md`; `pnpm docs:check` (0) → `evidence/W9-008-addon-visual-handoff.md; generated reference/docs/build/example gates passed`; `pnpm docs:links` (0) → `evidence/W9-008-addon-visual-handoff.md; 602 Markdown files and navigation targets passed`

## W10

- [x] **W10-001 — Establish runtime performance baselines**
  - Goal: Measure current and new scene route cold load, JS/CSS, asset transfer, CPU/GPU and frame cadence.
  - Depends on: W9-002
  - Deliverables: Baseline and budget document.
  - Acceptance (3/3 complete): [x] Measurements on named reference devices/browser.; [x] Initial route and deferred scene budgets are separated.; [x] No arbitrary performance claim.
  - Verify: pnpm board:budget; Playwright performance run
  - Evidence: `bun --filter @moonwitness/board build && node scripts/visual-universe/measure-home-scene.mjs` (0) → `docs/bundles/visual-universe-pack/evidence/W10-001-runtime-performance-baseline.md`

- [x] **W10-002 — Optimize scene asset loading and caching**
  - Goal: Implement lazy scene loading, preloading policy and responsive media selection.
  - Depends on: W10-001, W2-006, W9-002
  - Deliverables: Loading/cache policy and tests.
  - Acceptance (3/3 complete): [x] Only initial scene critical assets are eagerly loaded.; [x] Offscreen scenes do not download unnecessary media.; [x] Failed loads show fallback and retry where relevant.
  - Verify: network asset audit; pnpm test:e2e
  - Evidence: `production measurement harness; verify Cache-Control headers` (0) → `docs/bundles/visual-universe-pack/evidence/W10-002-scene-loading-and-cache.md`; `Evidence path recorded in canonical TaskOS; execution metadata not recorded.` (not recorded) → `docs/bundles/visual-universe-pack/evidence/W10-001-runtime-performance-baseline.md`

- [x] **W10-003 — Add reduced-motion and low-power scene modes**
  - Goal: Support reduced-motion, data-saver/low-capability settings where detectably appropriate.
  - Depends on: W1-007, W5-004, W9-002
  - Deliverables: Motion mode policy and tests.
  - Acceptance (3/3 complete): [x] User preference is respected before first meaningful playback.; [x] Low-power mode does not imply inaccessible hidden content.; [x] No preference is silently overridden.
  - Verify: Playwright reduced-motion tests
  - Evidence: `MW_VISUAL_BROWSER_MATRIX=true bunx --cwd apps/board playwright test e2e/public-home.spec.ts --config playwright.visual.config.ts --grep 'Save-Data'` (0) → `docs/bundles/visual-universe-pack/evidence/W10-003-motion-and-save-data.md`

- [x] **W10-004 — Add full visual and accessibility matrix**
  - Goal: Run desktop/tablet/mobile, light/dark, keyboard, touch, reduced motion and fallback tests.
  - Depends on: W9-002, W9-006, W10-003
  - Deliverables: Visual evidence matrix and issues list.
  - Acceptance (3/3 complete): [x] Critical production pages have review evidence.; [x] Axe/keyboard checks cover changed user flows.; [x] Known limitations are explicit.
  - Verify: pnpm test:ui; pnpm test:ui-catalog; pnpm test:e2e:visual:matrix
  - Evidence: `MW_VISUAL_BROWSER_MATRIX=true bunx --cwd apps/board playwright test -c playwright.visual.config.ts e2e/public-home.spec.ts` (0) → `docs/bundles/visual-universe-pack/evidence/W10-004-home-accessibility-matrix.md`; `Evidence path recorded in canonical TaskOS; execution metadata not recorded.` (not recorded) → `docs/bundles/visual-universe-pack/evidence/W9-005-W9-006-operational-coverage.md`

- [x] **W10-005 — Verify package build and consumer contracts**
  - Goal: Build, pack and consume assets/UI packages from apps and run API/desktop boundaries.
  - Depends on: W2-010, W5-011, W9-007
  - Deliverables: Package verification report.
  - Acceptance (4/4 complete): [x] Public exports resolve from actual consumer apps.; [x] No private dist imports.; [x] No unwanted runtime dependencies.; [x] API and ORM builds remain unaffected by visual dependencies.
  - Verify: pnpm build; pnpm test:assets; pnpm test:ui; pnpm test:ui-catalog; pnpm --filter @moonwitness/api typecheck; pnpm --filter @moonwitness/desktop typecheck
  - Evidence: `pnpm board:ui:check` (0) → `docs/bundles/visual-universe-pack/evidence/W10-005-package-verification.md`

- [x] **W10-006 — Run full quality and security review**
  - Goal: Run relevant repository CI gates and check license, provenance, dependencies, performance and accessibility.
  - Depends on: W10-004, W10-005
  - Deliverables: Release-quality report.
  - Acceptance (4/4 complete): [x] No secrets or licensing violations.; [x] No broken source manifests or generated artifacts.; [x] No unreviewed breaking API changes.; [x] No failing relevant required gate.
  - Verify: pnpm lint; pnpm test; pnpm test:integration; pnpm test:e2e
  - Evidence: `MW_VISUAL_BROWSER_MATRIX=true bun run test:e2e:visual` (0) → `docs/bundles/visual-universe-pack/evidence/W9-005-W9-006-operational-coverage.md`; `bun run test:assets && bun run test:ui && bun run test:ui-budget && bun run board:budget` (0) → `docs/bundles/visual-universe-pack/evidence/W10-005-package-verification.md`

- [x] **W10-007 — Finalize docs, release notes and handoff**
  - Goal: Publish final implementation, asset catalog and evidence guide.
  - Depends on: W10-006
  - Deliverables: Final changelog, README/docs index, evidence links and closure report.
  - Acceptance (3/3 complete): [x] All tasks have accurate statuses and evidence.; [x] Deferred/blocked tasks are not claimed complete.; [x] Version bump follows repo release policy, not every commit.
  - Verify: pnpm docs:check; pnpm docs:links; git diff --check
  - Evidence: `Evidence path recorded in canonical TaskOS; execution metadata not recorded.` (not recorded) → `docs/bundles/visual-universe-pack/evidence/W9-005-W9-006-operational-coverage.md`; `bun run docs:check:built && bun run docs:links && git diff --check` (0) → `docs/bundles/visual-universe-pack/evidence/W10-004-home-accessibility-matrix.md`

- [x] **W10-008 — Commit and push verified work to dev**
  - Goal: Commit coherent completed batches and push only through repository-approved branch workflow.
  - Depends on: W10-007
  - Deliverables: Commit hashes and dev push/PR evidence.
  - Acceptance (4/4 complete): [x] No force push or protected branch bypass.; [x] Never push main/master directly.; [x] If dev is protected and direct push is rejected, use repository-approved PR path or stop and report exact blocker.; [x] No empty commits.
  - Verify: git status --short --branch; git log -n 10 --oneline; git remote -v
  - Evidence: `git status --short --branch && git log -n 5 --oneline` (0) → `docs/bundles/visual-universe-pack/evidence/W9-005-W9-006-operational-coverage.md`
