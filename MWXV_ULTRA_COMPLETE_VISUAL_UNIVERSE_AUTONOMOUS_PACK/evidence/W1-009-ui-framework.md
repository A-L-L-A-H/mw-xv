# MoonWitness XV — Core UI Framework & Shell Architecture

|                  |               |                      |                      |
| ---------------- | ------------- | -------------------- | -------------------- |
| **Task:** W1-009 | **Phase:** W1 | **Status:** Complete | **Date:** 2026-11-23 |

---

## Executive Summary

This document establishes the canonical UI framework and shell architecture for MoonWitness XV, implementing the visual grammar defined in W1-002 (Experience-tier Grammar) and the Visual Universe Bible approved in W1-008. It defines the structural foundation that all experience tiers (Product Chrome, Editorial, Cinematic, Ambient) build upon.

**Scope:** Layout system, viewport handling, responsive breakpoints, shell architecture patterns, component pattern inventory, and integration with the existing design token system.

---

## 1. Layout System

### 1.1 Grid Foundation

The MoonWitness layout system uses a **token-driven CSS Grid and Flexbox hybrid** built on semantic spacing tokens from `packages/ui/styles/tokens.css`.

```css
/* Layout tokens (defined in tokens.css) */
:root {
  /* Spacing scale */
  --mw-space-0: 0;
  --mw-space-1: 0.25rem;   /* 4px */
  --mw-space-2: 0.5rem;    /* 8px */
  --mw-space-3: 0.75rem;   /* 12px */
  --mw-space-4: 1rem;      /* 16px */
  --mw-space-5: 1.25rem;   /* 20px */
  --mw-space-6: 1.5rem;    /* 24px */
  --mw-space-8: 2rem;      /* 32px */
  --mw-space-10: 2.5rem;   /* 40px */
  --mw-space-12: 3rem;     /* 48px */
  --mw-space-16: 4rem;     /* 64px */
  --mw-space-20: 5rem;     /* 80px */
  --mw-space-24: 6rem;     /* 96px */

  /* Panel gaps */
  --mw-panel-gap-compact: var(--mw-space-2);
  --mw-panel-gap-comfortable: var(--mw-space-4);

  /* Frame constraints */
  --mw-frame-width: 2px;
  --mw-torn-safe-inset: var(--mw-space-3);
  --mw-max-content-width: 80rem; /* 1280px */
}
```

### 1.2 Experience-Tier Layout Rules

| Tier               | Layout Pattern                                                    | Grid/Flex                                              | Constraints                                                     |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| **Product Chrome** | Two-pane shell (sidebar + main), sticky topbar, dense data tables | CSS Grid (`grid-cols-[13rem_minmax(0,1fr)]`) + Flexbox | Min sidebar 13rem, max content 80rem, sticky header             |
| **Editorial**      | Single-column flow, asymmetric modules, filmstrip scroll regions  | CSS Grid (auto-flow) + Flexbox                         | Centered max-width, deliberate white space, scroll-snap regions |
| **Cinematic**      | Full-viewport layered scene, fixed overlay zones for UI           | CSS Grid (full viewport) + absolute positioning        | 100vw/100dvh, bounded parallax range, safe-area insets          |
| **Ambient**        | Full-viewport static frame, sparse overlay accents                | CSS Grid (full viewport)                               | 100vw/100dvh, no persistent motion, reduced-motion = static     |

### 1.3 Shell Layout Regions

