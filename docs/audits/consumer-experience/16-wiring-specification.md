# Consumer Experience — 16. Wiring Specification

- **Topology Diagram:** [`diagrams/wiring-topology.mmd`](./diagrams/wiring-topology.mmd)
- **Architecture Blueprint:** [`15-target-architecture.md`](./15-target-architecture.md)
- **Implementation Backlog:** [`17-implementation-roadmap.md`](./17-implementation-roadmap.md)

---

## 1. Public Subpath Import Rules & Package Contracts

Consumer applications (`apps/board`, `apps/desktop`, `apps/ui-catalog`, `apps/docs`) must obey strict package import boundaries enforced by [`scripts/check-board-shared-ui.mjs`](../../../scripts/check-board-shared-ui.mjs), [`scripts/check-ui-design-system.mjs`](../../../scripts/check-ui-design-system.mjs), and [`scripts/check-desktop-non-overlap.mjs`](../../../scripts/check-desktop-non-overlap.mjs):

| Rule ID | Import Rule | Enforced On | Exact Allowed / Forbidden Specifiers |
| :--- | :--- | :--- | :--- |
| **WIR-01** | **Public `@moonwitness/ui` Subpaths Only** | `apps/*` | Allowed: `@moonwitness/ui/components/<kebab-name>`, `@moonwitness/ui/themes`, `@moonwitness/ui/icons`, `@moonwitness/ui/icons/<name>`, `@moonwitness/ui/lib/<module>`, `@moonwitness/ui/components.css`, `@moonwitness/ui/styles/tokens.css`. Forbidden: `@moonwitness/ui/dist/*`, `@moonwitness/ui/src/*`. |
| **WIR-02** | **1:1 Component-to-Export Parity** | `packages/ui` | Every `packages/ui/src/components/<name>.tsx` MUST have a matching `"./components/<name>"` entry in [`packages/ui/package.json`](../../../packages/ui/package.json) resolving to `dist/components/<name>.{d.ts,js}`. |
| **WIR-03** | **Zero Raw Controls / Foreign Icons** | `product-adopter` (`apps/board`, `apps/desktop`) | Forbidden: JSX `<button>`, `<input>`, `<select>`, `<textarea>`, `<svg>`, plus imports from `lucide-react`, `@heroicons/react`, `react-icons`, `react-feather`. Must use `@moonwitness/ui/components/*` & `@moonwitness/ui/icons`. |
| **WIR-04** | **Desktop Alias & Runtime Membrane (`INV-009`)** | `apps/board/src`, `apps/desktop` | `apps/desktop/desktop-web/vite.config.ts` aliases `@` -> `apps/board/src` and shims `next/{link,navigation,image,dynamic}`. `apps/board/src` must NEVER import `@moonwitness/orm*`, `tauri`, `better-sqlite3`, `node-pty`, or `node:*`. |
| **WIR-05** | **Explicit Workspace Dependencies** | `apps/desktop`, `apps/board` | `apps/desktop/package.json` declares both `@moonwitness/ui` and `@moonwitness/assets` (`workspace:*`) alongside `@moonwitness/client` and `@moonwitness/types`. |

---

## 2. Explicit Component & Service Wiring Matrix

