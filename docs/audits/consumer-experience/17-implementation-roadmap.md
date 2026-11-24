# Consumer Experience — 17. Implementation Roadmap

- **Dependency DAG:** [`diagrams/implementation-dag.mmd`](./diagrams/implementation-dag.mmd)
- **Target Architecture:** [`15-target-architecture.md`](./15-target-architecture.md)
- **Wiring Specification:** [`16-wiring-specification.md`](./16-wiring-specification.md)

---

## 1. Execution Workstreams Overview

| Workstream | Focus | Issue Range | Primary Package / App Owners | Exit Gate |
| :--- | :--- | :--- | :--- | :--- |
| **A. Foundation, Tokens & `moonwitness-riot` Skin** | Fix `--mw-chalk-mask`, contrast bugs, font stacks, `moonwitness-riot` skin, comic/motion tokens | `CX-001` – `CX-007` | `@moonwitness/types`, `@moonwitness/assets`, `@moonwitness/ui`, `@moonwitness/board` | `pnpm --filter @moonwitness/ui test` + WCAG AA `>= 4.5:1` across 8 `(skin × mode)` matrices |
| **B. Animation Lifecycle, FXLab CSS & Asset Registry** | Fix `useAnimationVisibility`, FXLab CSS rules, reduced-motion token parity, `@moonwitness/ui/lib/asset-registry`, `useSfx` wiring | `CX-008` – `CX-013` | `@moonwitness/ui`, `@moonwitness/assets`, `@moonwitness/board` | `FXLab` renders animated & reduced-motion states; `asset-registry` passes 100% `manifest.json` check |
| **C. Shared Primitives, Consolidation & CSS Debt Burn-Down** | Promote `ConfirmDialog`, `ErrorState`, `Breadcrumbs`, adopt unused UI exports, retire all 23 frozen CSS child overrides + 41 `--ink` aliases | `CX-014` – `CX-020` | `@moonwitness/ui`, `@moonwitness/board`, `@moonwitness/ui-catalog` | `scripts/ui-governance-policy.json` `reviewedDebt = []` (`0` overrides), `pnpm ui:design:audit` passes |
| **D. Visual Experience & Progression Components + Catalog Parity** | Build `ComicPanel`, `MangaFrame`, `StickerBadge`, upgraded `SpeechBubble`, `CharacterDisplay`/`Reaction`, `QuestCard`, `AchievementBadge`, `RewardPanel`; complete UI Catalog specimens | `CX-021` – `CX-027` | `@moonwitness/ui`, `@moonwitness/ui-catalog` | All 8 new components exported 1:1 in `packages/ui/package.json`; `pnpm test:ui-budget` passes |
| **E. Consumer Surface Remediation & Real API Wiring** | Restore `/knowledge`, fix mobile/tablet clipping & Settings remount, fix false empty states (`isError` handling), enrich `/board`, `/board/studio`, `/board/ai/hq`, `/board/projects` | `CX-028` – `CX-034` | `@moonwitness/board`, `@moonwitness/client` | Playwright matrix across 4 viewports passes with 0 clipping, 0 contrast errors, 0 false empty states |
| **F. Desktop Parity, Governance Alignment & Full Verification** | Fix `DesktopUpdateBannerMount`, align `ui-governance-policy.json` desktop test path, enforce `desktop:ui:check`, run full end-to-end verification | `CX-035` – `CX-038` | `@moonwitness/desktop`, `scripts/*` | `pnpm board:ui:check --all-product-apps`, `pnpm desktop:ui:check`, `pnpm desktop:test:web`, `pnpm test:e2e:visual:matrix` green |

---

## 2. Workstream A — Foundation, Design Tokens & `moonwitness-riot` Skin (`CX-001` – `CX-007`)

