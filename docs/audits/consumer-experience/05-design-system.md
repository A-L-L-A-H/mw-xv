# 05 — Design System & Token Audit

**Audit Scope:** [`packages/ui/src/styles/tokens.css`](../../../packages/ui/src/styles/tokens.css), [`packages/ui/src/styles/components.css`](../../../packages/ui/src/styles/components.css), [`packages/ui/src/themes/index.ts`](../../../packages/ui/src/themes/index.ts), [`packages/types/src/theme.ts`](../../../packages/types/src/theme.ts), [`packages/ui/TOKENS.md`](../../../packages/ui/TOKENS.md), [`packages/ui/README.md`](../../../packages/ui/README.md), [`packages/assets/fonts.css`](../../../packages/assets/fonts.css), and [`raw_arts/fonts/`](../../../raw_arts/fonts)
**Consumer Adapters Audited:** [`apps/board/src/index.css`](../../../apps/board/src/index.css), [`apps/board/src/app/global.css`](../../../apps/board/src/app/global.css), [`apps/desktop/desktop-web/desktop.css`](../../../apps/desktop/desktop-web/desktop.css), [`apps/board/src/components/providers/skin-provider.tsx`](../../../apps/board/src/components/providers/skin-provider.tsx)

---

## 1. Executive Summary

The `@moonwitness/ui` token architecture is structurally sound: [`tokens.css`](../../../packages/ui/src/styles/tokens.css) is the single source of truth with zero global element selectors or external font requests, [`themes/index.ts`](../../../packages/ui/src/themes/index.ts) exposes a validated `themeRegistry` and pre-hydration `createSkinInitScript()`, and every existing `(skin × mode)` pair passes WCAG AA (`>= 4.5:1` text, `>= 3.0:1` border/focus) in automated tests ([`packages/ui/tests/themes.test.mjs`](../../../packages/ui/tests/themes.test.mjs)).

However, four systemic gaps prevent the token system from delivering the 4 target art directions (**Funky Grunge Light**, **Funky Grunge Dark**, **Riot / High Contrast**, **Cartoon / Comic Experience**) cohesively:

1. **Missing `moonwitness-riot` skin:** Only 3 skins exist (`moonwitness-ink`, `moonwitness-compact`, `moonwitness-high-contrast`). There is no high-impact punk/riot zine skin separating expressive electric riot accents from accessibility-pure `moonwitness-high-contrast`.
2. **Legacy `saksi-*` & `cinzel-*` fonts orphaned in `raw_arts/fonts/`:** [`packages/assets/fonts.css`](../../../packages/assets/fonts.css) hosts `Anton`, `Space Grotesk`, `JetBrains Mono`, `Road Rage` (Latin subset), and `MoonWitness Grunge` (`normal` and `oblique` mapped to the same WOFF2). Meanwhile, `raw_arts/fonts/` holds `saksi-hand-{400,700}.woff2`, `saksi-marker-{400,700}.woff2`, `saksi-mono-{400,700}.woff2`, and `cinzel-{400,600,700}.woff2`, none of which are registered in `fonts.css` or referenced in `tokens.css`.
3. **Typography stack collapse in `tokens.css`:** `--mw-font-display`, `--mw-font-grunge`, and `--mw-font-brush` all prepend `'MoonWitness Grunge'` first (`tokens.css:81-84`), flattening the distinction between condensed block metrics (`Anton`) and hand-inked brush headings (`Road Rage` / `MoonWitness Grunge`). Additionally, `--mw-font-comic` does not exist.
4. **Missing semantic comic, sticker, progression, and kinetic motion tokens:** While `tokens.css` defines grunge clip-paths (`--mw-grunge-clip-rough`, `--mw-grunge-clip-jagged`, `--mw-grunge-clip-tape`, `--mw-grunge-clip-torn-card`, `--mw-grunge-clip-brush-btn`, `--mw-grunge-clip-notched`) and chalk masks (`--mw-chalk-mask`), it lacks semantic comic speech-bubble, SFX badge, panel gutter, halftone scale, and spring/stepped comic motion tokens—forcing `components.css` and `global.css` to hardcode `box-shadow`, `clip-path`, and `rotate()` literals.

