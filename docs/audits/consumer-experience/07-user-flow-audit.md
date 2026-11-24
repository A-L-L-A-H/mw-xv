# 07 — Consumer User Flow Audit (18 Journeys)

**Audit Scope:** All routes and user-facing flows across [`apps/board/src/app/`](../../../apps/board/src/app), [`apps/board/src/board-pages/`](../../../apps/board/src/board-pages), [`apps/board/src/components/`](../../../apps/board/src/components), and [`apps/desktop/desktop-web/main.tsx`](../../../apps/desktop/desktop-web/main.tsx).
**Visual Flow Diagram:** [`diagrams/user-flows.mmd`](./diagrams/user-flows.mmd)

---

## 1. Route & Entry Point Inventory

| Surface | Route(s) | Implementation | Auth Gate |
| --- | --- | --- | --- |
| Public Landing | `/` | [`apps/board/src/app/page.tsx`](../../../apps/board/src/app/page.tsx) | Public |
| Public Knowledge | `/knowledge` | [`apps/board/src/app/knowledge/page.tsx`](../../../apps/board/src/app/knowledge/page.tsx) | Public (`PUBLIC_APPROVED` only) |
| Authentication | `/login`, `/register` | [`apps/board/src/board-pages/auth-page.tsx`](../../../apps/board/src/board-pages/auth-page.tsx) | Public (redirects if authed) |
| Command Center | `/board` | [`apps/board/src/board-pages/dashboard-page.tsx`](../../../apps/board/src/board-pages/dashboard-page.tsx) | `ProtectedRoute` + `AppShell` |
| Model List & Views | `/board/m/[model]` (`?view=list\|kanban\|calendar\|graph\|pivot`, `?create=1`) | [`apps/board/src/board-pages/model-page.tsx`](../../../apps/board/src/board-pages/model-page.tsx) | `ProtectedRoute` |
| Model Create & Edit | `/board/m/[model]/new`, `/board/m/[model]/[id]` | [`model-page.tsx`](../../../apps/board/src/board-pages/model-page.tsx) + [`form-view.tsx`](../../../apps/board/src/components/views/form-view.tsx) | `ProtectedRoute` |
| Project Command | `/board/projects` | [`apps/board/src/board-pages/projects-page.tsx`](../../../apps/board/src/board-pages/projects-page.tsx) | `ProtectedRoute` |
| Knowledge Explorer | `/board/knowledge` | [`apps/board/src/board-pages/knowledge-page.tsx`](../../../apps/board/src/board-pages/knowledge-page.tsx) | `ProtectedRoute` + company/role |
| Story Workbench | `/board/stories/workbench` | [`apps/board/src/board-pages/story-workbench-page.tsx`](../../../apps/board/src/board-pages/story-workbench-page.tsx) | `ProtectedRoute` + `user\|superadmin` |
| Creative Studio | `/board/studio` | [`apps/board/src/app/board/studio/page.tsx`](../../../apps/board/src/app/board/studio/page.tsx) | `ProtectedRoute` |
| WhatsApp Inbox & Status | `/board/whatsapp`, `/board/whatsapp/status` | [`whatsapp-page.tsx`](../../../apps/board/src/board-pages/whatsapp-page.tsx), [`whatsapp-status-page.tsx`](../../../apps/board/src/board-pages/whatsapp-status-page.tsx) | `ProtectedRoute` |
| Commercial Pipeline | `/board/commercial` | [`apps/board/src/board-pages/commercial-page.tsx`](../../../apps/board/src/board-pages/commercial-page.tsx) | `ProtectedRoute` |
| Cloud & ISP Ops | `/board/cloud` | [`apps/board/src/board-pages/cloud-isp-page.tsx`](../../../apps/board/src/board-pages/cloud-isp-page.tsx) | `ProtectedRoute` (hidden in Desktop Workspace mode) |
| AI Mission Control | `/board/ai`, `/board/ai/{hq,mission-control,operations,continuity,governance,providers,eval-lab}` | [`apps/board/src/app/board/ai/*/page.tsx`](../../../apps/board/src/app/board/ai/hq/page.tsx) | `ProtectedRoute` (hidden in Desktop Workspace mode) |
| Profile & Settings | `/board/profile`, `/board/settings` | [`profile-page.tsx`](../../../apps/board/src/board-pages/profile-page.tsx), [`settings-page.tsx`](../../../apps/board/src/board-pages/settings-page.tsx) | `ProtectedRoute` |
| Desktop Webview Shell | All `/board*` + `/login`, `/register` | [`apps/desktop/desktop-web/main.tsx`](../../../apps/desktop/desktop-web/main.tsx) | Auto-login `'local'` session; `/knowledge` routes to `KnowledgePage`; `/` routes to `DashboardPage` |

