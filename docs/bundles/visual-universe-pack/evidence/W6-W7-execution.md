# W6–W7 Execution Evidence

## Completed and verified in this batch

- W6-003 bounded scene particles: `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/fx-lab.spec.ts --workers=1` — exit 0; Playwright 3/3 passed. Covers ≤36 particles, FX catalog intent/anti-patterns and gesture-gated muted soundscape specimen; `node --test packages/ui/tests/scene-components.test.mjs packages/ui/tests/scene-fx-audio.test.mjs` — exit 0, 6/6 passed.
- W6-004 comic transitions: same Playwright command — exit 0; 3/3 passed, including reduced motion content visibility.
- W6-007 FX preview catalogue: same Playwright command — exit 0; 3/3 passed in dark skin with intensity selector and intended-use/anti-pattern copy.
- W7-004 environment/layer inspector: `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/scene-harness.spec.ts --workers=1 --grep "environment inspector resets"` — exit 0; 1/1 passed. Confirms reset and baseline composition.
- W7-007 validator report generation: `pnpm --filter @moonwitness/ui-catalog diagnostics:generate` — exit 0; asset QA reports 231 manifest assets and one scene bundle, all passing. `pnpm assets:validate` — exit 0; 189 self-contained SVGs validated. `pnpm --filter @moonwitness/ui-catalog exec tsc -p tsconfig.json --noEmit` — exit 0. Report is `apps/ui-catalog/generated/asset-diagnostics.json`; browser test for loading/export could not run because the Playwright web server timed out.

## Blockers / incomplete work

- W6-006 is blocked by skipped prerequisite W6-005. No authorized, provenance-complete scene ambience pack is present; existing UI SFX tests do not satisfy the distinct scene ambience deliverable.
- W7-003 is blocked: `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/scene-harness.spec.ts --workers=1 --grep "character studio previews"` timed out after 30 seconds waiting for the Play button. The failure snapshot showed a Pause button while the control was expected to read Play, and the configured browser context uses reduced motion. Follow-up runs then crashed Chromium/its protocol connection. A final retry did not start because Playwright's preview webServer timed out after 30 seconds. A missing asset-package reference in `packages/ui` was removed to keep the UI boundary clean; the application now passes actual imported frames. `pnpm --filter @moonwitness/ui build` passes; do not claim browser acceptance until the character control/preview is verified in a stable browser run.
- W7-005 is blocked by W7-003 and W6-007's downstream acceptance remains subject to dependency policy; timeline scrubber code exists but no focused browser test completed. Its behavior was not promoted to done in this evidence update.
- W7-006 is blocked by W7-005. Responsive layer controls exist and the W7-004 390px test passed, but its required matrix/focal-crop visual verification has not passed.

## Gates and resource failures

- `pnpm --filter @moonwitness/ui build` — exit 0 after keeping UI package presentation-agnostic.
- `pnpm --filter @moonwitness/ui-catalog build:built` — one attempt passed before final source cleanup (validated 231 assets, scene, emitted catalog with 519.85 KB main bundle warning); a later attempt was terminated by native Windows exit 3221226505 during Vite build after 297 modules transformed.
- `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/scene-harness.spec.ts --workers=1 --grep "character studio|environment inspector resets|scene runtime supports"` — failed: Chromium Target crashed and Character Studio timed out; one inspector reset test passed.
- Full catalog grep run executed 30 tests: 22 passed, 8 unrelated existing catalog tests failed due overflow assertions, insufficient memory, or Axe timeout. No full-suite green claim is made.
- Two follow-up focused Playwright runs failed before tests because `config.webServer` did not start within 30 seconds.
- `git diff --check` — exit 0 for changed implementation files.

## Generated diagnostic contents

This is a build-time report from the existing `runAssetQa` and `validateSceneBundle` validators. It is not a live filesystem scan from the browser. It records validator errors and warnings, and export is disabled until the report is explicitly loaded into the panel.

## Follow-up verification on refreshed dev

- Source revalidation: `git pull --ff-only origin dev` — exit 0; latest dev was `327c32b`, which fixed the UI catalog gzip budget and SpritePlayer mobile overflow. Existing dirty ISP/Cloud/Control Plane files were preserved.
- `pnpm --filter @moonwitness/ui-catalog build` — exit 0; 297 modules built, UI package compiled, asset diagnostics validated 231 assets and one scene. Main chunk was 529.34 KB raw / 155.50 KB gzip; no configured gzip budget failure. Vite still reports the non-fatal 500 KB raw chunk advisory.
- `pnpm --filter @moonwitness/ui-catalog exec playwright test tests/fx-lab.spec.ts tests/scene-harness.spec.ts --workers=1` — exit 0; 11/11 passed. Character Studio play/pause/reset passes with reduced motion off; reduced motion defaults to a static frame and playback is opt-in; diagnostics loads/export JSON; timeline scrub reaches 1200ms; Moon City desktop/mobile scene crops use the expected 72%/24% and 52%/20% moon pivots and static fallback is visible.
- Chromium frame measurement for W6-003: 30 active intense particles, 119 requestAnimationFrame intervals, p95 16.7ms, maximum 16.8ms. The test enforces p95 ≤50ms and max ≤150ms. Test output was emitted by the successful Playwright run above.
- Responsive visual artifacts (reviewed and copied into tracked evidence): `W7-006-scene-preview-desktop.png` and `W7-006-scene-preview-mobile.png` in this directory.
- The initial follow-up responsive assertion expected percentages from computed CSS; the browser exposes computed pixel origins. The assertion was corrected to compare pivot ratios to the real layer bounds, then the responsive test passed. No production code change was needed for this adjustment.