---

## 2. Token Architecture & Surface Mapping

### 2.1 Existing Token Inventory (`packages/ui/src/styles/tokens.css`)

| Category | Tokens Defined | Observations |
| --- | --- | --- |
| **Fixed Brand Colors** | `--mw-paper-cream` (`#f3efe4`), `--mw-ink-black` (`#0d0d0d`), `--mw-ink-panel` (`#17171a`), `--mw-night` (`#0d0d0d`), `--mw-night-soft` (`#121216`), `--mw-night-raised` (`#17171a`), `--mw-night-blue` (`#092c49`), `--mw-night-magenta` (`#421027`), `--mw-yellow` (`#ffe031`), `--mw-magenta` (`#ff2e88`), `--mw-signal-blue` (`#00b8f0`), `--mw-violet` (`#c084fc`), `--mw-moon` (`#b6cad7`) | Properly separated from theme-aware `--mw-paper` / `--mw-ink`. Paired readable accents (`--mw-*-readable`) adapt between light and `.dark`. |
| **Semantic Surfaces** | `--mw-background`, `--mw-foreground`, `--mw-surface`, `--mw-surface-foreground`, `--mw-popover`, `--mw-primary`, `--mw-secondary`, `--mw-muted`, `--mw-accent`, `--mw-border`, `--mw-border-strong`, `--mw-border-subtle`, `--mw-input`, `--mw-focus`, `--mw-backdrop` | Complete semantic mapping. `apps/board/src/index.css:17-49` re-aliases these on `:root, .dark` into Tailwind `@theme inline` tokens. |
| **Semantic Status** | `--mw-error` / `--mw-destructive` (`#b42318` light / `#fda29b` dark), `--mw-success` (`#166534`), `--mw-warning` (`#facc15`), `--mw-info` (`#175cd3`) + `--mw-on-*` + `--mw-*-readable` | Distinct from brand magenta (`#ff2e88`). Note: `--mw-success` in `.dark` stays `#166534` with `--mw-on-success: #fffdf6` (`7.01:1`), while `--mw-success-readable` switches to `#86efac` for text on dark surfaces. |
| **Charts** | `--mw-chart-1`..`5` (`#476a2a`, `#ff2e88`, `#176b87`, `#936a22`, `#76519b`) | Paired with hatch patterns and labels in `components.css:1618` and `chart.tsx`. |
| **Typography** | `--mw-font-display`, `--mw-font-grunge`, `--mw-font-condensed`, `--mw-font-brush`, `--mw-font-sans`, `--mw-font-mono`, `--mw-font-size-2xs..2xl`, `--mw-line-height-tight/normal` | `--mw-font-size-2xs` and `--mw-font-size-xs` are identical (`0.75rem`). `--mw-font-display` and `--mw-font-brush` collide on `'MoonWitness Grunge'`. |
| **Spacing & Shape** | `--mw-space-1..8`, `--mw-panel-gap-{compact,comfortable}`, `--mw-panel-padding-{compact,comfortable}`, `--mw-frame-width` (`2px`), `--mw-torn-safe-inset` (`0.75rem`), `--mw-decorative-rotation` (`1.5deg`), `--mw-radius-sm/md/lg`, `--mw-grunge-radius-hand` | Well-defined spacing and safe inset tokens. Missing `--mw-comic-gutter`, `--mw-panel-border-heavy`, and `--mw-bubble-tail-size`. |
| **Depth & Texture** | `--mw-shadow-ink` (`3px 3px 0 0 var(--mw-ink)`), `--mw-shadow-ink-lg` (`6px 6px 0 0 var(--mw-ink)`), `--mw-shadow-anime-impact` (`4px 4px 0 0 var(--mw-ink), 7px 7px 0 0 var(--mw-magenta)`), `--mw-halftone-dot`, `--mw-grunge-grain-opacity`, 6 `--mw-grunge-clip-*`, `--mw-chalk-mask` | Inline `url("data:image/svg+xml,...")` in `--mw-chalk-mask` (`tokens.css:243`) is duplicated in `global.css:159` (`--board-chalk-mask`) and `global.css:417` (`--global-chalk-mask`), both unused because `mask-image` still points to `var(--mw-chalk-mask)`! |
| **Motion & Z-Index** | `--mw-motion-fast` (`120ms`), `--mw-motion-normal` (`160ms`), `--mw-motion-slow` (`220ms`), `--mw-motion-delay` (`200ms`), `--mw-motion-draw` (`700ms`), `--mw-motion-effect` (`1200ms`), `--mw-motion-pulse` (`1600ms`), `--mw-motion-progress` (`1400ms`), `--mw-motion-spin` (`800ms`), `--mw-motion-anime-snap` (`180ms`), `--mw-motion-anime-slash` (`360ms`), `--mw-motion-anime-burst` (`480ms`), `--mw-motion-grunge-jitter` (`900ms`), `--mw-layer-*` (`0..60`) | Under `@media (prefers-reduced-motion: reduce)` (`tokens.css:361-371`), 7 duration tokens zero out (`fast`, `normal`, `slow`, `anime-*`, `grunge-jitter`), but `--mw-motion-draw`, `--mw-motion-delay`, `--mw-motion-effect`, `--mw-motion-pulse`, `--mw-motion-progress`, and `--mw-motion-spin` are NOT zeroed in `:root` (handled instead by `animation: none` in `components.css:2245-2255, 2809-2830`). |

