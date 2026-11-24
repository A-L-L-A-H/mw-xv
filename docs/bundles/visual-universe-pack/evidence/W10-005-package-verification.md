# W10-005 — Package build and consumer contracts

Date: 2026-11-23
Verified source: `dev` at `a3fa6da` (pushed)

## Verification

- `pnpm build` — exit 0; all workspace packages, API, desktop, Board, and UI Catalog built. Board route manifest includes only registered production routes.
- `pnpm test:assets` — exit 0; asset inventory, provenance, package tarball, export targets, scene schema, and audio budget pass (56 tests).
- `pnpm test:ui` — exit 0; 71/71 tests pass, including public subpath, packed-consumer, private-path rejection, theme/contrast, and scene runtime contracts.
- `pnpm test:ui-catalog` — exit 0; 41/41 tests pass, including responsive/accessibility and scene/FX catalog coverage.
- `pnpm --filter @moonwitness/api typecheck` — exit 1 because no `typecheck` script is declared; equivalent `pnpm --filter @moonwitness/api build` runs `tsc` and passes (exit 0).
- `pnpm --filter @moonwitness/desktop typecheck` — exit 0.
- `pnpm --filter @moonwitness/orm-sales test` — exit 0; 2/2 tests pass.
- `pnpm --filter @moonwitness/orm-subscription test` — exit 0; 2/2 tests pass.
- `pnpm --filter @moonwitness/desktop test` — exit 0; 31/31 tests pass.
- `pnpm --filter @moonwitness/api exec vitest run tests/commercial-addons.routes.test.ts` — exit 0; 2/2 tests pass.
- `pnpm test:ui-budget` — exit 0; UI Catalog JavaScript and stylesheet remain within declared raw/gzip limits.
- `pnpm board:budget` — exit 0; route JavaScript/CSS and 27,012 bytes of interface audio pass.
- `pnpm board:ui:check` — exit 0; 6/6 boundary tests pass.

The audio-budget checker now selects only manifest entries with `kind: sound` and `variant: ui`. Scene ambience is intentionally excluded from the interface cue budget and remains governed by the asset/audio budgets. No visual runtime dependency was added; ORM/API packages remain presentation-agnostic.

The UI Catalog build reports a 529.35 kB raw main JavaScript chunk (155.51 kB gzip); `pnpm test:ui-budget` confirms both sizes stay below the existing 560,000 / 165,000 byte limits. The Vite chunk warning remains visible and should be revisited before increasing catalog scope.
