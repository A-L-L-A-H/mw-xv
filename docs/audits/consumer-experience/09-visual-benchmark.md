# MoonWitness Visual Benchmark & Experience Roadmap

> **Purpose**: Benchmark the current consumer surfaces audited in [02-visual-audit.md](./02-visual-audit.md) against both internal reference screens (`/` Home, `/login`, UI Catalog) and external art-direction / product benchmarks, establishing measurable quality gates for the MoonWitness consumer overhaul.

---

## 1. Benchmark Scorecard (Current Baseline vs. Target)

Ratings reflect direct live Chromium inspection across `1440x900`, `1280x800`, `768x1024`, and `390x844` (see [02-visual-audit.md](./02-visual-audit.md) and [08-coverage-matrix.md](./08-coverage-matrix.md)).

| Experience Dimension | Home & Auth (`/`, `/login`) | Board Operational Views (`/board/**`) | UI Catalog (`ui-catalog`) | Target Benchmark (vNext) | Primary Reference / Standard |
| --- | --- | --- | --- | --- | --- |
| **Art Direction & Comic Identity** | **4.5 / 5** — Rich Moon City art, brush display, paper notes, halftone | **2.2 / 5** — Masthead is strong, but subpages (`/ai/hq`, `/studio`, `/settings`) flatten into generic SaaS forms | **3.5 / 5** — Strong foundations & SceneLab, weak FXLab CSS | **4.8 / 5** — Unified comic/zine grammar from landing page through operational drill-downs | *Persona 5* / *Zenless Zone Zero* UI framing + [`packages/ui/README.md`](../../../packages/ui/README.md) |
| **Frame & Border Craft** | **2.5 / 5** — Stretched `--mw-chalk-mask` overlaps card ribbons & links | **1.5 / 5** — Stretched chalk mask slices headers, tables, dialogs & mobile cards | **2.5 / 5** — Overview & specimen panels suffer identical mask clipping | **4.8 / 5** — 9-slice / edge-safe grunge frames with zero text occlusion at any aspect ratio | Crisp ink edges + `--mw-torn-safe-inset` |
| **Character & Scene Presence** | **4.0 / 5** — Illustrated hero/cards, no animated sprite plane yet | **0.5 / 5** — Zero `CharacterPreview`, `LayeredScene`, or `SpeechBubble` in product views | **4.0 / 5** — `crew-01` & 9-plane Moon City live in SceneLab | **4.5 / 5** — Contextual `CharacterDisplay` & `SpeechBubble` in onboarding, empty states & AI HQ | *Duolingo* / *Jet Set Radio* reactive companion cues |
| **Empty, Loading & Error States** | **3.0 / 5** — Inline auth alert & `LoadingSpinner` work; `/knowledge` unreachable | **1.8 / 5** — Plain text / 32px doodle; persistent skeleton shimmer on Settings/Profile | **2.0 / 5** — Blank FXLab particles/transitions; AssetBrowser filter typos | **4.8 / 5** — Illustrated `EmptyState` with character reaction, clear recovery CTA, zero stale skeletons | *Linear* / *Notion* crisp state feedback + MoonWitness character art |
| **Progression & Sticker Grammar** | **2.5 / 5** — Numbered section ribbons (`01`–`04`) | **1.0 / 5** — Single static `+1 EVERY DAY` sidebar note; no badges/quests/rewards | **2.5 / 5** — `ZineSticker` & `GrungeStamp` prototypes only | **4.5 / 5** — `StickerBadge`, `QuestCard`, `AchievementBadge`, `RewardPanel` wired to real milestones | *Duolingo* streak/badge loop adapted to indie zine stickers |
| **Skinning, Dark Mode & WCAG AA** | **4.5 / 5** — Intentional dark editorial palette | **2.2 / 5** — Dark mode Settings yellow cards fail contrast (`~1.3:1`); High Contrast has clean focus | **4.0 / 5** — Light/dark toggle works; compact & riot skins not showcased | **5.0 / 5** — 100% WCAG AA (`>= 4.5:1`) across all 4 skins (`ink`, `compact`, `high-contrast`, `riot`) × light/dark | [`05-design-system.md`](./05-design-system.md) WCAG matrix |
| **Responsive Ergonomics** | **2.8 / 5** — `390x844` hero `h1` clips right edge (`MOONWITNES`) | **2.5 / 5** — `768x1024` topbar search crushed to `"CTRL"`; mobile sheet `X` overlaps seam | **3.0 / 5** — Mobile `17.5rem` fixed header height risk | **4.8 / 5** — Zero clipped headings, >=44px touch targets, clean tablet toolbar priority | WCAG 2.2 Target Size & Reflow |

