# Consumer Experience — 15. Target Architecture

- **Status:** Target Blueprint (Phase 2 Synthesis)
- **Baseline Inputs:** [01-repository-architecture.md](./01-repository-architecture.md), [02-visual-audit.md](./02-visual-audit.md), [03-component-inventory.md](./03-component-inventory.md), [04-component-centralization.md](./04-component-centralization.md), [05-design-system.md](./05-design-system.md), [06-animation-audit.md](./06-animation-audit.md), [07-user-flow-audit.md](./07-user-flow-audit.md), [08-coverage-matrix.md](./08-coverage-matrix.md), [09-visual-benchmark.md](./09-visual-benchmark.md)
- **Companion Wiring & Backlog:** [16-wiring-specification.md](./16-wiring-specification.md), [diagrams/wiring-topology.mmd](./diagrams/wiring-topology.mmd), [17-implementation-roadmap.md](./17-implementation-roadmap.md), [diagrams/implementation-dag.mmd](./diagrams/implementation-dag.mmd)

---

## 1. Architectural Mandate & Design Objectives

The MoonWitness XV consumer experience currently exhibits a **two-tier split**: high-craft editorial entry routes (`/`, `/login`, `/register`, `/board` masthead) alongside broken frame masks (`--mw-chalk-mask` stretched occlusion), dark-mode contrast failures on Settings buttons, an unreachable public `/knowledge` route, blank `FXLab` animation containers, 23 frozen `.mw-ui-*` child-class overrides, and flat SaaS operational subpages with zero character, progression, or scene runtime presence.

The target architecture resolves these failures structurally through four non-negotiable mandates:

1. **Strict 7-Layer Acyclic Dependency Graph:** Every consumer package and internal `@moonwitness/ui` module layer flows strictly downward from Domain Hosts/Consumers through UI Composition and Assets to `@moonwitness/types`, guaranteeing **zero circular dependencies**.
2. **Governance-Native Compliance:** All shared primitives, tokens, skins, and consumer compositions satisfy [`scripts/check-board-shared-ui.mjs`](../../../scripts/check-board-shared-ui.mjs), [`scripts/check-ui-design-system.mjs`](../../../scripts/check-ui-design-system.mjs), [`scripts/check-desktop-non-overlap.mjs`](../../../scripts/check-desktop-non-overlap.mjs), and bundle budgets ([`apps/board/bundle-budget.json`](../../../apps/board/bundle-budget.json), [`apps/ui-catalog/bundle-budget.json`](../../../apps/ui-catalog/bundle-budget.json)) with **zero** `reviewedDebt` entries remaining.
3. **4-Direction Unified Skin System (`moonwitness-riot` Addition):** Expressive editorial surfaces and dense operational workspaces share one contrast-verified token core (`>= 4.5:1` text, `>= 3.0:1` UI/focus) supporting **Funky Grunge Light**, **Funky Grunge Dark**, **Riot (`moonwitness-riot`)**, and **High Contrast (`moonwitness-high-contrast`)**, augmented by semantic comic & kinetic motion tokens.
4. **Deterministic Scene, Character & Progression Runtime:** `LayeredScene`, `SpritePlayer`, `SceneParticles`, `ComicSceneTransition`, `CharacterDisplay`/`CharacterReaction`, `QuestCard`, `AchievementBadge`, `RewardPanel`, and `useSfx` / `createSceneSoundscapeController` operate reliably across SSR, hydration, desktop webview, and `prefers-reduced-motion: reduce`.

---

## 2. 7-Layer Target Architecture

Dependencies flow strictly from higher layers (`Layer 7`) down toward lower layers (`Layer 1`) or peer data planes (`Layer 6` Client/API/ORM) without upward or cyclic edges.