| Capability / Surface | Canonical Package & File | Key TypeScript Contract / Exported Symbols | Consumer Wiring Targets | Replacement / Debt Retired |
| :--- | :--- | :--- | :--- | :--- |
| **Theme & Skin Registry** | `@moonwitness/types` ([`packages/types/src/theme.ts`](../../../packages/types/src/theme.ts)) + `@moonwitness/ui/themes` ([`packages/ui/src/themes/index.ts`](../../../packages/ui/src/themes/index.ts)) | `BuiltinSkinId` (`'moonwitness-ink' \| 'moonwitness-compact' \| 'moonwitness-high-contrast' \| 'moonwitness-riot'`), `BUILTIN_SKINS`, `themeRegistry`, `createSkinInitScript()` | [`apps/board/src/components/providers/skin-provider.tsx`](../../../apps/board/src/components/providers/skin-provider.tsx), [`apps/board/src/app/layout.tsx`](../../../apps/board/src/app/layout.tsx), [`apps/desktop/desktop-web/main.tsx`](../../../apps/desktop/desktop-web/main.tsx) | Replaces 3-skin `sm:grid-cols-3` assumption in `settings-page.tsx` with 4-skin `themeRegistry.list()` grid |
| **Typed Asset Registry** | `@moonwitness/ui/lib/asset-registry` (`packages/ui/src/lib/asset-registry.ts` -> export in `packages/ui/package.json`) | `AssetId`, `AssetThemeMode`, `AssetEntry`, `resolveAssetUrl(id, opts?)`, `resolveThemedAsset(pairId, mode)`, `getCharacterClips(characterId)` | `apps/board`, `apps/desktop`, `apps/ui-catalog`, `ErrorState`, `CharacterDisplay`, `HomeHeroArt`, `Logo` | Replaces ad-hoc hardcoded string paths (`/illustrations/...`, `/brand/...`) across pages |
| **Animation Visibility Hook** | `@moonwitness/ui/lib/use-animation-visibility` ([`packages/ui/src/lib/use-animation-visibility.ts`](../../../packages/ui/src/lib/use-animation-visibility.ts)) | `useAnimationVisibility<T>(externalRef?) => { ref, visibilityClass, isVisible }` (callback-ref state tracking) | `effects.tsx`, `ComicPanel`, `CharacterDisplay`, `QuestCard`, `RewardPanel` | Fixes initial-paint `opacity: 0` trap & stale `elementRef.current` on conditional remounts |
| **Scene & Character Engine** | `@moonwitness/ui/lib/scene-playback`, `scene-camera`, `scene-timeline`, `character-adapter`, `scene-test-harness` | `createScenePlaybackController`, `createSceneCameraController`, `createSceneTimeline`, `createCharacterAdapterRegistry`, `getActiveSceneHarness` | `LayeredScene`, `SpritePlayer`, `CharacterDisplay`, `CharacterReaction`, `SceneLab.tsx` | Connects existing runtime engine from `SceneLab`-only to production `/`, `/login`, `/board` |
| **FX & Transitions** | `@moonwitness/ui/components/scene-particles`, `scene-transitions`, [`components.css`](../../../packages/ui/src/styles/components.css) | `SceneParticles({ preset, intensity, count, seed, paused, reducedMotion })`, `ComicSceneTransition({ variant, active, durationMs, reducedMotion, onComplete })` | `FXLab.tsx`, `/board` hero transitions, `/board/stories/workbench` page turns, `RewardPanel` | Fixes blank FXLab containers by adding `@keyframes` & `matchMedia('(prefers-reduced-motion: reduce)')` |
| **Audio & Soundscape** | `@moonwitness/ui/components/audio`, `lib/audio-runtime`, `lib/scene-soundscape` | `SoundProvider`, `useSfx()`, `SoundToggle`, `createSceneSoundscapeController` | `RootLayout`, `HomeHeader`, `AppShell`, `AuthPage`, `FormView`, `KanbanView`, `ProjectsPage`, `StoryWorkbenchPage`, `RewardPanel` | Expands `useSfx().play(...)` beyond single `auth-page.tsx:90` call site; gesture-gated & default muted |
| **Comic & Character Visuals** | `@moonwitness/ui/components/{comic-panel,manga-frame,sticker-badge,character-display}`, `effects.tsx` (`SpeechBubble`) | `ComicPanel`, `ComicStrip`, `MangaFrame`, `StickerBadge`, `SpeechBubble({ tailDirection, variant, tone, speaker })`, `CharacterDisplay`, `CharacterReaction` | `/`, `/knowledge`, `/board`, `/board/studio`, `/board/ai/*`, `/board/projects`, `EmptyState`, `ErrorState` | Replaces stub `SpeechBubble` & debug-only `CharacterPreview` in product flows |
| **Progression Primitives** | `@moonwitness/ui/components/{quest-card,achievement-badge,reward-panel}` | `QuestCard`, `AchievementBadge`, `RewardPanel` | `/board` onboarding checklist, `/board/studio` publication readiness, `/board/projects` milestone completion | Replaces static `+1 every day` sidebar pill & plain text checklists |
| **Unified Dialogs & States** | `@moonwitness/ui/components/{confirm-dialog,error-state,breadcrumbs,field,filter-facet-bar,pagination,kanban-board}` | `ConfirmDialog`, `ErrorState`, `Breadcrumbs({ renderLink })`, `Field`, `FilterFacetBar`, `Pagination`, `KanbanBoard` | `ModelPage`, `ListView`, `KanbanView`, `SearchEngineBar`, `WhatsAppStatusPage`, `MissionControlShell`, `DesktopErrorBoundary` | Retires local `confirm-dialog.tsx`, `window.confirm()`, inline 404/error panels, and activates 4 unused `@moonwitness/ui` exports |
| **Sized Shared Primitives (Debt Burn-Down)** | `@moonwitness/ui/components/{section-ribbon,panel,metric-tile,page-header,select}` | `SectionRibbon` (`size?: 'sm'\|'md'\|'lg'`, `treatment`), `Panel` (`density?: 'micro'\|'default'\|'spacious'`), `MetricTile` (`size?: 'compact'\|'default'\|'hero'`, `interactive`), `PageHeader` (`scale?: 'default'\|'hero'`), `SelectTrigger` (`fullWidth`) | [`apps/board/src/app/global.css`](../../../apps/board/src/app/global.css), [`apps/board/src/index.css`](../../../apps/board/src/index.css), [`apps/ui-catalog/src/styles.css`](../../../apps/ui-catalog/src/styles.css) | Eliminates all **23** frozen `sharedChildClassOverrides` in `scripts/ui-governance-policy.json` |