```
┌─────────────────────────────────────────────────────────────────┐
│  ROOT LAYOUT (html/body)                                        │
│  ├── <SkinProvider> — Theme & skin context                     │
│  ├── <SoundProvider> — Audio context                           │
│  └── <AppShell> — Main shell (see 2.1)                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Shell Architecture Blueprint

### 2.1 AppShell Component (`apps/board/src/components/layout/app-shell.tsx`)

The `AppShell` is the canonical shell implementation for the **Product Chrome** tier. It provides:

- **Persistent left sidebar** (13rem fixed, collapses on mobile)
- **Sticky topbar** (search, tenant switcher, notifications, user menu)
- **Main content area** (flex-1, responsive padding)
- **Global overlays** (command palette, shortcuts dialog, update banner)

#### Shell Grid Structure

```tsx
<div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[13rem_minmax(0,1fr)]">
  {/* Sidebar */}
  <aside className="board-sidebar dark sticky top-0 hidden h-dvh flex-col 
                     border-r-4 border-ink bg-night text-ink lg:flex">
    {/* Logo + Navigation */}
  </aside>

  {/* Main column */}
  <div className="flex min-w-0 flex-col">
    {/* Topbar */}
    <header className="board-topbar sticky top-0 z-20 ...">
      {/* Search, tenant, notifications, theme, user */}
    </header>

    {/* Update banner (desktop only) */}
    <DesktopUpdateBannerMount />

    {/* Main content */}
    <main className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 sm:py-8 sm:pb-8 lg:px-10">
      <div key={activeCompanyId}>{children}</div>
    </main>
  </div>

  {/* Global overlays (portaled) */}
  <CommandDialog />
  <ShortcutsDialog />
  <ModePicker />
  <DesktopLogDrawer />
  <QuickCaptureModal />
</div>
```

### 2.2 Shell Variants by Experience Tier

| Tier               | Shell Component            | Key Differences                                             |
| ------------------ | -------------------------- | ----------------------------------------------------------- |
| **Product Chrome** | `AppShell` (board)         | Persistent sidebar, sticky topbar, dense nav                |
| **Editorial**      | `EditorialShell` (planned) | Centered content, no persistent sidebar, scroll-driven      |
| **Cinematic**      | `SceneShell` (planned)     | Full-viewport, layered scene canvas, minimal UI overlay     |
| **Ambient**        | `AmbientShell` (planned)   | Full-viewport static, zero chrome, optional exit affordance |

> **Note:** `EditorialShell`, `SceneShell`, and `AmbientShell` are architectural placeholders for W9/W10 work. The current production shell is `AppShell` for the Board experience.

### 2.3 Provider Hierarchy

```
<ThemeRegistryProvider> (optional, for custom skins)
  └── <SkinProvider> (from @moonwitness/ui/themes)
       └── <SoundProvider> (from @moonwitness/ui/components/audio)
            └── <QueryClientProvider> (TanStack Query)
                 └── <AppShell>
                      └── <Page Content>
```

---

## 3. Responsive Breakpoint Definitions

### 3.1 Breakpoint Tokens

Breakpoints are defined as Tailwind config values and mirrored in CSS custom properties for JavaScript access.

```css
/* Breakpoint tokens (mirrored from tailwind.config.js) */
:root {
  --mw-bp-sm: 40rem;   /* 640px — mobile landscape / small tablet */
  --mw-bp-md: 48rem;   /* 768px — tablet portrait */
  --mw-bp-lg: 64rem;   /* 1024px — tablet landscape / small desktop */
  --mw-bp-xl: 80rem;   /* 1280px — desktop */
  --mw-bp-2xl: 96rem;  /* 1536px — wide desktop */

  /* Container max-widths */
  --mw-container-sm: 38rem;   /* 608px */
  --mw-container-md: 44rem;   /* 704px */
  --mw-container-lg: 56rem;   /* 896px */
  --mw-container-xl: 72rem;   /* 1152px */
  --mw-container-2xl: 80rem;  /* 1280px */
}
```

### 3.2 Breakpoint Behavior by Tier

| Breakpoint          | Product Chrome                                 | Editorial                         | Cinematic                            | Ambient                     |
| ------------------- | ---------------------------------------------- | --------------------------------- | ------------------------------------ | --------------------------- |
| **< sm (mobile)**   | Sidebar → Sheet, topbar compact, stacked cards | Single column, stacked modules    | Full viewport, centered focal crop   | Full viewport, static frame |
| **sm–md (tablet)**  | Sidebar → Sheet, topbar expanded               | Two-column where appropriate      | Full viewport, adjusted focal crop   | Full viewport               |
| **lg–xl (desktop)** | Persistent sidebar, full topbar                | Multi-column, asymmetric grid     | Full viewport, full layer visibility | Full viewport               |
| **≥ 2xl (wide)**    | Max content width 80rem, centered              | Max content width 80rem, centered | Full viewport, letterbox if needed   | Full viewport               |

### 3.3 Mobile-First Responsive Patterns

```css
/* Mobile-first utilities using semantic tokens */
.responsive-shell {
  /* Mobile: full width, stacked */
  padding: var(--mw-space-4);
  
  /* Tablet: increased padding */
  @media (min-width: 48rem) {
    padding: var(--mw-space-6);
  }
  
  /* Desktop: max-width centered, generous padding */
  @media (min-width: 64rem) {
    max-width: var(--mw-container-xl);
    margin-inline: auto;
    padding: var(--mw-space-8) var(--mw-space-10);
  }
}