### `CX-001` — Replace stretched `--mw-chalk-mask` with non-occluding 9-slice / outer ink framing
- **Priority:** `P0`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`
- **Package Owner:** `@moonwitness/ui`
- **Exact Affected File Paths:** `packages/ui/src/styles/tokens.css`, `packages/ui/src/styles/components.css`, `apps/board/src/index.css`, `apps/board/src/app/global.css`
- **Existing Condition:** `--mw-chalk-mask` (`viewBox="0 0 200 100" preserveAspectRatio="none"`) is applied with `mask-size: 100% 100%` over `inset: 0` on `.mw-ui-panel`, `.mw-ui-dialog-content`, `.mw-ui-table`, `.ink-panel`, and `.home-editorial-card`.
- **Problem:** Non-uniform scaling distorts 2–4px SVG strokes into 20–45px blocks slicing through table headers, mobile cards, dialog controls, and headings ([`02-visual-audit.md`](./02-visual-audit.md#31-stretched-mw-chalk-mask-collision-defect-p0)).
- **Proposed Solution:** Remove stretched `mask-size: 100% 100%` overlays from content panels, tables, and dialogs; replace with 9-slice `border-image` SVG (fixed corner/edge widths) or crisp `--mw-frame-width` ink borders + `--mw-grunge-radius-hand` + `--mw-torn-safe-inset` padding clearance. Remove dead `--board-chalk-mask` and `--global-chalk-mask` duplicate SVG data URIs.
- **Dependencies:** None
- **Expected Output:** Updated border/frame CSS rules in `tokens.css`, `components.css`, `index.css`, and `global.css`.
- **Acceptance Criteria:** Zero text-to-border bounding-box intersection across `.mw-ui-panel`, `.mw-ui-dialog-content`, `.mw-ui-table`, and `.ink-panel` at `1440x900` and `390x844`; `duplicate-chalk-mask` count = `0`.
- **Test Strategy:** `pnpm ui:design:check`; Playwright bounding-box overlap assertion on `/board/m/base.partner` and `CommandDialog`.
- **Risk Level:** Medium (touches shared panel/dialog framing across all apps; mitigated by visual screenshot diff).

### `CX-002` — Fix dark-mode Settings button contrast (`~1.3:1` yellow/cream collision)
- **Priority:** `P0`
- **Application:** `apps/board`, `apps/desktop`
- **Package Owner:** `@moonwitness/board`
- **Exact Affected File Paths:** `apps/board/src/board-pages/settings-page.tsx`
- **Existing Condition:** Unselected Theme, Skin, and Density `<Button>` cards inherit default yellow `--mw-primary` background while child descriptions use `text-ink-soft` (`#c9c5b8` in `.dark`).
- **Problem:** Yields `~1.3:1` contrast in dark mode, making unselected skin descriptions unreadable ([`02-visual-audit.md`](./02-visual-audit.md#32-dark-mode-contrast-collapse-unstable-remounts-on-settings-p0)).
- **Proposed Solution:** Pass `variant="outline"` (or `variant="ghost"`) on unselected Theme/Skin/Density buttons so they render on `--mw-surface` with `--mw-foreground`/`--mw-ink-soft`, and apply `bg-primary text-[var(--mw-primary-foreground)]` with explicit dark foreground on selected cards.
- **Dependencies:** None
- **Expected Output:** Accessible light/dark Settings picker cards across all skins.
- **Acceptance Criteria:** Axe and computed contrast ratio `>= 4.5:1` on all Theme, Skin, and Density cards in both `light` and `dark` modes.
- **Test Strategy:** Playwright + `@axe-core/playwright` run on `/board/settings` in light & dark modes.
- **Risk Level:** Low.

### `CX-003` — Disambiguate `--mw-font-display`, `--mw-font-brush`, `--mw-font-grunge` and add `JetBrains Mono` 700
- **Priority:** `P0`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`, `apps/docs`
- **Package Owner:** `@moonwitness/ui`, `@moonwitness/assets`
- **Exact Affected File Paths:** `packages/ui/src/styles/tokens.css`, `packages/assets/fonts.css`, `packages/assets/manifest.json`
- **Existing Condition:** `--mw-font-display`, `--mw-font-grunge`, and `--mw-font-brush` all prepend `'MoonWitness Grunge'`, shadowing `Anton` and `Road Rage`; `JetBrains Mono` omits `@font-face` weight `700`.
- **Problem:** Flattens condensed KPI/header typography (`Anton`) vs brush headings (`Road Rage`) and causes synthetic faux-bold on `font-mono font-bold` ([`05-design-system.md`](./05-design-system.md#3-typography-font-asset-audit)).
- **Proposed Solution:** Set `--mw-font-display: 'Anton', 'MoonWitness Grunge', Impact, 'Arial Narrow', sans-serif`, `--mw-font-brush: 'Road Rage', 'MoonWitness Grunge', Impact, sans-serif`, keep `--mw-font-grunge: 'MoonWitness Grunge', 'Road Rage', Impact, sans-serif`, and register `JetBrains Mono` weight `700` in `packages/assets/fonts.css`.
- **Dependencies:** None
- **Expected Output:** Distinct `Anton`, `Road Rage`, `MoonWitness Grunge`, and `JetBrains Mono` 700 font faces loaded cleanly.
- **Acceptance Criteria:** `document.fonts` reports `Anton` active on KPI metrics/display headers, `Road Rage` on brush ribbons, and zero synthetic bold warnings.
- **Test Strategy:** `pnpm --filter @moonwitness/ui test` (`tokens.test.mjs`) + Playwright `document.fonts.check()` verification.
- **Risk Level:** Low (minor metric width shifts checked against `390x844` layout).

### `CX-004` — Triage orphaned `raw_arts/fonts/saksi-*` and `cinzel-*` font binaries
- **Priority:** `P2`
- **Application:** All consumers
- **Package Owner:** `@moonwitness/assets`
- **Exact Affected File Paths:** `raw_arts/fonts/saksi-hand-400.woff2`, `raw_arts/fonts/saksi-hand-700.woff2`, `raw_arts/fonts/saksi-marker-400.woff2`, `raw_arts/fonts/saksi-marker-700.woff2`, `raw_arts/fonts/saksi-mono-400.woff2`, `raw_arts/fonts/saksi-mono-700.woff2`, `raw_arts/fonts/cinzel-400.woff2`, `raw_arts/fonts/cinzel-600.woff2`, `raw_arts/fonts/cinzel-700.woff2`, `packages/assets/fonts.css`, `packages/assets/licenses.json`, `packages/assets/manifest.json`
- **Existing Condition:** 9 `.woff2` files sit unregistered in `raw_arts/fonts/`.
- **Problem:** Orphaned font assets create licensing/provenance ambiguity and unused disk artifacts ([`05-design-system.md`](./05-design-system.md#31-hosted-fonts-packagesassetsfontscss-vs-raw-artsfonts)).
- **Proposed Solution:** Verify license provenance in `packages/assets/licenses.json`; promote `saksi-hand` & `saksi-marker` into `packages/assets/fonts/` + `fonts.css` (`--mw-font-comic`) if ISC/OFL-verified, and archive `saksi-mono`/`cinzel` (or register `cinzel` strictly for Studio imprint if approved).
- **Dependencies:** `CX-003`
- **Expected Output:** Zero unregistered font binaries in `raw_arts/fonts/`.
- **Acceptance Criteria:** `pnpm --filter @moonwitness/assets run qa` passes with full license attribution for every hosted font.
- **Test Strategy:** `pnpm --filter @moonwitness/assets run inventory` + `qa`.
- **Risk Level:** Low.

### `CX-005` — Add `BuiltinSkinId` `'moonwitness-riot'` to `@moonwitness/types` and `@moonwitness/ui/themes`
- **Priority:** `P0`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`
- **Package Owner:** `@moonwitness/types`, `@moonwitness/ui`
- **Exact Affected File Paths:** `packages/types/src/theme.ts`, `packages/ui/src/themes/index.ts`, `packages/ui/tests/themes.test.mjs`
- **Existing Condition:** Only 3 built-in skins (`moonwitness-ink`, `moonwitness-compact`, `moonwitness-high-contrast`) are registered.
- **Problem:** Expressive Riot / Punk Comic aesthetic is conflated with pure accessibility `moonwitness-high-contrast` ([`05-design-system.md`](./05-design-system.md#4-existing-skins-vs-4-target-art-directions)).
- **Proposed Solution:** Add `'moonwitness-riot'` to `BuiltinSkinId` (`packages/types/src/theme.ts`), register metadata in `BUILTIN_SKINS` (`defaultMode: 'dark'`, `defaultDensity: 'comfortable'`, swatch `#09090b`/`#121216`/`#f5efdf`/`#ff2e88`), and extend `themes.test.mjs` validation.
- **Dependencies:** None
- **Expected Output:** `themeRegistry.list()` returns 4 validated skins; `createSkinInitScript()` accepts `'moonwitness-riot'`.
- **Acceptance Criteria:** `moonwitness-riot` resolves via `themeRegistry.resolve('moonwitness-riot')` and normalizes preferences cleanly.
- **Test Strategy:** `pnpm --filter @moonwitness/types test ; if ($?) { pnpm --filter @moonwitness/ui test }`.
- **Risk Level:** Low.

### `CX-006` — Define `moonwitness-riot` light/dark CSS tokens and semantic comic tokens in `tokens.css`
- **Priority:** `P0`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`
- **Package Owner:** `@moonwitness/ui`
- **Exact Affected File Paths:** `packages/ui/src/styles/tokens.css`, `packages/ui/TOKENS.md`, `packages/ui/tests/tokens.test.mjs`
- **Existing Condition:** `tokens.css` lacks `[data-skin='moonwitness-riot']` rules and lacks semantic `--mw-comic-*` tokens (`gutter`, `panel-border`, `bubble-bg/fg`, `sfx-bg/fg`, `stamp-bg/fg`, `halftone-size`, `sticker-tilt`).
- **Problem:** Comic/cartoon components cannot inherit skin-aware tokens without hardcoded literals ([`05-design-system.md`](./05-design-system.md#5-specification-moonwitness-riot-skin-semantic-comicmotion-tokens)).
- **Proposed Solution:** Add `[data-skin='moonwitness-riot']` and `[data-skin='moonwitness-riot'].dark` blocks plus `:root`/`.dark` `--mw-comic-*` tokens to `tokens.css` and document them in `TOKENS.md`.
- **Dependencies:** `CX-005`
- **Expected Output:** Verified CSS token layer supporting all 4 skins × 2 modes + semantic comic variables.
- **Acceptance Criteria:** Automated contrast test verifies `>= 4.5:1` text and `>= 3.0:1` UI/focus across all 20 `moonwitness-riot` pairs; `pnpm ui:design:check` passes.
- **Test Strategy:** `pnpm --filter @moonwitness/ui test` + `pnpm ui:design:check`.
- **Risk Level:** Low.

### `CX-007` — Update Settings Skin Grid & UI Catalog Skin Switcher for 4 Skins
- **Priority:** `P1`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`
- **Package Owner:** `@moonwitness/board`, `@moonwitness/ui-catalog`
- **Exact Affected File Paths:** `apps/board/src/board-pages/settings-page.tsx`, `apps/ui-catalog/src/catalog.tsx`
- **Existing Condition:** `settings-page.tsx:854` hardcodes `sm:grid-cols-3` for 3 skins; `ui-catalog` lacks an interactive 4-skin switcher bar across `ink`, `compact`, `high-contrast`, and `riot`.
- **Problem:** Adding a 4th skin wraps unevenly into a 3+1 orphan row on Settings and cannot be visually inspected in Catalog.
- **Proposed Solution:** Change `settings-page.tsx` grid to `sm:grid-cols-2 lg:grid-cols-4` and add a 4-skin selector in `ui-catalog` (`catalog.tsx`) alongside light/dark toggle.
- **Dependencies:** `CX-002`, `CX-005`, `CX-006`
- **Expected Output:** Balanced 2×2 / 4-col skin picker in Settings and live 4-skin toggle in UI Catalog.
- **Acceptance Criteria:** `data-skin="moonwitness-riot"` toggles cleanly in both apps with zero layout wrap defects.
- **Test Strategy:** Playwright screenshot + axe check on `/board/settings` and `ui-catalog`.
- **Risk Level:** Low.

---

## 3. Workstream B — Animation Lifecycle, FXLab CSS & Asset Registry (`CX-008` – `CX-013`)

### `CX-008` — Fix `useAnimationVisibility` initial `opacity: 0` trap and callback-ref re-attachment
- **Priority:** `P0`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`
- **Package Owner:** `@moonwitness/ui`
- **Exact Affected File Paths:** `packages/ui/src/lib/use-animation-visibility.ts`, `packages/ui/src/styles/components.css`, `packages/ui/src/components/effects.tsx`, `packages/ui/tests/effects.test.mjs`
- **Existing Condition:** `useAnimationVisibility` initializes `isVisible = false` and reads `elementRef.current` in a `[]` `useEffect`; `components.css` pauses entrance keyframes (`mw-ui-anime-slam`, `mw-ui-speech-pop`, `mw-ui-ink-draw`) at `0%` (`opacity: 0`).
- **Problem:** Offscreen or SSR-rendered `MangaPanel`, `GrungeStamp`, `SpeechBubble`, and `InkUnderline` remain invisible until intersection fires, and conditional DOM remounts never re-observe ([`06-animation-audit.md`](./06-animation-audit.md#22-useanimationvisibility-packagesuisrclibuse-animation-visibilityts)).
- **Proposed Solution:** Store the observed DOM node in state via callback `ref` (`useState<T | null>(null)`), default SSR/initial elements to visible static styling, and trigger keyframe entrances only when `.mw-ui-motion-visible` is active (excluding reduced motion). Fix `SpeedLines` pulse gating on `.mw-ui-motion-visible`.
- **Dependencies:** None
- **Expected Output:** Reliable visibility observer and visible initial paint for all effect primitives.
- **Acceptance Criteria:** SSR `renderToStaticMarkup` and offscreen mounts never freeze at `opacity: 0`; conditional remounts re-attach `IntersectionObserver`.
- **Test Strategy:** `pnpm --filter @moonwitness/ui test` (`effects.test.mjs`) with SSR + DOM remount assertions.
- **Risk Level:** Low.

### `CX-009` — Implement `SceneParticles` & `ComicSceneTransition` CSS keyframes and OS reduced-motion listeners
- **Priority:** `P1`
- **Application:** `apps/ui-catalog`, `apps/board`, `apps/desktop`
- **Package Owner:** `@moonwitness/ui`
- **Exact Affected File Paths:** `packages/ui/src/styles/components.css`, `packages/ui/src/components/scene-particles.tsx`, `packages/ui/src/components/scene-transitions.tsx`, `packages/ui/tests/scene-fx-audio.test.mjs`
- **Existing Condition:** `.mw-ui-scene-particle` and `.mw-ui-comic-transition` have zero CSS rules/keyframes in `components.css`; neither component subscribes to `window.matchMedia('(prefers-reduced-motion: reduce)')`.
- **Problem:** FXLab particle presets (`rain`, `dust`, `stars`, `sparks`) and comic transitions (`ink-wipe`, `panel-reveal`, `cut-impact`, `soft`) render blank or static in live browser ([`02-visual-audit.md`](./02-visual-audit.md#1-executive-visual-summary), [`06-animation-audit.md`](./06-animation-audit.md#24-layered-scene-camera-playback-timeline-harness)).
- **Proposed Solution:** Author `.mw-ui-scene-particles`, `.mw-ui-scene-particle` keyframes (`mw-ui-particle-fall/float/twinkle/spark`), and `.mw-ui-comic-transition` clip-path/transform states in `components.css`; subscribe both components to `matchMedia('(prefers-reduced-motion: reduce)')` honoring `getActiveSceneHarness()` overrides.
- **Dependencies:** `CX-008`
- **Expected Output:** Live animated particles and comic transitions in FXLab and product scenes, settling immediately under reduced motion.
- **Acceptance Criteria:** FXLab renders visible particle geometries and transition wipes; `reducedMotion: true` or OS reduced motion renders static visible state (`opacity: 1`).
- **Test Strategy:** `pnpm --filter @moonwitness/ui test` + Playwright inspection of `FXLab` (`apps/ui-catalog`).
- **Risk Level:** Low.

### `CX-010` — Zero all remaining `--mw-motion-*` tokens under `prefers-reduced-motion: reduce` and fix SSR `SpritePlayer` / `LayeredScene`
- **Priority:** `P1`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`
- **Package Owner:** `@moonwitness/ui`, `@moonwitness/board`
- **Exact Affected File Paths:** `packages/ui/src/styles/tokens.css`, `packages/ui/src/components/sprite-player.tsx`, `packages/ui/src/components/layered-scene.tsx`, `packages/ui/src/components/character-preview.tsx`, `apps/board/src/board-pages/dashboard-page.tsx`, `apps/board/src/components/views/list-view.tsx`, `apps/board/src/components/layout/activity-bell.tsx`
- **Existing Condition:** 6 motion tokens (`draw`, `delay`, `effect`, `pulse`, `progress`, `spin`) stay non-zero in `tokens.css`; `SpritePlayer`/`LayeredScene` omit SSR reduced-motion hint; `dashboard-page`, `list-view`, and `activity-bell` use raw Tailwind `animate-pulse`/`animate-spin`.
- **Problem:** Motion tokens are inconsistent under reduced motion, and raw Tailwind pulse divs bypass `useAnimationVisibility` offscreen pausing ([`06-animation-audit.md`](./06-animation-audit.md#3-prefers-reduced-motion-audit-summary)).
- **Proposed Solution:** Zero `--mw-motion-draw`, `--mw-motion-delay`, `--mw-motion-effect`, `--mw-motion-pulse`, `--mw-motion-progress`, `--mw-motion-spin`, and `--mw-motion-comic-*` in `@media (prefers-reduced-motion: reduce)` in `tokens.css`; replace raw `animate-pulse`/`animate-spin` placeholders in `apps/board` with `<Skeleton />` / `<LoadingSpinner />`; preload sprite clip frames cleanly in `SpritePlayer` and sync `CharacterPreview` Play button with OS `matchMedia`.
- **Dependencies:** `CX-006`, `CX-008`
- **Expected Output:** Consistent token-driven reduced-motion behavior across CSS, JS, and SSR.
- **Acceptance Criteria:** Zero raw `animate-pulse` loading placeholders in `dashboard-page.tsx`, `list-view.tsx`, and `activity-bell.tsx`; `tokens.test.mjs` verifies all `--mw-motion-*` durations = `0ms` under reduced motion.
- **Test Strategy:** `pnpm --filter @moonwitness/ui test` + Playwright `emulateMedia({ reducedMotion: 'reduce' })`.
- **Risk Level:** Low.

### `CX-011` — Implement typed `@moonwitness/ui/lib/asset-registry` contract against `manifest.json`
- **Priority:** `P1`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`, `apps/docs`
- **Package Owner:** `@moonwitness/ui`, `@moonwitness/assets`
- **Exact Affected File Paths:** `packages/ui/src/lib/asset-registry.ts`, `packages/ui/package.json`, `packages/ui/tests/asset-registry.test.mjs`, `apps/board/src/components/home/home-hero-art.tsx`, `apps/board/src/components/manga/logo.tsx`
- **Existing Condition:** Asset URLs (`/illustrations/...`, `/brand/...`, `/scenes/...`) are hardcoded strings scattered across components with no compile-time validation against `packages/assets/manifest.json`.
- **Problem:** Broken or mismatched light/dark SVG paths or missing subpath prefixes (`basePath`) are only caught manually at runtime ([`16-wiring-specification.md`](./16-wiring-specification.md#3-typed-moonwitnessuilibasset-registry-contract)).
- **Proposed Solution:** Create `packages/ui/src/lib/asset-registry.ts` exporting `resolveAsset`, `resolveAssetUrl`, and `resolveCharacterClip`; export `./lib/asset-registry` in `packages/ui/package.json`; add unit test validating every registered path against `packages/assets/manifest.json`; migrate `HomeHeroArt` and `Logo`.
- **Dependencies:** None
- **Expected Output:** Typed asset lookup API with 100% manifest verification.
- **Acceptance Criteria:** `asset-registry.test.mjs` passes; every registered ID resolves to an existing file in `packages/assets/`.
- **Test Strategy:** `pnpm --filter @moonwitness/ui test`.
- **Risk Level:** Low.

### `CX-012` — Wire `useSfx()` cues and `createSceneSoundscapeController` into product milestones
- **Priority:** `P2`
- **Application:** `apps/board`, `apps/desktop`
- **Package Owner:** `@moonwitness/board`, `@moonwitness/ui`
- **Exact Affected File Paths:** `apps/board/src/components/views/form-view.tsx`, `apps/board/src/components/views/kanban-view.tsx`, `apps/board/src/board-pages/projects-page.tsx`, `apps/board/src/board-pages/story-workbench-page.tsx`, `apps/board/src/components/desktop/quick-capture-modal.tsx`, `apps/board/public/sounds/` (via `scripts/copy-board-public-assets.mjs`)
- **Existing Condition:** `useSfx().play(...)` is called only in `auth-page.tsx:90`; `createSceneSoundscapeController` is unused outside `FXLab.tsx`.
- **Problem:** `SoundToggle` in `AppShell` appears inert across almost every user workflow ([`06-animation-audit.md`](./06-animation-audit.md#25-audio-soundscape-audiotsx-audio-runtimets-scene-soundscapets)).
- **Proposed Solution:** Trigger `useSfx().play('success' | 'signal' | 'alert')` on record save (`FormView`), stage move (`KanbanView`, `ProjectsPage`), story revision save (`StoryWorkbenchPage`), and quick capture (`QuickCaptureModal`), while keeping audio muted by default and gesture-gated. Add optional opt-in ambient scene toggle in Studio/Story Workbench via `createSceneSoundscapeController`.
- **Dependencies:** `CX-011`
- **Expected Output:** Cohesive tactile SFX feedback when user enables `SoundToggle`, verified against `bundle-budget.json` (`<= 50,000 B` UI sounds).
- **Acceptance Criteria:** Enabling `SoundToggle` emits single-slot cues on key wins; muted by default; `pnpm board:budget` passes.
- **Test Strategy:** Playwright audio-cue spy test + `pnpm board:budget`.
- **Risk Level:** Low.

### `CX-013` — Wire `LayeredScene` into `/` Hero & `/login` Stage with Static Fallbacks
- **Priority:** `P2`
- **Application:** `apps/board`
- **Package Owner:** `@moonwitness/board`, `@moonwitness/ui`
- **Exact Affected File Paths:** `apps/board/src/components/home/home-hero-art.tsx`, `apps/board/src/board-pages/auth-page.tsx`, `apps/board/bundle-budget.json`
- **Existing Condition:** `LayeredScene` (`Moon City` 9-layer parallax) is unused in `apps/board`; `HomeHeroArt` and `AuthPage` render static `<picture>`/`<img>` only.
- **Problem:** The flagship parallax Moon City environment built in `@moonwitness/ui` is hidden in UI Catalog `SceneLab` ([`01-repository-architecture.md`](./01-repository-architecture.md#5-shared-ui-dependency-map)).
- **Proposed Solution:** Progressive-enhance `HomeHeroArt` to render `LayeredScene` (`scenes/moon-city-scene.json` via `asset-registry`) with `staticFallback={resolveAssetUrl('illustration.home-hero-desktop')}`, `operationalMode={false}`, and `prefers-reduced-motion` static fallback while preserving LCP and `/` bundle budget (`<= 300,000 B` JS gzip).
- **Dependencies:** `CX-009`, `CX-010`, `CX-011`
- **Expected Output:** Interactive bounded Moon City parallax stage on `/` desktop with zero layout shift (`CLS = 0`).
- **Acceptance Criteria:** `pnpm board:budget` passes on `homepage`; `prefers-reduced-motion: reduce` falls back to single static `<img>`.
- **Test Strategy:** `pnpm board:budget` + `pnpm test:e2e:visual:matrix`.
- **Risk Level:** Medium (must verify `/` JS bundle budget and LCP remain within threshold).

---

## 4. Workstream C — Shared Primitives, Consolidation & CSS Debt Burn-Down (`CX-014` – `CX-020`)

### `CX-014` — Promote `ConfirmDialog` to `@moonwitness/ui/components/confirm-dialog`
- **Priority:** `P1`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`
- **Package Owner:** `@moonwitness/ui`, `@moonwitness/board`
- **Exact Affected File Paths:** `packages/ui/src/components/confirm-dialog.tsx`, `packages/ui/package.json`, `apps/board/src/components/views/confirm-dialog.tsx`, `apps/board/src/components/ai/mission-control-chrome.tsx`, `apps/board/src/board-pages/whatsapp-status-page.tsx`, `apps/board/src/components/whatsapp/message-action-dialogs.tsx`
- **Existing Condition:** Confirmation modals are duplicated across `confirm-dialog.tsx`, `EmergencyConfirmModal` (`mission-control-chrome.tsx`), inline WhatsApp dialogs, and native `window.confirm()` (`whatsapp-status-page.tsx:129`).
- **Problem:** Inconsistent keyboard/focus/error semantics and native browser `window.confirm()` breaks dark mode & zine UX ([`04-component-centralization.md`](./04-component-centralization.md#1-centralization-matrix)).
- **Proposed Solution:** Create shared `ConfirmDialog` in `@moonwitness/ui` supporting `warningBanner`, `consequence`, `busy`, `error` (`role="alert"`), and `destructive`; replace `window.confirm()` in `whatsapp-status-page.tsx` and wrap `EmergencyConfirmModal` around shared `ConfirmDialog`.
- **Dependencies:** `CX-001`
- **Expected Output:** Single canonical `ConfirmDialog` primitive exported in `packages/ui/package.json`.
- **Acceptance Criteria:** Zero `window.confirm` calls in `apps/board/src`; `pnpm ui:design:check` and `pnpm test:ui` pass.
- **Test Strategy:** `pnpm test:ui` (Escape guard while `busy`, focus trap, `role="alert"` error) + E2E WhatsApp status confirm test.
- **Risk Level:** Low.

### `CX-015` — Create `@moonwitness/ui/components/error-state` and `@moonwitness/ui/components/breadcrumbs`
- **Priority:** `P1`
- **Application:** `apps/board`, `apps/desktop`, `apps/docs`, `apps/ui-catalog`
- **Package Owner:** `@moonwitness/ui`, `@moonwitness/board`, `@moonwitness/desktop`
- **Exact Affected File Paths:** `packages/ui/src/components/error-state.tsx`, `packages/ui/src/components/breadcrumbs.tsx`, `packages/ui/package.json`, `apps/board/src/app/error.tsx`, `apps/board/src/app/not-found.tsx`, `apps/board/src/components/layout/breadcrumbs.tsx`, `apps/desktop/desktop-web/error-telemetry.ts`, `apps/desktop/desktop-web/main.tsx`
- **Existing Condition:** Error/404 cards are duplicated 4 times with plain panels and zero illustrations; `Breadcrumbs` is locked to `next/link` in `apps/board`.
- **Problem:** Inconsistent error recovery UX and router lock-in prevent reuse across Vite apps (`ui-catalog`, `docs`, `desktop`) ([`04-component-centralization.md`](./04-component-centralization.md#1-centralization-matrix)).
- **Proposed Solution:** Build `ErrorState` (`code`, `title`, `description`, `assetId` via `asset-registry`, `primaryAction`, `secondaryAction`, `role="alert"`) and router-agnostic `Breadcrumbs` (`renderLink?` / `onNavigate`) in `@moonwitness/ui`; migrate `error.tsx`, `not-found.tsx`, `DesktopErrorBoundary`, and `DesktopBoardApp` error fallback.
- **Dependencies:** `CX-001`, `CX-011`
- **Expected Output:** Unified illustrated error/404 cards and portable `Breadcrumbs`.
- **Acceptance Criteria:** 404/error screens display `state.not-found`/`state.offline` illustrations and accessible `role="alert"` recovery actions.
- **Test Strategy:** `pnpm test:ui` + Playwright check of 404 and offline recovery states.
- **Risk Level:** Low.

### `CX-016` — Extract `BrandMark` & `InboxPopover` shared shells
- **Priority:** `P2`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`, `apps/docs`
- **Package Owner:** `@moonwitness/ui`, `@moonwitness/board`
- **Exact Affected File Paths:** `packages/ui/src/components/brand-mark.tsx`, `packages/ui/src/components/inbox-popover.tsx`, `packages/ui/package.json`, `apps/board/src/components/manga/logo.tsx`, `apps/board/src/components/layout/notification-bell.tsx`, `apps/board/src/components/layout/activity-bell.tsx`, `apps/board/src/components/cloud/mesh-topology-panel.tsx`, `apps/board/src/components/ai/mesh-fleet-drawer.tsx`
- **Existing Condition:** Brand lockup URLs are duplicated across `board`, `docs`, and `ui-catalog`; `NotificationBell` and `ActivityBell` duplicate popover trigger/badge/empty/retry scaffolding; `MeshFleetDrawer` and `MeshTopologyPanel` duplicate peer health cards.
- **Problem:** Drift across header bell states and brand surface resolution ([`04-component-centralization.md`](./04-component-centralization.md#1-centralization-matrix)).
- **Proposed Solution:** Add `BrandMark` (using `asset-registry`) and `InboxPopover` in `@moonwitness/ui`; extract app-local `MeshNodeCard` in `apps/board/src/components/cloud/mesh-node-card.tsx` shared by `MeshTopologyPanel` and `MeshFleetDrawer`.
- **Dependencies:** `CX-011`
- **Expected Output:** Shared `BrandMark`, `InboxPopover`, and `MeshNodeCard`.
- **Acceptance Criteria:** `pnpm ui:design:check` and `pnpm test:ui` pass; Notification & Activity bell popovers retain identical unread badge & retry behavior.
- **Test Strategy:** `pnpm test:ui` + Playwright header popover spec.
- **Risk Level:** Low.

### `CX-017` — Adopt unused `@moonwitness/ui` primitives (`KanbanBoard`, `FilterFacetBar`, `Pagination`, `Field`) in `apps/board`
- **Priority:** `P1`
- **Application:** `apps/board`, `apps/desktop`
- **Package Owner:** `@moonwitness/ui`, `@moonwitness/board`
- **Exact Affected File Paths:** `packages/ui/src/components/kanban-board.tsx`, `packages/ui/src/components/pagination.tsx`, `apps/board/src/components/views/kanban-view.tsx`, `apps/board/src/components/views/search-engine-bar.tsx`, `apps/board/src/components/views/list-view.tsx`, `apps/board/src/components/desktop/quick-capture-modal.tsx`, `apps/board/src/board-pages/profile-page.tsx`
- **Existing Condition:** `KanbanBoard`, `FilterFacetBar`, `Pagination`, and `Field` have `0` imports in `apps/board` (`01-repository-architecture.md` lists 11 unused shared components).
- **Problem:** `apps/board` reimplements bespoke filter chips (`SearchEngineBar`), pagination buttons (`ListView`), Kanban columns (`KanbanView`), and manual label/error wrappers ([`04-component-centralization.md`](./04-component-centralization.md#1-centralization-matrix)).
- **Proposed Solution:** Extend `KanbanBoard` with `onCardMove`, keyboard `ArrowLeft`/`ArrowRight` moves, and `<SelectField>` fallback while preserving its Knip-protected signature; add optional page-size slot to `Pagination`; adopt `KanbanBoard`, `FilterFacetBar`, `Pagination`, and `Field` across `KanbanView`, `SearchEngineBar`, `ListView`, `QuickCaptureModal`, and `ProfilePage`.
- **Dependencies:** None
- **Expected Output:** 4 previously unused `@moonwitness/ui` exports actively used in `product-adopter` apps.
- **Acceptance Criteria:** `check-board-shared-ui.mjs` reports increased adoption with `0` regressions in drag/keyboard/pagination tests.
- **Test Strategy:** `pnpm test:ui` + `apps/board` E2E list/kanban/filter tests.
- **Risk Level:** Medium (requires preserving Knip-protected `KanbanBoard` & `FilterFacetBar` signatures).

### `CX-018` — Promote sizing/density variants to `SectionRibbon`, `Panel`, `MetricTile`, `PageHeader`, and `SelectTrigger`
- **Priority:** `P1`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`
- **Package Owner:** `@moonwitness/ui`
- **Exact Affected File Paths:** `packages/ui/src/components/section-ribbon.tsx`, `packages/ui/src/components/panel.tsx`, `packages/ui/src/components/metric-tile.tsx`, `packages/ui/src/components/page-header.tsx`, `packages/ui/src/components/select.tsx`, `packages/ui/src/styles/components.css`
- **Existing Condition:** 23 `.mw-ui-*` child-class overrides exist across `apps/board` and `apps/ui-catalog` because shared primitives lack `size`, `density`, `interactive`, `scale`, and `fullWidth` props.
- **Problem:** Consumer apps cannot customize component density or hero scaling without violating `sharedChildClassOverrides` governance ([`02-visual-audit.md`](./02-visual-audit.md#4-governance-debt-all-23-frozen-css-child-class-overrides)).
- **Proposed Solution:** Add `SectionRibbon` (`size?: 'sm' | 'md' | 'lg'`, `treatment`), `Panel` (`density?: 'micro' | 'default' | 'spacious'`), `MetricTile` (`size?: 'compact' | 'default' | 'hero'`, `interactive?: boolean`, accent styles in `components.css`), `PageHeader` (`scale?: 'default' | 'hero'`, built-in responsive stack `<672px`), and `SelectTrigger` (`fullWidth?: boolean`).
- **Dependencies:** `CX-001`
- **Expected Output:** First-class variant props and `.mw-ui-*` CSS rules inside `@moonwitness/ui`.
- **Acceptance Criteria:** All existing component snapshots remain visually faithful while exposing clean props for all 23 override use cases.
- **Test Strategy:** `pnpm test:ui` + `pnpm ui:design:check`.
- **Risk Level:** Low.

### `CX-019` — Retire all 23 frozen `.mw-ui-*` child-class overrides (`reviewedDebt -> []`)
- **Priority:** `P1`
- **Application:** `apps/board`, `apps/ui-catalog`
- **Package Owner:** `@moonwitness/board`, `@moonwitness/ui-catalog`, Governance (`scripts/`)
- **Exact Affected File Paths:** `apps/board/src/app/global.css`, `apps/board/src/index.css`, `apps/board/src/components/dashboard/kpi-grid.tsx`, `apps/board/src/app/page.tsx`, `apps/board/src/board-pages/auth-page.tsx`, `apps/ui-catalog/src/styles.css`, `apps/ui-catalog/src/catalog.tsx`, `scripts/ui-governance-policy.json`
- **Existing Condition:** `scripts/ui-governance-policy.json` freezes 4 entries in `global.css`, 7 in `index.css`, and 12 in `ui-catalog/src/styles.css`.
- **Problem:** Frozen debt blocks clean styling refactors and masks coupling to internal `.mw-ui-*` DOM structure ([`04-component-centralization.md`](./04-component-centralization.md#2-css-override-debt-consolidation-plan-23-frozen-entries)).
- **Proposed Solution:** Replace the 23 CSS override blocks with the new props from `CX-018` in JSX (`kpi-grid.tsx`, `page.tsx`, `auth-page.tsx`, `catalog.tsx`) and empty `rules.sharedChildClassOverrides.reviewedDebt` to `[]` in `scripts/ui-governance-policy.json`.
- **Dependencies:** `CX-018`
- **Expected Output:** Zero `.mw-ui-*` child-class overrides anywhere in consumer apps.
- **Acceptance Criteria:** `pnpm ui:design:check` passes with `reviewedDebt.length === 0`.
- **Test Strategy:** `pnpm ui:design:check` + `pnpm test:ui-catalog` + `pnpm test:e2e:visual:matrix`.
- **Risk Level:** Medium (must verify visual parity across `/` home, `/login`, `/board`, and `ui-catalog`).

### `CX-020` — Canonicalize all 41 consumer `--ink*` CSS aliases to `--mw-*` and enforce error mode
- **Priority:** `P2`
- **Application:** `apps/board`, `apps/ui-catalog`
- **Package Owner:** `@moonwitness/board`, `@moonwitness/ui-catalog`, Governance (`scripts/`)
- **Exact Affected File Paths:** `apps/board/src/index.css`, `apps/board/src/app/global.css`, `apps/ui-catalog/src/styles.css`, `scripts/ui-governance-policy.json`
- **Existing Condition:** `41` consumer occurrences of legacy `--ink*` CSS variables remain (`aliasCanonicalization.enforcement = "report-only"`).
- **Problem:** Dual token naming (`--ink*` vs `--mw-*`) confuses contributors and diverges from `packages/ui` ([`01-repository-architecture.md`](./01-repository-architecture.md#5-shared-ui-dependency-map)).
- **Proposed Solution:** Replace all 41 consumer `--ink*` variable references with canonical `--mw-*` tokens (`--mw-ink`, `--mw-paper`, etc.) and flip `aliasCanonicalization.enforcement` to `"error"` in `scripts/ui-governance-policy.json`.
- **Dependencies:** `CX-019`
- **Expected Output:** Zero `--ink*` references in consumer CSS/TSX.
- **Acceptance Criteria:** `pnpm ui:design:audit` (`--strict-alias-debt`) passes with `0` alias findings.
- **Test Strategy:** `pnpm ui:design:audit`.
- **Risk Level:** Low.

---

## 5. Workstream D — Visual Experience & Progression Components + UI Catalog Parity (`CX-021` – `CX-027`)

### `CX-021` — Build `ComicPanel` (+ `ComicStrip`) and `MangaFrame` in `@moonwitness/ui`
- **Priority:** `P1`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`
- **Package Owner:** `@moonwitness/ui`
- **Exact Affected File Paths:** `packages/ui/src/components/comic-panel.tsx`, `packages/ui/src/components/manga-frame.tsx`, `packages/ui/src/styles/components.css`, `packages/ui/package.json`, `packages/ui/tests/effects.test.mjs`
- **Existing Condition:** `MangaPanel` lacks multi-panel comic strip grid/gutters/diagonal cuts/panel numbers/caption strips; `InkFrame` and `ArtworkFrame` are separate and lack unified halftone bleed + corner tape/stamp slots.
- **Problem:** Operational and storytelling screens lack reusable comic layout framing ([`03-component-inventory.md`](./03-component-inventory.md#4-missing-visual-experience-components-gap-analysis)).
- **Proposed Solution:** Implement `ComicStrip` + `ComicPanel` (grid columns, `--mw-comic-gutter`, diagonal cut variants, panel number tag, caption strip, backwards-compatible alongside `MangaPanel`) and `MangaFrame` (composing aspect ratio, rough SVG filter via `useId()`, halftone bleed, corner tape/stamp slots, static fallback). Export both in `packages/ui/package.json`.
- **Dependencies:** `CX-001`, `CX-006`, `CX-008`
- **Expected Output:** `ComicPanel`, `ComicStrip`, `MangaFrame` components + `.mw-ui-comic-*` CSS.
- **Acceptance Criteria:** Unique SVG filter IDs per instance, `0px` horizontal overflow on `390x844`, exports verified by `check-ui-design-system.mjs`.
- **Test Strategy:** `pnpm --filter @moonwitness/ui test` + `pnpm ui:design:check`.
- **Risk Level:** Low.

### `CX-022` — Build `StickerBadge` and upgrade `SpeechBubble` with directional tail, variant & speaker
- **Priority:** `P1`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`
- **Package Owner:** `@moonwitness/ui`
- **Exact Affected File Paths:** `packages/ui/src/components/sticker-badge.tsx`, `packages/ui/src/components/effects.tsx`, `packages/ui/src/styles/components.css`, `packages/ui/package.json`, `packages/ui/tests/effects.test.mjs`
- **Existing Condition:** `SpeechBubble` (`effects.tsx:767-774`) accepts only `{ children, className }`; `ZineSticker` is purely decorative while `Badge` is plain pill text.
- **Problem:** No semantic sticker badge with icon/count/unlocked state and no directional speaker bubble for character/empty-state narration ([`03-component-inventory.md`](./03-component-inventory.md#4-missing-visual-experience-components-gap-analysis)).
- **Proposed Solution:** Create `StickerBadge` (`tone`, `tilt`, `tape`, `icon`, `count`, `earned`, `interactive`) and upgrade `SpeechBubble` with optional `tailDirection` (`'left' | 'right' | 'top' | 'bottom' | 'none'`), `variant` (`'speech' | 'thought' | 'shout' | 'whisper'`), `tone`, `speaker`, and `action` while keeping `{ children, className }` backwards-compatible.
- **Dependencies:** `CX-006`, `CX-008`
- **Expected Output:** Exported `StickerBadge` and upgraded `SpeechBubble` using `--mw-comic-bubble-*` & `--mw-comic-sfx-*` tokens.
- **Acceptance Criteria:** Contrast `>= 4.5:1` across all 4 skins × light/dark; reduced motion suppresses tilt jitter.
- **Test Strategy:** `pnpm --filter @moonwitness/ui test` + `pnpm ui:design:check`.
- **Risk Level:** Low.

### `CX-023` — Build `CharacterDisplay` & `CharacterReaction` bound to `character-adapter` & `asset-registry`
- **Priority:** `P1`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`
- **Package Owner:** `@moonwitness/ui`
- **Exact Affected File Paths:** `packages/ui/src/components/character-display.tsx`, `packages/ui/src/styles/components.css`, `packages/ui/package.json`, `packages/ui/tests/scene-runtime.test.mjs`
- **Existing Condition:** Only debug `CharacterPreview` exists (rendering `StatusBar` + Play/Pause/Reduced-motion QA buttons).
- **Problem:** No product-ready character widget exists for empty states, onboarding, AI agents, or milestones ([`03-component-inventory.md`](./03-component-inventory.md#4-missing-visual-experience-components-gap-analysis)).
- **Proposed Solution:** Build `CharacterDisplay` (rendering `SpritePlayer` via `resolveCharacterClip` from `asset-registry` without debug controls, enforcing `INV-017` `min(100%, width)` + `aspectRatio` and `prefers-reduced-motion` still fallback) and `CharacterReaction` (pairing `CharacterDisplay` + `SpeechBubble` for `mood: 'idle' | 'thinking' | 'celebrate' | 'alert' | 'empty'`). Keep `CharacterPreview` intact for Catalog.
- **Dependencies:** `CX-010`, `CX-011`, `CX-022`
- **Expected Output:** Product-ready `CharacterDisplay` and `CharacterReaction` components.
- **Acceptance Criteria:** Zero debug controls in DOM, `0px` mobile overflow (`INV-017`), deterministic static frame under `reducedMotion`.
- **Test Strategy:** `pnpm --filter @moonwitness/ui test` + Playwright responsive `390x844` check.
- **Risk Level:** Low.

### `CX-024` — Enhance `EmptyState` with character/illustration preset slots
- **Priority:** `P1`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`
- **Package Owner:** `@moonwitness/ui`
- **Exact Affected File Paths:** `packages/ui/src/components/empty-state.tsx`, `packages/ui/src/styles/components.css`, `packages/ui/tests/effects.test.mjs`
- **Existing Condition:** `EmptyState` supports only small `icon`, `title`, `description`, `action`.
- **Problem:** Board empty states look bare (`32px` doodle or plain text) despite rich `illustrations/{empty,no-results,no-activity}-*.svg` assets existing ([`02-visual-audit.md`](./02-visual-audit.md#35-unillustrated-empty-error-progressionsticker-gaps)).
- **Proposed Solution:** Add optional `illustration?: AssetId | ReactNode` and `mode?: 'light' | 'dark'` props to `EmptyState` (resolving via `asset-registry` with `aria-hidden="true"` decorative `<img>`) and keep existing `icon` prop 100% compatible.
- **Dependencies:** `CX-011`, `CX-008`
- **Expected Output:** Illustrated `EmptyState` primitive ready for immediate adoption across Board views.
- **Acceptance Criteria:** Renders `<img>` with `naturalWidth > 0` when `illustration` is provided; preserves heading hierarchy (`headingLevel`).
- **Test Strategy:** `pnpm --filter @moonwitness/ui test` + Catalog specimen verification.
- **Risk Level:** Low.

### `CX-025` — Build `QuestCard`, `AchievementBadge`, and `RewardPanel` progression primitives
- **Priority:** `P2`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`
- **Package Owner:** `@moonwitness/ui`
- **Exact Affected File Paths:** `packages/ui/src/components/quest-card.tsx`, `packages/ui/src/components/achievement-badge.tsx`, `packages/ui/src/components/reward-panel.tsx`, `packages/ui/src/styles/components.css`, `packages/ui/package.json`, `packages/ui/tests/effects.test.mjs`
- **Existing Condition:** Zero quest, achievement, or reward components exist anywhere in `packages/ui` or `apps/*`.
- **Problem:** Progression moments (onboarding checklist, studio readiness, project milestones) rely on plain text or a single static `+1 every day` sidebar pill ([`03-component-inventory.md`](./03-component-inventory.md#4-missing-visual-experience-components-gap-analysis)).
- **Proposed Solution:** Implement `QuestCard` (`title`, `objective`, `progress`, `total` with `role="progressbar"`, `rewardLabel`, `status: 'active' | 'completed' | 'locked'`, `action`), `AchievementBadge` (`title`, `criteria`, `unlocked`, `unlockedAt`, `progress`, `tier`, non-color lock/unlock icon), and `RewardPanel` (combining `MangaPanel`, `AnimeImpactBurst`, `StickerBadge`, `useSfx`, and reduced-motion safe reveal).
- **Dependencies:** `CX-021`, `CX-022`, `CX-012`
- **Expected Output:** Three new progression exports in `packages/ui/package.json`.
- **Acceptance Criteria:** Non-color status indicators pass WCAG 1.4.1; reduced-motion suppresses burst loops; `pnpm ui:design:check` passes.
- **Test Strategy:** `pnpm --filter @moonwitness/ui test` + axe accessibility check in Catalog.
- **Risk Level:** Low.

### `CX-026` — Fix UI Catalog mobile header, `AssetBrowser` typos, and showcase all 9 missing existing + 8 new components
- **Priority:** `P1`
- **Application:** `apps/ui-catalog`
- **Package Owner:** `@moonwitness/ui-catalog`
- **Exact Affected File Paths:** `apps/ui-catalog/src/styles.css`, `apps/ui-catalog/src/AssetBrowser.tsx`, `apps/ui-catalog/src/catalog.tsx`, `apps/ui-catalog/tests/catalog.spec.ts`
- **Existing Condition:** `AssetBrowser.tsx:40-45` renders `"All categorys"` / `"All statuss"`; `styles.css:1418` hardcodes `height: 17.5rem; overflow: hidden` on mobile `.mw-ui-page-header`; 9 existing `@moonwitness/ui` components (`date-picker`, `label`, `log-console`, `mode-picker`, `number-input`, `smart-button-box`, `status-bar`, `tag-input`, `update-banner`) and the 8 new components lack Catalog specimens.
- **Problem:** Catalog fails as a complete reference consumer and risks mobile header clipping ([`02-visual-audit.md`](./02-visual-audit.md#33-responsive-clipping-route-accessibility-p1)).
- **Proposed Solution:** Fix `"All categories"` / `"All statuses"` strings, change `height: 17.5rem` to `min-height: 17.5rem` (`overflow: visible`), and add lazy-split Catalog sections (`VisualExperienceLab.tsx` / `FormControlsSection.tsx`) showcasing all missing and new components without breaching `bundle-budget.json`.
- **Dependencies:** `CX-014`, `CX-015`, `CX-021`, `CX-022`, `CX-023`, `CX-025`
- **Expected Output:** 100% `@moonwitness/ui` component coverage in `apps/ui-catalog`.
- **Acceptance Criteria:** `pnpm test:ui-catalog` and `pnpm test:ui-budget` (`total JS <= 168,000 B gzip`, `initial JS <= 158,000 B gzip`) both pass.
- **Test Strategy:** `pnpm --filter @moonwitness/ui-catalog build ; if ($?) { pnpm test:ui-budget ; if ($?) { pnpm test:ui-catalog } }`.
- **Risk Level:** Medium (must stay under `apps/ui-catalog/bundle-budget.json` via dynamic lazy imports).

### `CX-027` — Adopt `CharacterReaction`, `ComicPanel`, `QuestCard`, `AchievementBadge`, `RewardPanel` across Board operational views
- **Priority:** `P2`
- **Application:** `apps/board`, `apps/desktop`
- **Package Owner:** `@moonwitness/board`
- **Exact Affected File Paths:** `apps/board/src/board-pages/dashboard-page.tsx`, `apps/board/src/components/views/list-view.tsx`, `apps/board/src/components/creative/editorial-studio-panel.tsx`, `apps/board/src/app/board/ai/hq/page.tsx`, `apps/board/src/board-pages/projects-page.tsx`, `apps/board/src/board-pages/profile-page.tsx`, `apps/board/src/app/board/studio/page.tsx`
- **Existing Condition:** Operational views (`/board/studio`, `/board/ai/hq`, `/board/projects`, `/board/profile`, `ListView` empty state) appear as flat SaaS forms with zero character/comic/progression presence ([`09-visual-benchmark.md`](./09-visual-benchmark.md#2-internal-surface-to-surface-parity-gaps)).
- **Proposed Solution:** Wire `CharacterReaction` into `EmptyState` across `ListView` and `DashboardPage`; add `PageHeader treatment="brush"` + `ComicPanel`/`QuestCard` publication readiness + `CharacterDisplay` to `/board/studio`; add `Avatar`/`CharacterDisplay` + `FilterFacetBar` to `/board/ai/hq`; add `QuestCard`/`RewardPanel` milestone celebration to `/board/projects`; add `AchievementBadge` + `Avatar` to `/board/profile`.
- **Dependencies:** `CX-017`, `CX-021`, `CX-023`, `CX-024`, `CX-025`, `CX-032`
- **Expected Output:** Cohesive MoonWitness comic/zine identity across operational routes without bloating bundle budgets.
- **Acceptance Criteria:** `pnpm board:budget` passes on `board` & `model`; `0` axe violations across upgraded routes.
- **Test Strategy:** `pnpm board:budget` + Playwright visual matrix across `/board`, `/board/studio`, `/board/ai/hq`, `/board/projects`, `/board/profile`.
- **Risk Level:** Medium (bundle budget and clean visual hierarchy on dense tables).

---

## 6. Workstream E — Consumer Surface Remediation & Real API Wiring (`CX-028` – `CX-034`)

### `CX-028` — Restore public `/knowledge` route and connect bidirectional discovery links
- **Priority:** `P0`
- **Application:** `apps/board`
- **Package Owner:** `@moonwitness/board`
- **Exact Affected File Paths:** `apps/board/next.config.ts`, `apps/board/src/app/page.tsx`, `apps/board/src/components/home/home-header.tsx`, `apps/board/src/app/knowledge/page.tsx`
- **Existing Condition:** `apps/board/next.config.ts:54` permanently redirects `/knowledge` -> `/board/knowledge`; `/` has zero links to `/knowledge` (`02 KNOWLEDGE` card links to `/register`); `/knowledge` lacks Sign In / Register CTAs.
- **Problem:** Unauthenticated visitors cannot reach `apps/board/src/app/knowledge/page.tsx`, getting bounced to `/login` ([`02-visual-audit.md`](./02-visual-audit.md#33-responsive-clipping-route-accessibility-p1), [`07-user-flow-audit.md`](./07-user-flow-audit.md#journey-1-public-landing-exploration)).
- **Proposed Solution:** Remove `{ source: '/knowledge', destination: '/board/knowledge', permanent: true }` from `next.config.ts`; link `/` header + `02 KNOWLEDGE` card to `/knowledge`; add `Sign in` / `Join the Crew` links on `/knowledge`. (Keep `apps/desktop` `/knowledge` -> `KnowledgePage` behavior intact since desktop auto-authenticates.)
- **Dependencies:** None
- **Expected Output:** Public `/knowledge` route renders fail-closed `PUBLIC_APPROVED` projections without auth redirect.
- **Acceptance Criteria:** `GET /knowledge` returns HTTP 200 (no 308 redirect) and displays `Public Knowledge` shell in unauthenticated Chromium.
- **Test Strategy:** `apps/board/e2e/resilience.spec.ts` unauthenticated `/knowledge` check + Playwright navigation from `/` -> `/knowledge`.
- **Risk Level:** Low.

### `CX-029` — Fix mobile (`390x844`) hero clipping, tablet (`768px`) topbar search squeeze & sheet close collision
- **Priority:** `P1`
- **Application:** `apps/board`, `apps/desktop`
- **Package Owner:** `@moonwitness/board`
- **Exact Affected File Paths:** `apps/board/src/app/global.css`, `apps/board/src/components/layout/app-shell.tsx`, `apps/board/src/index.css`
- **Existing Condition:** `.home-title` sets `white-space: nowrap` clipping `MOONWITNESS` at `390px`; `#open-command-palette` crushes to `"CTRL"` at `768x1024`; `.board-sidebar::after` overlaps mobile `SheetContent` close `X` button.
- **Problem:** Broken responsive ergonomics at tablet and mobile breakpoints ([`02-visual-audit.md`](./02-visual-audit.md#33-responsive-clipping-route-accessibility-p1)).
- **Proposed Solution:** Remove `white-space: nowrap` / adjust fluid clamp (`clamp(2.4rem, 11vw, 7.8rem)`) below `480px` in `global.css`; prioritize `#open-command-palette` (`min-w-[11rem]`) at `md` in `app-shell.tsx` by moving secondary utilities cleanly; add right inset/z-index clearance on `SheetClose` away from `.board-sidebar::after` (`index.css`). Also adjust `QuickCaptureModal` trigger offset so it never overlaps bottom pagination on mobile.
- **Dependencies:** `CX-001`
- **Expected Output:** Clean `390x844` and `768x1024` layouts with zero element clipping or control overlap.
- **Acceptance Criteria:** `h1.getBoundingClientRect().right <= clientWidth` on `/` at `390x844`; `#open-command-palette` width `>= 176px` at `768x1024`; sheet `X` clickable without overlap.
- **Test Strategy:** Playwright viewport matrix (`1440x900`, `1280x800`, `768x1024`, `390x844`) bounding-box assertions.
- **Risk Level:** Low.

### `CX-030` — Fix Settings/Profile volatile `key={scopeKey}` remounts & skeleton stability
- **Priority:** `P0`
- **Application:** `apps/board`, `apps/desktop`
- **Package Owner:** `@moonwitness/board`
- **Exact Affected File Paths:** `apps/board/src/board-pages/settings-page.tsx`, `apps/board/src/board-pages/profile-page.tsx`, `apps/board/src/lib/client.ts`
- **Existing Condition:** `SettingsPage` keys `<SettingsPageContent key={scopeKey} />` on `getQueryScope()`; background refetches (`/auth/me`, `/notifications/inbox`) trigger full subtree remounts and persistent skeleton shimmers.
- **Problem:** Interactive controls detach from DOM mid-click (`element was detached from the DOM`) during live Playwright interaction ([`02-visual-audit.md`](./02-visual-audit.md#32-dark-mode-contrast-collapse-unstable-remounts-on-settings-p0)).
- **Proposed Solution:** Derive stable tenant/user key (`user.id + companyId`) rather than mutable scope reference, preserve rendered controls during `isFetching` background refetches (`placeholderData` / stale-while-revalidate), and show non-blocking inline sync indicator instead of replacing form with `<Skeleton />`.
- **Dependencies:** None
- **Expected Output:** Stable DOM identity across background refetches on `/board/settings` and `/board/profile`.
- **Acceptance Criteria:** 100% deterministic skin/theme/density clicks in Playwright without DOM detachment.
- **Test Strategy:** Playwright rapid skin/theme toggle + refetch stability test on `/board/settings` & `/board/profile`.
- **Risk Level:** Low.

### `CX-031` — Eliminate false empty/zero states on API error (`KanbanView`, `GraphView`, `ProjectsPage`, `CommercialPage`, `CloudIspPage`, `DashboardPage`, `AppShell`)
- **Priority:** `P0`
- **Application:** `apps/board`, `apps/desktop`
- **Package Owner:** `@moonwitness/board`
- **Exact Affected File Paths:** `apps/board/src/components/views/kanban-view.tsx`, `apps/board/src/components/views/graph-view.tsx`, `apps/board/src/board-pages/projects-page.tsx`, `apps/board/src/board-pages/commercial-page.tsx`, `apps/board/src/board-pages/cloud-isp-page.tsx`, `apps/board/src/board-pages/dashboard-page.tsx`, `apps/board/src/components/layout/app-shell.tsx`
- **Existing Condition:** `KanbanView`, `GraphView`, `ProjectsPage`, `CommercialPage`, and `CloudIspPage` fall back to `?? []` / `0` on `isError`; `DashboardPage.handleToggleCron` logs to `console.error` with no toast; `AppShell` omnisearch swallows errors silently.
- **Problem:** Network/API failures masquerade as valid empty states or zero metrics, violating MoonWitness's fail-closed error-vs-empty contract ([`07-user-flow-audit.md`](./07-user-flow-audit.md#3-systemic-flow-findings-summary)).
- **Proposed Solution:** Branch explicitly on `isLoading` -> `<Skeleton />`, `isError` -> `<ErrorState role="alert" onRetry={refetch} />` across all 5 operational views; add `toast.error` on `handleToggleCron` failure; surface scoped warning inside `CommandList` when omnisearch sub-queries fail.
- **Dependencies:** `CX-015`
- **Expected Output:** Zero silent API failure fallbacks across all 18 user journeys.
- **Acceptance Criteria:** Mocking HTTP 500 on `/api/projects/:id/board`, `/board/commercial`, `/board/cloud`, or `?view=kanban`/`graph` renders `role="alert"` + `Retry` button instead of `0` / `"No records"`.
- **Test Strategy:** `apps/board/e2e/resilience.spec.ts` fault-injection tests for each affected route.
- **Risk Level:** Low.

### `CX-032` — Fix `CalendarView` 390px mobile layout, `ListView` URL sub-mode sync, and `KnowledgePage` scroll-to-target
- **Priority:** `P1`
- **Application:** `apps/board`, `apps/desktop`
- **Package Owner:** `@moonwitness/board`
- **Exact Affected File Paths:** `apps/board/src/components/views/calendar-view.tsx`, `apps/board/src/components/views/list-view.tsx`, `apps/board/src/board-pages/knowledge-page.tsx`
- **Existing Condition:** `CalendarView` uses unscrollable `grid-cols-7` squeezing cells to `~45px` on `390px` mobile; `ListView` `table | grid | pipeline` sub-mode is ephemeral React state; `KnowledgePage` `"Open pinned passage"` updates state without scrolling `#source-heading` into view and lacks `Retry` buttons on errors.
- **Problem:** Mobile calendar is unreadable, refreshing `ListView` resets grid/pipeline mode, and mobile Knowledge users miss passage updates ([`07-user-flow-audit.md`](./07-user-flow-audit.md#3-systemic-flow-findings-summary)).
- **Proposed Solution:** Render responsive agenda list below `sm:` (or horizontal `overflow-x-auto` scroll region with `min-w-[44rem]`) in `CalendarView`; sync `ListView` sub-mode via `?layout=table|grid|pipeline` URL param; add `scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' })` to `#source-heading` + `Retry` actions on `KnowledgePage` errors.
- **Dependencies:** None
- **Expected Output:** Readable mobile calendar, persistent `ListView` layout URL state, and clear Knowledge jump feedback.
- **Acceptance Criteria:** `CalendarView` has zero text truncation at `390x844`; reloading `?layout=grid` preserves Grid view; `"Open pinned passage"` moves viewport to `#source-heading`.
- **Test Strategy:** Playwright responsive & navigation tests on `/board/m/base.partner?view=calendar` and `/board/knowledge`.
- **Risk Level:** Low.

### `CX-033` — Normalize `EditorialStudioPanel` copy and wire persistent/exportable Studio drafts via `@moonwitness/client`
- **Priority:** `P2`
- **Application:** `apps/board`, `apps/desktop`
- **Package Owner:** `@moonwitness/board`, `@moonwitness/client`
- **Exact Affected File Paths:** `apps/board/src/components/creative/editorial-studio-panel.tsx`, `apps/board/src/app/board/studio/page.tsx`, `packages/client/src/client.ts`
- **Existing Condition:** `editorial-studio-panel.tsx#L395-L406` mixes Indonesian empty-state copy into an English screen, and title/brief/readiness checklist edits are client-only memory lost on refresh.
- **Problem:** Studio work cannot be saved, exported, or resumed across sessions ([`02-visual-audit.md`](./02-visual-audit.md#34-flat-saas-operational-views-vs-comiccharacter-identity), [`07-user-flow-audit.md`](./07-user-flow-audit.md#journey-13-creative-asmaul-husna-studio-boardstudio)).
- **Proposed Solution:** Normalize UI copy to English (consistent with locale policy), add deterministic JSON/Markdown brief export + `MoonWitnessClient` `storeStoryVersion` / local draft persistence with loading/error states and `useSfx().play('success')` feedback.
- **Dependencies:** `CX-012`, `CX-027`
- **Expected Output:** English-consistent, save/export-capable Creative Studio.
- **Acceptance Criteria:** Reloading `/board/studio` preserves or reloads saved draft; export produces valid JSON/Markdown brief.
- **Test Strategy:** Playwright `/board/studio` draft save/reload/export E2E test.
- **Risk Level:** Low.

### `CX-034` — Eliminate Next.js dev CSP `eval()` console warnings and clean up dev ergonomics
- **Priority:** `P2`
- **Application:** `apps/board`
- **Package Owner:** `@moonwitness/board`
- **Exact Affected File Paths:** `apps/board/next.config.ts`
- **Existing Condition:** `next.config.ts:40` sets `script-src 'self' 'unsafe-inline'` unconditionally, causing 19 CSP `eval()` console errors during Next.js `next dev` HMR.
- **Problem:** Noisy dev console errors obscure real runtime exceptions during visual audits ([`02-visual-audit.md`](./02-visual-audit.md#35-unillustrated-empty-error-progressionsticker-gaps)).
- **Proposed Solution:** Allow `'unsafe-eval'` strictly when `process.env.NODE_ENV === 'development'` while keeping production `next build`/`next start` CSP locked to `'self' 'unsafe-inline'` (zero `'unsafe-eval'` in prod).
- **Dependencies:** None
- **Expected Output:** Zero CSP `eval()` errors in `next dev`, strict prod CSP preserved.
- **Acceptance Criteria:** Dev Playwright audit logs `0` CSP console errors; prod build header test asserts `'unsafe-eval'` is absent.
- **Test Strategy:** Verify header string in prod `next build` + live Playwright dev run.
- **Risk Level:** Low.

---

## 7. Workstream F — Desktop Parity, Governance Policy Alignment & Verification (`CX-035` – `CX-038`)

### `CX-035` — Wire `DesktopUpdateBannerMount` to real Tauri updater status and fix stuck `'checking'` state
- **Priority:** `P1`
- **Application:** `apps/desktop`, `apps/board`
- **Package Owner:** `@moonwitness/desktop`, `@moonwitness/board`
- **Exact Affected File Paths:** `apps/board/src/components/layout/app-shell.tsx`, `apps/board/src/lib/desktop-bridge.ts`, `apps/desktop/src/index.ts`, `apps/desktop/desktop-web/main.tsx`
- **Existing Condition:** Clicking "Check" in `DesktopUpdateBannerMount` (`app-shell.tsx:189-204`) sets `status = 'checking'` with no IPC completion callback, leaving the banner permanently spinning.
- **Problem:** Dead-end updater UX in Desktop mode ([`07-user-flow-audit.md`](./07-user-flow-audit.md#journey-4-desktop-bootstrap-mode-selection-appsdesktopdesktop-webmaintsx)).
- **Proposed Solution:** Add `checkForUpdates()` / `installUpdate()` methods on `DesktopCapabilityBridge` (`window.__MW_DESKTOP__`) with safe fallback to `'up-to-date'` / `'error'` timeout when running in webview-only preview, ensuring `DesktopUpdateBannerMount` always transitions out of `'checking'`.
- **Dependencies:** None
- **Expected Output:** Bounded, non-hanging desktop update lifecycle.
- **Acceptance Criteria:** Clicking Check in desktop webview transitions from `'checking'` to `'up-to-date'`, `'available'`, or `'error'` (`0` stuck spinners).
- **Test Strategy:** `pnpm --filter @moonwitness/desktop test` + `pnpm desktop:test:web`.
- **Risk Level:** Low (`INV-009` compliant—only extends `window.__MW_DESKTOP__` interface in `board`).

### `CX-036` — Align `apps/desktop` governance policy path and explicit `@moonwitness/assets` dependency
- **Priority:** `P1`
- **Application:** `apps/desktop`
- **Package Owner:** `@moonwitness/desktop`, Governance (`scripts/`)
- **Exact Affected File Paths:** `scripts/ui-governance-policy.json`, `apps/desktop/package.json`, `apps/desktop/desktop-web/vite.config.ts`
- **Existing Condition:** `scripts/ui-governance-policy.json:61` points `apps/desktop.runtimeEvidence[0].tests` to nonexistent `apps/desktop/e2e/desktop-web.spec.ts` instead of `apps/desktop/desktop-web/tests/routes.spec.ts`; `apps/desktop/package.json` omits `@moonwitness/assets` and declares `@moonwitness/ui` only in `devDependencies`.
- **Problem:** `check-ui-design-system.mjs` emits `missing test files` warning for `apps/desktop`, and asset coupling relies implicitly on `apps/board/public` ([`01-repository-architecture.md`](./01-repository-architecture.md#observed-architectural-gaps)).
- **Proposed Solution:** Update `runtimeEvidence[0].tests` to `["apps/desktop/desktop-web/tests/routes.spec.ts"]` in `scripts/ui-governance-policy.json`, add `"@moonwitness/assets": "workspace:*"` to `apps/desktop/package.json`, and verify `desktop-web/vite.config.ts` resolves `@moonwitness/assets` cleanly without crossing `INV-009`.
- **Dependencies:** None
- **Expected Output:** Clean `desktop-webview` runtime evidence validation and explicit workspace asset dependency.
- **Acceptance Criteria:** `pnpm ui:design:check` reports `0` missing test files; `pnpm desktop:ui:check` and `pnpm desktop:build` pass (`INV-018`).
- **Test Strategy:** `pnpm ui:design:check ; if ($?) { pnpm desktop:ui:check ; if ($?) { pnpm desktop:build } }`.
- **Risk Level:** Low.

### `CX-037` — Expand `apps/desktop/desktop-web/tests/routes.spec.ts` for `/knowledge`, `/board/studio`, skin switching & reduced motion
- **Priority:** `P2`
- **Application:** `apps/desktop`
- **Package Owner:** `@moonwitness/desktop`
- **Exact Affected File Paths:** `apps/desktop/desktop-web/tests/routes.spec.ts`, `apps/desktop/playwright.web.config.ts`
- **Existing Condition:** `routes.spec.ts` verifies basic route switching and boot fallback, without covering `moonwitness-riot`, `/knowledge` -> `KnowledgePage`, `/board/studio` persistence, or `DesktopUpdateBannerMount`.
- **Problem:** Visual and interactive parity regressions on Desktop webview could escape CI.
- **Proposed Solution:** Add Playwright assertions in `routes.spec.ts` covering `moonwitness-riot` skin toggle, `DesktopUpdateBannerMount` state completion, `/board/studio` render, `/knowledge` authenticated desktop view, and `prefers-reduced-motion: reduce`.
- **Dependencies:** `CX-007`, `CX-028`, `CX-033`, `CX-035`, `CX-036`
- **Expected Output:** Parity test coverage across all desktop webview routes.
- **Acceptance Criteria:** `pnpm desktop:test:web` passes with `testTimeout >= 30000` (`INV-018`).
- **Test Strategy:** `pnpm desktop:test:web`.
- **Risk Level:** Low.

### `CX-038` — Execute final cross-workspace governance, budget, contrast, and visual matrix verification gate
- **Priority:** `P0`
- **Application:** `apps/board`, `apps/desktop`, `apps/ui-catalog`, `apps/docs`
- **Package Owner:** All Consumer Experience Owners
- **Exact Affected File Paths:** Verification gate across `packages/types`, `packages/assets`, `packages/ui`, `packages/client`, `apps/board`, `apps/desktop`, `apps/ui-catalog`, `apps/docs`, `scripts/ui-governance-policy.json`
- **Existing Condition:** Individual packages and apps have separate lint/test/budget commands that must all pass together after remediation.
- **Problem:** Ensures zero cross-layer regressions, zero `reviewedDebt`, and full WCAG AA + bundle budget compliance before merge.
- **Proposed Solution:** Run sequential PowerShell verification gate covering workspace builds, unit tests, static governance (`board:ui:check`, `ui:design:audit`, `desktop:ui:check`), bundle budgets (`board:budget`, `test:ui-budget`), docs portal check (`docs:publication:check`), and Playwright visual + E2E matrices (`test:ui-catalog`, `desktop:test:web`, `test:e2e`, `test:e2e:visual:matrix`).
- **Dependencies:** `CX-004`, `CX-013`, `CX-014`, `CX-016`, `CX-020`, `CX-026`, `CX-027`, `CX-029`, `CX-030`, `CX-031`, `CX-032`, `CX-033`, `CX-034`, `CX-037`
- **Expected Output:** Full green release sign-off evidence log.
- **Acceptance Criteria:** Every governance gate, budget check, unit suite, and Playwright E2E/visual suite passes with `0` errors and `0` `reviewedDebt` entries.
- **Test Strategy:**
  ```powershell
  pnpm --filter @moonwitness/types build ; if ($?) { pnpm --filter @moonwitness/ui test } ; if ($?) { pnpm --filter @moonwitness/client test } ; if ($?) { pnpm board:ui:check --all-product-apps } ; if ($?) { pnpm ui:design:audit } ; if ($?) { pnpm desktop:ui:check } ; if ($?) { pnpm board:budget } ; if ($?) { pnpm test:ui-budget } ; if ($?) { pnpm test:ui-catalog } ; if ($?) { pnpm desktop:test:web } ; if ($?) { pnpm test:e2e:visual:matrix }
  ```
- **Risk Level:** Low (pure verification gate).
