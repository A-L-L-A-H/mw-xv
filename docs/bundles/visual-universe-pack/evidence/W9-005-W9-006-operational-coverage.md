# W9-005 and W9-006 — Crew boundary and operational Board gate

Date: 2026-11-25 (Asia/Jakarta)

## W9-005 — Crew and Story composition

Acceptance is complete. Production story state remains API-backed. No real user is represented by fictional artwork, and no fictional crew metrics or maps are added to production. `crew-01` is explicitly fictional in the catalog and is an approved decorative Moon City pilot in the public hero. Catalog reduced-motion checks confirm its example remains static where expected.

Verification:

- `bun --filter @moonwitness/ui-catalog test` — exit 0; 96 passed, including all SceneLab/provenance tests.
- `bunx --cwd apps/ui-catalog playwright test tests/scene-harness.spec.ts --config playwright.config.ts` — earlier focused run exit 0; 9 passed. The full current UI Catalog suite also passed all 11 SceneLab/scene-harness cases.
- Homepage scene targeted Playwright check — exit 0; 3 passed across Chromium, Firefox and WebKit.

## W9-006 — Operational Board tier (still blocked)

The official full visual audit runs with installed Chromium, Firefox and WebKit. After synchronizing restored cookie-backed sessions into `AuthProvider`, the latest official 42-case run reports 33 passed and 9 failed: seven Firefox and two WebKit. All Chromium cases passed. The WebKit protected-route, page/icon, activity, homepage, login, mobile-overlay and story workbench cases now pass; the two WebKit failures are KPI and ordinary-user dashboard screenshot mismatches. Firefox passes the page/icon, activity and story-masthead cases, but has two dashboard screenshot mismatches and five page crashes during Axe-heavy/mobile/story checks. The Firefox homepage Axe crash also reproduces when that case runs alone. No snapshot was refreshed: visual inspection shows substantial old-versus-current dashboard composition differences, so the intended baseline still needs review. The auth race is fixed and its focused WebKit overlay test passes, but W9-006 remains blocked by reproducible Firefox instability and four dashboard baseline mismatches.

Do not update operational baselines to these mismatches without reviewing them. Resolve browser-specific operational layout/rendering and the shared visual-test session behavior, then rerun the official matrix.

Verification:

- `bun run board:ui:check` — exit 0; 6 passed.
- `bun --filter @moonwitness/board lint` — exit 0.
- `bun --filter @moonwitness/board typecheck` — exit 0.
- `bun --filter @moonwitness/board build` — exit 0; existing routes listed, no Signals or Archive route.
- `bun run board:budget` — exit 0; all measured JS/CSS budgets pass; interface audio loads on demand.
- `MW_VISUAL_BROWSER_MATRIX=true bun run test:e2e:visual` — exit 1; 33 passed, 9 failed (7 Firefox, 2 WebKit), 9.9 minutes. Raw output is captured at `test-results/w9-006-auth-fix-matrix.log` (ignored local run artifact); per-test contexts are under `test-results/playwright-visual/`.
- Focused WebKit mobile-overlay/protected-route regression after auth hydration fix — exit 0; 1 passed. Focused Firefox homepage test — exit 1; Axe evaluation reproducibly crashed at mobile viewport.
- Save-Data homepage test — exit 0; 3 passed (Chromium, Firefox, WebKit).