---

## 2. Detailed Audit of All 18 Consumer User Journeys

### Journey 1 — Public Landing & Exploration (`/`)
- **Entry & Intent:** Unauthenticated visitor lands on `/`, scans brand manifesto, editorial cards (`01 PEOPLE & RECORDS`, `02 KNOWLEDGE`, `03 STORY WORKBENCH`), orbit connection band, and 4-step process filmstrip.
- **Actions & Navigation:** Header nav (`#home`, `#people`, `#knowledge`, `#stories`, `#about`), `SoundToggle`, mobile `Sheet` drawer (`<=600px`), primary CTA `"Explore MoonWitness"` (`/register`), secondary `"Sign in to your workspace"` (`/login`), card links (`01/02 -> /register`, `03 -> /login`).
- **Feedback / Loading / Empty / Error / Success:** Static SSR HTML with zero API fetch; `HorizontalFilmstrip` supports keyboard `ArrowLeft/ArrowRight/Home/End`.
- **Exit & Recovery / Dead Ends / Mobile:**
  - **Dead End / Friction:** Card `02 KNOWLEDGE` links to `/register` instead of `/knowledge` (public knowledge projections are not linked from the homepage hero or cards!). Header does not link `/knowledge` either.
  - **Mobile:** Good responsive stacking (`@media (max-width: 900px)` and `600px`); mobile sheet replaces desktop sound toggle and nav links.

### Journey 2 — Public Knowledge Verification (`/knowledge`)
- **Entry & Intent:** External user visits `/knowledge` directly to inspect `PUBLIC_APPROVED` digest-verified projections.
- **Actions & Navigation:** `Refresh projections` button, `Workspace Home` link (`/`).
- **States:**
  - *Loading:* `role="status"` live text + `<Panel title="Checking public projections">` with 3 `<Skeleton>` bars.
  - *Empty:* `<EmptyState title="No approved public projections">` explaining fail-closed filtering.
  - *Error / Fail-Closed:* Any non-2xx or malformed payload (`isValidApprovedPublication` SHA-256 check) renders `<EmptyState title="Public projections unavailable">` + `Retry` button.
  - *Success:* Renders list of `Panel` cards with `PUBLIC_APPROVED` badge, digest prefix, and citation list.
- **Dead Ends / Mobile:** No back-to-login CTA; clean single-column layout (`max-w-5xl`).

### Journey 3 — Sign In & Registration (`/login`, `/register`)
- **Entry & Intent:** User authenticates (`Enter the Shadow`) or registers (`Join the Crew`), optionally carrying `?returnTo=/board/...`.
- **Actions & Navigation:** Form fields (`name`, `login`, `email`, `password` with show/hide toggle), submit button, `auth-switch` link preserving `returnTo`, `Follow the Signal` home link.
- **States:**
  - *Loading:* Disables submit, sets `aria-busy="true"`, shows `<LoadingSpinner />` + `"Entering the shadow…"` / `"Creating account…"`.
  - *Error:* `role="alert"` `.auth-shadow-error` banner with API message or network fallback.
  - *Success:* Plays `useSfx().play('success')`, validates `safeReturnPath(returnTo)` (blocks open-redirect `//` or non-`/board` paths), calls `router.replace(from)`.
- **Dead Ends / Mobile:** No `"Forgot password?"` flow (correctly omitted per `README.md:11`). Mobile (`<=899px`) crops art cleanly above the form card (`margin-top: -1.15rem`).