---

## 3. Typography & Font Asset Audit

### 3.1 Hosted Fonts (`packages/assets/fonts.css`) vs. `raw_arts/fonts/`

| Family | Source Location | Weights / Styles in `fonts.css` | Range / Subsetting | Role & Gap |
| --- | --- | --- | --- | --- |
| **MoonWitness Grunge** | [`packages/assets/fonts/MoonWitnessGrunge-latin.woff2`](../../../packages/assets/fonts/MoonWitnessGrunge-latin.woff2) (source `.otf`) | `400 normal`, `400 oblique` (both point to same file) | Latin | Proprietary grunge display face. Currently overrides `Anton` and `Road Rage` as the #1 family in `--mw-font-display`, `--mw-font-grunge`, `--mw-font-brush`. |
| **Road Rage** | [`packages/assets/fonts/RoadRage-latin.woff2`](../../../packages/assets/fonts/RoadRage-latin.woff2) | `400 normal` | Latin + Latin-1 accents (subsetted via `prepare-fonts.mjs`) | Intended by `README.md:22` as `--mw-font-brush` for expressive headings, but shadowed by `'MoonWitness Grunge'` in `tokens.css:84`. |
| **Anton** | [`packages/assets/fonts/Anton-latin.woff2`](../../../packages/assets/fonts/Anton-latin.woff2), `Anton-latin-ext.woff2` | `400 normal` | `latin`, `latin-ext` | Intended by `README.md:22` as `--mw-font-display` for compact labels/metrics, but shadowed by `'MoonWitness Grunge'` in `tokens.css:81`. |
| **Space Grotesk** | [`packages/assets/fonts/SpaceGrotesk-latin.woff2`](../../../packages/assets/fonts/SpaceGrotesk-latin.woff2), `latin-ext` | `400`, `500`, `600`, `700` | `latin`, `latin-ext` | Body, controls, tables (`--mw-font-sans`). Uses the same WOFF2 variable/static file across weights 400–700. |
| **JetBrains Mono** | [`packages/assets/fonts/JetBrainsMono-latin.woff2`](../../../packages/assets/fonts/JetBrainsMono-latin.woff2), `latin-ext` | `400`, `600` | `latin`, `latin-ext` | Technical IDs, timestamps, code (`--mw-font-mono`). Weight `700` is used widely in CSS (`font-bold`) and relies on synthetic/fallback bolding because `700` is not declared in `fonts.css`. |
| **Saksi Hand** *(raw)* | [`raw_arts/fonts/saksi-hand-400.woff2`](../../../raw_arts/fonts/saksi-hand-400.woff2), `saksi-hand-700.woff2` | **Not registered** | Unknown | Legacy handwritten font in `raw_arts/fonts/`. Candidate for comic speech-bubble/annotation (`--mw-font-comic-note`) if license provenance is verified and moved to `@moonwitness/assets`. |
| **Saksi Marker** *(raw)* | [`raw_arts/fonts/saksi-marker-400.woff2`](../../../raw_arts/fonts/saksi-marker-400.woff2), `saksi-marker-700.woff2` | **Not registered** | Unknown | Legacy marker font in `raw_arts/fonts/`. Candidate for SFX onomatopoeia / comic callouts (`--mw-font-comic-sfx`) pending license check. |
| **Saksi Mono** *(raw)* | [`raw_arts/fonts/saksi-mono-400.woff2`](../../../raw_arts/fonts/saksi-mono-400.woff2), `saksi-mono-700.woff2` | **Not registered** | Unknown | Legacy monospace in `raw_arts/fonts/`. Redundant with `JetBrains Mono`. |
| **Cinzel** *(raw)* | [`raw_arts/fonts/cinzel-400.woff2`](../../../raw_arts/fonts/cinzel-400.woff2), `600`, `700` | **Not registered** | Unknown | Serif display font in `raw_arts/fonts/`. Useful only for `GOD PROMISE` imprint in `/board/studio`, not core MoonWitness zine/comic UI. |