---

## 2. Internal Surface-to-Surface Parity Gaps

Comparing MoonWitness's **strongest live surfaces** against its **weakest live surfaces** reveals concrete, reusable patterns already in the repository that simply are not propagated consistently:

| Pattern | Best Current Example | Underperforming Counterparts | Parity Fix |
| --- | --- | --- | --- |
| **Page Masthead & Section Framing** | `/board` Command Center ([screenshot](./screenshots/audit-board-dashboard-desktop.png)) & `/board/stories/workbench` ([screenshot](./screenshots/audit-stories-workbench-desktop.png)) | `/board/studio` ([screenshot](./screenshots/audit-studio-desktop.png)), `/board/ai/hq` ([screenshot](./screenshots/audit-ai-hq-desktop.png)), `/board/profile` ([screenshot](./screenshots/audit-profile-desktop.png)) | Adopt `PageHeader treatment="brush"` + contextual artwork/motif strip on Studio, AI HQ, and Profile headers. |
| **Interactive Surface Tactility** | `/` Home editorial cards (`mw-ui-interactive-surface`, [screenshot](./screenshots/audit-home-desktop.png)) | `/board/ai/hq` table rows & native `<select>` filters, `/board/studio` checklist | Replace full-width native `<select>` bars with `FilterFacetBar` / tactile sticker chips (`StickerBadge`) and interactive cards. |
| **Character & Parallax Runtime** | UI Catalog `#scene-environment-inspector` ([screenshot](./screenshots/audit-catalog-scenelab-desktop.png)) | All `apps/board` & `apps/desktop` screens (0 usages) | Embed lightweight `CharacterDisplay` (`crew-01`) inside `EmptyState`, `/board` welcome strip, and onboarding checklists. |
| **Clean Border & Elevation** | `/board` KPI `MetricTile` cards ([screenshot](./screenshots/audit-board-dashboard-desktop.png)) — crisp 2px ink borders + hard offset shadow, no overlapping mask | `.ink-panel`, `.mw-ui-panel`, `.mw-ui-dialog-content`, `.mw-ui-table` ([screenshot](./screenshots/audit-partner-list-mobile.png)) | Remove stretched `--mw-chalk-mask` overlay from content panels; adopt `MetricTile`-style crisp border + optional corner stamp outside padding. |

---

## 3. Target Experience Benchmark (4 Art Directions)

Cross-referencing [`05-design-system.md`](./05-design-system.md) and [`03-component-inventory.md`](./03-component-inventory.md), each skin should deliver a distinct, contrast-verified consumer personality:

1. **Funky Grunge Light (`moonwitness-ink`, light)** — Warm newsprint (`#f3efe4`), tactile halftone (`7px`), hard ink shadows, magenta/yellow sticker callouts, zero text-obscuring frame masks.
2. **Funky Grunge Dark (`moonwitness-ink`, dark)** — Ink-black canvas (`#0e0e10`), dark raised panels (`#17171a`), cream paper scraps for stickers/badges, and fixed dark-on-yellow button contrast (`#0d0d0d` on `#ffe031` everywhere—never `--mw-ink-soft` on yellow).
3. **Riot / High Contrast (`moonwitness-riot` + `moonwitness-high-contrast`)** — Maximum edge energy (`moonwitness-riot`) for expressive narrative surfaces and strict WCAG AAA/AA accessibility (`moonwitness-high-contrast`) with 3px reinforced focus rings.
4. **Cartoon / Comic Experience (New Visual Components)** — Introduce `ComicPanel`, `MangaFrame`, `SpeechBubble` (with SVG tail + speaker badge), `StickerBadge`, `CharacterDisplay`/`CharacterReaction`, `QuestCard`, `AchievementBadge`, and `RewardPanel` in `@moonwitness/ui` so operational workflows feel alive without sacrificing tabular clarity.

---

## 4. Prioritized Remediation Roadmap

### Phase P0 — Visual & Functional Blockers (Immediate)

