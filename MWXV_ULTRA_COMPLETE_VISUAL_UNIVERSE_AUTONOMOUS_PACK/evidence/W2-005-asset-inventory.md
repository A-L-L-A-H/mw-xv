# W2-005 — Asset inventory query evidence

- Added `queryAssetInventory` against the canonical manifest with filters for pack, category/kind, subject, domain, format, and status.
- Results distinguish source-only assets from runtime assets and mark any source with blocked or unverified provenance as blocked.
- Added `auditAssetInventory` for unlisted files, missing files, and broken canonical source/variant references.
- Added package command `pnpm --filter @moonwitness/assets inventory [--pack=...]`.
- `pnpm test:assets` — exit 0 (34 tests and docs export check).
- `pnpm --filter @moonwitness/assets inventory --pack=moon-city` — exit 0; returned 7 Moon City sources, all generated rasters classified blocked, and no orphan/missing/broken references.