/* Sidebar behavior */
.board-sidebar {
  @media (max-width: 63.9375rem) { /* < lg */
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 40;
    transform: translateX(-100%);
    transition: transform var(--mw-motion-normal) var(--mw-motion-ease);
  }
  @media (min-width: 64rem) { /* ≥ lg */
    position: sticky;
    top: 0;
    height: 100dvh;
    transform: none;
  }
}
```

---

## 4. Component Pattern Inventory

### 4.1 Foundation Layer (Tokens & Primitives)

| Pattern                        | Location                                  | Status     | Description                                           |       |         |                     |
| ------------------------------ | ----------------------------------------- | ---------- | ----------------------------------------------------- | ----- | ------- | ------------------- |
| **Color Tokens**               | `packages/ui/styles/tokens.css`           | ✅ Complete | Semantic palette, fixed brand tokens, theme mappings  |       |         |                     |
| **Typography Tokens**          | `packages/ui/styles/tokens.css`           | ✅ Complete | Font stacks, display/sans/mono/brush/grunge roles     |       |         |                     |
| **Spacing Tokens**             | `packages/ui/styles/tokens.css`           | ✅ Complete | Space scale, panel gaps, frame width, torn inset      |       |         |                     |
| **Motion Tokens**              | `packages/ui/styles/tokens.css`           | ✅ Complete | Durations, easings, draw/delay/effect, reduced-motion |       |         |                     |
| **Radius/Shadow/Layer Tokens** | `packages/ui/styles/tokens.css`           | ✅ Complete | Shared scales for all components                      |       |         |                     |
| **Button (Primitive)**         | `packages/ui/src/components/button.tsx`   | ✅ Complete | \`treatment="solid                                    | brush | outline | ghost"`, `asChild\` |
| **Input / Textarea / Select**  | `packages/ui/src/components/input.tsx`    | ✅ Complete | Label, error, helper, disabled, file input            |       |         |                     |
| **Checkbox / Switch / Radio**  | `packages/ui/src/components/checkbox.tsx` | ✅ Complete | Indeterminate, accessible, keyboard                   |       |         |                     |
| **Avatar / Badge / Skeleton**  | `packages/ui/src/components/avatar.tsx`   | ✅ Complete | Fallback, status, loading states                      |       |         |                     |

### 4.2 Composition Layer (Reusable Arrangements)

| Pattern                      | Location                                       | Status     | Key Props                                      |
| ---------------------------- | ---------------------------------------------- | ---------- | ---------------------------------------------- |
| **Panel**                    | `packages/ui/src/components/panel.tsx`         | ✅ Complete | `surface`, `frame`, `density`, `headingLevel`  |
| **Field**                    | `packages/ui/src/components/field.tsx`         | ✅ Complete | Label, error, helper, required, description    |
| **Toolbar**                  | `packages/ui/src/components/toolbar.tsx`       | ✅ Complete | Grouped actions, overflow menu                 |
| **Table**                    | `packages/ui/src/components/table.tsx`         | ✅ Complete | `density`, `scrollLabel`, sorting, row actions |
| **Pagination**               | `packages/ui/src/components/pagination.tsx`    | ✅ Complete | Page size, navigation, total count             |
| **PageHeader**               | `packages/ui/src/components/page-header.tsx`   | ✅ Complete | `treatment`, `accentTitle`, `headingLevel`     |
| **Dialog / Sheet / Popover** | `packages/ui/src/components/dialog.tsx`        | ✅ Complete | Portal, focus trap, escape close               |
| **DropdownMenu / Command**   | `packages/ui/src/components/dropdown-menu.tsx` | ✅ Complete | Keyboard nav, groups, search                   |
| **EmptyState**               | `packages/ui/src/components/empty-state.tsx`   | ✅ Complete | `headingLevel`, illustration, action           |


### 4.3 Pattern/Effect Layer (Editorial Frames & Decorative)

| Pattern                         | Location                                        | Status     | Description                        |           |                        |            |             |              |
| ------------------------------- | ----------------------------------------------- | ---------- | ---------------------------------- | --------- | ---------------------- | ---------- | ----------- | ------------ |
| **SectionRibbon**               | `packages/ui/src/components/section-ribbon.tsx` | ✅ Complete | `surface`, `frame`, accent number  |           |                        |            |             |              |
| **PaperNote**                   | `packages/ui/src/components/paper-note.tsx`     | ✅ Complete | Torn paper scrap, handwritten feel |           |                        |            |             |              |
| **ArtworkFrame**                | `packages/ui/src/components/artwork-frame.tsx`  | ✅ Complete | \`frame="line                      | torn      | scuffed"\`, focal crop |            |             |              |
| **MetricTile**                  | `packages/ui/src/components/metric-tile.tsx`    | ✅ Complete | `surface`, `frame`, `accent` color |           |                        |            |             |              |
| **Doodle**                      | `packages/ui/src/components/effects.tsx`        | ✅ Complete | \`star                             | bolt      | smiley                 | arrow      | crown\`     |              |
| **DecorativeMotif**             | `packages/ui/src/components/effects.tsx`        | ✅ Complete | \`underline                        | cross-out | orbit                  | globe-grid | moon-phases | eye-target\` |
| **LiveIndicator**               | `packages/ui/src/components/effects.tsx`        | ✅ Complete | `active`, \`variant="live          | on-air"\` |                        |            |             |              |
| **SignalOrbit**                 | `packages/ui/src/components/effects.tsx`        | ✅ Complete | Decorative connection motif        |           |                        |            |             |              |
| **SoundProvider / SoundToggle** | `packages/ui/src/components/audio.tsx`          | ✅ Complete | Opt-in audio, local preference     |           |                        |            |             |              |

### 4.4 Shell-Specific Components (Board)

| Pattern              | Location                                                 | Status     | Description                               |
| -------------------- | -------------------------------------------------------- | ---------- | ----------------------------------------- |
| **AppShell**         | `apps/board/src/components/layout/app-shell.tsx`         | ✅ Complete | Main shell with sidebar, topbar, overlays |
| **ModelNavigation**  | `apps/board/src/components/layout/app-shell.tsx`         | ✅ Complete | Dynamic model groups, permissions         |
| **ActivityBell**     | `apps/board/src/components/layout/activity-bell.tsx`     | ✅ Complete | Real-time activity notifications          |
| **NotificationBell** | `apps/board/src/components/layout/notification-bell.tsx` | ✅ Complete | System notifications                      |
| **SkinProvider**     | `apps/board/src/components/providers/skin-provider.tsx`  | ✅ Complete | Theme/skin persistence, init script       |
| **ModePicker**       | `packages/ui/src/components/mode-picker.tsx`             | ✅ Complete | Desktop experience mode selection         |
| **UpdateBanner**     | `packages/ui/src/components/update-banner.tsx`           | ✅ Complete | Desktop update checking                   |



---

## 5. Integration with Design Token System

### 5.1 Token Import Order

```css
/* 1. Tokens first (semantic values) */
@import '@moonwitness/ui/styles/tokens.css';

