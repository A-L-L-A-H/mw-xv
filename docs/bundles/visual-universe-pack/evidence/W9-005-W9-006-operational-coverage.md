# W9-005 and W9-006 — Crew boundary and operational Board gate

Date: 2026-11-25 (Asia/Jakarta)

## W9-005 — Crew and Story composition

Acceptance is complete. Production story state remains API-backed. No real user is represented by fictional artwork, and no fictional crew metrics or maps are added to production. `crew-01` is explicitly fictional in the catalog and is an approved decorative Moon City pilot in the public hero. Catalog reduced-motion checks confirm its example remains static where expected.

Verification:

- `bun --filter @moonwitness/ui-catalog test` — exit 0; 86 passed.
- `bunx --cwd apps/ui-catalog playwright test tests/scene-harness.spec.ts --config playwright.config.ts` — exit 0; 9 passed.
- Homepage scene targeted Playwright check — exit 0; 3 passed across Chromium, Firefox and WebKit.

## W9-006 — Operational Board tier (still blocked)

The official full visual audit now runs with installed Chromium, Firefox and WebKit. The focused Moon City homepage test is green in all three. Shared UI boundary, lint, typecheck, production build and bundle budgets are green. However the operational visual tier is not green: the latest official 42-case run reports 28 passed and 14 failed, with all failures in Firefox/WebKit. These include dashboard KPI and ordinary-user visual baselines (the latter changes page height), Firefox Axe/page crashes and login rendering, WebKit authenticated-route/session failures, and story masthead/responsive route assertions. Chromium passes all 14 cases, and homepage passes across all three engines.

Do not update operational baselines to these mismatches without reviewing them. Resolve browser-specific operational layout/rendering and the shared visual-test session behavior, then rerun the official matrix.

Verification:

- `bun run board:ui:check` — exit 0; 6 passed.
- `bun --filter @moonwitness/board lint` — exit 0.
- `bun --filter @moonwitness/board typecheck` — exit 0.
- `bun --filter @moonwitness/board build` — exit 0; existing routes listed, no Signals or Archive route.
- `bun run board:budget` — exit 0; all measured JS/CSS budgets pass; interface audio loads on demand.
- `MW_VISUAL_BROWSER_MATRIX=true bun run test:e2e:visual` — exit 1; 28 passed, 14 failed (7 Firefox, 7 WebKit), 7.1 minutes. Per-test contexts are under `test-results/playwright-visual/` for this run.
- Focused homepage test — exit 0; 3 passed (Chromium, Firefox, WebKit).