### 3.2 Recommended Typography Contract Fix

- Separate `--mw-font-display` to lead with `'Anton', 'MoonWitness Grunge', Impact, 'Arial Narrow', sans-serif` so KPI numerals and dense section headings stay crisp and legible (matching `README.md:22`).
- Keep `--mw-font-grunge` leading with `'MoonWitness Grunge', 'Road Rage', Impact, sans-serif` for punk/riot titles.
- Keep `--mw-font-brush` leading with `'Road Rage', 'MoonWitness Grunge', Impact, sans-serif` (or keep `'MoonWitness Grunge'` strictly for `--mw-font-grunge` so `Road Rage` actually renders on brush ribbons).
- Add `@font-face` weight `700` for `JetBrains Mono` in `packages/assets/fonts.css` to avoid browser faux-bold on `font-mono font-bold`.
- Formally triage `raw_arts/fonts/saksi-*`: either promote `saksi-hand` / `saksi-marker` into `packages/assets/fonts.css` with `licenses.json` provenance for `--mw-font-comic` or archive them out of `raw_arts/fonts/` so no orphaned binary assets linger.

---

## 4. Existing Skins vs. 4 Target Art Directions

### 4.1 Mapping Matrix

| Existing Skin (`packages/ui/src/themes/index.ts`) | Target Art Direction | Alignment | Gaps vs. Target Direction |
| --- | --- | --- | --- |
| `moonwitness-ink` (`light`) | **1. Funky Grunge Light** | **Strong** | Warm cream paper (`#f3efe4`), deep ink (`#0d0d0d`), yellow primary (`#ffe031`), halftone dots (`rgb(13 13 13 / 13%)`). Operational pages (`CommercialPage`, `CloudIspPage`, `SettingsPage`, AI Mission Control) use flat borders instead of grunge/paper-note grammar. |
| `moonwitness-ink` (`dark`) | **2. Funky Grunge Dark** | **Strong** | Charcoal paper (`#0e0e10`), dark panel (`#17171a`), cream ink (`#f3efe4`). Primary remains yellow (`#ffe031`); however, `--mw-border` becomes `#f3efe4` in `.dark`, which reduces contrast of ink-on-ink halftone textures unless `data-surface="ink"` is used explicitly. |
| `moonwitness-high-contrast` (`light` / `dark`) | **3. Riot / High Contrast** | **Partial (Wrong Intent)** | `moonwitness-high-contrast` is pure WCAG AAA accessibility (`#ffffff`/`#000000` with `3px` frames and `#ffd000` yellow). It strips halftone/zine character and has **no magenta/cyan riot polarity**. A dedicated `moonwitness-riot` skin is needed so accessibility users keep `moonwitness-high-contrast` untouched while expressive Riot mode thrives. |
| `moonwitness-compact` (`light` / `dark`) | *(Operational Dense)* | **N/A (Utility Skin)** | Tighter radii (`0.125rem`–`0.375rem`), cyan primary (`#00b8f0`), compact default density. Useful for dense tables/AI ops; orthogonal to the 4 expressive directions. |
| *(Missing)* | **4. Cartoon / Comic Experience** | **Missing** | No dedicated skin or semantic comic token layer for panel gutters (`--mw-comic-gutter`), speech-bubble surfaces, SFX impact badges, stepped frame timing, or character stage backdrops. Currently only isolated effects (`SpeechBubble`, `MangaPanel`, `AnimeImpactBurst`) exist in `effects.tsx`. |