### Journey 4 — Desktop Bootstrap & Mode Selection (`apps/desktop/desktop-web/main.tsx`)
- **Entry & Intent:** Desktop Tauri user launches app; `DesktopBoardApp` auto-authenticates as `local` against sidecar API, then prompts `ModePicker` (`Workspace` vs `DX / Developer`) on first run.
- **States:**
  - *Loading:* `<DesktopChrome />` + `<DesktopBoot label="Starting local workspace" />` over `moon-city-orbit.webp`.
  - *Error:* `<Panel title="Local workspace unavailable">` with `Retry` (re-attempts local login) and `Sign in manually` (`/login`).
  - *Success:* Mounts `AppShell`, `DesktopUpdateBannerMount`, `DesktopLogDrawer`, `QuickCaptureModal`, and `ModePicker` if `!desktopModeChosen`.
- **Dead Ends / Mobile:**
  - **Gap:** `DesktopUpdateBannerMount` (`app-shell.tsx:189-204`) sets `status` to `'checking'` on click, but has no actual Tauri updater IPC wired—clicking Check stays stuck in `'checking'` unless dismissed!

### Journey 5 — Authenticated Shell Navigation, Omnisearch & Shortcuts (`AppShell`)
- **Entry & Intent:** Authenticated user navigates modules, switches multi-tenant company scope, searches records (`Ctrl+K`), opens shortcuts (`Ctrl+/`), toggles theme/sound, or opens mobile drawer.
- **States:**
  - *Loading:* `ModelNavigation` renders 4 `<Skeleton>` bars while `useModels()` loads.
  - *Empty:* `CommandEmpty` shows `"No matching models or records found."` when `paletteQuery.trim().length >= 2`.
  - *Error:* `companiesData` or omnisearch sub-queries silently catch (`catch(() => ({ records: [] }))`), hiding failures instead of surfacing a scoped warning.
  - *Success:* Selecting a `CommandItem` closes dialog, clears query, and routes; focus returns to `#open-command-palette` via `requestAnimationFrame`.
- **Dead Ends / Mobile:** Mobile (`< lg`) collapses sidebar into `<Sheet side="left">`, hides `#shortcuts-btn` (`hidden md:inline-flex`), and moves Theme Toggle into User Dropdown (`sm:hidden`). `QuickCaptureModal` (`fixed bottom-4 left-4 z-30`) can overlap bottom table pagination on mobile despite `pb-24` on `<main>`.

### Journey 6 — Command Center Dashboard (`/board`)
- **Entry & Intent:** User lands on `/board`, reviews KPI grid, live audit/activity pulse feed, admin worker/outbox telemetry, and available module cards.
- **Actions:** Quick-create links (`New Partner`, `New Company`, `Schedule Task`), admin subview tabs (`Overview & Telemetry` / `Cron Scheduler & Queue`), `Triage Failures` modal, `Refresh Worker`, cron enable/disable toggle.
- **States:**
  - *Loading:* `animate-pulse` placeholder divs (inconsistent with shared `<Skeleton>`).
  - *Empty:* Text-only empty notices (`"No recent audit records available."`, `"No planned activities at this time."`, `"No accessible models found"`).
  - *Error:* `jobsHealthState === 'error' | 'unavailable'` shows `role="alert"` text; `cronsState === 'error'` includes `Retry` button; `handleToggleCron` logs to `console.error` without a user-facing `toast.error`!
- **Dead Ends / Mobile:** Metrics grid collapses `4 -> 2 -> 1` columns cleanly; `Triage Failures` modal supports job/outbox retry and cancel.

### Journey 7 — Model Discovery, Search, Filter, Sort, Export & Bulk Actions (`/board/m/[model]`)
- **Entry & Intent:** User opens any ORM model list (e.g., `/board/m/base.partner`), switches between `Table`, `Grid`, `Pipeline`, or top-level `kanban`/`calendar`/`graph`/`pivot` views, filters, sorts, exports CSV, imports CSV, or bulk-archives/tags.
- **States:**
  - *Loading:* Mobile card skeletons (`animate-pulse`), desktop `<Skeleton>` table cells, `isFetching` refresh indicator.
  - *Empty:* Inline `<Doodle kind="sparkle">` + `"No records found"` + `"Create Record"` CTA (when `views.permissions.create`).
  - *Error:* Top `role="alert"` destructive banner with `Retry` button.
  - *Success:* Debounced search (`250ms`), sticker filters, popover custom filter, `QueryBuilderDialog`, `ImportWizardDialog`, CSV download, `ConfirmDialog` for bulk archive.
