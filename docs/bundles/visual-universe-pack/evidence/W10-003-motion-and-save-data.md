# W10-003 — Reduced motion and Save-Data scene mode

Date: 2026-11-25 (Asia/Jakarta)

`HomeHeroArt` starts in static mode during SSR and the first hydration render, then respects `prefers-reduced-motion`. When the browser exposes `navigator.connection.saveData === true`, the hero keeps its static Moon City artwork, pilot, copy, and links visible while omitting the layered parallax scene and stopping sprite playback. The scene runtime is dynamically imported only when motion is permitted. Unknown low-power/network capability is not guessed and no user preference is overridden.

Verification:

- `bun --filter @moonwitness/board build` — exit 0; production routes generated, no Signals/Archive routes.
- `$env:MW_VISUAL_BROWSER_MATRIX='true'; bunx --cwd apps/board playwright test e2e/public-home.spec.ts --config playwright.visual.config.ts --grep 'homepage spelling|Save-Data'` — exit 0; Save-Data scenario passed Chromium, Firefox and WebKit (3/3). The homepage spelling/responsive case is covered separately by the official visual audit.
- `bunx --cwd apps/board playwright test e2e/public-home.spec.ts --config playwright.visual.config.ts --grep 'Save-Data'` — exit 0; focused Chromium retry, 1/1.

The capability is opt-in and browser-dependent; engines without the Network Information API continue to use the user's motion preference and normal animated mode.
