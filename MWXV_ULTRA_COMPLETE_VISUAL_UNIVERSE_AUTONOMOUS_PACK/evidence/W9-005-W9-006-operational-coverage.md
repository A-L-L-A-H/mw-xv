# W9-005 and W9-006 — Existing visual coverage and Board gate

Date: 2026-11-24 (final green run)
Source branch: `dev`; commits `d18fa54`, `d1949d6`, `c8ac4d7`, `ad683ff` and following Board gate fixes.

## W9-005 — Crew and Story composition

The only production narrative surface is `/board/stories/workbench`. It uses the decorative, provenance-listed `story-workbench-masthead.webp` and continues to load story state through the existing API client. No production `/crew` route exists, so no fictional crew member or map was added to production UI. The dynamic user model remains API-backed. The catalog's `crew-01` specimen is explicitly marked as a fictional, catalog-only example with no backend record or real crew identity.

Verification (all green):

- `pnpm test:ui-catalog` — exit 0; 41/41 tests pass, including the character specimen, story workbench responsive layout, theme matrix, and Axe checks.
- `pnpm test:e2e:visual:matrix` — exit 0; 42/42 tests pass across Chromium/Firefox/WebKit, including story workbench readability, homepage composition, and the empty/unavailable workbench states.
- `pnpm --filter @moonwitness/board typecheck` — exit 0.

## W9-006 — Operational Board tier

Board boundary, typecheck, lint, UI budget, bundle budget, and the full three-browser visual matrix all pass. Baselines were refreshed to the intentional grunge aesthetic rollout and made deterministic:

- Dashboard KPI baseline is clipped to the stable masthead/tab/KPI-card region; volatile metric values are masked (live counts mutate between runs).
- Catalog documentation artifacts are written by the chromium project only, with a short retry against Windows transient file-write errors.
- The model-navigation sheet Escape check moves focus into the Radix layer before dismissing.
- The ordinary-user fixture login is scoped per browser project and tolerates 409 on re-runs.
- The ordinary-user test allows 90 s for first-run dev-server JIT compilation.

Verification (all green):

- `pnpm board:ui:check` — exit 0; 6/6 boundary tests pass.
- `pnpm --filter @moonwitness/board typecheck` — exit 0.
- `pnpm test:ui-budget` — exit 0; within budget.
- `pnpm board:budget` — exit 0; 27,012 bytes of interface audio.
- `pnpm test:e2e:visual:matrix` — exit 0; **42 passed (8.5m)** — 14 tests × Chromium/Firefox/WebKit, including light/dark theme coverage, responsive protected screens, mobile overlays keyboard dismissal, and Axe accessibility assertions.

## Matrix stabilization history (for reviewers)

| Issue                   | Root cause                                                                                      | Fix                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 16 initial failures     | stale baselines vs intentional grunge rollout + broken API boot (`erp-ledger` camelCase fields) | ORM fields converted to snake_case; baselines regenerated after review |
| Screenshot write errors | three browsers writing identical catalog artifact paths on Windows                              | chromium-only writes via `writeCatalogScreenshot` + retry              |
| 409 on user creation    | shared API server, fixed `visual-user` login across projects                                    | per-project login suffix + 409 tolerance                               |
| WebKit dialog Escape    | focus left on trigger for a tick after keyboard open                                            | focus a link inside the sheet before Escape                            |
| Dashboard KPI flake     | live counters, audit ledger, and model-registry grid mutate                                     | clip to stable region, mask metric values                              |
| Ordinary-user timeout   | cold dev-server JIT compile on first run                                                        | 90 s test timeout                                                      |