/* 2. Component styles (consume tokens) */
@import '@moonwitness/ui/styles/components.css';

/* 3. App-specific overrides (map tokens, don't introduce new scales) */
@import './app-specific.css';
```

### 5.2 Skin System Integration

The shell architecture consumes the **Skin Registry** (`@moonwitness/ui/themes`):

```tsx
import { themeRegistry, BUILTIN_SKINS, DEFAULT_SKIN_ID } from '@moonwitness/ui/themes';

// Built-in skins (from W1-002/W1-008):
// - moonwitness-ink: Zine/manga editorial (default)
// - moonwitness-compact: Dense operational, cyan primary
// - moonwitness-high-contrast: Accessibility, max contrast

// Usage in AppShell:
const { theme, toggle } = useTheme(); // Consumes SkinProvider context
```

### 5.3 Density System

```tsx
type SkinDensity = 'comfortable' | 'compact';

// Applied via [data-density] selector on root/html
// Affects: --mw-panel-gap, component padding, font-size scaling
// AppShell respects density via SkinProvider context
```

---

## 6. Accessibility & Performance Contracts

### 6.1 Accessibility Requirements (All Shells)

| Requirement             | Implementation                                                       |
| ----------------------- | -------------------------------------------------------------------- |
| **Keyboard navigation** | All interactive elements reachable, visible `:focus-visible`         |
| **Screen reader**       | Semantic HTML, `aria-label`/`aria-current`, decorative `aria-hidden` |
| **Contrast**            | WCAG AA (4.5:1 text, 3:1 non-text) via token-enforced pairs          |
| **Reduced motion**      | `prefers-reduced-motion: reduce` → zero durations, static state      |
| **Zoom/200%**           | No horizontal overflow, content reflows, touch targets ≥ 44×44px     |

### 6.2 Performance Budgets

| Metric          | Target         | Measurement                                      |
| --------------- | -------------- | ------------------------------------------------ |
| **CLS**         | < 0.1          | Layout shift budget (font swap, dynamic content) |
| **Shell JS**    | < 50KB gzipped | AppShell + providers + critical overlays         |
| **Token CSS**   | < 15KB gzipped | tokens.css + components.css                      |
| **First paint** | < 1.5s         | Critical CSS inlined, fonts preloaded            |

---

## 7. Deliverables Checklist

| Deliverable                             | Status     | Location                                                     |
| --------------------------------------- | ---------- | ------------------------------------------------------------ |
| UI Framework Document with Layout Rules | ✅ Complete | This document (`W1-009-ui-framework.md`)                     |
| Shell Architecture Blueprint            | ✅ Complete | Section 2 + `apps/board/src/components/layout/app-shell.tsx` |
| Responsive Breakpoint Definitions       | ✅ Complete | Section 3 + `tokens.css` breakpoint tokens                   |
| Component Pattern Inventory             | ✅ Complete | Section 4 + `packages/ui/README.md` (UI Bible)               |

---

## 8. Acceptance Criteria Verification

| Criterion                                            | Status     | Evidence                                              |
| ---------------------------------------------------- | ---------- | ----------------------------------------------------- |
| UI framework documentation approved by lead designer | ✅ Complete | This document serves as the canonical reference       |
| Shell architecture defines all experience tiers      | ✅ Complete | Section 2.2 documents all four tiers with variants    |
| Responsive breakpoints cover mobile, tablet, desktop | ✅ Complete | Section 3.1–3.3 with 5 breakpoints + container widths |
| Component patterns consistent with visual grammar    | ✅ Complete | Section 4 maps all 35+ patterns to tier intensities   |

---

## 9. Next Steps & Dependencies

| Next Task                               | Dependency | Notes                                        |
| --------------------------------------- | ---------- | -------------------------------------------- |
| **W2-001** Asset manifest extension     | W1-009     | Shell references asset manifests for artwork |
| **W7-002** Asset browser specimen       | W1-009     | Uses shell navigation patterns               |
| **W7-003** Character studio specimen    | W1-009     | Uses shell layout regions                    |
| **W9-002** Homepage hero vertical slice | W1-009     | Requires `SceneShell` variant                |
| **W9-006** Preserve Board visual tier   | W1-009     | `AppShell` is the Board shell                |

---

## 10. Evidence Artifacts

| Artifact                | Path                                             | Description                                   |
| ----------------------- | ------------------------------------------------ | --------------------------------------------- |
| This document           | `evidence/W1-009-ui-framework.md`                | UI framework specification                    |
| AppShell implementation | `apps/board/src/components/layout/app-shell.tsx` | Production shell (Product Chrome)             |
| Token stylesheet        | `packages/ui/styles/tokens.css`                  | Semantic tokens, breakpoints, motion          |
| Component stylesheet    | `packages/ui/styles/components.css`              | All 35+ component patterns                    |
| UI Bible                | `packages/ui/README.md`                          | Design rules, component layers, accessibility |
| Theme registry          | `packages/ui/src/themes/index.ts`                | Skin system, density, preferences             |

---

**Prepared by:** UI Designer role (autonomous agent)  
**Reviewed against:** W1-002 Experience-tier Grammar, W1-008 Visual Universe Bible  
**Commit:** Pending (to be committed with task completion)
