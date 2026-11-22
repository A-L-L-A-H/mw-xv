# W2-006 — Responsive Image Derivative Pipeline Evidence

- Implemented `packages/assets/scripts/responsive-derivatives.mjs` exporting `RESPONSIVE_DERIVATIVE_PRESETS`, `verifyMasterImmutability`, `planResponsiveDerivatives`, and `verifyResponsiveDerivatives`, wired via `pnpm --filter @moonwitness/assets artwork:derivatives`.
- Enforces non-overwriting master provenance (`kind === 'source'`), normalized focal-safe crop presets, WebP byte budgets (`<= maxBytes`), and rejects unverified AVIF emissions (`allowAvif: false`).
- Verified in `packages/assets/tests/responsive-and-layered-art.test.mjs` and `pnpm test:assets`.
