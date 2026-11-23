# W9-005 and W9-006 — Existing visual coverage and Board gate

Date: 2026-11-23
Source branch: `dev` at `a3fa6da`

## W9-005 — Crew and Story composition

The only production narrative surface found is `/board/stories/workbench`. It uses the decorative, provenance-listed `story-workbench-masthead.webp` and continues to load story state through the existing API client. No production `/crew` route exists, so no fictional crew member or map was added to production UI. The dynamic user model remains API-backed. The catalog's `crew-01` specimen is explicitly marked as a fictional, catalog-only example with no backend record or real crew identity.

The catalog label and assertion were committed in `a3fa6da`.

Verification:

- `pnpm test:ui-catalog` — exit 0; 41/41 tests pass, including the character specimen, story workbench responsive layout, theme matrix, and Axe checks.
- `pnpm --filter @moonwitness/board typecheck` — exit 0.
- `pnpm --filter @moonwitness/board build` — exit 0 as part of `pnpm build`.
- `pnpm test:e2e:visual:matrix` — exit 1. Its shared Board visual gate has unresolved snapshot drift and environment failures listed below; W9-005 is held blocked until the shared required visual gate is green.

## W9-006 — Operational Board tier

The active navigation marker and mobile chatter tabs are present in the current pushed Board source. The mobile record audit shows the three chatter actions wrapping within the viewport, with no horizontal overflow. Board shared UI, typecheck, lint, UI budget, and Board bundle budget pass. The full matrix still fails, so the task is not marked complete.

Verification and evidence:

- `pnpm board:ui:check` — exit 0; 6/6 boundary tests pass.
- `pnpm --filter @moonwitness/board typecheck` — exit 0.
- `pnpm --filter @moonwitness/board lint` — exit 0; existing warnings remain in unrelated files.
- `pnpm test:ui-budget` — exit 0; JavaScript 557,723 raw / 164,071 gzip bytes, within budget.
- `pnpm board:budget` — exit 0 after fixing interface-audio inventory filtering; 27,012 bytes of interface audio.
- Focused Chromium visual checks — active navigation and mobile data-view checks passed after the current Board fixes.
- `pnpm test:e2e:visual:matrix` — exit 1; 5 passed, 37 failed across 42 tests × Chromium/Firefox/WebKit. Chromium failures include stale dashboard/home/workbench snapshots, two screenshot write errors under `docs/design/ui-catalog`, and a stale `Toggle theme` menu locator. Firefox and WebKit cannot launch because the Playwright binaries are not installed.
- Side-by-side artifacts reviewed: `test-results/playwright-visual/visual-audit-dashboard-KPI-4ec23-abricated-trend-percentages-chromium/board-dashboard-admin-desktop-1440-{expected,actual,diff}.png` and `test-results/playwright-visual/visual-audit-homepage-spel-cc715-t-and-reference-screenshots-chromium/home-mobile-390-{expected,actual,diff}.png`.

No visual snapshot baseline was updated. The task remains blocked on a reviewed baseline/locator refresh and available Firefox/WebKit binaries.
