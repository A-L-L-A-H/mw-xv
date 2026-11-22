# Atomic Task Board

**Total: 109 tasks.** Canonical state is `task.json`; this file is generated from it.

Status counts: done 43 · skipped 3 · in_progress 1 · blocked 7 · todo 55.

## W0

- [x] **W0-001 — Revalidate repository baseline**
  - Goal: Confirm repository root, branch and exact HEAD before any modification.
  - Depends on: none
  - Deliverables: Baseline report with current SHA, worktree state, branch protection observations.
  - Acceptance: Repository is A-L-L-A-H/mw-xv.; Work begins from latest dev; no hard reset, force push or destructive checkout.; Record current HEAD and dirty files.
  - Verify: git status --short --branch; git rev-parse HEAD
  - Evidence: `git status --short --branch` (0) → `evidence/W0-001-baseline.md`; `git rev-parse HEAD` (0) → `evidence/W0-001-baseline.md`; `git ls-remote origin refs/heads/dev` (0) → `evidence/W0-001-baseline.md`

- [x] **W0-002 — Inventory all workspace packages and apps**
  - Goal: Refresh package inventory from pnpm workspace rather than relying on this pack snapshot.
  - Depends on: W0-001
  - Deliverables: Updated package/app inventory and dependency graph.
  - Acceptance: All workspace package.json files are accounted for.; Apps are separately identified from packages.; No new duplicate package is proposed without a demonstrated consumer.
  - Verify: pnpm -r list --depth -1; inspect pnpm-workspace.yaml and package.json
  - Evidence: `pnpm -r list --depth -1` (0) → `evidence/W0-002-workspace-inventory.md`; `inspect pnpm-workspace.yaml and app/package manifests` (0) → `evidence/W0-002-workspace-inventory.md`

- [x] **W0-003 — Revalidate active addon registry**
  - Goal: Refresh API addon registry, manifests, dependencies, postInstall hooks and routes.
  - Depends on: W0-001
  - Deliverables: Addon registry map and addon-to-domain inventory.
  - Acceptance: All active manifests are found from actual registry, not folder-name guessing.; Health/runtime modules without ORM manifest are identified separately.; No DB migrations or seeds are changed by this audit task.
  - Verify: pnpm --filter @moonwitness/api build
  - Evidence: `pnpm --filter @moonwitness/api typecheck` (1) → `evidence/W0-003-addon-registry.md`; `pnpm --filter @moonwitness/api build` (0) → `evidence/W0-003-addon-registry.md`

- [x] **W0-004 — Revalidate asset and UI baseline**
  - Goal: Refresh asset count, schema version, generator ownership, current UI exports, FX and consumers.
  - Depends on: none
  - Deliverables: Asset/UI baseline with exact counts and source paths.
  - Acceptance: manifest and license manifest are read directly.; Generator ownership and package exports are documented.; Newer dev commits are preserved; do not revert existing grunge/anime kinetics changes.
  - Verify: pnpm assets:validate; pnpm test:ui
  - Evidence: `pnpm assets:validate` (0) → `evidence/W0-004-assets-ui-baseline.md`; `pnpm test:ui` (1) → `evidence/W0-004-assets-ui-baseline.md`; `pnpm test:ui` (0) → `evidence/W0-004-assets-ui-baseline.md`

- [x] **W0-005 — Map addon data to actual UI consumers**
  - Goal: Trace each active addon to its real routes, views, screens, permission boundaries and user-visible states.
  - Depends on: none
  - Deliverables: Domain-to-screen-to-asset matrix with verified references.
  - Acceptance: No fictional route, menu, model or functionality is invented.; Unmapped domains are labelled not found/unverified, not assumed.; Static visual assets remain outside ORM domain manifests.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck
  - Evidence: `pnpm board:ui:check` (0) → `evidence/W0-005-domain-consumers.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `evidence/W0-005-domain-consumers.md`; `pnpm --filter @moonwitness/api build` (0) → `evidence/W0-005-domain-consumers.md`

- [x] **W0-006 — Create implementation delta report**
  - Goal: Compare current code with this pack and adjust task backlog to avoid duplication.
  - Depends on: W0-002, W0-003, W0-004, W0-005
  - Deliverables: Baseline delta document and updated dependency decisions.
  - Acceptance: Existing implementations are reused.; Task IDs remain stable unless a task is explicitly retired with reason.; No task is marked done without repository evidence.
  - Verify: git diff --check; review task.json dependency integrity
  - Evidence: `node MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/tools/sync-task-state.mjs` (0) → `evidence/W0-006-implementation-delta.md`; `node MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/tools/sync-task-state.mjs --check` (0) → `evidence/W0-006-implementation-delta.md`; `git diff --check` (0) → `evidence/W0-006-implementation-delta.md`; `git diff --cached --check` (0) → `evidence/W0-006-implementation-delta.md`

## W1

- [x] **W1-001 — Approve canonical MoonWitness art direction**
  - Goal: Formalize the user's zine/punk/manga reference into a production-grade visual bible while preserving current brand identity.
  - Depends on: W0-006
  - Deliverables: Visual Bible section: art direction, palette roles, linework, cel shading, grunge, composition and exclusions.
  - Acceptance: Primary identity remains MoonWitness XV, not a generic anime template.; Reference DNA is interpreted, not copied from copyrighted franchises.; Black/ink, paper/white, hot magenta, electric blue/cyan and signal yellow are token-mapped.; Grunge, manga ink, photocopy, ripped paper and urban anime environment have controlled intensity tiers.
  - Verify: visual review via UI Catalog
  - Evidence: `user approval in chat; checked existing UI token palette and WCAG AA tests` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/art-direction-proposal.md`

- [x] **W1-002 — Define visual grammar by experience tier**
  - Goal: Separate immersive story surfaces from operational UI and functional admin surfaces.
  - Depends on: W1-001
  - Deliverables: Experience-tier rules and examples.
  - Acceptance: Living World pages may use cinematic scenes and sustained movement within budgets.; Board tables/forms/data remain readable and interaction-first.; Micro-interaction, editorial, cinematic and ambient animation have separate use policies.
  - Verify: documentation review
  - Evidence: `approved-direction design specification against current UI tokens, fonts, assets and source` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/experience-tier-grammar.md`

- [ ] **W1-003 — Define character identity rules** — **IN PROGRESS**
  - Goal: Specify repeatable identity sheets and safe depiction rules for recurring cast.
  - Depends on: W1-001
  - Deliverables: Character Bible template and continuity contract.
  - Acceptance: Stable character IDs, silhouette, proportions, outfit, palette and signature props.; Default crew art can use anonymous/back-facing hooded silhouettes; identifiable faces require approved identity design.; No random changes to face, hair, clothing or body proportions across scenes.; Do not depict Allah or represent sacred figures visually; use text/name only where product content explicitly requires it.
  - Verify: character bible schema validation
  - Evidence: `character policy/template review` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/character-bible-template.md`

- [x] **W1-004 — Define anime rendering and color pipeline**
  - Goal: Specify line weight, cel-shading, shadows, highlight, grain and color grading.
  - Depends on: W1-001
  - Deliverables: Rendering style guide and reference sheet specification.
  - Acceptance: Every production asset declares a style/renderer profile.; Lighting and color grading remain consistent across scene packs.; Do not bake interface labels or dynamic data into artwork.
  - Verify: visual contact sheet review
  - Evidence: `approved-direction design specification against current UI tokens, fonts, assets and source` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/rendering-color-profile.md`

- [x] **W1-005 — Define typography and lettering layers**
  - Goal: Keep graphic lettering separate from product copy and provide approved fonts/license handling.
  - Depends on: W1-001
  - Deliverables: Typography/lettering policy and asset brief.
  - Acceptance: UI copy remains live text.; Artwork lettering is decorative only and separately authored/licensed.; Font files and subsets retain source/hash/license provenance.
  - Verify: pnpm assets:validate
  - Evidence: `approved-direction design specification against current UI tokens, fonts, assets and source` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/typography-lettering-policy.md`

