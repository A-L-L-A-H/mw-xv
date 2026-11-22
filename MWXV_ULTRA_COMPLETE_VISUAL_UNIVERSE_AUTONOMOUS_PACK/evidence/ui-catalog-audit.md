# UI Catalog architecture audit

## Existing consumer and harness

There is one established specimen app at `apps/ui-catalog`, with a single `src/catalog.tsx` surface, shared styles, and Playwright screenshot coverage in `tests/catalog.spec.ts`. It already covers shared components, themes, responsive viewports, editorial treatments, data states, audio consent controls, Motion reduced-motion behavior and effect specimens. `playwright.config.ts` configures reduced motion for deterministic default screenshots; selected tests explicitly switch to `no-preference` when checking animation.

Build/test commands are `pnpm test:ui-catalog` (build plus Playwright) and `pnpm test:ui-budget`/`pnpm ui:budget` (catalog bundle budget). The app uses the existing `@moonwitness/ui` and `@moonwitness/assets` packages. Do not create a second catalog or asset inventory.

## Integration plan

Add any future visual-universe art/scene specimens as sections in the existing catalog, grouped by approved assets and experience tier. Reuse current state, theme, viewport, reduced-motion and screenshot controls. Keep fixture copy explicitly labeled as design examples and prevent fixture data from leaking into production.

## Verification

- `pnpm test:ui-catalog` — exit 0 during W0 baseline (25 browser tests passed).
- Existing browser harness and bundle budget were inspected. No catalog files changed in this audit.
