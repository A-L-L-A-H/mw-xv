# W9-005 and W9-006 — Crew boundary and operational Board gate

Date: 2026-11-25 (Asia/Jakarta)

## W9-005 — Crew and Story composition

Acceptance is complete. Production story state remains API-backed. No real user is represented by fictional artwork, and no fictional crew metrics or maps are added to production. `crew-01` is explicitly fictional in the catalog and is an approved decorative Moon City pilot in the public hero. Catalog reduced-motion checks confirm its example remains static where expected.

Verification:

- `bun --filter @moonwitness/ui-catalog test` — exit 0; 96 passed, including all SceneLab/provenance tests.
- `bunx --cwd apps/ui-catalog playwright test tests/scene-harness.spec.ts tests/asset-review-status.spec.ts` — exit 0; 29 passed (18 asset-review-status cases + 11 SceneLab/scene-harness cases).
- Homepage scene targeted Playwright check — exit 0; 3 passed across Chromium, Firefox and WebKit.

## W9-006 — Operational Board tier (complete — 42/42 across Chromium, Firefox, and WebKit)

The official 42-case cross-browser visual audit (`MW_VISUAL_BROWSER_MATRIX=true bun run test:e2e:visual`) passes **42/42** across Chromium (14/14), Firefox (14/14), and WebKit (14/14). Operational Board light/dark themes, skins, compact density, restrained motion, focus boundaries, and layout stability remain intact with zero immersive runtime leakage into operational tables, forms, or admin data flows.

Root causes resolved to bring the matrix from 33/42 to 42/42:

1. **Visual test server canonical origin (`apps/board/playwright.visual.config.ts`)**: Added `NEXT_PUBLIC_SITE_URL: baseURL` (`http://127.0.0.1:5177`) to the `webServer.env` configuration so `<link rel="canonical">` and OpenGraph image URLs match the visual test server origin across all browser projects.
2. **Firefox 159 WebIDL `[Cached]` `FrozenArray` ARIA element cross-compartment crash (`apps/board/e2e/visual-audit.spec.ts`, `public-home.spec.ts`, `responsive-protected-axe.spec.ts`, `knowledge-explorer.spec.ts`)**: Playwright `1.65.1`'s bundled Firefox `159.0` (`firefox-1572`) populates `Element.prototype.ariaLabelledByElements` in Playwright's isolated Juggler utility compartment during locator evaluation (`getByLabel`, `getByRole`). When `axe-core` subsequently reads `ariaLabelledByElements` (and related reflected ARIA element-reference getters) from the main world, Gecko crashes the content process across compartments. Neutralizing those reflected element-reference getters on `Element.prototype` in the main world before `AxeBuilder.analyze()` keeps `axe-core` on its standard `getAttribute('aria-labelledby')` / ID-reference traversal path and completes every Firefox WCAG 2.1 A/AA scan with zero crashes and zero violations.
3. **Stale pre-Stage-6 Firefox and WebKit dashboard baselines (`apps/board/e2e/visual-audit.spec.ts-snapshots/board-dashboard-{admin,user}-desktop-1440-{firefox,webkit}-win32.png`)**: Commit `f9b87218` refreshed the Chromium dashboard baselines after the Stage 6 masthead and sidebar typography update, leaving the four Firefox/WebKit dashboard snapshot files at the earlier November 24 layout. After visual inspection confirmed pixel-level composition, typography, masthead artwork, and theme parity between Firefox/WebKit actual renders and the approved Chromium baselines, the four Firefox/WebKit snapshot files were aligned.

Verification:

- `bun run board:ui:check` — exit 0; 6 passed (60 UI module imports, 52 imported components, 29 routes, 0 native control violations).
- `bun --filter @moonwitness/board lint` — exit 0.
- `bun --filter @moonwitness/board typecheck` — exit 0.
- `bun --filter @moonwitness/board build` — exit 0; 27 static/dynamic routes built cleanly, no fake `/signals` or `/archive` routes.
- `bun run board:budget` — exit 0; all measured JS/CSS route budgets pass (`homepage` JS 39,343 B gzip / CSS 35,836 B gzip; `board` JS 152,793 B gzip / CSS 37,995 B gzip; `login` JS 63,654 B gzip; `model` JS 183,459 B gzip); interface audio 27,012 B loaded on demand.
- `MW_VISUAL_BROWSER_MATRIX=true bun run test:e2e:visual` — exit 0; **42 passed, 0 failed** (14 Chromium, 14 Firefox, 14 WebKit), 8.2 minutes.
- `MW_VISUAL_BROWSER_MATRIX=true bunx --cwd apps/board playwright test -c playwright.visual.config.ts e2e/public-home.spec.ts` — exit 0; **27 passed, 0 failed** (9 Chromium, 9 Firefox, 9 WebKit), 1.1 minutes.