```text
Layer 7: Consumer Applications
         @moonwitness/board (product-adopter)
         @moonwitness/desktop (product-adopter via @ -> apps/board/src)
         @moonwitness/ui-catalog (reference-consumer)
         @moonwitness/docs (publication-shell)
           │                                      │
           ▼                                      ▼
Layer 6: Transport, Domain & Persistence Plane    (Data / Runtime Plane)
         @moonwitness/client  ──►  @moonwitness/api  ──►  @moonwitness/orm + @moonwitness/orm-*
         (apps/desktop sidecar consumes @moonwitness/orm-* directly; apps/board NEVER does [INV-009])
           │
           ▼
Layer 5: @moonwitness/ui — Visual-Experience & Animation Layer
         ComicPanel, MangaFrame, StickerBadge, SpeechBubble, CharacterDisplay, CharacterReaction,
         QuestCard, AchievementBadge, RewardPanel, LayeredScene, SpritePlayer, SceneParticles,
         ComicSceneTransition, CharacterPreview, Audio/SoundProvider, SceneSoundscape, SceneTimeline
           │
           ▼
Layer 4: @moonwitness/ui — Composed Surfaces Layer
         Panel, PageHeader, SectionRibbon, PaperNote, ArtworkFrame, MetricTile, EmptyState,
         ErrorState, ConfirmDialog, Toolbar, Pagination, Breadcrumbs, KanbanBoard, FilterFacetBar,
         Chart (BarChart/LineChart), LogConsole, SmartButtonBox, StatusBar, ModePicker, UpdateBanner
           │
           ▼
Layer 3: @moonwitness/ui — Primitives & Controls Layer
         Button, Input, Textarea, Checkbox, Switch, Label, Field, Select, SelectField, DatePicker,
         NumberInput, TagInput, Badge, Avatar, Skeleton, Dialog, Sheet, Popover, DropdownMenu,
         Tabs, Tooltip, Command, Table, ToastHost, Icons (./icons/*)
           │
           ▼
Layer 2: Foundation Assets & Token Layer
         @moonwitness/assets (fonts.css, manifest.json, brand/*, illustrations/*, materials/*,
                              animation/*, environments/*, scenes/*, sounds/*)
         @moonwitness/ui/styles/tokens.css + @moonwitness/ui/themes + @moonwitness/ui/lib/asset-registry
           │
           ▼
Layer 1: @moonwitness/types
         Zero workspace dependencies: BuiltinSkinId, ColorMode, SkinDensity, SkinId, SkinMetadata,
         ThemeRegistry, UserThemePreferences, Domain/View metadata DTOs
```

### 2.1 Layer Ownership & Responsibilities

