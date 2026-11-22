# W2-008 — Sprite sheet metadata evidence

- Added optional `spriteSheet` schema fields: canonical atlas path, frame dimensions/count, duration, grid, loop flag, playback direction, and normalized pivot.
- Validation enforces integer positive values, frame count within the grid, atlas reference resolution, and atlas pixel bounds.
- Added `renderSpriteSheetGuide` and a generated SVG guide at `evidence/sprite-sheet-metadata-guide.svg`. It visualizes metadata cells only; no artwork frames were cropped or fabricated.
- Focused tests cover accepted metadata, missing atlas, out-of-bounds grids, escaped labels, and guide frame count.
- `pnpm test:assets` — exit 0 (35 tests, docs asset check clean).
- Residual issue: no reviewed character sprite sheet exists, so this contract does not claim a production animation asset.