- **Dead Ends / Mobile:** Mobile (`< sm`) swaps wide table (`min-w-[1200px]`) for stacked `ink-panel` record cards with checkbox and `"Open →"` button. `Table` inside `sm:block` uses `scrollLabel` for keyboard panning. **Gap:** View mode (`table | grid | pipeline`) inside `ListView` is local component state (lost on refresh), unlike top-level `?view=` URL param.

### Journey 8 — Record Create, Edit, Conflict Resolution & Archive (`/board/m/[model]/new`, `/board/m/[model]/[id]`)
- **Entry & Intent:** User creates a new record (`new` or `?create=1`, including `?relation_parent_model=...`) or edits an existing record (`Ctrl+S` to save, `Esc` to go back).
- **States:**
  - *Loading:* `<Skeleton>` form block (`role="status"`).
  - *Empty / Not Found:* `<EmptyState title="Record not found">` with `"Back to list"` button.
  - *Error / Conflict:* Client-side required-field validation inline error; `409 ConflictError` fetches server record and surfaces conflict diff dialog; `isError` renders `<EmptyState role="alert">` with `Retry`.
  - *Success:* `toast.success('Record saved successfully.')`, resets `dirty` flag (releasing `beforeunload` guard), redirects to `/board/m/${model}/${newId}` (or back to `relationParent`).
- **Recovery:** Unsaved `dirty` state triggers `ConfirmDialog` before navigating back on `Back` click or `Esc`.

### Journey 9 — Model Kanban, Calendar, Graph & Pivot Views (`/board/m/[model]?view=...`)
- **Entry & Intent:** User switches `?view=` tab to `kanban`, `calendar`, `graph`, or `pivot`.
- **States & Gaps:**
  - `KanbanView`: Supports drag-and-drop, keyboard `ArrowLeft/ArrowRight`, and `<SelectField>` fallback (`Move stage`). **Gap:** Missing loading skeleton and error alert banner (silently renders empty columns on error!).
  - `CalendarView`: Month/Week switcher, Previous/Next navigation, `<LoadingSpinner />`, `role="alert"` error box. **Gap:** `grid-cols-7` does not stack or scroll horizontally on 390px mobile—7 columns squeeze to ~45px each, clipping record titles!
  - `GraphView`: Uses shared `BarChart` / `LineChart` with `loading` prop and accessible table/legend. **Gap:** Does not pass `query.isError` to chart error state (`BarChart`/`LineChart` shows empty state on API failure).
  - `PivotView`: Includes loading `<Skeleton>`, error `<EmptyState role="alert">` + `Retry`, empty `<EmptyState>`, scrollable `role="region" tabIndex={0}` table, and CSV export (`<= 5000` cells).

### Journey 10 — Project Command, DAG Radar & WorkContract Dispatch (`/board/projects`)
- **Entry & Intent:** User manages projects/stages/tasks, filters DAG (`All / Ready / Blocked`), drags or batch-moves cards, syncs TaskOS snapshots, dispatches 1-click AI WorkContracts, or binds Desktop git worktrees.
- **Actions & Shortcuts:** `/` or `Ctrl+K` focuses search, `n` focuses quick-create, `f` cycles DAG filter, `Ctrl/Cmd+Click` multi-selects cards.
- **States:**
  - *Loading / Empty / Error:* Stage columns show `"Empty stage"` text. **Gap:** `projectsQuery` and `boardQuery` have **no top-level loading skeleton or error retry banner** in `ProjectsPage`—if `/api/projects/:id/board` fails, the user sees `0` metrics and zero stage columns (false zero state!).
  - *Success:* Toast notifications for stage move, batch move, WorkContract link, and Desktop FLOW cockpit priming.
- **Mobile:** `lg:grid-cols-4` stacks stage columns vertically on mobile/tablet; card action buttons wrap cleanly.