| Layer       | Package / Sub-layer                                                                                               | Exact Modules / Responsibilities                                                                                                                                                                                                                                                                                                                              | Allowed Downward Imports                                                                                                                                                           | Forbidden Imports (Cycle & Boundary Guard)                                                                                                                                      |
| :---------- | :---------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Layer 1** | `@moonwitness/types` ([`packages/types`](../../../packages/types/package.json))                                   | Skin & theme contracts (`BuiltinSkinId`, `SkinMetadata`, `ThemeRegistry`), ORM view metadata (`ListView`, `FormView`, `KanbanView`, `FieldMeta`), shared DTOs.                                                                                                                                                                                                | None (`0` workspace deps)                                                                                                                                                          | All other `@moonwitness/*` packages, React, DOM, Node built-ins                                                                                                                 |
| **Layer 2** | `@moonwitness/assets` ([`packages/assets`](../../../packages/assets/package.json)) + `@moonwitness/ui` Foundation | Canonical visual media (`manifest.json`), fonts (`fonts.css` + `JetBrains Mono` 700), [`tokens.css`](../../../packages/ui/src/styles/tokens.css), [`themes/index.ts`](../../../packages/ui/src/themes/index.ts), `lib/asset-registry.ts`, `lib/cn.ts`, `lib/compose-refs.ts`.                                                                                 | `@moonwitness/types`                                                                                                                                                               | React components (`./components/*`), `@moonwitness/client`, `@moonwitness/orm*`, app code                                                                                       |
| **Layer 3** | `@moonwitness/ui` Primitives                                                                                      | Accessible headless wrappers & atomic controls (`button`, `input`, `field`, `select`, `dialog`, `sheet`, `table`, `toast`, `skeleton`, `badge`, `icons/*`).                                                                                                                                                                                                   | Layer 1 (`@moonwitness/types`), Layer 2 (`tokens.css`, `lib/cn`, `lib/use-modal-focus`)                                                                                            | Layer 4/5 `@moonwitness/ui` compositions, `@moonwitness/client`, Next.js/Tauri APIs                                                                                             |
| **Layer 4** | `@moonwitness/ui` Composed Surfaces                                                                               | Multi-part UI surfaces (`panel`, `page-header`, `metric-tile`, `empty-state`, `error-state`, `confirm-dialog`, `kanban-board`, `filter-facet-bar`, `pagination`, `breadcrumbs`, `chart`, `status-bar`).                                                                                                                                                       | Layer 1–3 (`tokens`, `lib/*`, Primitives)                                                                                                                                          | Layer 5 (`SpritePlayer`/`LayeredScene` except via `EmptyState` slot or `ErrorState` static `asset-registry`), `@moonwitness/client`, router packages (`next/*`, `react-router`) |
| **Layer 5** | `@moonwitness/ui` Visual-Experience & Animation                                                                   | Expressive comic/progression & runtime engines (`comic-panel`, `manga-frame`, `sticker-badge`, `speech-bubble`/`effects`, `character-display`, `quest-card`, `achievement-badge`, `reward-panel`, `layered-scene`, `sprite-player`, `scene-particles`, `scene-transitions`, `audio`, `lib/scene-*`, `lib/character-adapter`, `lib/use-animation-visibility`). | Layer 1–4 (`types`, `asset-registry`, `themes`, Primitives, `Panel`/`MangaPanel`)                                                                                                  | `@moonwitness/client`, React Query, `@moonwitness/orm*`, app state                                                                                                              |
| **Layer 6** | `@moonwitness/client`, `@moonwitness/api`, `@moonwitness/orm-*`                                                   | Typed REST/JSON-RPC SDK ([`packages/client`](../../../packages/client/package.json)), Fastify 5 thin API host ([`apps/api`](../../../apps/api/package.json)), and Objection/Knex addons (`packages/orm*` via `INV-014`).                                                                                                                                      | `@moonwitness/types` (`client` -> `types`; `api` -> `orm-*` -> `orm` -> `types`)                                                                                                   | `@moonwitness/ui`, `@moonwitness/board`, `@moonwitness/desktop`                                                                                                                 |
| **Layer 7** | `@moonwitness/board`, `@moonwitness/desktop`, `@moonwitness/ui-catalog`, `@moonwitness/docs`                      | Route shells, BFF `/api/session`, TanStack Query hooks, `DesktopRouteSwitch` + Tauri sidecar bridge, Catalog specimen gallery, Docs portal.                                                                                                                                                                                                                   | Layers 1–5 (`@moonwitness/ui`, `@moonwitness/assets`, `@moonwitness/types`) + `@moonwitness/client` (`board`/`desktop` only); `desktop` Node sidecar may use `orm-*` per `INV-009` | Direct `@moonwitness/orm*` in `apps/board/src` (`INV-009`); raw HTML controls/SVGs in `product-adopter` apps                                                                    |

---

## 3. Zero Circular Dependency Enforcement

Circular dependencies are prevented by **four structural rules** verified in TypeScript project compilation and static governance checks:

1. **One-Way Package Graph:**
   - `@moonwitness/types` has `0` workspace dependencies.
   - `@moonwitness/assets` has `0` runtime workspace dependencies.
   - `@moonwitness/ui` depends ONLY on `@moonwitness/types` (and optionally consumes asset paths through typed metadata in `@moonwitness/ui/lib/asset-registry` rather than importing React consumers or `@moonwitness/client`).
   - `@moonwitness/client` depends ONLY on `@moonwitness/types`.
   - `@moonwitness/board` and `@moonwitness/desktop` depend on `@moonwitness/ui`, `@moonwitness/assets`, `@moonwitness/client`, and `@moonwitness/types`—never the reverse.
