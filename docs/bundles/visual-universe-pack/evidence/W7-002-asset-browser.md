# W7-002 — Asset browser specimen evidence

- Added a keyboard-accessible catalog specimen that fetches the canonical manifest and license manifest as static build assets; the large JSON files are not inlined into the JavaScript bundle.
- Filters use only tags present in the manifest: category, pack, subject, domain, variant, and status. Search covers canonical paths and tags; empty-tag fields explain that no values are registered.
- Cards show stable paths, type/variant/dimensions, selected approved-package previews, source/runtime status, and rights-blocked provenance. No production domain records are fabricated.
- Responsive styles use the catalog token system; loading and fetch-error states are exposed to assistive technology.
- `pnpm --filter @moonwitness/ui-catalog build` — exit 0.
- `pnpm ui:budget` — exit 0; JavaScript 502,884/524,288 raw bytes and 146,991/163,840 gzip bytes; stylesheet 130,304/131,072 raw bytes and 23,431/24,576 gzip bytes.
- `pnpm test:ui-catalog` — completed; JUnit `test-results/junit/ui-catalog.xml` records 26 tests, 0 failures, 0 errors, including the new asset-browser case.
- Residual issue: Vite reports a single JavaScript chunk above its 500 kB warning threshold, although the reviewed total raw/gzip budgets pass. Catalog already contains the shared visual component set; future work can code-split the browser if the threshold is tightened.