---

## 3. Typed `@moonwitness/ui/lib/asset-registry` Contract

To prevent drifting relative URLs and broken light/dark SVG pairings across Next.js (`apps/board/public/` populated by [`scripts/copy-board-public-assets.mjs`](../../../scripts/copy-board-public-assets.mjs)) and Vite (`apps/desktop`, `apps/ui-catalog`, `apps/docs`), all media lookups route through a single typed module exported at `@moonwitness/ui/lib/asset-registry` (`packages/ui/src/lib/asset-registry.ts`):

```ts
export type AssetCategory =
  | 'brand'
  | 'illustration'
  | 'environment'
  | 'scene'
  | 'animation'
  | 'material'
  | 'sound';

export type AssetThemeMode = 'light' | 'dark';

export interface AssetRegistryOptions {
  /** Base path prefix (defaults to '' for root-served Next.js/Desktop; e.g. import.meta.env.BASE_URL in Vite subpaths). */
  readonly basePath?: string;
  /** Color mode used when resolving paired SVG/illustration IDs. */
  readonly mode?: AssetThemeMode;
}

export type BrandAssetId =
  | 'brand.lockup'
  | 'brand.lockup-mono'
  | 'brand.symbol'
  | 'brand.symbol-mono'
  | 'brand.wordmark'
  | 'brand.wordmark-mono'
  | 'brand.favicon';

export type IllustrationAssetId =
  | 'illustration.home-hero-desktop'
  | 'illustration.home-hero-mobile'
  | 'illustration.auth-login-desktop'
  | 'illustration.auth-login-mobile'
  | 'illustration.board-masthead'
  | 'illustration.story-workbench-masthead'
  | 'illustration.moon-city-orbit'
  | 'illustration.editorial-people'
  | 'illustration.editorial-knowledge'
  | 'illustration.editorial-stories'
  | 'illustration.editorial-archive'
  | 'illustration.editorial-signal'
  | 'illustration.editorial-rain'
  | 'state.empty'
  | 'state.no-results'
  | 'state.no-activity'
  | 'state.access-denied'
  | 'state.not-found'
  | 'state.offline'
  | 'state.onboarding'
  | 'pattern.orbit';

export type CharacterClipId =
  | 'crew-01-idle'
  | 'crew-01-hair-move'
  | 'crew-01-turn'
  | 'crew-01-walk';

export type SoundAssetId =
  | 'ui.success'
  | 'ui.alert'
  | 'ui.signal'
  | 'ambience.moon-city-night'
  | 'ambience.underground-hum'
  | 'ambience.archive-quiet'
  | 'ambience.street-rain';

export type AssetId = BrandAssetId | IllustrationAssetId | SoundAssetId | 'scene.moon-city';

export interface ResolvedAsset {
  readonly id: AssetId;
  readonly url: string;
  readonly manifestPath: string;
  readonly category: AssetCategory;
  readonly width?: number;
  readonly height?: number;
}

export function resolveAsset(id: AssetId, options?: AssetRegistryOptions): ResolvedAsset;
export function resolveAssetUrl(id: AssetId, options?: AssetRegistryOptions): string;
export function resolveCharacterClip(clipId: CharacterClipId, options?: AssetRegistryOptions): CharacterClipDescriptor;
```