### Journey 11 — Knowledge Explorer (`/board/knowledge`)
- **Entry & Intent:** Authenticated user with company context reads pinned `Qur’an · Tanzil` / `World English Bible · WEBP` passages, searches the research graph, and inspects relation evidence/counterevidence.
- **States:**
  - *Gate:* Non-company or unauthorized roles see `Knowledge explorer unavailable` `role="alert"` panel.
  - *Loading / Empty / Error:* `<Skeleton>` per section; `role="alert"` messages on citation/passage/search/relation errors (no retry button, user re-submits or clicks source button); `role="status"` count + empty message on 0 graph matches.
- **Dead Ends / Mobile:** Clicking `"Open pinned passage"` updates `sourceId`/`requestedLocator` above, **but does not scroll up to `#source-heading`**, so mobile users may think the button did nothing.

### Journey 12 — Story Workbench (`/board/stories/workbench`)
- **Entry & Intent:** `user` or `superadmin` drafts/reorders pages (`1..100`) of `mw:story:editorial-sample`, previews composition, saves immutable SHA-256 revisions, and inspects historical versions.
- **States:**
  - *Gate:* Other roles see plain text `"A tenant user or superadmin role is required."`
  - *Loading / Empty / Error:* Inline `"Loading latest revision…"`, `404 NotFoundError` handled gracefully (`"No saved sample is available..."` while keeping editor enabled), non-404 errors disable `Save` (`canSave = false`) and show `Retry loading story` while preserving draft text!
  - *Success:* Saves immutable version, updates `notice` (`role="status"`) with digest prefix, refetches current version.
- **Mobile:** 3-column grid collapses at `80rem` (`2 cols`) and `48rem` (`1 col`), wrapping `Page navigator` and `Revision inspector` in `<details open class="story-workbench-mobile-collapse">` accordions.

### Journey 13 — Creative & Asmaul Husna Studio (`/board/studio`)
- **Entry & Intent:** User switches across 4 tabs: `GOD PROMISE & ROCKSOUL Editorial`, `Asmaul Husna Concept Explorer`, `Asmaul Husna Knowledge Graph`, and `Extension Hub Marketplace`.
- **States & Gaps:**
  - Purely client-side interactive state (`imprint`, `title`, `brief`, readiness checklist, cluster/search filter).
  - **Gap:** `EditorialStudioPanel` has **no persistence or save/export action**—refreshing `/board/studio` discards title, brief, and checklist progress, and there is no loading/error state because no backend API is wired.

### Journey 14 — Commercial Pipeline (`/board/commercial`)
- **Entry & Intent:** Operator converts CRM Opportunities -> Sale Orders -> Confirms Orders -> Binds Subscriptions -> Activates/Suspends billing.
- **States & Gaps:**
  - *Loading / Empty:* `<Skeleton>` in each panel; plain mono text when empty.
  - *Error:* **Gap:** `opportunitiesQuery`, `ordersQuery`, and `subscriptionsQuery` have **no `isError` UI**—query failures fall back to `?? []` and display `"No opportunities recorded"` (false empty state!). Mutations show `toast.error` and disable active row via `actingId`.

### Journey 15 — Cloud & ISP Operations (`/board/cloud`)
- **Entry & Intent:** Operator monitors Docker Agent & ISP RADIUS health, deploys `cloud.app` containers, inspects deployment logs, exports Terraform HCL, syncs/rotates NAS secrets, manages subscribers, and runs metering.
- **States & Gaps:**
  - *Loading / Error:* `appsQuery` handles loading/error/empty; **however**, `cloudHealthQuery` and `ispHealthQuery` display `'error'` inside `MetricTile` without an error banner or retry action, and `deploymentsQuery`/`nasQuery`/`subscribersQuery` show empty text on failure if `isError` is true.
  - *Success:* Toast feedback + inline `<pre>` previews for deployment logs and Terraform HCL.