- [ ] **W1-006 — Define art composition and responsive rules** — **BLOCKED:** Responsive composition rules have been drafted, but acceptance explicitly requires a responsive UI Catalog preview. The diagnosed Playwright/Vite preview gate failure is recorded in evidence/approval-followup-checks.md; retry exhausted.
  - Goal: Specify wide, tall, square, panel, hero and parallax-safe compositions.
  - Depends on: W1-001, W1-002
  - Deliverables: Composition recipes and focal-safe-area rules.
  - Acceptance: Desktop/mobile assets have deliberate art direction, not blind center crops.; Focal points and text-safe areas are explicit.; No important character feature is unintentionally cut at supported breakpoints.
  - Verify: responsive UI catalog preview
  - Evidence: `asset-tool availability audit and/or responsive catalog verification retry` (1) → `evidence/moon-city-asset-tool-blocker.md; evidence/approval-followup-checks.md`

- [x] **W1-007 — Define accessibility and motion principles** — **SKIPPED:** Accessibility and motion policy is already implemented in packages/ui/README.md, TOKENS.md, tokens.css and components.css. Existing tests verify muted-by-default audio, explicit playback, reduced motion, focus and non-interactive decorative FX; no duplicate policy layer was added.
  - Goal: Set reduced-motion, alternative static scene, keyboard, captions and sound consent rules.
  - Depends on: none
  - Deliverables: Accessibility and motion policy.
  - Acceptance: Information never depends on animation/audio.; Reduced-motion produces meaningful static/low-motion scene.; Sound remains muted until explicitly enabled.; No effects block focus, text selection or pointer interaction.
  - Verify: pnpm test:ui; pnpm test:ui-catalog
  - Evidence: `node --test packages/ui/tests/audio.test.mjs packages/ui/tests/effects.test.mjs` (0) → `evidence/W0-006-implementation-delta.md`; `node --test --test-name-pattern "reduced motion|interactive surfaces expose opt-in feedback" packages/ui/tests/tokens.test.mjs` (0) → `evidence/W0-006-implementation-delta.md`; `pnpm test:ui` (0) → `evidence/W0-004-assets-ui-baseline.md`; `pnpm test:ui-catalog` (0) → `evidence/W0-006-implementation-delta.md`

- [x] **W1-008 — Publish Visual Universe Bible**
  - Goal: Consolidate approved decisions into canonical docs without duplicating existing UI Bible.
  - Depends on: W1-001, W1-002, W1-003, W1-004, W1-005, W1-006, W1-007
  - Deliverables: Canonical visual universe guide and links from existing design docs.
  - Acceptance: Single source of truth is identified.; Existing docs are updated by linking/targeted additions, not copied into competing versions.; Open decisions are clearly listed.
  - Verify: pnpm docs:check; pnpm docs:links
  - Evidence: `pnpm docs:check:built` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/approval-followup-checks.md`; `pnpm docs:links` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/approval-followup-checks.md`

## W2