**Contract Guarantees:**
1. Every `manifestPath` maps 1:1 to a verified entry in [`packages/assets/manifest.json`](../../../packages/assets/manifest.json) (checked by a Node unit test in `packages/ui/tests/`).
2. Paired `state.*` and `brand.*` IDs deterministically resolve `-light.{svg}` vs `-dark.{svg}` from `options.mode ?? 'light'`.
3. `apps/board` keeps `basePath: ''` (serving from `apps/board/public/*` synced by `copy-board-public-assets.mjs`), `apps/desktop` resolves from `apps/board/public` via `desktop-web/vite.config.ts` `publicDir`, and `apps/ui-catalog` passes `import.meta.env.BASE_URL`.
4. New Wave 1+ visual assets (`kuro-signal-*`, `vesper-ink-*`, `bg-riot-*`, `scene-*`) are added to `packages/assets/manifest.json` first and registered via typed IDs in `asset-registry.ts` rather than unvalidated string literals.

---

## 4. Animation Lifecycle & `prefers-reduced-motion` Contracts

### 4.1 Deterministic Animation State Machine
Every animated component (`effects.tsx`, `LayeredScene`, `SpritePlayer`, `SceneParticles`, `ComicSceneTransition`, `CharacterDisplay`, `RewardPanel`) obeys a 4-state deterministic lifecycle:

```text
[mount / SSR] ──(hydration + matchMedia check)──► [reduced-static] (when prefers-reduced-motion: reduce OR reducedMotion prop OR sceneReducedMotion=1)
      │
      ├──(no reduced motion; visible in viewport + tab active)──► [active-playing]
      │         │
      │         ├──(IntersectionObserver out-of-view OR document.hidden)──► [offscreen-paused]
      │         └──(one-shot complete / pointer skip)──► [settled-visible] (opacity: 1, transform: none)
```

### 4.2 Hard Contracts
1. **Zero Initial-Paint `opacity: 0` Trap:** Components using `useAnimationVisibility` (`MangaPanel`, `GrungeStamp`, `SpeechBubble`, `InkUnderline`, `PaperNote`, `EmptyState`) MUST render at `opacity: 1` prior to `.mw-ui-motion-visible` activation. Entrance animations trigger strictly on `.mw-ui-motion-visible:not(.mw-ui-motion-reduced)` and are omitted when `isReducedMotion` is true.
2. **Callback-Ref Re-Attachment:** `useAnimationVisibility` stores the observed element in `useState<T | null>(null)` inside its callback `ref` so conditional DOM swaps re-register `IntersectionObserver`.
3. **Automatic OS Reduced-Motion Binding:** `SpritePlayer`, `LayeredScene`, `SceneParticles`, and `ComicSceneTransition` each subscribe to `window.matchMedia('(prefers-reduced-motion: reduce)')` when the `reducedMotion` prop is omitted, honoring `getActiveSceneHarness()?.reducedMotion` override first for deterministic Playwright testing.
4. **Particle & Transition CSS Completeness:** [`packages/ui/src/styles/components.css`](../../../packages/ui/src/styles/components.css) implements `.mw-ui-scene-particles`, `.mw-ui-scene-particle` (`rain`, `dust`, `stars`, `sparks` keyframes capped at `MAX_SCENE_PARTICLES = 36`), and `.mw-ui-comic-transition` (`ink-wipe`, `panel-reveal`, `cut-impact`, `soft` clip-path/transform states), all zeroed/settled immediately under `@media (prefers-reduced-motion: reduce)` and `data-reduced-motion="true"`.
5. **Motion Token Parity:** [`packages/ui/src/styles/tokens.css`](../../../packages/ui/src/styles/tokens.css) zeroes **all** `--mw-motion-*` duration tokens (including `draw`, `delay`, `effect`, `pulse`, `progress`, `spin`, `comic-pop`, `comic-wipe`, `comic-jitter`) inside `@media (prefers-reduced-motion: reduce)`.
6. **Audio Safety Contract:** `SoundProvider` (`audio.tsx`) and `createSceneSoundscapeController` (`scene-soundscape.ts`) initialize muted, gate on first `pointerdown`/`keydown`, cap soundscape volume at `<= 0.4` (`0.18` default), enforce 1 active audio element at a time, and swallow browser autoplay rejections.