---

## 5. Specification: `moonwitness-riot` Skin & Semantic Comic/Motion Tokens

### 5.1 Registry Metadata (`packages/types/src/theme.ts` & `packages/ui/src/themes/index.ts`)

Extend `BuiltinSkinId` in `packages/types/src/theme.ts:5`:
```ts
export type BuiltinSkinId =
  | 'moonwitness-ink'
  | 'moonwitness-compact'
  | 'moonwitness-high-contrast'
  | 'moonwitness-riot';
```

Register in `BUILTIN_SKINS` (`packages/ui/src/themes/index.ts`):
```ts
Object.freeze({
  id: 'moonwitness-riot',
  label: 'MoonWitness Riot',
  description: 'High-impact punk zine and comic skin with stark contrast, heavy ink borders, and electric neon accents.',
  supportedModes: Object.freeze(['light', 'dark'] as const),
  supportedDensities: Object.freeze(['comfortable', 'compact'] as const),
  defaultMode: 'dark',
  defaultDensity: 'comfortable',
  swatch: Object.freeze({
    background: '#09090b',
    surface: '#121216',
    foreground: '#f5efdf',
    accent: '#ff2e88',
  }),
})
```

### 5.2 CSS Token Overrides for `moonwitness-riot`

```css
/* Skin: moonwitness-riot (Riot / Punk Comic Poster) */
[data-skin='moonwitness-riot'] {
  --mw-paper: #f5efdf;
  --mw-paper-raised: #fff9eb;
  --mw-ink: #0a0a0c;
  --mw-ink-soft: #2d2d2a;
  --mw-ink-faint: #2d2d2a;
  --mw-muted: #e4dcc8;
  --mw-primary: #ffe031;
  --mw-primary-foreground: #0a0a0c;
  --mw-accent: #ff2e88;
  --mw-accent-foreground: #0a0a0c;
  --mw-on-accent: #0a0a0c;
  --mw-on-magenta: #0a0a0c;
  --mw-on-violet: #0a0a0c;
  --mw-border: #0a0a0c;
  --mw-border-strong: #0a0a0c;
  --mw-focus: #a60e4f;
  --mw-magenta-readable: #a60e4f;
  --mw-cyan-readable: #006e92;
  --mw-yellow-readable: #6b5500;
  --mw-violet-readable: #6322cf;
  --mw-frame-width: 3px;
  --mw-shadow-ink: 4px 4px 0 0 #0a0a0c;
  --mw-shadow-ink-lg: 7px 7px 0 0 #0a0a0c;
  --mw-shadow-anime-impact: 4px 4px 0 0 #0a0a0c, 8px 8px 0 0 #ff2e88;
  --mw-halftone-dot: rgb(10 10 12 / 18%);
  --mw-grunge-grain-opacity: 0.2;
}

[data-skin='moonwitness-riot'].dark {
  --mw-paper: #09090b;
  --mw-paper-raised: #121216;
  --mw-ink: #f5efdf;
  --mw-ink-soft: #cfcabd;
  --mw-ink-faint: #cfcabd;
  --mw-muted: #1e1e24;
  --mw-primary: #ff2e88;
  --mw-primary-foreground: #0a0a0c;
  --mw-accent: #ffe031;
  --mw-accent-foreground: #0a0a0c;
  --mw-border: #f5efdf;
  --mw-border-strong: #f5efdf;
  --mw-focus: #ffe031;
  --mw-error: #fda29b;
  --mw-on-error: #0a0a0c;
  --mw-magenta-readable: #ff4d99;
  --mw-cyan-readable: #00b8f0;
  --mw-yellow-readable: #ffe031;
  --mw-violet-readable: #c084fc;
  --mw-shadow-ink: 4px 4px 0 0 #000000;
  --mw-shadow-ink-lg: 7px 7px 0 0 #ff2e88;
  --mw-shadow-anime-impact: 4px 4px 0 0 #000000, 8px 8px 0 0 #00b8f0;
  --mw-halftone-dot: rgb(245 239 223 / 14%);
  --mw-grunge-grain-opacity: 0.22;
}
```

