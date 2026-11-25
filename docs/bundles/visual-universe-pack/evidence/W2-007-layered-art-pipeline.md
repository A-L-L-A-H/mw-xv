# W2-007 — Transparent Layered-Art Export Pipeline Evidence

- Implemented `packages/assets/scripts/layered-art-pipeline.mjs` exporting `MOON_CITY_LAYERS` and `validateLayeredArtStack`, wired via `pnpm --filter @moonwitness/assets artwork:layers`.
- Audits the separated Moon City parallax/composite stack (`sky`, `moon`, `cloud`, `skyline`, `midground`, `foreground`) across `2048x1152` coordinates, strictly increasing `zIndex` (`0..5`), normalized pivots/focal points, and PNG alpha preservation via `sharp` (`moon-city-moon-layer.png`, `moon-city-skyline-layer.png`).
- Verified in `packages/assets/tests/responsive-and-layered-art.test.mjs` and `pnpm test:assets`.
