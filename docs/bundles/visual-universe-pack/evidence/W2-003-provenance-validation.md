# W2-003 — Provenance contract evidence

- Extended `licenses.json` with source provenance for every Moon City source tagged in the canonical manifest.
- Provenance records creator, generation/derivation source, model when reported, generated date, license state, modifications, approval status, and distribution eligibility.
- AI-generated masters and derivatives are explicitly marked `unverified`, `blocked`, and non-distributable; hand-authored project SVGs record ISC and review status.
- Added `validateSourceProvenance` to enforce complete records for tagged source assets, reject duplicates/missing provenance, and prevent unverified rights from being approved or distributed.
- `pnpm test:assets` — exit 0 (32 tests and docs export check).
- Residual issue: provider/model output terms for Magpie `workbuddy-ai/hy-image-3.5` remain unverified; source rasters cannot ship until reviewed.