### 5.3 Semantic Comic & Motion Tokens (Cartoon / Comic Experience Layer)

To support **Direction 4 (Cartoon / Comic Experience)** across all skins without duplicating values:

```css
/* Semantic Comic & Panel Tokens (:root defaults, overridden in .dark & skins) */
--mw-comic-gutter: var(--mw-space-4);
--mw-comic-panel-border: 3px;
--mw-comic-panel-bg: var(--mw-surface);
--mw-comic-panel-fg: var(--mw-surface-foreground);
--mw-comic-bubble-bg: #fff9eb;          /* .dark: #17171c */
--mw-comic-bubble-fg: #0a0a0c;          /* .dark: #f5efdf */
--mw-comic-sfx-bg: var(--mw-yellow);
--mw-comic-sfx-fg: #0a0a0c;
--mw-comic-stamp-bg: var(--mw-magenta);
--mw-comic-stamp-fg: #0a0a0c;
--mw-comic-halftone-size: 6px;
--mw-comic-sticker-tilt: -2.4deg;

/* Semantic Kinetic Comic Motion Tokens */
--mw-motion-comic-steps: 3;
--mw-motion-comic-pop: 200ms;           /* 0ms under prefers-reduced-motion: reduce */
--mw-motion-comic-wipe: 280ms;          /* 0ms under prefers-reduced-motion: reduce */
--mw-motion-comic-jitter: 900ms;        /* 0ms under prefers-reduced-motion: reduce */
--mw-motion-ease-comic-snap: cubic-bezier(0.22, 1.35, 0.36, 1);
```

---

## 6. WCAG AA Contrast Proofs

All contrast ratios below were verified programmatically via WCAG 2.1 relative luminance (`(L1 + 0.05) / (L2 + 0.05)`).

### 6.1 Existing Skins Baseline (`packages/ui/src/styles/tokens.css`)