---

## 5. Complete Route-to-Component & Route-to-Asset Matrices

### 5.1 `apps/board` & `apps/desktop` Route Matrix

| Route (`apps/board` / `apps/desktop`) | Entry File(s) | Auth & Shell | Primary Mounted Components (`@moonwitness/ui` & App-Local) | Target Asset Registry IDs (`@moonwitness/ui/lib/asset-registry`) |
| :--- | :--- | :--- | :--- | :--- |
| `/` (`apps/board`) | [`apps/board/src/app/page.tsx`](../../../apps/board/src/app/page.tsx) | Public | `HomeHeader`, `Logo` (`BrandMark`), `HomeHeroArt` (`LayeredScene` + fallback), `SectionRibbon`, `PaperNote`, `ComicPanel`, `MangaFrame`, `StickerBadge`, `HorizontalFilmstrip`, `Button`, `SoundToggle` | `brand.lockup`, `illustration.home-hero-desktop`, `illustration.home-hero-mobile`, `illustration.editorial-people`, `illustration.editorial-knowledge`, `illustration.editorial-stories`, `illustration.moon-city-orbit`, `scene.moon-city`, `crew-01-idle` |
| `/` (`apps/desktop`) | [`apps/desktop/desktop-web/main.tsx`](../../../apps/desktop/desktop-web/main.tsx) | `ProtectedRoute` + `AppShell` | `DesktopChrome`, `DesktopBoot`, `DashboardPage` (routes `/` -> `/board`) | `illustration.moon-city-orbit`, plus `/board` assets |
| `/knowledge` (`apps/board` public) | [`apps/board/src/app/knowledge/page.tsx`](../../../apps/board/src/app/knowledge/page.tsx) *(remove `next.config.ts#L54` redirect)* | Public (`PUBLIC_APPROVED`) | `PageHeader`, `Panel`, `Badge`, `StickerBadge`, `Skeleton`, `EmptyState`, `ErrorState`, `Button`, `CharacterReaction` (empty/error) | `brand.lockup`, `illustration.editorial-knowledge`, `state.empty`, `state.offline`, `crew-01-idle` |
| `/knowledge` (`apps/desktop`) | [`apps/desktop/desktop-web/main.tsx#L80`](../../../apps/desktop/desktop-web/main.tsx#L80) | `ProtectedRoute` + `AppShell` | Routes to `KnowledgePage` (same as `/board/knowledge`) | Same as `/board/knowledge` |
| `/login`, `/register` | [`apps/board/src/app/login/page.tsx`](../../../apps/board/src/app/login/page.tsx), [`register/page.tsx`](../../../apps/board/src/app/register/page.tsx), [`auth-page.tsx`](../../../apps/board/src/board-pages/auth-page.tsx) | Public | `AuthPage`, `Logo`, `SoundToggle`, `MangaFrame`, `Panel` (`density="spacious"`), `Field`, `Input`, `Button`, `LoadingSpinner`, `SpeechBubble`, `useSfx().play('success')` | `brand.lockup`, `illustration.auth-login-desktop`, `illustration.auth-login-mobile`, `ui.success`, `ui.alert` |
| `/board` | [`apps/board/src/app/board/page.tsx`](../../../apps/board/src/app/board/page.tsx), [`dashboard-page.tsx`](../../../apps/board/src/board-pages/dashboard-page.tsx) | `ProtectedRoute` + `AppShell` | `AppShell` (`CommandDialog`, `ShortcutsDialog`, `NotificationBell`, `ActivityBell`, `SoundToggle`, `ModePicker`, `UpdateBanner`), `DashboardKpiGrid` (`MetricTile`), `QuestCard` (onboarding), `CharacterDisplay`, `Panel`, `Table`, `Skeleton`, `CronSchedulerPanel` | `brand.symbol`, `illustration.board-masthead`, `state.no-activity`, `crew-01-idle`, `ui.signal` |
| `/board/m/[model]` | [`apps/board/src/app/board/m/[model]/page.tsx`](../../../apps/board/src/app/board/m/[model]/page.tsx), [`model-page.tsx`](../../../apps/board/src/board-pages/model-page.tsx) | `ProtectedRoute` + `AppShell` | `Breadcrumbs`, `Tabs`, `ListView` (`Table`, `Toolbar`, `SearchEngineBar` + `FilterFacetBar`, `Pagination`, `QueryBuilderDialog`, `ImportWizardDialog`, `ConfirmDialog`), `KanbanView` (`KanbanBoard`), `CalendarView`, `GraphView` (`BarChart`/`LineChart`), `PivotView`, `ErrorState`, `EmptyState` + `CharacterReaction` | `state.empty`, `state.no-results`, `state.offline`, `ui.success`, `ui.alert` |
| `/board/m/[model]/new`, `/board/m/[model]/[id]` | [`apps/board/src/app/board/m/[model]/[id]/page.tsx`](../../../apps/board/src/app/board/m/[model]/[id]/page.tsx), [`form-view.tsx`](../../../apps/board/src/components/views/form-view.tsx) | `ProtectedRoute` + `AppShell` | `FormView`, `StatusBar`, `SmartButtonBox`, `Tabs`, `Field`, `FieldWidget`, `One2ManyWidget`, `TagsWidget`, `Chatter`, `WorkflowPanel`, `ConfirmDialog`, `ErrorState`, `EmptyState` | `state.not-found`, `state.offline`, `ui.success`, `ui.alert` |
| `/board/projects` | [`apps/board/src/app/board/projects/page.tsx`](../../../apps/board/src/app/board/projects/page.tsx), [`projects-page.tsx`](../../../apps/board/src/board-pages/projects-page.tsx) | `ProtectedRoute` + `AppShell` | `PageHeader`, `MetricTile`, `KanbanBoard`, `QuestCard`, `AchievementBadge`, `RewardPanel` (milestone completion), `StickerBadge`, `ErrorState`, `Skeleton`, `ConfirmDialog` | `state.empty`, `state.offline`, `crew-01-hair-move`, `ui.success` |
| `/board/knowledge` | [`apps/board/src/app/board/knowledge/page.tsx`](../../../apps/board/src/app/board/knowledge/page.tsx), [`knowledge-page.tsx`](../../../apps/board/src/board-pages/knowledge-page.tsx) | `ProtectedRoute` + `AppShell` | `PageHeader`, `Panel`, `Input`, `Button`, `Badge`, `StickerBadge`, `Skeleton`, `ErrorState`, `EmptyState` | `illustration.editorial-knowledge`, `state.access-denied`, `state.no-results` |
| `/board/stories/workbench` | [`apps/board/src/app/board/stories/workbench/page.tsx`](../../../apps/board/src/app/board/stories/workbench/page.tsx), [`story-workbench-page.tsx`](../../../apps/board/src/board-pages/story-workbench-page.tsx) | `ProtectedRoute` + `AppShell` (`user\|superadmin`) | `SectionRibbon`, `ComicPanel`, `MangaFrame`, `SpeechBubble`, `ComicSceneTransition`, `Panel`, `Button`, `Textarea`, `Badge`, `ErrorState`, `Skeleton` | `illustration.story-workbench-masthead`, `illustration.editorial-stories`, `state.access-denied`, `ui.success` |
| `/board/studio` | [`apps/board/src/app/board/studio/page.tsx`](../../../apps/board/src/app/board/studio/page.tsx), [`editorial-studio-panel.tsx`](../../../apps/board/src/components/creative/editorial-studio-panel.tsx) | `ProtectedRoute` + `AppShell` | `PageHeader` (`treatment="brush"`), `Tabs`, `ComicPanel`, `MangaFrame`, `StickerBadge`, `QuestCard` (publication readiness), `CharacterDisplay`, `Input`, `Textarea`, `SelectField`, `EmptyState` | `illustration.editorial-archive`, `illustration.editorial-signal`, `illustration.editorial-rain`, `state.empty`, `crew-01-idle` |
| `/board/whatsapp`, `/board/whatsapp/status` | [`whatsapp-page.tsx`](../../../apps/board/src/board-pages/whatsapp-page.tsx), [`whatsapp-status-page.tsx`](../../../apps/board/src/board-pages/whatsapp-status-page.tsx) | `ProtectedRoute` + `AppShell` | `InboxList`, `ConversationHeader`, `ConversationTimeline`, `MessageComposer`, `PairingPanel`, `MediaPreview`, `MessageActionDialogs` (`ConfirmDialog`), `ProfileDrawers` (`Sheet`), `StatusBar` | `state.empty`, `state.offline`, `ui.signal`, `ui.success` |
| `/board/commercial` | [`apps/board/src/app/board/commercial/page.tsx`](../../../apps/board/src/app/board/commercial/page.tsx), [`commercial-page.tsx`](../../../apps/board/src/board-pages/commercial-page.tsx) | `ProtectedRoute` + `AppShell` | `PageHeader`, `MetricTile`, `Panel`, `Table`, `Badge`, `Button`, `ErrorState` (for all 3 queries), `EmptyState`, `Skeleton` | `state.empty`, `state.offline`, `ui.success` |
| `/board/cloud` | [`apps/board/src/app/board/cloud/page.tsx`](../../../apps/board/src/app/board/cloud/page.tsx), [`cloud-isp-page.tsx`](../../../apps/board/src/board-pages/cloud-isp-page.tsx) | `ProtectedRoute` (hidden in Desktop Workspace) | `PageHeader`, `PaasStudioPanel`, `PaasTemplateCatalog`, `MeshTopologyPanel` (`MeshNodeCard`), `LogConsole`, `ErrorState`, `Skeleton`, `Tabs` | `state.offline`, `state.empty` |
| `/board/ai` -> `/board/ai/{hq,mission-control,operations,continuity,governance,providers,eval-lab}` | [`apps/board/src/app/board/ai/*/page.tsx`](../../../apps/board/src/app/board/ai/hq/page.tsx) | `ProtectedRoute` (hidden in Desktop Workspace) | `MissionControlShell` (`PageHeader` + `Tabs`), `ProvenanceBadge`, `RiskTierBadge`, `EmergencyConfirmModal` (`ConfirmDialog`), `Avatar` / `CharacterDisplay`, `FilterFacetBar`, `Table`, `AgiTelemetryPanel`, `EvolutionObligationsPanel`, `LocalRagSearchPanel`, `MeshFleetDrawer`, `VpsOnboardingCard`, `CloudAgentPanels` | `crew-01-idle`, `state.empty`, `state.offline`, `ui.alert` |
| `/board/profile` | [`apps/board/src/app/board/profile/page.tsx`](../../../apps/board/src/app/board/profile/page.tsx), [`profile-page.tsx`](../../../apps/board/src/board-pages/profile-page.tsx) | `ProtectedRoute` + `AppShell` | `PageHeader`, `Avatar`, `AchievementBadge`, `Panel`, `Field`, `Input`, `Button`, `ErrorState`, `Skeleton` | `state.not-found`, `state.offline`, `crew-01-idle` |
| `/board/settings` | [`apps/board/src/app/board/settings/page.tsx`](../../../apps/board/src/app/board/settings/page.tsx), [`settings-page.tsx`](../../../apps/board/src/board-pages/settings-page.tsx) | `ProtectedRoute` + `AppShell` | `PageHeader`, `Panel`, `Button` (`variant="outline"` unselected), `Switch`, `NotificationPreferences`, `DesktopDoctorCard`, `ErrorState`, `Skeleton` | `state.offline`, `ui.success` |

### 5.2 `apps/ui-catalog` & `apps/docs` Reference Surfaces
- **`apps/ui-catalog`** ([`catalog.tsx`](../../../apps/ui-catalog/src/catalog.tsx)): Showcases all 48 existing + 8 new Visual Experience/Composed components (`DatePicker`, `Label`, `LogConsole`, `ModePicker`, `NumberInput`, `SmartButtonBox`, `StatusBar`, `TagInput`, `UpdateBanner`, `ConfirmDialog`, `ErrorState`, `Breadcrumbs`, `ComicPanel`, `MangaFrame`, `StickerBadge`, `CharacterDisplay`, `QuestCard`, `AchievementBadge`, `RewardPanel`) while staying within [`apps/ui-catalog/bundle-budget.json`](../../../apps/ui-catalog/bundle-budget.json) (`total JS <= 168,000 B gzip`).
- **`apps/docs`** ([`portal.tsx`](../../../apps/docs/src/portal.tsx)): Imports `Button` from `@moonwitness/ui/components/button`, brand SVG from `@moonwitness/assets`, and embeds built `@moonwitness/ui-catalog` at `/components/`.

---

## 6. Real `@moonwitness/client` API & Error-vs-Empty Wiring

All browser and desktop data flows route through the singleton `client` exported by [`apps/board/src/lib/client.ts`](../../../apps/board/src/lib/client.ts) (`MoonWitnessClient` from [`packages/client/src/client.ts`](../../../packages/client/src/client.ts)):

1. **Dual-Transport Session Contract:**
   - **Web (`apps/board`):** `CookieTokenStorage` + same-origin BFF [`apps/board/src/app/api/session/route.ts`](../../../apps/board/src/app/api/session/route.ts) (`HttpOnly`, `SameSite=Strict`, `mw_board_session` cookie) + [`next.config.ts`](../../../apps/board/next.config.ts) rewrites to `BOARD_API_TARGET`.
   - **Desktop (`apps/desktop`):** `window.__MW_DESKTOP_API_URL__` pointing to Fastify 5 loopback sidecar (`127.0.0.1:4242`) with `storageKey: 'mw-board-session'` and auto-login (`local` / `local-offline-session`).
2. **Typed Client & Repository Methods Wired to UI Surfaces:**
   - **Auth & Identity (`AuthProvider`, `AuthPage`, `SettingsPage`):** `ready()`, `login()`, `register()`, `refresh()`, `logout()`, `getMe()`.
   - **Model Metadata & CRUD (`useViews`, `ListView`, `FormView`, `KanbanView`, `CalendarView`, `GraphView`, `PivotView`):** `getModels()`, plus `ModelRepository` (`getFields()`, `getViews()`, `read()`, `groupCount()`, `create()`, `write()`, `unlink()`, `uploadAttachment()`, `downloadAttachment()`).
   - **Knowledge & Story (`KnowledgePage`, `/knowledge`, `StoryWorkbenchPage`):** `getSourceCitation()`, `getCorpusPassage()`, `searchResearchGraph()`, `getResearchRelationExplanation()`, `getStoryVersion()`, `storeStoryVersion()` (plus `fetch('/api/knowledge/public/publications')` with fail-closed SHA-256 verification on public `/knowledge`).
   - **AI Mission Control (`apps/board/src/components/ai/ai-api.ts`):** `AI_MISSION_CONTROL_ROUTES` hooks backed by `MoonWitnessClient` HTTP requests + non-optimistic `EmergencyConfirmModal`.
3. **Mandatory Error-vs-Empty Contract:**
   - Every React Query consumer (`KanbanView`, `GraphView`, `ProjectsPage`, `CommercialPage`, `CloudIspPage`, `AppShell` omnisearch/companies, `DashboardPage`) MUST check `query.isLoading` -> `<Skeleton />`, then `query.isError` -> `<ErrorState role="alert" onRetry={query.refetch} />`, and ONLY render `<EmptyState />` / `<CharacterReaction mood="empty" />` when `query.isSuccess && records.length === 0`. Falling back to `query.data ?? []` without checking `isError` is prohibited.
   - Mutations (`handleToggleCron`, `WhatsAppStatusPage`, `EditorialStudioPanel` persistence/export) must surface explicit `toast.error` / inline `role="alert"` failures and use shared `ConfirmDialog` rather than `window.confirm()`.
