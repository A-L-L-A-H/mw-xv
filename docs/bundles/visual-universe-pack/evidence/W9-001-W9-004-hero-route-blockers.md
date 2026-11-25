# W9-001 through W9-004 — Moon City production slice and route gap

Date: 2026-11-25 (Asia/Jakarta)

## W9-001 — Moon City scene definition and approval

Project-owner approval is recorded in `docs/decisions/moon-city-production-approval.md`. It selects the anonymous fictional `crew-01` as pilot and approves the existing authored idle clip and desktop/mobile homepage artwork for production distribution, subject to their already recorded provenance and applicable source terms. No real person or user identity is attached. The approval does not claim an independent legal review.

The homepage consumes `packages/assets/scenes/moon-city-scene.json` as its canonical layer, breakpoint and clip definition. Desktop/mobile responsive rules resolve against the manifest. Art contains no product copy or metrics. The registry labels crew-01 as the anonymous example.

Verification:

- `bun --filter @moonwitness/assets qa` — exit 0; 401 runtime assets, 54 source masters, 0 errors, 0 warnings.
- `node --test packages/assets/tests/moon-city-scene.test.mjs packages/assets/tests/character-registry.test.mjs` — exit 0; 8 passed.
- `docs/decisions/moon-city-production-approval.md` — recorded project-owner approval and boundaries.

## W9-002 — Homepage hero vertical slice

`apps/board/src/components/home/home-hero-art.tsx` renders the canonical scene layers and responsive variants with the four-frame `crew-01-idle` loop, keeping real HTML headline, navigation, copy and calls to action in the page. Desktop/mobile static artwork remains the fallback; reduced-motion uses a static frame. React Strict Mode lifecycle replay is handled without disposing the active playback controller, and the fallback only activates when the actual selected image cannot load.

Verification:

- `bun --filter @moonwitness/board typecheck` — exit 0.
- `bun --filter @moonwitness/board build` — exit 0.
- `bunx --cwd apps/board playwright test e2e/visual-audit.spec.ts --config playwright.visual.reuse.config.mjs --grep "homepage spelling"` — exit 0; 3 passed in Chromium, Firefox and WebKit.
- Updated deterministic approved-reference snapshots: `apps/board/e2e/visual-audit.spec.ts-snapshots/home-mobile-390-chromium-win32.png` and `home-reference-1672-chromium-win32.png`.

## W9-003 — Cinematic scroll transitions

Editorial reveals are progressive enhancement, do not intercept scrolling, and retain direct document order and visibility when reduced motion is requested. Native scrolling and reduced-motion/static scene fallback were checked in the three-browser homepage test above.

## W9-004 — Signals and Archive

Production route inventory and the Next build contain neither `/signals` nor `/archive`. No fake route, record, metric, signal, map or feed was introduced. Two explicitly labeled catalog-only visual specimens explain the route/data-contract gap and contain no navigable links or live records.

Verification:

- `bun --filter @moonwitness/ui-catalog test` — exit 0; 96 passed.
- `bunx --cwd apps/ui-catalog playwright test tests/scene-harness.spec.ts --config playwright.config.ts` — exit 0; 11 passed, including route-gap safeguards.

## W9-005 — Crew and Story boundary

Story remains backed by the existing API state. Fictional crew-01 is visibly an example in the catalog and only appears as approved decorative pilot illustration in the homepage; no crew metrics, maps, or fictional user records were added. The UI catalog verifies the specimen under reduced motion.

Verification:

- `bun --filter @moonwitness/ui-catalog test` — exit 0; 96 passed.
- `bunx --cwd apps/ui-catalog playwright test tests/scene-harness.spec.ts --config playwright.config.ts` — exit 0; 11 passed.