| Skin (`mode`) | `fg / bg` | `surface-fg / surface` | `muted-fg / muted` | `primary-fg / primary` | `on-magenta / magenta` | `magenta-readable / surface` | `cyan-readable / surface` | `border / surface` | `focus / bg` | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `moonwitness-ink` (`light`) | 16.92:1 | 19.10:1 | 8.83:1 | 14.77:1 | 5.55:1 | 6.67:1 | 5.20:1 | 19.10:1 | 16.92:1 | **PASS** |
| `moonwitness-ink` (`dark`) | 16.78:1 | 15.57:1 | 9.07:1 | 14.77:1 | 5.55:1 | 5.11:1 | 7.76:1 | 15.57:1 | 16.78:1 | **PASS** |
| `moonwitness-compact` (`light`) | 16.27:1 | 18.86:1 | 9.05:1 | 8.44:1 | 5.55:1 | 6.79:1 | 5.30:1 | 18.86:1 | 16.27:1 | **PASS** |
| `moonwitness-compact` (`dark`) | 17.33:1 | 15.99:1 | 9.18:1 | 8.44:1 | 5.55:1 | 5.12:1 | 7.78:1 | 15.99:1 | 17.33:1 | **PASS** |
| `moonwitness-high-contrast` (`light`) | 21.00:1 | 21.00:1 | 14.60:1 | 14.27:1 | 5.55:1 | 8.61:1 | 7.56:1 | 21.00:1 | 21.00:1 | **PASS** |
| `moonwitness-high-contrast` (`dark`) | 21.00:1 | 19.80:1 | 13.65:1 | 16.57:1 | 5.55:1 | 7.28:1 | 11.04:1 | 19.80:1 | 16.57:1 | **PASS** |

### 6.2 `moonwitness-riot` Contrast Proofs (Both Modes + Comic Tokens)

| Token Pair | `moonwitness-riot` Light (FG / BG) | Ratio | `moonwitness-riot` Dark (FG / BG) | Ratio | WCAG AA Target | Result |
| --- | --- | --- | --- | --- | --- | --- |
| `--mw-foreground` on `--mw-background` | `#0a0a0c` / `#f5efdf` | **17.23:1** | `#f5efdf` / `#09090b` | **17.33:1** | `>= 4.5:1` | **PASS** |
| `--mw-surface-foreground` on `--mw-surface` | `#0a0a0c` / `#fff9eb` | **18.84:1** | `#f5efdf` / `#121216` | **16.28:1** | `>= 4.5:1` | **PASS** |
| `--mw-muted-foreground` on `--mw-muted` | `#2d2d2a` / `#e4dcc8` | **10.11:1** | `#cfcabd` / `#1e1e24` | **10.14:1** | `>= 4.5:1` | **PASS** |
| `--mw-primary-foreground` on `--mw-primary` | `#0a0a0c` / `#ffe031` | **15.03:1** | `#0a0a0c` / `#ff2e88` | **5.65:1** | `>= 4.5:1` | **PASS** |
| `--mw-on-magenta` on `--mw-magenta` | `#0a0a0c` / `#ff2e88` | **5.65:1** | `#0a0a0c` / `#ff2e88` | **5.65:1** | `>= 4.5:1` | **PASS** |
| `--mw-on-cyan` on `--mw-signal-blue` | `#0a0a0c` / `#00b8f0` | **8.59:1** | `#0a0a0c` / `#00b8f0` | **8.59:1** | `>= 4.5:1` | **PASS** |
| `--mw-on-violet` on `--mw-violet` | `#0a0a0c` / `#c084fc` | **7.49:1** | `#0a0a0c` / `#c084fc` | **7.49:1** | `>= 4.5:1` | **PASS** |
| `--mw-destructive-fg` on `--mw-destructive` | `#fff9eb` / `#b42318` | **6.26:1** | `#0a0a0c` / `#fda29b` | **10.19:1** | `>= 4.5:1` | **PASS** |
| `--mw-on-success` on `--mw-success` | `#fff9eb` / `#166534` | **6.79:1** | `#fffdf6` / `#166534` | **7.01:1** | `>= 4.5:1` | **PASS** |
| `--mw-on-warning` on `--mw-warning` | `#0a0a0c` / `#facc15` | **12.92:1** | `#0a0a0c` / `#facc15` | **12.92:1** | `>= 4.5:1` | **PASS** |
| `--mw-on-info` on `--mw-info` | `#fff9eb` / `#175cd3` | **5.70:1** | `#fffdf6` / `#175cd3` | **5.88:1** | `>= 4.5:1` | **PASS** |
| `--mw-magenta-readable` on `--mw-surface` | `#a60e4f` / `#fff9eb` | **7.15:1** | `#ff4d99` / `#121216` | **6.03:1** | `>= 4.5:1` | **PASS** |
| `--mw-cyan-readable` on `--mw-surface` | `#006e92` / `#fff9eb` | **5.49:1** | `#00b8f0` / `#121216` | **8.11:1** | `>= 4.5:1` | **PASS** |
| `--mw-yellow-readable` on `--mw-surface` | `#6b5500` / `#fff9eb` | **6.84:1** | `#ffe031` / `#121216` | **14.20:1** | `>= 4.5:1` | **PASS** |
| `--mw-violet-readable` on `--mw-surface` | `#6322cf` / `#fff9eb` | **7.52:1** | `#c084fc` / `#121216` | **7.07:1** | `>= 4.5:1` | **PASS** |
| `--mw-border` against `--mw-surface` | `#0a0a0c` / `#fff9eb` | **18.84:1** | `#f5efdf` / `#121216` | **16.28:1** | `>= 3.0:1` | **PASS** |
| `--mw-focus` against `--mw-background` | `#a60e4f` / `#f5efdf` | **6.54:1** | `#ffe031` / `#09090b` | **15.12:1** | `>= 3.0:1` | **PASS** |
| `--mw-comic-bubble-fg` on `--mw-comic-bubble-bg` | `#0a0a0c` / `#fff9eb` | **18.84:1** | `#f5efdf` / `#17171c` | **15.56:1** | `>= 4.5:1` | **PASS** |
| `--mw-comic-sfx-fg` on `--mw-comic-sfx-bg` | `#0a0a0c` / `#ffe031` | **15.03:1** | `#0a0a0c` / `#ffe031` | **15.03:1** | `>= 4.5:1` | **PASS** |
| `--mw-comic-stamp-fg` on `--mw-comic-stamp-bg` | `#0a0a0c` / `#ff2e88` | **5.65:1** | `#0a0a0c` / `#ff2e88` | **5.65:1** | `>= 4.5:1` | **PASS** |