1. **Eliminate `--mw-chalk-mask` Text Occlusion** ([`tokens.css#L243`](../../../packages/ui/src/styles/tokens.css#L243), [`components.css#L1049-L1075`](../../../packages/ui/src/styles/components.css#L1049-L1075), [`index.css#L157-L173`](../../../apps/board/src/index.css#L157-L173), [`global.css#L414-L431`](../../../apps/board/src/app/global.css#L414-L431)): Replace stretched `mask-size: 100% 100%` `::before` overlays with 9-slice `border-image` or non-overlapping outer border treatments.
2. **Fix Settings Dark-Mode Contrast (`#ffe031` + `text-ink-soft`)** ([`settings-page.tsx#L830-L920`](../../../apps/board/src/board-pages/settings-page.tsx#L830-L920)): Render unselected theme/skin/density cards with `variant="outline"` (paper/surface background + `--mw-foreground`) and selected cards with `bg-primary text-[var(--mw-on-accent)]` so descriptions never inherit dark-mode light `--mw-ink-soft` over yellow.
3. **Fix Settings/Profile Remount & Skeleton Stability** ([`settings-page.tsx#L175-L180`](../../../apps/board/src/board-pages/settings-page.tsx#L175-L180)): Stop keying `SettingsPageContent` on volatile `getQueryScope()` identity during active renders; preserve existing controls while refetching.
4. **Restore Public `/knowledge` Route** ([`next.config.ts#L54`](../../../apps/board/next.config.ts#L54)): Remove the permanent redirect `/knowledge -> /board/knowledge` so unauthenticated visitors can access [`app/knowledge/page.tsx`](../../../apps/board/src/app/knowledge/page.tsx).

### Phase P1 — Responsive & Component Polish

5. **Fix Mobile Home Hero `h1` Clipping** ([`global.css#L248-L256`](../../../apps/board/src/app/global.css#L248-L256)): Remove `white-space: nowrap` below `480px` or scale `clamp(2.6rem, 11.5vw, 7.8rem)` so `MOONWITNESS` fits cleanly inside `390px` with margin.
6. **Fix Tablet (`768px`) Topbar Search & Mobile Sheet Close Button** ([`app-shell.tsx#L462-L538`](../../../apps/board/src/components/layout/app-shell.tsx#L462-L538)): Collapse secondary topbar utilities cleanly on `md` so `#open-command-palette` retains at least `180px` width + search icon, and add `z-10` / right inset clearance for the mobile sheet close `X` away from `.board-sidebar::after`.
7. **Complete FXLab CSS & Fix UI Catalog Typos** ([`components.css`](../../../packages/ui/src/styles/components.css), [`AssetBrowser.tsx#L40-L45`](../../../apps/ui-catalog/src/AssetBrowser.tsx#L40-L45), [`styles.css#L1418`](../../../apps/ui-catalog/src/styles.css#L1418)): Implement `.mw-ui-scene-particle` and `.mw-ui-comic-transition` styles; fix `"All categories"` / `"All statuses"`; replace fixed `height: 17.5rem` with `min-height`.
8. **Burn Down All 23 Frozen CSS Overrides** ([`ui-governance-policy.json#L174-L316`](../../../scripts/ui-governance-policy.json#L174-L316)): Promote `SectionRibbon`, `MetricTile`, `Panel`, `PageHeader`, and `SelectTrigger` sizing/density variants into `@moonwitness/ui` and remove the `reviewedDebt` entries.

### Phase P2 — Consumer Visual Experience Upgrade

9. **Ship Missing Comic, Character & Progression Primitives** (aligned with [03-component-inventory.md](./03-component-inventory.md) and [04-component-centralization.md](./04-component-centralization.md)): Build `ComicPanel`, `MangaFrame`, `StickerBadge`, `SpeechBubble`, `CharacterDisplay`/`CharacterReaction`, `QuestCard`, `AchievementBadge`, and `RewardPanel`.
10. **Upgrade Operational Pages & Empty/Error States**: Wire `CharacterReaction` into `EmptyState` across `ListView`, `KanbanView`, `FormView`, `ProfilePage`, `SettingsPage`, and `EditorialStudioPanel` (also normalizing Indonesian strings in `editorial-studio-panel.tsx`), and bring comic/character avatars + quest progression into `/board`, `/board/studio`, and `/board/ai/hq`.

---

## 5. Verification Gates for Remediation

Every visual fix should pass these measurable gates before release:
- **Zero Text-Border Overlap**: Automated bounding-box intersection check confirming frame/border pseudo-elements never overlap text nodes inside `.mw-ui-panel`, `.mw-ui-dialog-content`, `.mw-ui-table`, or `.ink-panel` across `1440x900`, `1280x800`, `768x1024`, and `390x844`.
- **Zero Viewport/Heading Clipping**: `document.documentElement.scrollWidth === clientWidth` and `h1.getBoundingClientRect().right <= clientWidth` at `390x844`.
- **WCAG AA Contrast (`>= 4.5:1`)**: Axe + computed token luminance verification on every skin (`ink`, `compact`, `high-contrast`, `riot`) × mode (`light`, `dark`), explicitly covering Settings cards and disabled/selected states.
- **Governance Cleanliness**: `pnpm board:ui:check` and `pnpm ui:design:check` pass with `0` `reviewedDebt` overrides remaining.