- [x] **W2-001 — Design backward-compatible asset manifest extension**
  - Goal: Extend existing manifest only where needed for stable asset IDs, pack/domain tags, source and variants.
  - Depends on: W0-004, W1-008
  - Deliverables: Versioned schema proposal and fixtures.
  - Acceptance: Keep one canonical packages/assets/manifest.json.; Keep existing package license/provenance source of truth.; Do not create competing master inventories.; Old assets remain readable or have a deterministic converter.
  - Verify: node --test packages/assets/tests/*.test.mjs
  - Evidence: `node --test packages/assets/tests/*.test.mjs` (0) → `23 asset tests passed against the legacy v1 manifest and path-based canonical inventory`

- [x] **W2-002 — Implement manifest schema validation**
  - Goal: Implement schema validation for the approved asset metadata extension.
  - Depends on: W2-001
  - Deliverables: Schema validator, valid/invalid fixtures and tests.
  - Acceptance: Reject duplicate IDs/paths, malformed variants and invalid references.; Support source/master/generated relationships.; Validation errors include file and field context.
  - Verify: pnpm test:assets
  - Evidence: `pnpm test:assets` (0) → `evidence/W2-002-schema-validation.md`

- [x] **W2-003 — Extend license and provenance contract**
  - Goal: Add creator, source method, upstream source, license, generated date, modifications and approval status.
  - Depends on: W2-001
  - Deliverables: Provenance validator and docs.
  - Acceptance: No unknown or blank licensing metadata for distributable assets.; AI-generated content is labelled accurately with applicable terms verified.; Unverified source is marked blocked/non-distributable.
  - Verify: pnpm test:assets
  - Evidence: `pnpm test:assets` (0) → `evidence/W2-003-provenance-validation.md`

- [x] **W2-004 — Define source, master and generated ownership rules** — **SKIPPED:** Existing explicit generator ownership helper and focused tests satisfy all acceptance criteria; verified against current source.
  - Goal: Ensure each generator only replaces the paths it owns.
  - Depends on: W2-002
  - Deliverables: Generator ownership registry and tests.
  - Acceptance: Existing manifest ownership helper is reused.; Manual/master assets cannot be deleted by generators.; Generators are deterministic and idempotent.
  - Verify: pnpm test:assets
  - Evidence: `pnpm test:assets` (0) → `evidence/W2-004-existing-ownership.md`

- [x] **W2-005 — Build asset inventory and query tooling**
  - Goal: Provide CLI/report output filtered by pack, category, subject, domain, format and status.
  - Depends on: W2-002
  - Deliverables: Asset inventory command and test fixtures.
  - Acceptance: Inventory uses canonical manifest.; Source files and distributable files are distinguishable.; Orphans and broken references are reported.
  - Verify: pnpm test:assets
  - Evidence: `pnpm test:assets` (0) → `evidence/W2-005-asset-inventory.md`; `pnpm --filter @moonwitness/assets inventory --pack=moon-city` (0) → `evidence/W2-005-asset-inventory.md`

- [ ] **W2-006 — Build responsive image derivative pipeline**
  - Goal: Extend Sharp generation for responsive artwork variants, AVIF/WebP where suitable and focal-safe crops.
  - Depends on: W2-004, W1-006
  - Deliverables: Responsive derivative generation and metadata.
  - Acceptance: Master files are never overwritten.; Quality/size presets are documented and measured.; No unconditional AVIF migration without browser compatibility evidence.
  - Verify: pnpm assets:generate; pnpm assets:validate

- [ ] **W2-007 — Build transparent layered-art export pipeline**
  - Goal: Define and implement layer asset handling for PNG/WebP/AVIF/SVG outputs while preserving alpha.
  - Depends on: W2-002, W2-006
  - Deliverables: Layer validation/export utility and sample fixtures.
  - Acceptance: Transparent layer dimensions and origins align exactly.; Layer ordering and pivot/focal metadata preserved.; No flattening of runtime layers into a single image.
  - Verify: pnpm test:assets

- [x] **W2-008 — Add sprite sheet and frame-sequence metadata**
  - Goal: Define frame dimensions, frame count, timing, loop, direction, pivot and atlas references.
  - Depends on: W2-002
  - Deliverables: Sprite sheet metadata validator and generated preview.
  - Acceptance: Frame bounds are valid.; Timing and playback metadata are deterministic.; Frames are not generated from an unreviewed single raster crop.
  - Verify: pnpm test:assets
  - Evidence: `pnpm test:assets` (0) → `evidence/W2-008-sprite-metadata.md; evidence/sprite-sheet-metadata-guide.svg`

- [x] **W2-009 — Add scene and animation metadata contracts**
  - Goal: Define scene descriptors and animation clips that reference canonical asset IDs.
  - Depends on: W2-002, W2-008
  - Deliverables: Scene schema and animation metadata schema.
  - Acceptance: References resolve through canonical asset manifest.; Scene files contain layout/animation data, not embedded secrets or domain business records.; No cyclic references.
  - Verify: schema fixture tests
  - Evidence: `pnpm test:assets` (0) → `evidence/W2-009-scene-contracts.md`

- [ ] **W2-010 — Update package exports, pack list and docs sync**
  - Goal: Ensure every public asset category is included in build/package and docs asset sync.
  - Depends on: W2-005, W2-006, W2-007, W2-008, W2-009
  - Deliverables: Explicit package exports and pack verification tests.
  - Acceptance: Only intended runtime outputs are shipped.; High-resolution source/master assets are not copied into consumer bundles by default.; Asset package remains framework-independent and zero-runtime-dependency.
  - Verify: pnpm --filter @moonwitness/assets pack --dry-run; pnpm test:assets

- [ ] **W2-011 — Build contact-sheet generator for all packs**
  - Goal: Generate deterministic contact sheets grouped by pack/category/character/scene.
  - Depends on: W2-005, W2-010
  - Deliverables: Contact sheet generator and docs output.
  - Acceptance: Contact sheets include stable IDs and variants.; No generated docs or binary output is committed without repository conventions.; Image rendering works in existing Playwright/Sharp tooling.
  - Verify: pnpm assets:render; pnpm assets:validate

- [ ] **W2-012 — Add duplicate, size and orphan asset gates**
  - Goal: Extend QA for duplicates, oversized files, unused outputs and wrong generated folder ownership.
  - Depends on: W2-005, W2-010
  - Deliverables: Asset quality report and thresholds.
  - Acceptance: Thresholds are based on measured consumer budgets.; Large source masters are exempt from runtime budgets but included in repository tracking review.; All exceptions are documented and narrow.
  - Verify: pnpm test:assets; pnpm ui:budget

## W3

- [ ] **W3-001 — Create canonical character registry**
  - Goal: Define character IDs, role, silhouette, palette, proportions, outfit and continuity metadata.
  - Depends on: W1-003, W2-009
  - Deliverables: Character registry specification and initial template.
  - Acceptance: Each recurring character has one stable identity.; No character is bound to an AI provider/model identity.; Default crew figures may remain anonymous/back-facing unless identity is approved.
  - Verify: character schema tests

- [ ] **W3-002 — Create first canonical MoonWitness crew character sheet**
  - Goal: Produce/review one canonical character sheet as the pilot for production quality.
  - Depends on: W3-001, W1-004
  - Deliverables: Master character sheet with front/side/back, scale, silhouette and palette.
  - Acceptance: Anatomy, linework, outfit and silhouette pass review.; Character remains consistent with Visual Bible.; Source master and provenance recorded.
  - Verify: contact sheet review

- [ ] **W3-003 — Create expression and facial-state sheet**
  - Goal: Prepare approved eye/mouth/expression variants only for characters requiring visible facial animation.
  - Depends on: W3-002
  - Deliverables: Expression sheet and state mapping.
  - Acceptance: Expression shapes preserve identity.; No unnecessary face visibility for anonymous crew designs.; Variants are named and measurable.
  - Verify: character consistency review

- [ ] **W3-004 — Create pose and gesture library**
  - Goal: Prepare reusable static poses and gestures for narrative scenes.
  - Depends on: W3-002
  - Deliverables: Pose pack and metadata.
  - Acceptance: Poses do not alter character identity/outfit.; Pose IDs are stable and previewable.; Pose usage/licensing is recorded.
  - Verify: contact sheet review

- [ ] **W3-005 — Separate character layers and pivots**
  - Goal: Prepare layered masters for selected pilot character with pivots and hierarchy.
  - Depends on: W3-002, W2-007
  - Deliverables: Layered source files, pivot metadata and preview.
  - Acceptance: Body/hair/arm/prop layers align without visible seams.; Layer names and pivots are stable.; Source remains editable.
  - Verify: layer alignment test; visual preview

- [ ] **W3-006 — Create idle and breathing animation clip**
  - Goal: Create subtle idle/breathing clip for pilot character.
  - Depends on: W3-005, W2-008
  - Deliverables: Idle clip and animation metadata.
  - Acceptance: Loop is seamless.; Movement is subtle and intentional.; Reduced-motion has a still pose fallback.
  - Verify: animation playback test

- [ ] **W3-007 — Create blink and hair movement variants**
  - Goal: Add optional blink/hair movement as separated clips or states.
  - Depends on: W3-003, W3-005, W3-006
  - Deliverables: Blink/hair animation metadata and previews.
  - Acceptance: No forced facial detail where design is anonymous.; Loop/state triggers behave deterministically.; Animation can pause offscreen.
  - Verify: animation playback test

- [ ] **W3-008 — Create walk and turn animation prototype**
  - Goal: Produce a small representative movement set for pilot character.
  - Depends on: W3-005, W2-008
  - Deliverables: Walk/turn prototype clips and docs.
  - Acceptance: Frame timing/pivots are correct.; No foot sliding beyond approved style.; A static pose fallback always exists.
  - Verify: sprite/rig preview

- [ ] **W3-009 — Build character preview renderer**
  - Goal: Provide deterministic preview for turnaround, layers, poses and clips in UI Catalog/Creative Lab.
  - Depends on: W3-001, W3-006, W2-009
  - Deliverables: Character preview specimen and tests.
  - Acceptance: Preview loads by asset ID.; No business data or backend route is embedded.; Playback can pause, reset and switch state.
  - Verify: pnpm test:ui-catalog

## W4

- [ ] **W4-001 — Define Moon City environment kit** — **BLOCKED:** Environment Bible and reviewed contact sheet exist, but final responsive scene preview is not accepted and W1-006 remains blocked; cannot complete required review/dependency gate. Image generation was available; see evidence/moon-city-asset-tool-blocker.md.
  - Goal: Specify canonical visual environment, lighting, perspective and prop vocabulary.
  - Depends on: W1-004, W1-006
  - Deliverables: Environment Bible and shot breakdown.
  - Acceptance: Moon City palette/lighting matches canonical world.; Environment modules can be reused across pages.; No embedded interface copy/statistics.
  - Verify: environment contact sheet review
  - Evidence: `Moon City source and contact-review acceptance audit` (0) → `evidence/moon-city-asset-tool-blocker.md; evidence/moon-city-layer-contact-review.png`

- [ ] **W4-002 — Produce Moon City sky and moon layers** — **BLOCKED:** Partial source set exists and is inventoried. Complete transparent sky/moon layer set and responsive safe-zone review are missing; generated rasters are non-distributable pending terms review. See evidence/moon-city-asset-tool-blocker.md.
  - Goal: Create master sky/moon layers with alpha and responsive safe zones.
  - Depends on: W4-001, W2-007
  - Deliverables: Sky and moon source assets and variants.
  - Acceptance: Layer boundaries and transparent alpha are valid.; Moon is not flattened into unrelated foreground.; Focal point metadata exists.
  - Verify: pnpm test:assets; visual preview
  - Evidence: `Moon City source and contact-review acceptance audit` (0) → `evidence/moon-city-asset-tool-blocker.md; evidence/moon-city-layer-contact-review.png`

- [ ] **W4-003 — Produce cloud and atmosphere layers** — **BLOCKED:** A hand-authored static cloud SVG exists, but no loop seam preview or reviewed atmospheric pack exists. See evidence/moon-city-asset-tool-blocker.md.
  - Goal: Create clouds, haze and atmospheric depth layers.
  - Depends on: W4-002
  - Deliverables: Cloud/haze pack with animation suitability notes.
  - Acceptance: Layers are loopable or static as declared.; No visible seams in looping movement.; Opacity does not obscure required text.
  - Verify: visual preview
  - Evidence: `Moon City source and contact-review acceptance audit` (0) → `evidence/moon-city-asset-tool-blocker.md; evidence/moon-city-layer-contact-review.png`

- [ ] **W4-004 — Produce distant and midground city layers** — **BLOCKED:** Generated opaque skyline source and derived cutout exist, but clean alpha/perspective/mobile preview and distribution rights remain unverified. See evidence/moon-city-asset-tool-blocker.md.
  - Goal: Create background skyline and city silhouettes.
  - Depends on: W4-001, W2-007
  - Deliverables: Distant/midground city pack.
  - Acceptance: Perspective and lighting match scene bible.; Layer depth order is documented.; Desktop and mobile composition is supported.
  - Verify: visual preview
  - Evidence: `Moon City source and contact-review acceptance audit` (0) → `evidence/moon-city-asset-tool-blocker.md; evidence/moon-city-layer-contact-review.png`

- [ ] **W4-005 — Produce foreground rooftop and props** — **BLOCKED:** A hand-authored foreground SVG exists, but safe occlusion and clean responsive preview acceptance are outstanding. See evidence/moon-city-asset-tool-blocker.md.
  - Goal: Create railing, rooftop, wires, signs and safe foreground occluders.
  - Depends on: W4-001, W2-007
  - Deliverables: Foreground and prop pack.
  - Acceptance: Alpha edges are clean.; Foreground does not obscure text/controls.; Scene layers are separately addressable.
  - Verify: visual preview
  - Evidence: `Moon City source and contact-review acceptance audit` (0) → `evidence/moon-city-asset-tool-blocker.md; evidence/moon-city-layer-contact-review.png`

- [ ] **W4-006 — Create alternate MoonWitness environments** — **BLOCKED:** Alternate underground/archive/rooftop/street environment assets and contact sheet have not been produced. See evidence/moon-city-asset-tool-blocker.md.
  - Goal: Produce reusable underground, archive, rooftop and street environment briefs/assets.
  - Depends on: W4-001, W4-004, W4-005
  - Deliverables: Environment coverage pack and metadata.
  - Acceptance: Each environment has coherent visual identity.; Reusable shared props are canonical.; No per-addon duplicated copy of the same background.
  - Verify: contact sheet review
  - Evidence: `Moon City source and contact-review acceptance audit` (0) → `evidence/moon-city-asset-tool-blocker.md; evidence/moon-city-layer-contact-review.png`

- [ ] **W4-007 — Define environment animation channels**
  - Goal: Specify which layers move, speed ranges, loop duration and pause conditions.
  - Depends on: W4-002, W4-003, W4-004, W4-005
  - Deliverables: Environment animation map.
  - Acceptance: Motion is subtle, bounded and deterministic.; No default infinite heavy animation on operational pages.; Reduced motion maps to a static composite.
  - Verify: scene contract tests

- [ ] **W4-008 — Build environment preview and depth inspector**
  - Goal: Preview isolated planes and order with background transparency.
  - Depends on: W4-007, W3-009
  - Deliverables: Environment preview specimen/tool.
  - Acceptance: All planes can be toggled and reordered.; Pivots/origins are inspectable.; Preview is usable on narrow viewports.
  - Verify: pnpm test:ui-catalog

## W5

- [x] **W5-001 — Choose animation engine boundary**
  - Goal: Audit existing Motion dependency in Board and choose CSS/SVG/Motion first; adapter seams for specialist character SDKs.
  - Depends on: W0-006, W1-007
  - Deliverables: Decision record and dependency/licensing matrix.
  - Acceptance: Use existing motion package where capable.; Do not add GSAP/Rive/Live2D/Three/Pixi by default.; Paid/proprietary SDK requires explicit human approval.; No runtime dependency is added to assets package.
  - Verify: dependency graph review; bundle baseline
  - Evidence: `user approval in chat; dependency source search` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/motion-boundary-proposal.md`; `pnpm ui:budget` (0) → `catalog JavaScript and stylesheet remain within declared raw/gzip budgets`

- [ ] **W5-002 — Define scene runtime contracts**
  - Goal: Specify SceneDefinition, LayerDefinition, CameraDefinition, Clip, Event, State and fallback contracts.
  - Depends on: W2-009, W5-001
  - Deliverables: Typed scene/runtime contract design.
  - Acceptance: Assets are referenced by stable IDs.; No business-domain state is stored in scene manifests.; Scene data is serializable and validated.
  - Verify: typecheck; schema tests

- [ ] **W5-003 — Implement scene descriptor validation**
  - Goal: Validate layers, ordering, bounds, animation refs, breakpoints and accessibility fallbacks.
  - Depends on: W5-002, W2-002
  - Deliverables: Scene validator and test fixtures.
  - Acceptance: Reject missing assets, cyclic references, invalid depth and missing fallback.; Reports actionable file/field locations.
  - Verify: unit tests

- [ ] **W5-004 — Implement scene lifecycle and playback controller**
  - Goal: Create deterministic play/pause/seek/reset lifecycle with visibility and unmount cleanup.
  - Depends on: W5-002, W5-001
  - Deliverables: Scene playback controller and unit tests.
  - Acceptance: No leaked observers/timers/listeners.; Offscreen scenes pause when appropriate.; Reduced-motion/static mode is respected.
  - Verify: unit tests; browser lifecycle test

- [ ] **W5-005 — Implement layered scene renderer**
  - Goal: Render ordered image/vector/video-frame layers in a responsive scene viewport.
  - Depends on: W5-003, W5-004, W2-007
  - Deliverables: Scene renderer component.
  - Acceptance: Layer order, opacity, transform, blend and clipping are typed.; No giant full-page screenshot mockup as background.; Static fallback if animation runtime cannot initialize.
  - Verify: pnpm test:ui; pnpm test:ui-catalog

- [ ] **W5-006 — Implement camera and parallax controller**
  - Goal: Support bounded camera pan/zoom and pointer/scroll linked depth movement.
  - Depends on: W5-005, W4-007
  - Deliverables: Camera/parallax system and specimens.
  - Acceptance: Respect prefers-reduced-motion.; No perpetual motion on data views.; No scroll hijacking.; Touch/keyboard remain usable.
  - Verify: browser interaction tests

- [ ] **W5-007 — Implement animation timeline orchestration**
  - Goal: Coordinate scene entrance, layer transitions, clips and event triggers.
  - Depends on: W5-004, W5-005
  - Deliverables: Timeline API and deterministic preview.
  - Acceptance: Timeline can play/pause/restart and complete.; Navigation does not trap user waiting for animation.; No unbounded recursive timeline.
  - Verify: unit tests; browser tests

- [ ] **W5-008 — Implement character adapter contract**
  - Goal: Create adapter interface to play approved sprite/rig/clip assets without hard-coding one vendor.
  - Depends on: W5-002, W3-009
  - Deliverables: Character renderer adapter contract and basic implementation.
  - Acceptance: Sprite/image sequence is supported in baseline.; Rive/Live2D adapters remain optional and isolated.; Character identity data is separate from playback engine.
  - Verify: adapter tests

- [ ] **W5-009 — Implement sprite-sequence playback**
  - Goal: Render sprite sequences with timing, loop, pause, scale and fallback.
  - Depends on: W5-008, W2-008
  - Deliverables: Sprite player component and tests.
  - Acceptance: Frame count and duration follow metadata.; Playback pauses offscreen and on reduced-motion.; No memory leak after source replacement/unmount.
  - Verify: unit tests; browser tests

- [ ] **W5-010 — Implement deterministic camera/scene test harness**
  - Goal: Provide test controls for fixed frame/time, reduced motion and deterministic scene snapshots.
  - Depends on: W5-005, W5-006, W5-007
  - Deliverables: Scene test harness.
  - Acceptance: Snapshots do not capture mid-transition nondeterministically.; Animation can be disabled or pinned to known timeline state.; Visual regression includes key viewports.
  - Verify: pnpm test:ui-catalog

- [ ] **W5-011 — Decide runtime package extraction**
  - Goal: Extract a separate scene-runtime package only if more than one consumer needs stable reusable contracts.
  - Depends on: W5-004, W5-005, W5-006, W5-007, W5-008
  - Deliverables: Extraction decision, package boundary or documented no-extraction result.
  - Acceptance: No speculative package proliferation.; If extracted, zero app route/auth/domain knowledge.; Package exports and consumers are explicit.
  - Verify: workspace build; package verification

- [ ] **W5-012 — Integrate optional rig engine proof of concept**
  - Goal: Only if visual need is demonstrated, implement one isolated proof using approved licensing and bundle budget.
  - Depends on: W5-001, W5-008, W5-011
  - Deliverables: POC report; otherwise explicit skipped decision.
  - Acceptance: No proprietary assets or paid licensing without approval.; No required SDK in default asset/UI package.; Fallback sprite/2.5D scene remains complete.
  - Verify: license review; bundle budget; browser playback test

## W6

- [x] **W6-001 — Inventory and preserve existing anime FX**
  - Goal: Audit all exported effects and CSS keyframes including latest raw-art grunge kinetics.
  - Depends on: W0-004
  - Deliverables: FX reuse map and gap list.
  - Acceptance: Existing effects are not duplicated.; Latest dev commit and budget changes are preserved.; Effects are grouped by UI micro, cinematic and ambient.
  - Verify: pnpm test:ui
  - Evidence: `source inventory of shared FX exports, CSS keyframes, motion tokens and reduced-motion/audio behavior` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/fx-reuse-map.md`; `pnpm test:ui` (0) → `59 UI tests and packed consumer verification passed`

- [x] **W6-002 — Define cinematic FX contracts**
  - Goal: Define impact, frame-freeze, slash, transition, particles, glow and camera shake with safe intensity levels.
  - Depends on: W6-001, W1-007
  - Deliverables: FX contract and design examples.
  - Acceptance: All FX have static/reduced-motion alternative.; No FX covers controls or content.; Intensity and duration are bounded.
  - Verify: FX preview review
  - Evidence: `reviewed packages/ui/src/components/effects.tsx, component styles/tokens, reduced-motion tests and fx-reuse-map` (0) → `evidence/cinematic-fx-contract.md`

- [ ] **W6-003 — Implement bounded scene particle effects**
  - Goal: Build measured lightweight particle presets for rain, dust, stars and sparks.
  - Depends on: W6-002, W5-004
  - Deliverables: Particle presets and performance tests.
  - Acceptance: Particle count and frame time are bounded.; Pause offscreen/unmounted.; Static fallback supported.
  - Verify: browser performance test

- [ ] **W6-004 — Implement comic scene transition pack**
  - Goal: Build reusable ink wipe, panel reveal, cut/impact and soft transition.
  - Depends on: W6-002, W5-007
  - Deliverables: Transition components and specimens.
  - Acceptance: Transitions are interruptible and do not block navigation.; Keyboard and reduced-motion work.; No content remains hidden on animation failure.
  - Verify: pnpm test:ui-catalog

- [x] **W6-005 — Create environment ambience pack** — **SKIPPED:** Existing localized UI sound consent and provenance are verified in evidence/audio-consent-audit.md. The distinct scene ambience deliverable is not authorized/generated: W1-001 canonical art direction and W2-003 soundscape provenance contract are still gated/uncompleted, and no additional ambience asset is claimed. Reopen when the dependent scene audio contract is approved.
  - Goal: Create/procure approved short ambient loops and document provenance.
  - Depends on: W1-007, W2-003
  - Deliverables: Optional ambience masters and optimized variants.
  - Acceptance: No copyrighted music or unlicensed sound effects.; User must explicitly enable ambience.; Audio is lazy-loaded and has mute/stop lifecycle.
  - Verify: audio tests; provenance validation
  - Evidence: `pnpm test:assets` (0) → `27 asset tests, canonical audio provenance and short PCM budget passed`; `pnpm test:ui` (0) → `audio interaction-consent tests passed within 59 UI tests`

- [ ] **W6-006 — Implement scene soundscape controller**
  - Goal: Integrate optional scene ambience without coupling playback to hover/scroll.
  - Depends on: W6-005, W5-004
  - Deliverables: Soundscape controller and settings integration.
  - Acceptance: Default is muted.; One or policy-limited set of sources only; avoid overlapping loops.; Scene changes stop/fade old ambience.; Audio failure cannot break UX.
  - Verify: pnpm test:ui; browser audio tests

- [ ] **W6-007 — Create FX contact sheet and preview catalogue**
  - Goal: Expose each effect in UI Catalog with light/dark, reduced-motion and intensity variants.
  - Depends on: W6-002, W6-003, W6-004
  - Deliverables: FX catalogue specimen and snapshots.
  - Acceptance: All FX have documented intended use and anti-pattern.; No duplicate one-off CSS effect outside shared package without reason.
  - Verify: pnpm test:ui-catalog

## W7

- [x] **W7-001 — Audit existing UI Catalog architecture**
  - Goal: Map current specimens, state controls, screenshot harness and bundle budget.
  - Depends on: W0-006
  - Deliverables: Creative Lab integration plan.
  - Acceptance: Extend existing app and test harness.; Do not create a duplicate catalog app.
  - Verify: pnpm test:ui-catalog
  - Evidence: `pnpm test:ui-catalog` (0) → `25 Playwright browser tests passed during W0 baseline; existing harness/source map in evidence/ui-catalog-audit.md`

- [x] **W7-002 — Add asset browser specimen**
  - Goal: Browse canonical assets by category, pack, subject, domain, variant and status.
  - Depends on: W7-001, W2-005
  - Deliverables: Asset browser UI with deterministic fixture data.
  - Acceptance: Uses manifest data.; No fabricated production domain records.; Keyboard/filter/accessibility supported.
  - Verify: pnpm test:ui-catalog
  - Evidence: `pnpm test:ui-catalog` (0) → `evidence/W7-002-asset-browser.md; test-results/junit/ui-catalog.xml`

- [ ] **W7-003 — Add character studio specimen**
  - Goal: Preview identity sheets, poses, expressions and animation states.
  - Depends on: W7-002, W3-009, W5-008
  - Deliverables: Character Studio.
  - Acceptance: Character ID and state displayed as metadata.; Preview can pause/reset/switch variants.; No persistent editing API implied unless implemented.
  - Verify: pnpm test:ui-catalog

- [ ] **W7-004 — Add environment and layer inspector**
  - Goal: Toggle layers, change z-order, inspect pivots and preview breakpoints.
  - Depends on: W7-002, W4-008, W5-005
  - Deliverables: Environment/Layer Inspector.
  - Acceptance: Preview state can be reset to fixture baseline.; Does not mutate canonical assets.
  - Verify: pnpm test:ui-catalog

- [ ] **W7-005 — Add timeline and FX preview**
  - Goal: Provide play/pause/reset/scrub or discrete deterministic states for animation/FX.
  - Depends on: W7-003, W6-007, W5-007
  - Deliverables: Timeline/FX lab specimen.
  - Acceptance: Preview is deterministic in tests.; No autoplay with sound.; Does not require a production authoring server.
  - Verify: pnpm test:ui-catalog

- [ ] **W7-006 — Add responsive scene preview**
  - Goal: Preview desktop/tablet/mobile compositions and reduced-motion mode.
  - Depends on: W7-004, W7-005, W1-006
  - Deliverables: Responsive preview controls and screenshots.
  - Acceptance: Breakpoints are actual app breakpoints, not arbitrary labels.; Focal point and clipping can be reviewed side-by-side.
  - Verify: Playwright visual tests

- [ ] **W7-007 — Add asset and scene diagnostics panel**
  - Goal: Show missing refs, provenance gaps, size, format and scene validation.
  - Depends on: W7-002, W5-003, W2-012
  - Deliverables: Diagnostics panel and actionable messages.
  - Acceptance: Diagnostics sourced from validators.; No false green when validation has not run.; Can export report.
  - Verify: pnpm test:ui-catalog; pnpm assets:validate

## W8

- [x] **W8-D01 — Audit base addon visual requirements**
  - Goal: Inspect the real base models, views, menu/access rules, API routes and current Board consumer. Domain: People, partners, companies, users, activities, attachments, tags, records.
  - Depends on: W0-005
  - Deliverables: base domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance: Every model, view, route and permission cited is verified in current source.; Missing or unavailable consumer routes are explicitly marked, not invented.; Existing visual assets/components are identified for reuse.; ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/domains/base.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/W8-D-board-typecheck.md`

- [x] **W8-D02 — Audit auth addon visual requirements**
  - Goal: Inspect the real auth models, views, menu/access rules, API routes and current Board consumer. Domain: Identity, login, registration, security and session states.
  - Depends on: W0-005
  - Deliverables: auth domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance: Every model, view, route and permission cited is verified in current source.; Missing or unavailable consumer routes are explicitly marked, not invented.; Existing visual assets/components are identified for reuse.; ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/domains/auth.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/W8-D-board-typecheck.md`

- [x] **W8-D03 — Audit jobs addon visual requirements**
  - Goal: Inspect the real jobs models, views, menu/access rules, API routes and current Board consumer. Domain: Queues, jobs, scheduled work, execution and failure states.
  - Depends on: W0-005
  - Deliverables: jobs domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance: Every model, view, route and permission cited is verified in current source.; Missing or unavailable consumer routes are explicitly marked, not invented.; Existing visual assets/components are identified for reuse.; ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/domains/jobs.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/W8-D-board-typecheck.md`

- [x] **W8-D04 — Audit integration addon visual requirements**
  - Goal: Inspect the real integration models, views, menu/access rules, API routes and current Board consumer. Domain: Webhook endpoints, delivery and connector states.
  - Depends on: W0-005
  - Deliverables: integration domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance: Every model, view, route and permission cited is verified in current source.; Missing or unavailable consumer routes are explicitly marked, not invented.; Existing visual assets/components are identified for reuse.; ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/domains/integration.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/W8-D-board-typecheck.md`

- [x] **W8-D05 — Audit whatsapp addon visual requirements**
  - Goal: Inspect the real whatsapp models, views, menu/access rules, API routes and current Board consumer. Domain: Accounts, conversations, messages, media and contact states.
  - Depends on: W0-005
  - Deliverables: whatsapp domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance: Every model, view, route and permission cited is verified in current source.; Missing or unavailable consumer routes are explicitly marked, not invented.; Existing visual assets/components are identified for reuse.; ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/domains/whatsapp.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/W8-D-board-typecheck.md`

- [x] **W8-D06 — Audit request addon visual requirements**
  - Goal: Inspect the real request models, views, menu/access rules, API routes and current Board consumer. Domain: Purchase requests and approval lifecycle.
  - Depends on: W0-005
  - Deliverables: request domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance: Every model, view, route and permission cited is verified in current source.; Missing or unavailable consumer routes are explicitly marked, not invented.; Existing visual assets/components are identified for reuse.; ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/domains/request.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/W8-D-board-typecheck.md`

- [x] **W8-D07 — Audit notification addon visual requirements**
  - Goal: Inspect the real notification models, views, menu/access rules, API routes and current Board consumer. Domain: Inbox, unread/read/archived and channel states.
  - Depends on: W0-005
  - Deliverables: notification domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance: Every model, view, route and permission cited is verified in current source.; Missing or unavailable consumer routes are explicitly marked, not invented.; Existing visual assets/components are identified for reuse.; ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/domains/notification.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/W8-D-board-typecheck.md`

- [x] **W8-D08 — Audit organization addon visual requirements**
  - Goal: Inspect the real organization models, views, menu/access rules, API routes and current Board consumer. Domain: Departments, teams, positions, memberships and hierarchy.
  - Depends on: W0-005
  - Deliverables: organization domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance: Every model, view, route and permission cited is verified in current source.; Missing or unavailable consumer routes are explicitly marked, not invented.; Existing visual assets/components are identified for reuse.; ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/domains/organization.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/W8-D-board-typecheck.md`

- [x] **W8-D09 — Audit workflow addon visual requirements**
  - Goal: Inspect the real workflow models, views, menu/access rules, API routes and current Board consumer. Domain: Definitions, instances, transitions, approvals and event history.
  - Depends on: W0-005
  - Deliverables: workflow domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance: Every model, view, route and permission cited is verified in current source.; Missing or unavailable consumer routes are explicitly marked, not invented.; Existing visual assets/components are identified for reuse.; ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/domains/workflow.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/W8-D-board-typecheck.md`

- [x] **W8-D10 — Audit knowledge addon visual requirements**
  - Goal: Inspect the real knowledge models, views, menu/access rules, API routes and current Board consumer. Domain: Witness testimony, source, evidence, corrections, interpretations and research graph.
  - Depends on: W0-005
  - Deliverables: knowledge domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance: Every model, view, route and permission cited is verified in current source.; Missing or unavailable consumer routes are explicitly marked, not invented.; Existing visual assets/components are identified for reuse.; ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/domains/knowledge.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/W8-D-board-typecheck.md`

- [x] **W8-D11 — Audit orm-storage addon visual requirements**
  - Goal: Inspect the real orm-storage models, views, menu/access rules, API routes and current Board consumer. Domain: Attachment storage providers and lifecycle states; currently provider addon has no domain models.
  - Depends on: W0-005
  - Deliverables: orm-storage domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance: Every model, view, route and permission cited is verified in current source.; Missing or unavailable consumer routes are explicitly marked, not invented.; Existing visual assets/components are identified for reuse.; ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/domains/storage.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/W8-D-board-typecheck.md`

- [x] **W8-D12 — Audit ai addon visual requirements**
  - Goal: Inspect the real ai models, views, menu/access rules, API routes and current Board consumer. Domain: Agents, profiles, models, providers, contracts, runs, taskforces, skills and memory.
  - Depends on: W0-005
  - Deliverables: ai domain-to-screen-to-asset mapping with source paths and real states
  - Acceptance: Every model, view, route and permission cited is verified in current source.; Missing or unavailable consumer routes are explicitly marked, not invented.; Existing visual assets/components are identified for reuse.; ORM/API ownership boundaries remain unchanged.
  - Verify: focused source review; pnpm --filter @moonwitness/board typecheck
  - Evidence: `focused source review of addon manifest/models/views/access/API registry and Board consumers` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/domains/ai.md`; `pnpm --filter @moonwitness/board typecheck` (0) → `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/evidence/W8-D-board-typecheck.md`

- [x] **W8-001 — Implement visual coverage for base addon**
  - Goal: Implement only the verified base asset references, UI compositions and state treatments based on W8-D01. Domain: People, partners, companies, users, activities, attachments, tags, records.
  - Depends on: W8-D01, W2-005, W1-008
  - Deliverables: base addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance: Only real existing models/routes/permissions are represented.; Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; Artwork remains decorative; labels, state and actions are real UI data.; New assets include provenance and are registered in canonical manifest.; If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `pnpm --filter @moonwitness/board typecheck` (0) → `evidence/W8-001-base-visual-coverage.md`; `pnpm board:ui:check` (0) → `evidence/W8-001-base-visual-coverage.md`; `node --test scripts/board/model-icon-registry.test.mjs scripts/board/model-view-error-state.test.mjs` (0) → `evidence/W8-001-base-visual-coverage.md`

- [x] **W8-002 — Implement visual coverage for auth addon**
  - Goal: Implement only the verified auth asset references, UI compositions and state treatments based on W8-D02. Domain: Identity, login, registration, security and session states.
  - Depends on: W8-D02, W2-005, W1-008
  - Deliverables: auth addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance: Only real existing models/routes/permissions are represented.; Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; Artwork remains decorative; labels, state and actions are real UI data.; New assets include provenance and are registered in canonical manifest.; If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `pnpm test:ui-catalog` (0) → `evidence/W8-002-auth-visual-coverage.md; test-results/junit/ui-catalog.xml`; `pnpm --filter @moonwitness/ui-catalog build && pnpm ui:budget` (0) → `evidence/W8-002-auth-visual-coverage.md`

- [x] **W8-003 — Implement visual coverage for jobs addon**
  - Goal: Implement only the verified jobs asset references, UI compositions and state treatments based on W8-D03. Domain: Queues, jobs, scheduled work, execution and failure states.
  - Depends on: W8-D03, W2-005, W1-008
  - Deliverables: jobs addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance: Only real existing models/routes/permissions are represented.; Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; Artwork remains decorative; labels, state and actions are real UI data.; New assets include provenance and are registered in canonical manifest.; If no production consumer exists, provide a labelled UI Catalog specimen and document that gap; when a verified consumer exists, document and reuse it without inventing routes.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `node --test scripts/board/jobs-resource-state.test.mjs` (0) → `scripts/board/jobs-resource-state.test.mjs`; `pnpm --filter @moonwitness/board typecheck` (0) → `apps/board/src/board-pages/dashboard-page.tsx`; `pnpm board:ui:check` (0) → `scripts/check-board-shared-ui.mjs`; `pnpm test:assets` (0) → `packages/assets/tests`; `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/catalog.spec.ts`

- [x] **W8-004 — Implement visual coverage for integration addon**
  - Goal: Implement only the verified integration asset references, UI compositions and state treatments based on W8-D04. Domain: Webhook endpoints, delivery and connector states.
  - Depends on: W8-D04, W2-005, W1-008
  - Deliverables: integration addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance: Only real existing models/routes/permissions are represented.; Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; Artwork remains decorative; labels, state and actions are real UI data.; New assets include provenance and are registered in canonical manifest.; If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `pnpm --filter @moonwitness/ui-catalog build` (0) → `apps/ui-catalog/dist`; `pnpm --filter @moonwitness/ui-catalog test` (0) → `apps/ui-catalog/tests/catalog.spec.ts`; `pnpm board:ui:check` (0) → `scripts/check-board-shared-ui.mjs`; `pnpm --filter @moonwitness/board typecheck` (0) → `apps/board`; `pnpm test:assets` (0) → `packages/assets/tests`

- [x] **W8-005 — Implement visual coverage for whatsapp addon**
  - Goal: Implement only the verified whatsapp asset references, UI compositions and state treatments based on W8-D05. Domain: Accounts, conversations, messages, media and contact states.
  - Depends on: W8-D05, W2-005, W1-008
  - Deliverables: whatsapp addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance: Only real existing models/routes/permissions are represented.; Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; Artwork remains decorative; labels, state and actions are real UI data.; New assets include provenance and are registered in canonical manifest.; If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `pnpm board:ui:check` (0) → `scripts/check-board-shared-ui.mjs`; `pnpm --filter @moonwitness/board typecheck` (0) → `apps/board/src`; `pnpm test:assets` (0) → `packages/assets/tests`; `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/catalog.spec.ts`

- [x] **W8-006 — Implement visual coverage for request addon**
  - Goal: Implement only the verified request asset references, UI compositions and state treatments based on W8-D06. Domain: Purchase requests and approval lifecycle.
  - Depends on: W8-D06, W2-005, W1-008
  - Deliverables: request addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance: Only real existing models/routes/permissions are represented.; Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; Artwork remains decorative; labels, state and actions are real UI data.; New assets include provenance and are registered in canonical manifest.; If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `pnpm --filter @moonwitness/ui-catalog build` (0) → `apps/ui-catalog/dist`; `pnpm --filter @moonwitness/ui-catalog test` (0) → `apps/ui-catalog/tests/catalog.spec.ts`; `pnpm board:ui:check` (0) → `scripts/check-board-shared-ui.mjs`; `pnpm --filter @moonwitness/board typecheck` (0) → `apps/board`; `pnpm test:assets` (0) → `packages/assets/tests`

- [x] **W8-007 — Implement visual coverage for notification addon**
  - Goal: Implement only the verified notification asset references, UI compositions and state treatments based on W8-D07. Domain: Inbox, unread/read/archived and channel states.
  - Depends on: W8-D07, W2-005, W1-008
  - Deliverables: notification addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance: Only real existing models/routes/permissions are represented.; Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; Artwork remains decorative; labels, state and actions are real UI data.; New assets include provenance and are registered in canonical manifest.; If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `pnpm test:e2e:visual --grep "canonical activity, notification, and cron icons"` (0) → `apps/board/e2e/visual-audit.spec.ts`; `pnpm --filter @moonwitness/board typecheck` (0) → `apps/board/src/components/layout/notification-bell.tsx`; `pnpm board:ui:check` (0) → `scripts/check-board-shared-ui.mjs`; `pnpm test:assets` (0) → `packages/assets/tests`; `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/catalog.spec.ts`

- [x] **W8-008 — Implement visual coverage for organization addon**
  - Goal: Implement only the verified organization asset references, UI compositions and state treatments based on W8-D08. Domain: Departments, teams, positions, memberships and hierarchy.
  - Depends on: W8-D08, W2-005, W1-008
  - Deliverables: organization addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance: Only real existing models/routes/permissions are represented.; Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; Artwork remains decorative; labels, state and actions are real UI data.; New assets include provenance and are registered in canonical manifest.; If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `pnpm --filter @moonwitness/board typecheck` (0) → `apps/board/src/lib/models.ts`; `pnpm board:ui:check` (0) → `scripts/check-board-shared-ui.mjs`; `pnpm test:assets` (0) → `packages/assets/tests`; `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/catalog.spec.ts`

- [x] **W8-009 — Implement visual coverage for workflow addon**
  - Goal: Implement only the verified workflow asset references, UI compositions and state treatments based on W8-D09. Domain: Definitions, instances, transitions, approvals and event history.
  - Depends on: W8-D09, W2-005, W1-008
  - Deliverables: workflow addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance: Only real existing models/routes/permissions are represented.; Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; Artwork remains decorative; labels, state and actions are real UI data.; New assets include provenance and are registered in canonical manifest.; If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog
  - Evidence: `node --test scripts/board/workflow-action-state.test.mjs` (0) → `scripts/board/workflow-action-state.test.mjs`; `pnpm --filter @moonwitness/board typecheck` (0) → `apps/board/src/components/views/workflow-panel.tsx`; `pnpm board:ui:check` (0) → `scripts/check-board-shared-ui.mjs`; `pnpm test:assets` (0) → `packages/assets/tests`; `pnpm test:ui-catalog` (0) → `apps/ui-catalog/tests/catalog.spec.ts`

- [ ] **W8-010 — Implement visual coverage for knowledge addon**
  - Goal: Implement only the verified knowledge asset references, UI compositions and state treatments based on W8-D10. Domain: Witness testimony, source, evidence, corrections, interpretations and research graph.
  - Depends on: W8-D10, W2-005, W1-008, W4-001
  - Deliverables: knowledge addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance: Only real existing models/routes/permissions are represented.; Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; Artwork remains decorative; labels, state and actions are real UI data.; New assets include provenance and are registered in canonical manifest.; If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog

- [ ] **W8-011 — Implement visual coverage for orm-storage addon**
  - Goal: Implement only the verified orm-storage asset references, UI compositions and state treatments based on W8-D11. Domain: Attachment storage providers and lifecycle states; currently provider addon has no domain models.
  - Depends on: W8-D11, W2-005, W1-008
  - Deliverables: orm-storage addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance: Only real existing models/routes/permissions are represented.; Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; Artwork remains decorative; labels, state and actions are real UI data.; New assets include provenance and are registered in canonical manifest.; If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog

- [ ] **W8-012 — Implement visual coverage for ai addon**
  - Goal: Implement only the verified ai asset references, UI compositions and state treatments based on W8-D12. Domain: Agents, profiles, models, providers, contracts, runs, taskforces, skills and memory.
  - Depends on: W8-D12, W2-005, W1-008, W3-001
  - Deliverables: ai addon asset coverage and tested UI specimens/consumer integration where a real screen exists
  - Acceptance: Only real existing models/routes/permissions are represented.; Shared assets are reused by stable ID; no domain-specific duplicate asset copies.; Empty/loading/error/permission-denied/zero/unavailable states are distinct where applicable.; Artwork remains decorative; labels, state and actions are real UI data.; New assets include provenance and are registered in canonical manifest.; If a route does not exist, provide a labelled UI Catalog specimen and document the missing production consumer rather than inventing the route.
  - Verify: pnpm board:ui:check; pnpm --filter @moonwitness/board typecheck; pnpm test:assets; pnpm test:ui-catalog

## W9

- [ ] **W9-001 — Create first Moon City scene definition**
  - Goal: Compose approved sky, moon, cloud, city, character and foreground assets into one scene.
  - Depends on: W3-006, W4-007, W5-003
  - Deliverables: Versioned Moon City scene manifest.
  - Acceptance: All references resolve.; Scene has desktop/mobile variants or responsive composition rules.; Scene contains no UI copy or product metrics.
  - Verify: scene validation; contact sheet

- [ ] **W9-002 — Build immersive homepage hero vertical slice**
  - Goal: Integrate first living scene into homepage without replacing real HTML navigation/copy/CTA.
  - Depends on: W9-001, W5-005, W5-006, W5-007, W5-009
  - Deliverables: Production homepage hero scene.
  - Acceptance: Visual hierarchy matches approved reference DNA.; Character and environment animation are visible but not distracting.; Static fallback always loads.; No full-page screenshot used as background.
  - Verify: pnpm --filter @moonwitness/board typecheck; pnpm --filter @moonwitness/board build; pnpm test:e2e:visual

- [ ] **W9-003 — Add cinematic scroll/story section transitions**
  - Goal: Connect homepage story sections with controlled reveal/camera transitions.
  - Depends on: W9-002, W6-004, W5-006
  - Deliverables: Scroll-linked scene transition specimens and production integration.
  - Acceptance: No scroll hijacking or hidden content.; Reduced-motion has direct static order.; Mobile touch scrolling remains native.
  - Verify: Playwright scroll tests; reduced-motion tests

- [ ] **W9-004 — Extend selected Signals and Archive scenes**
  - Goal: Use existing asset IDs and scene contracts for the next two content experiences when those routes exist.
  - Depends on: W8-009, W8-010, W9-001
  - Deliverables: Signals/Archive scene integration or documented route-gap decision.
  - Acceptance: No fake routes or unsupported live data.; If actual route is absent, create approved catalog specimen only and record blocker.
  - Verify: pnpm --filter @moonwitness/board typecheck; pnpm test:e2e

- [ ] **W9-005 — Integrate Crew and Story visual compositions**
  - Goal: Apply character/environment assets to existing user and story experiences only where supported by product data.
  - Depends on: W8-001, W8-010, W3-009
  - Deliverables: Crew/Story scene or editorial compositions.
  - Acceptance: Real users remain real data or neutral avatars.; Fictional character examples are visibly marked as examples in catalog.; No fictional crew metrics or maps in production.
  - Verify: pnpm test:e2e:visual; pnpm test:ui-catalog

- [ ] **W9-006 — Preserve operational Board visual tier**
  - Goal: Ensure new immersive runtime does not leak into dense forms, tables or admin data flows.
  - Depends on: W5-005, W6-002, W8-001
  - Deliverables: Board regression report.
  - Acceptance: Existing Board light/dark themes, skins and density remain intact.; Operational screens use restrained motion and valid focus boundaries.; No measurable layout shift/regression.
  - Verify: pnpm board:ui:check; pnpm test:e2e:visual:matrix

- [ ] **W9-007 — Decide desktop app scene adoption**
  - Goal: Audit desktop UI technology and performance before adopting world runtime.
  - Depends on: W5-002, W5-011
  - Deliverables: Desktop integration decision and optional proof.
  - Acceptance: No UI/assets dependency added blindly.; Shared formats can be consumed without browser-only globals leaking into shared contracts.; No unsupported desktop capability is assumed.
  - Verify: pnpm --filter @moonwitness/desktop typecheck; pnpm --filter @moonwitness/desktop test

- [ ] **W9-008 — Document complete addon asset handoff**
  - Goal: Document how addons request/reuse UI asset IDs without importing artwork into ORM/server.
  - Depends on: W8-001, W8-012, W2-010
  - Deliverables: Developer guide for addon-to-visual mapping.
  - Acceptance: Backend packages remain presentation-agnostic.; No circular dependency from ORM to assets/UI.; Static visual ID to runtime component mapping is explicit.
  - Verify: pnpm docs:check; pnpm docs:links

## W10

- [ ] **W10-001 — Establish runtime performance baselines**
  - Goal: Measure current and new scene route cold load, JS/CSS, asset transfer, CPU/GPU and frame cadence.
  - Depends on: W9-002
  - Deliverables: Baseline and budget document.
  - Acceptance: Measurements on named reference devices/browser.; Initial route and deferred scene budgets are separated.; No arbitrary performance claim.
  - Verify: pnpm board:budget; Playwright performance run

- [ ] **W10-002 — Optimize scene asset loading and caching**
  - Goal: Implement lazy scene loading, preloading policy and responsive media selection.
  - Depends on: W10-001, W2-006, W9-002
  - Deliverables: Loading/cache policy and tests.
  - Acceptance: Only initial scene critical assets are eagerly loaded.; Offscreen scenes do not download unnecessary media.; Failed loads show fallback and retry where relevant.
  - Verify: network asset audit; pnpm test:e2e

- [ ] **W10-003 — Add reduced-motion and low-power scene modes**
  - Goal: Support reduced-motion, data-saver/low-capability settings where detectably appropriate.
  - Depends on: W1-007, W5-004, W9-002
  - Deliverables: Motion mode policy and tests.
  - Acceptance: User preference is respected before first meaningful playback.; Low-power mode does not imply inaccessible hidden content.; No preference is silently overridden.
  - Verify: Playwright reduced-motion tests

- [ ] **W10-004 — Add full visual and accessibility matrix**
  - Goal: Run desktop/tablet/mobile, light/dark, keyboard, touch, reduced motion and fallback tests.
  - Depends on: W9-002, W9-006, W10-003
  - Deliverables: Visual evidence matrix and issues list.
  - Acceptance: Critical production pages have review evidence.; Axe/keyboard checks cover changed user flows.; Known limitations are explicit.
  - Verify: pnpm test:ui; pnpm test:ui-catalog; pnpm test:e2e:visual:matrix

- [ ] **W10-005 — Verify package build and consumer contracts**
  - Goal: Build, pack and consume assets/UI packages from apps and run API/desktop boundaries.
  - Depends on: W2-010, W5-011, W9-007
  - Deliverables: Package verification report.
  - Acceptance: Public exports resolve from actual consumer apps.; No private dist imports.; No unwanted runtime dependencies.; API and ORM builds remain unaffected by visual dependencies.
  - Verify: pnpm build; pnpm test:assets; pnpm test:ui; pnpm test:ui-catalog; pnpm --filter @moonwitness/api typecheck; pnpm --filter @moonwitness/desktop typecheck

- [ ] **W10-006 — Run full quality and security review**
  - Goal: Run relevant repository CI gates and check license, provenance, dependencies, performance and accessibility.
  - Depends on: W10-004, W10-005
  - Deliverables: Release-quality report.
  - Acceptance: No secrets or licensing violations.; No broken source manifests or generated artifacts.; No unreviewed breaking API changes.; No failing relevant required gate.
  - Verify: pnpm lint; pnpm test; pnpm test:integration; pnpm test:e2e

- [ ] **W10-007 — Finalize docs, release notes and handoff**
  - Goal: Publish final implementation, asset catalog and evidence guide.
  - Depends on: W10-006
  - Deliverables: Final changelog, README/docs index, evidence links and closure report.
  - Acceptance: All tasks have accurate statuses and evidence.; Deferred/blocked tasks are not claimed complete.; Version bump follows repo release policy, not every commit.
  - Verify: pnpm docs:check; pnpm docs:links; git diff --check

- [ ] **W10-008 — Commit and push verified work to dev**
  - Goal: Commit coherent completed batches and push only through repository-approved branch workflow.
  - Depends on: W10-007
  - Deliverables: Commit hashes and dev push/PR evidence.
  - Acceptance: No force push or protected branch bypass.; Never push main/master directly.; If dev is protected and direct push is rejected, use repository-approved PR path or stop and report exact blocker.; No empty commits.
  - Verify: git status --short --branch; git log -n 10 --oneline; git remote -v
