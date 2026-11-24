# 08 — Consumer Experience Coverage Matrix

**Evidence Basis:** Strictly verified from source inspection (`packages/ui`, `packages/assets`, `packages/types`, `apps/board`, `apps/desktop`, `apps/ui-catalog`) and programmatic checks executed in this audit session.
**Status Definitions:**
- **PASS:** Implemented, verified in code/tests, meets design and accessibility contract.
- **PARTIAL:** Implemented in part or only on a subset of surfaces/states; documented gaps remain.
- **FAIL:** Violates contract or breaks behavior in inspected code.
- **NOT IMPLEMENTED:** Absent from the codebase.
- **NOT APPLICABLE:** Explicitly out of scope for the surface.
- **NOT VERIFIED:** Exists in codebase or external harness, not directly executed/measured in this worker's session.

---

## 1. Design System, Tokens & Typography Coverage

| Capability / Requirement | Status | Evidence & Observed Scope | Gap / Remediation |
| --- | --- | --- | --- |
| Single CSS token source (`--mw-*`) | **PASS** | [`packages/ui/src/styles/tokens.css`](../../../packages/ui/src/styles/tokens.css) has zero element selectors and zero external font URLs; mapped in [`apps/board/src/index.css`](../../../apps/board/src/index.css). | Deduplicate unused `--board-chalk-mask` / `--global-chalk-mask` in `apps/board`. |
| Skin Registry & Pre-hydration Script | **PASS** | [`themeRegistry`](../../../packages/ui/src/themes/index.ts) + `createSkinInitScript()` wired in [`apps/board/src/app/layout.tsx`](../../../apps/board/src/app/layout.tsx) and tested in [`themes.test.mjs`](../../../packages/ui/tests/themes.test.mjs). | — |
| Existing 3 Skins WCAG AA (`>= 4.5:1`) | **PASS** | Programmatically verified all 6 `(skin × mode)` pairs across 17 token pairs (`5.11:1` minimum on dark `magenta-readable`; `>= 5.20:1` across all light/HC pairs). | — |
| Target 1: Funky Grunge Light (`moonwitness-ink` light) | **PARTIAL** | Implemented in `tokens.css` and strong on `/`, `/login`, `/board` masthead. | Operational routes (`CommercialPage`, `CloudIspPage`, AI HQ) remain flat-bordered SaaS panels. |
| Target 2: Funky Grunge Dark (`moonwitness-ink` dark) | **PARTIAL** | Implemented in `.dark` + sidebar scoped `.dark` in [`app-shell.tsx`](../../../apps/board/src/components/layout/app-shell.tsx). | Halftone/chalk layers rely on `data-surface="ink"` explicitly in dark mode. |
| Target 3: Riot / High Contrast (`moonwitness-riot`) | **NOT IMPLEMENTED** | Only accessibility `moonwitness-high-contrast` exists (`BuiltinSkinId` in [`theme.ts`](../../../packages/types/src/theme.ts)). | Implement `moonwitness-riot` per [05-design-system.md](./05-design-system.md#5-specification-moonwitness-riot-skin-semantic-comicmotion-tokens). |
| Target 4: Cartoon / Comic Experience Tokens | **NOT IMPLEMENTED** | Missing `--mw-comic-gutter`, `--mw-comic-bubble-*`, `--mw-comic-sfx-*`, `--mw-motion-comic-*` tokens. | Add semantic comic tokens to `tokens.css` ([05-design-system.md](./05-design-system.md#53-semantic-comic-motion-tokens-cartoon-comic-experience-layer)). |
| Font Hosting (`Anton`, `Space Grotesk`, `JetBrains Mono`, `Road Rage`, `MoonWitness Grunge`) | **PARTIAL** | Hosted in [`packages/assets/fonts.css`](../../../packages/assets/fonts.css). | `--mw-font-display` & `--mw-font-brush` both lead with `'MoonWitness Grunge'`, shadowing `Anton` and `Road Rage`; `JetBrains Mono` missing `700` `@font-face`. |
| Legacy `raw_arts/fonts/saksi-*` & `cinzel-*` | **FAIL** | 9 `.woff2` files exist in [`raw_arts/fonts/`](../../../raw_arts/fonts) unregistered in `fonts.css` and unreferenced in `tokens.css`. | Triage into `@moonwitness/assets` with license provenance or archive. |

---

## 2. Animation, Motion & Audio Coverage

| Module / Behavior | Status | Evidence & Observed Scope | Gap / Remediation |
| --- | --- | --- | --- |
| `useAnimationVisibility` offscreen pause | **PARTIAL** | [`use-animation-visibility.ts`](../../../packages/ui/src/lib/use-animation-visibility.ts) attaches `IntersectionObserver` and emits `.mw-ui-motion-visible` / `.mw-ui-motion-paused`. | Initial `false` state pauses entrance keyframes (`MangaPanel`, `GrungeStamp`, `SpeechBubble`, `InkUnderline`) at `opacity: 0` / hidden before intersection; DOM re-attachment not tracked. |
| `effects.tsx` decorative & loading primitives | **PARTIAL** | 16 primitives in [`effects.tsx`](../../../packages/ui/src/components/effects.tsx) with `aria-hidden` and deterministic PRNG seeds. | `SpeedLines` pulse not gated on `.mw-ui-motion-visible`; `LoadingSpinner` becomes static circle under reduced motion. |
| `ScenePlaybackController` & `SceneCameraController` | **PASS** | [`scene-playback.ts`](../../../packages/ui/src/lib/scene-playback.ts), [`scene-camera.ts`](../../../packages/ui/src/lib/scene-camera.ts), [`scene-timeline.ts`](../../../packages/ui/src/lib/scene-timeline.ts), [`scene-test-harness.ts`](../../../packages/ui/src/lib/scene-test-harness.ts) verified in [`scene-runtime.test.mjs`](../../../packages/ui/tests/scene-runtime.test.mjs). | Tested in unit harness; not yet adopted on production `apps/board` pages (only `apps/ui-catalog/src/SceneLab.tsx`). |
| `LayeredScene` & `SpritePlayer` | **PARTIAL** | [`layered-scene.tsx`](../../../packages/ui/src/components/layered-scene.tsx) & [`sprite-player.tsx`](../../../packages/ui/src/components/sprite-player.tsx) implement static fallbacks and adapter registry (`character-adapter.ts`). | Only rendered in `ui-catalog` (`SceneLab`); SSR renders animated markup unless `reducedMotion` prop is explicitly passed. |
| `SceneParticles` & `ComicSceneTransition` | **FAIL** | [`scene-particles.tsx`](../../../packages/ui/src/components/scene-particles.tsx) & [`scene-transitions.tsx`](../../../packages/ui/src/components/scene-transitions.tsx) emit `.mw-ui-scene-particle` / `.mw-ui-comic-transition`. | **Neither class has CSS rules or `@keyframes` in [`components.css`](../../../packages/ui/src/styles/components.css)**, and neither auto-detects `matchMedia('(prefers-reduced-motion: reduce)')`. |
| `prefers-reduced-motion` CSS & Tokens | **PARTIAL** | `tokens.css` zeroes 7 tokens; `components.css`, `index.css`, and `global.css` clamp animations/transitions. | 6 motion tokens (`draw`, `delay`, `effect`, `pulse`, `progress`, `spin`) remain non-zero in `tokens.css`; Tailwind `animate-pulse` used directly in `dashboard-page.tsx` & `list-view.tsx`. |
| `SoundProvider` / `SoundToggle` / `useSfx` | **PARTIAL** | [`audio.tsx`](../../../packages/ui/src/components/audio.tsx) & [`audio-runtime.ts`](../../../packages/ui/src/lib/audio-runtime.ts) enforce default-muted, gesture-gated, single-slot playback (`audio.test.mjs`). | Wrapped in `apps/board` & `apps/desktop`, but `play()` is called only in `auth-page.tsx:90`. |
| `createSceneSoundscapeController` | **PARTIAL** | [`scene-soundscape.ts`](../../../packages/ui/src/lib/scene-soundscape.ts) tested in `scene-fx-audio.test.mjs` with `ambience-*.wav` in `packages/assets/sounds/`. | Not wired into any production route (`apps/board` or `apps/desktop`). |

---

## 3. Consumer User Journeys Coverage (J1–J18)

| # | Journey | Route(s) | Status | Key Evidence & Gaps |
| --- | --- | --- | --- | --- |
| J1 | Public Landing & Exploration | `/` | **PARTIAL** | Rich hero/editorial/filmstrip composition & mobile sheet; **gap:** no link to `/knowledge` from header or Knowledge card. |
| J2 | Public Knowledge Verification | `/knowledge` | **PASS** | Fail-closed SHA-256 verification, loading skeleton, empty state, and `Retry` error state implemented in [`app/knowledge/page.tsx`](../../../apps/board/src/app/knowledge/page.tsx). |
| J3 | Sign In & Registration | `/login`, `/register` | **PASS** | Accessible labels, password visibility toggle, `aria-busy` spinner, `safeReturnPath` redirect guard, SFX cue on success (`auth-page.tsx`). |
| J4 | Desktop Bootstrap & Mode Picker | `desktop-web/main.tsx` | **PARTIAL** | Auto-login + retry/manual fallback + `ModePicker` (`routes.spec.ts`); **gap:** `DesktopUpdateBannerMount` (`app-shell.tsx:189`) gets stuck in `'checking'` state. |
| J5 | AppShell, Omnisearch & Shortcuts | `/board*` | **PARTIAL** | `Ctrl+K` omnisearch, `Ctrl+/`, tenant switcher, mobile nav `Sheet`; **gap:** omnisearch sub-queries swallow errors silently; `QuickCaptureModal` fixed pill risks crowding bottom content. |
| J6 | Command Center Dashboard | `/board` | **PARTIAL** | Masthead, KPI grid, live pulse, admin worker/outbox & crons; **gap:** `handleToggleCron` lacks user-facing error toast; raw `animate-pulse` instead of `<Skeleton>`. |
| J7 | Model List, Filter, Sort, Export/Import | `/board/m/[model]` | **PASS** | Table/Grid/Pipeline modes, debounced search, filters, `QueryBuilderDialog`, `ImportWizardDialog`, CSV export, bulk archive `ConfirmDialog`, mobile card view (`list-view.tsx`). |
| J8 | Record Create, Edit & Conflict Recovery | `/board/m/[model]/new`, `[id]` | **PASS** | Required/domain validation, `409 ConflictError` diff recovery, `dirty` `beforeunload` + `Esc` confirm guard, `Ctrl+S`, `Skeleton` & `EmptyState` (`form-view.tsx`). |
| J9 | Model Kanban, Calendar, Graph & Pivot | `/board/m/[model]?view=*` | **FAIL** | `PivotView` is complete; **however**, `KanbanView` hides API errors, `GraphView` omits `query.isError` state, and `CalendarView` `grid-cols-7` squeezes unworkably on 390px mobile. |
| J10 | Project Command & WorkContracts | `/board/projects` | **FAIL** | DAG filter, drag/batch stage move, TaskOS sync, WorkContract dispatch; **gap:** no loading skeleton or error state on `projectsQuery`/`boardQuery` (renders `0` metrics on failure). |
| J11 | Knowledge Explorer | `/board/knowledge` | **PARTIAL** | Role/company gate, pinned citations, graph search, relation explainer; **gap:** `"Open pinned passage"` does not scroll to `#source-heading`, and error alerts lack `Retry` buttons. |
| J12 | Story Workbench | `/board/stories/workbench` | **PASS** | 3-pane layout with mobile `<details>` accordions, immutable version history, SHA-256 integrity, draft-preserving error recovery (`story-workbench-page.tsx`). |
| J13 | Creative & Asmaul Husna Studio | `/board/studio` | **PARTIAL** | 4-tab imprint & Asmaul Husna explorer (`editorial-studio-panel.tsx`); **gap:** client-only state with no persistence or export (edits lost on reload). |
| J14 | Commercial Pipeline | `/board/commercial` | **FAIL** | Full Opp -> Order -> Sub lifecycle mutations + toasts; **gap:** `isError` on all 3 read queries falls through to `"No opportunities/orders/subscriptions"` false empty state. |
| J15 | Cloud & ISP Operations | `/board/cloud` | **PARTIAL** | Provider deploy, logs, Terraform HCL, NAS/RADIUS sync; **gap:** `deploymentsQuery`/`nasQuery`/`subscribersQuery` hide read errors behind empty states; health tiles lack retry. |
| J16 | WhatsApp Inbox & Status | `/board/whatsapp`, `/status` | **PARTIAL** | Resilient stale-sync banner + retry, mobile master-detail toggle, idempotent status publishing; **gap:** `whatsapp-status-page.tsx:129` uses native `window.confirm()`. |
| J17 | AI Mission Control | `/board/ai/*` | **PASS** | 7-tab `MissionControlShell`, provenance legend, `Server Policy Denial` alert, `EmergencyConfirmModal`, `scrollLabel` tables (`mission-control-chrome.tsx`). |
| J18 | Profile, Settings & Preferences | `/board/profile`, `/board/settings` | **PARTIAL** | Safe read-before-write gating, Desktop Doctor/RAG/Backups, Appearance & regional controls; **gap:** `sm:grid-cols-3` skin picker needs 4-column update for `moonwitness-riot`. |

---

## 4. Runtime & Verification Status Disclosure

| Check | Status in This Audit | Notes |
| --- | --- | --- |
| Token & Contrast Math (`tokens.css` + `moonwitness-riot`) | **PASS** | Executed via Node luminance script during this session across all 6 existing + 2 proposed `(skin × mode)` matrices. |
| `@moonwitness/ui` unit test suite (`pnpm --filter @moonwitness/ui test`) | **NOT VERIFIED** | Inspected test source files (`themes.test.mjs`, `tokens.test.mjs`, `effects.test.mjs`, `audio.test.mjs`, `scene-runtime.test.mjs`, `scene-fx-audio.test.mjs`) directly; test runner was not executed by this auditor. |
| Live Browser Screenshots & Multi-Viewport Inspection | **NOT APPLICABLE** | Delegated to `@visual-auditor` (`02-visual-audit.md`, `09-visual-benchmark.md`). |
| Component Inventory & Governance Gates | **NOT APPLICABLE** | Delegated to `@arch-auditor` (`01-repository-architecture.md`, `03-component-inventory.md`, `04-component-centralization.md`). |
