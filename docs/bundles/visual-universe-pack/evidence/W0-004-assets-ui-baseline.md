# W0-004 — Asset and UI baseline

Manifest source: `packages/assets/manifest.json` (schema version 1, 179 entries). Kinds: app-icon 2, artwork 9, favicon 1, font 7, illustration 14, lockup 4, material 17, ornament 11, pattern 5, readme-banner 1, social-card 2, sound 3, source 7, symbol 4, wordmark 4. License provenance is in the single `packages/assets/licenses.json` (schema version 1; 4 font records, 9 artwork records, 3 sound records and 1 brand-assets record). Generator ownership is documented in `packages/assets/README.md`; one canonical manifest and license file remain in use.

Package exports currently expose brand, fonts, font CSS, icons, illustrations, materials, sounds, `manifest.json` and `licenses.json`. `packages/ui` owns tokens, typed icon wrappers and shared controls/effects. Current Board package depends on Motion and consumes assets/UI; `apps/docs` and the existing `apps/ui-catalog` are the other visual consumers. Current dirty `packages/ui/package.json` also contains component subpaths for controls already in this worktree; the change is preserved and not treated as a clean-HEAD capability claim.

The checked-in UI Bible describes the existing brand/grunge/anime motion language. Current generated asset totals and source paths were read directly; no source asset or license manifest was changed.

Verification:

- `pnpm assets:validate` — exit 0 (`Validated 151 self-contained SVG assets`).
- `pnpm test:ui` — initially exit 1: 58/59 tests passed because `packages/ui/tests/tokens.test.mjs` expected `>=20` while the pre-existing dirty manifest declares `>=24`. The assertion was aligned with the repository's Node 24 CI floor and the existing manifest was preserved; rerun exit 0, 59/59 tests passed, packed-consumer checks passed.
- UI Catalog build produced JS 499.00 kB raw / 147.09 kB gzip and CSS 128.22 kB raw / 23.15 kB gzip. These are audit measurements only; budget verification is a separate task.
- Existing untracked `raw_arts/` contains 363 files including generated originals and derivatives. It has no reviewed task-linked provenance record as a whole; none is admitted to the canonical asset package by this audit.
