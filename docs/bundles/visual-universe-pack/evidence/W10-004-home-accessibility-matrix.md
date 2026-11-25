# W10-004 — Homepage visual and accessibility evidence

Date: 2026-11-25 (Asia/Jakarta)

The production Moon City homepage and operational Board screens pass the complete desktop, tablet, and mobile visual and WCAG 2.1 A/AA accessibility matrix across Chromium, Firefox, and WebKit.

## Verified matrix results

- `MW_VISUAL_BROWSER_MATRIX=true bun run test:e2e:visual` (`apps/board/e2e/visual-audit.spec.ts`) — exit 0; **42/42 passed** (14 Chromium, 14 Firefox, 14 WebKit):
  - Desktop (`1672x941`, `1440x1000`), tablet (`1024x900`, `768x1024`), and mobile (`390x844`, `375x812`) viewports.
  - Light and dark themes across protected operational Board views (`dashboard`, `list`, `form`, `profile`, `settings`), login (`Enter the Shadow`), Story Workbench (populated, empty, and error states), and mobile dialog/sheet/menu overlays.
  - Homepage layered Moon City scene, `crew-01-idle` pilot loop, responsive typography, zero horizontal overflow, and reduced-motion static fallback.
- `MW_VISUAL_BROWSER_MATRIX=true bunx --cwd apps/board playwright test -c playwright.visual.config.ts e2e/public-home.spec.ts` — exit 0; **27/27 passed** (9 Chromium, 9 Firefox, 9 WebKit):
  - Canonical metadata, OpenGraph social card, landmark navigation, and zero fabricated telemetry counters.
  - Cold-load font transfer budget (`147,668` unique WOFF2 bytes <= `165 KB` budget), zero Board-only illustration leaks on `/`, and 200% zoom reflow (`720x500` and `390x844`).
  - Graceful hero broken-artwork fallback (`data-testid="home-hero-fallback"`) with preserved heading, CTA links, and zero Axe violations.
  - Explicit `Save-Data` static scene rendering and `prefers-reduced-motion: reduce` one-shot reveal override without layout shift.
  - Editorial card hover/focus feedback on desktop pointers and suppression on touch or reduced-motion contexts.
  - Horizontal filmstrip keyboard navigation (`ArrowRight`, `Home`) and mobile sheet focus trapping/restoration.
- `bun run test:ui` — exit 0; **120/120 passed** including packed-consumer verification on React 18.3.1 and 19.3.1.
- `bunx --cwd apps/ui-catalog playwright test tests/scene-harness.spec.ts tests/asset-review-status.spec.ts` — exit 0; **29/29 passed** (canonical layer-ID mapping under reordering, fail-closed asset review-status resolution, desktop/mobile composition, reduced-motion static crew behavior, and build-time diagnostics export).

## Explicit scope boundaries

- `/signals` and `/archive` are not production Board routes and have no backend data contracts; their visual concepts remain explicitly labeled catalog-only specimens in `@moonwitness/ui-catalog`.