2. **Router- & Query-Agnostic Shared UI (`@moonwitness/ui`):**
   - Components promoted from `apps/board` (`Breadcrumbs`, `ConfirmDialog`, `ErrorState`, `QuestCard`) must accept callbacks (`onNavigate`, `renderLink`, `onConfirm`, `onRetry`) rather than importing `next/link`, `next/navigation`, `@tanstack/react-query`, or `@/lib/client`.
3. **Internal `@moonwitness/ui` Layering (`3 -> 2 -> 1`, `4 -> 3`, `5 -> 4`):**
   - Foundation helpers (`lib/cn.ts`, `lib/asset-registry.ts`, `themes/index.ts`) never import `./components/*`.
   - Layer 3 Primitives (`button.tsx`, `dialog.tsx`, `badge.tsx`) never import Layer 4 (`panel.tsx`, `empty-state.tsx`) or Layer 5 (`effects.tsx`, `character-display.tsx`).
   - Layer 4 Composed components (`empty-state.tsx`, `error-state.tsx`) accept `illustration?: ReactNode | AssetId` slots rather than importing `CharacterDisplay` directly; Layer 5 (`CharacterReaction`) composes Layer 4 (`Panel`/`EmptyState`) and Layer 3 (`Badge`/`Button`) cleanly downward.
4. **Build-Time & Test-Time Verification:**
   - [`packages/ui/package.json`](../../../packages/ui/package.json) `pnpm --filter @moonwitness/ui build` runs `generate-icons.mjs` + `tsc` with strict module boundaries.
   - [`scripts/check-ui-design-system.mjs`](../../../scripts/check-ui-design-system.mjs) verifies zero cyclic CSS `--mw-*` token definitions and 1:1 `packages/ui/src/components/*.tsx` to `exports` parity.

---

## 4. Governance Rules & Gate Enforcement