---

## 7. Prioritized Design System Remediation

1. **P0 — Add `moonwitness-riot` skin** across `packages/types/src/theme.ts`, `packages/ui/src/themes/index.ts`, `packages/ui/src/styles/tokens.css`, and `packages/ui/tests/themes.test.mjs`, and update `SettingsPage` skin grid from `sm:grid-cols-3` to `sm:grid-cols-2 lg:grid-cols-4` (`apps/board/src/board-pages/settings-page.tsx:854`).
2. **P0 — Disambiguate `--mw-font-display` vs. `--mw-font-brush`** in `tokens.css:81-84` (`Anton` for `--mw-font-display`, `Road Rage` for `--mw-font-brush`, `MoonWitness Grunge` for `--mw-font-grunge`) and declare `700` weight for `JetBrains Mono` in `packages/assets/fonts.css`.
3. **P1 — Introduce semantic comic/motion tokens** (`--mw-comic-*`, `--mw-motion-comic-*`) in `tokens.css` and zero all remaining motion duration tokens (`--mw-motion-draw`, `--mw-motion-delay`, `--mw-motion-effect`, `--mw-motion-pulse`, `--mw-motion-progress`, `--mw-motion-spin`) inside `@media (prefers-reduced-motion: reduce)`.
4. **P1 — Deduplicate inline SVG data URIs** (`--board-chalk-mask` and `--global-chalk-mask` in `apps/board/src/index.css:159` and `apps/board/src/app/global.css:417` are dead declarations shadowing `--mw-chalk-mask`).
5. **P2 — Triage `raw_arts/fonts/saksi-*` and `cinzel-*`:** Either register with provenance in `packages/assets/fonts.css` or archive from `raw_arts/fonts/`.