### Journey 16 — WhatsApp Inbox & Status Publishing (`/board/whatsapp`, `/board/whatsapp/status`)
- **Entry & Intent:** Operator pairs WhatsApp account (QR/status), filters/searches inbox conversations, replies/forwards/reacts/edits/revokes messages, or publishes text/image/video WhatsApp Status updates (`<=700` chars, `<=10 MiB`).
- **States:**
  - *Error / Recovery:* `whatsapp-page.tsx:60-92` shows prominent `role="alert"` banner preserving stale cached data timestamp (`lastInboxSyncLabel`) with `Retry` button. `whatsapp-status-page.tsx` validates length, MIME type, and size client-side, asks `window.confirm(...)`, sends `Idempotency-Key`, and polls status (`queued -> sending -> sent | failed | unknown`).
  - *Mobile:* Splits master-detail via `mobileConversationOpen` toggle (`Back to list` button in `ConversationHeader`).
  - **Friction:** `whatsapp-status-page.tsx:129` uses native `window.confirm(...)` instead of shared `<ConfirmDialog>`.

### Journey 17 — AI Mission Control (`/board/ai/hq`, `mission-control`, `operations`, `continuity`, `governance`, `providers`, `eval-lab`)
- **Entry & Intent:** Operator inspects governed service-principal agents, work contracts, durable runs, continuity obligations, risk grants (`R0..R4`), provider routing, and eval lab metrics across the 7-tab `MissionControlShell`.
- **States:**
  - *Error:* `MissionControlShell` renders structured `role="alert"` (`Server Policy Denial / Action Failed`) and `EmergencyConfirmModal` enforces non-optimistic confirmation (`Awaiting Server…`).
  - *Loading / Empty:* `<Skeleton>` + explicit empty table row messaging.
  - *Mobile:* `MissionControlShell` wraps section nav tabs (`flex-wrap`), `Table` uses `scrollLabel` horizontal scroll region.

### Journey 18 — Profile, Settings & Preferences (`/board/profile`, `/board/settings`)
- **Entry & Intent:** User views/edits linked `base.partner` profile (`/board/profile`), or configures Desktop mode, Local AI/Backups, Appearance (`theme`, `skin`, `density`), Notifications, Language/Timezone, Password, and Admin Config Parameters / Feature Flags (`/board/settings`).
- **States:**
  - *Loading / Empty / Error:* Both pages render `<Skeleton>` and `<EmptyState role="alert">` with `Retry` buttons; `SettingsPage` blocks regional/password writes (`disabled={!regionalReadSucceeded}`) when reads fail so partial state cannot corrupt preferences.
  - *Success:* `toast.success(...)` + inline `"Saved"` button feedback; password change logs out (`await logout()`) and redirects to `/login`.
  - **Gap:** Appearance grid (`settings-page.tsx:854`) uses `sm:grid-cols-3` tailored for 3 skins; adding `moonwitness-riot` requires updating to `sm:grid-cols-2 lg:grid-cols-4`.

---

## 3. Systemic Flow Findings Summary

| Defect Category | Affected Journeys | Root Cause & Location |
| --- | --- | --- |
| **False Empty/Zero on API Error** | J9 (`GraphView`), J10 (`ProjectsPage`), J14 (`CommercialPage`), J15 (`CloudIspPage`) | Queries read `query.data ?? []` without branching on `query.isError`, violating MoonWitness's error-vs-empty contract. |
| **Missing Scroll-to-Target Feedback** | J11 (`KnowledgePage`) | Clicking `"Open pinned passage"` updates state at top of page without scrolling `#source-heading` into view. |
| **Disconnected Public Discovery** | J1 (`/`), J2 (`/knowledge`) | `/` has zero links to `/knowledge`, and `/knowledge` has no link to `/login` or `/register`. |
| **Stuck Update Check / Unsaved State** | J4 (`DesktopUpdateBannerMount`), J13 (`EditorialStudioPanel`), J7 (`ListView` mode) | `DesktopUpdateBannerMount` sets `'checking'` with no IPC completion; `EditorialStudioPanel` has no save persistence; `ListView` sub-mode isn't URL-synced. |
| **Mobile Layout Squeeze / Native Dialog** | J9 (`CalendarView`), J16 (`WhatsAppStatusPage`), J5 (`QuickCaptureModal`) | `CalendarView` uses unscrollable 7-col grid on mobile; `WhatsAppStatusPage` uses `window.confirm()`; `QuickCaptureModal` sits `fixed bottom-4 left-4` over bottom content. |