All consumer-experience changes must pass the three static governance scripts plus bundle budget gates documented in [`01-repository-architecture.md`](./01-repository-architecture.md#8-governance-gates-bundle-budgets):

### 4.1 `scripts/check-board-shared-ui.mjs` (`pnpm board:ui:check --all-product-apps`)

- **App Classification Gate:** Every folder in `apps/*` with a `package.json` must match [`scripts/ui-governance-policy.json`](../../../scripts/ui-governance-policy.json):
  - `product-adopter`: `apps/board`, `apps/desktop` (must declare `@moonwitness/ui`).
  - `reference-consumer`: `apps/ui-catalog`.
  - `publication-shell`: `apps/docs`.
  - `standalone-exempt`: `apps/agent-observability` (read-only, untouched).
  - `non-ui`: `apps/api`, `apps/agent-sandbox`, `apps/isp`, `apps/control-plane`.
- **Forbidden Patterns in `product-adopter` Apps:**
  - Raw JSX `<button>`, `<input>`, `<select>`, `<textarea>`, `<svg>`.
  - Direct icon library imports (`lucide-react`, `@heroicons/react`, `react-icons`, `react-feather`).
  - Internal `@moonwitness/ui/dist/*` imports (all imports must use public subpaths in `packages/ui/package.json`).
- **Policy Path Alignment Fix Required:** Update `apps/desktop.runtimeEvidence[0].tests` in [`scripts/ui-governance-policy.json`](../../../scripts/ui-governance-policy.json#L61) from `apps/desktop/e2e/desktop-web.spec.ts` to the real test file [`apps/desktop/desktop-web/tests/routes.spec.ts`](../../../apps/desktop/desktop-web/tests/routes.spec.ts) (and add `@moonwitness/assets` to `apps/desktop/package.json`).

### 4.2 `scripts/check-ui-design-system.mjs` (`pnpm ui:design:check` / `pnpm ui:design:audit`)

- **Export & Token Integrity:**
  - Every `packages/ui/src/components/*.tsx` must have a matching `"./components/<name>"` export in [`packages/ui/package.json`](../../../packages/ui/package.json) (and vice versa).
  - Zero cyclic `--mw-*` CSS custom properties; zero undefined `var(--mw-*)` references; zero duplicate inline chalk-mask data URIs (`duplicate-chalk-mask`—fixes dead `--board-chalk-mask` & `--global-chalk-mask` in `apps/board`).
  - Zero hardcoded visual colors (`#hex`, `rgb(...)`, `oklch(...)`, Tailwind palette classes like `bg-yellow-400`, `text-slate-500`) inside `product-adopter` apps.
- **23-Entry Child-Class Debt Burn-Down (`sharedChildClassOverrides`):**
  - Target state reduces `rules.sharedChildClassOverrides.reviewedDebt` in [`scripts/ui-governance-policy.json`](../../../scripts/ui-governance-policy.json#L174-L316) from **23 entries -> 0 entries** by promoting first-class props onto `@moonwitness/ui` components (`SectionRibbon`, `Panel`, `MetricTile`, `PageHeader`, `SelectTrigger`) and deleting the consumer `.mw-ui-*` child overrides in `apps/board/src/app/global.css` (4), `apps/board/src/index.css` (7), and `apps/ui-catalog/src/styles.css` (12).
- **Alias Canonicalization:** Migrate all **41** consumer `--ink*` alias references to canonical `--mw-*` tokens and promote `aliasCanonicalization.enforcement` from `"report-only"` to `"error"`.

### 4.3 `scripts/check-desktop-non-overlap.mjs` (`pnpm desktop:ui:check`, `INV-009`)

- **Hard Membrane:**
  - `apps/desktop/src/**/*.ts` must NEVER invoke `defineModel(` or `defineAddon(`.
  - `apps/board/src/**/*.{ts,tsx,js,jsx}` must NEVER import `@moonwitness/orm*`, `tauri`, `better-sqlite3`, `node-pty`, or `node:{fs,fs/promises,child_process,os,process}`.
- **Shared Web Surface Rule:** Desktop UI parity happens strictly via Vite `@` -> `apps/board/src` aliasing in [`apps/desktop/desktop-web/vite.config.ts`](../../../apps/desktop/desktop-web/vite.config.ts) plus progressive runtime detection of `window.__MW_DESKTOP__` and `window.__MW_DESKTOP_API_URL__`.

---

## 5. Frame Geometry, Contrast & Skin Layer (`moonwitness-riot`)

### 5.1 Root-Cause Elimination of Stretched `--mw-chalk-mask` Distortion

- **Observed P0 Failure:** [`packages/ui/src/styles/tokens.css`](../../../packages/ui/src/styles/tokens.css#L243) defines `--mw-chalk-mask` with `viewBox="0 0 200 100" preserveAspectRatio="none"` and interior strokes. Applied at `mask-size: 100% 100%` in `components.css`, `apps/board/src/index.css`, and `apps/board/src/app/global.css`, tall mobile cards and wide tables scale 4px strokes into 20–45px blocks slicing straight through text, column headers, and dialog controls.
- **Target Frame Contract:**
  1. Remove `mask-image: var(--mw-chalk-mask)` from all content-bearing containers (`.mw-ui-panel`, `.mw-ui-dialog-content`, `.mw-ui-table`, `.ink-panel`, `.home-editorial-card`).
  2. Replace panel/dialog/table framing with **9-slice `border-image` SVG** (`border-image-slice: 16`, `border-image-width: 12px`, `border-image-repeat: round`) or crisp `--mw-frame-width` (`2px` / `3px`) ink borders with `--mw-grunge-radius-hand` and `--mw-shadow-ink`.
  3. Confine decorative corner stamps, tape strips, and chalk ticks strictly outside `--mw-torn-safe-inset` (`0.75rem` minimum inner clearance) so bounding boxes of pseudo-elements never intersect `.mw-ui-panel-header`, `.mw-ui-panel-content`, or `thead`.

### 5.2 `moonwitness-riot` Skin Layer & 4 Art Directions

Extend [`BuiltinSkinId`](../../../packages/types/src/theme.ts#L5) and [`BUILTIN_SKINS`](../../../packages/ui/src/themes/index.ts#L25) to support 4 cohesive skins (`moonwitness-ink`, `moonwitness-compact`, `moonwitness-high-contrast`, **`moonwitness-riot`**):

| Skin ID (`data-skin`)       | Target Art Direction          | Light Surface / Accent            | Dark Surface / Accent             | Frame & Shadow Character                                         | Verified Min Contrast (`tokens.css` / `05-design-system.md`) |
| :-------------------------- | :---------------------------- | :-------------------------------- | :-------------------------------- | :--------------------------------------------------------------- | :----------------------------------------------------------- |
| `moonwitness-ink`           | **Funky Grunge Light / Dark** | `#f3efe4` / `#ffe031`             | `#0e0e10` / `#ffe031`             | `2px` ink, `3px`/`6px` hard offset, `7px` halftone               | `>= 5.11:1` (Dark `magenta-readable`)                        |
| `moonwitness-riot`          | **Riot / Punk Comic Poster**  | `#f5efdf` / `#ffe031` + `#ff2e88` | `#09090b` / `#ff2e88` + `#ffe031` | `3px` heavy ink, `4px`/`7px` offset + magenta/cyan double impact | `>= 5.49:1` across all 20 token pairs                        |
| `moonwitness-high-contrast` | **WCAG AAA Accessibility**    | `#ffffff` / `#ffd000`             | `#000000` / `#ffd000`             | `3px` pure border, zero halftone grain                           | `>= 5.55:1` (`21:1` text)                                    |
| `moonwitness-compact`       | **Dense Operational Utility** | `#f0eee9` / `#00b8f0`             | `#0f1014` / `#00b8f0`             | Tighter radii, `compact` default density                         | `>= 5.12:1`                                                  |

- **Settings Contrast Contract (P0 Fix):** In [`apps/board/src/board-pages/settings-page.tsx`](../../../apps/board/src/board-pages/settings-page.tsx#L830-L920), unselected Theme, Skin (`sm:grid-cols-2 lg:grid-cols-4`), and Density cards MUST use `variant="outline"` (surface background + `--mw-foreground` / `--mw-ink-soft`) and selected cards MUST enforce `text-[var(--mw-primary-foreground)]` on primary backgrounds—never rendering dark-mode `--mw-ink-soft` (`#c9c5b8`) over `#ffe031` yellow (`1.3:1` failure eliminated).

### 5.3 Typography & Semantic Comic / Motion Tokens

1. **Disambiguate Font Stacks ([`packages/ui/src/styles/tokens.css`](../../../packages/ui/src/styles/tokens.css#L81-L84)):**
   - `--mw-font-display`: `'Anton', 'MoonWitness Grunge', Impact, 'Arial Narrow', sans-serif` (crisp condensed KPI & header metrics).
   - `--mw-font-brush`: `'Road Rage', 'MoonWitness Grunge', Impact, sans-serif` (expressive brush ribbons).
   - `--mw-font-grunge`: `'MoonWitness Grunge', 'Road Rage', Impact, sans-serif` (hero/poster grunge lockups).
   - Add `JetBrains Mono` weight `700` `@font-face` in [`packages/assets/fonts.css`](../../../packages/assets/fonts.css) and triage `raw_arts/fonts/{saksi-*,cinzel-*}` (register with provenance in `licenses.json` or archive).
2. **Semantic Comic & Motion Tokens (`tokens.css`):**
   - `--mw-comic-gutter`, `--mw-comic-panel-border`, `--mw-comic-panel-bg`, `--mw-comic-bubble-bg`/`fg`, `--mw-comic-sfx-bg`/`fg`, `--mw-comic-stamp-bg`/`fg`, `--mw-comic-halftone-size`, `--mw-comic-sticker-tilt`.
   - `--mw-motion-comic-steps: 3`, `--mw-motion-comic-pop: 200ms`, `--mw-motion-comic-wipe: 280ms`, `--mw-motion-comic-jitter: 900ms`, `--mw-motion-ease-comic-snap: cubic-bezier(0.22, 1.35, 0.36, 1)`.
   - Zero **all** motion duration tokens inside `@media (prefers-reduced-motion: reduce)` (including `--mw-motion-draw`, `--mw-motion-delay`, `--mw-motion-effect`, `--mw-motion-pulse`, `--mw-motion-progress`, `--mw-motion-spin`, and `--mw-motion-comic-*`).
