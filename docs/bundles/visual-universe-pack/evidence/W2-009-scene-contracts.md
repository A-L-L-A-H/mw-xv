# W2-009 — Scene and animation contracts evidence

- Added `validateSceneBundle` in `packages/assets/scripts/scene-schema.mjs` for scene layers, canonical asset paths, ordering, normalized position/pivot, opacity, bounded parallax, static fallback, scene includes, and clip references.
- Added clip validation for canonical frame paths, duration, loop state, direction, and normalized pivot.
- Nested scene composition is cycle checked. Supported keys are allowlisted; route/permission/business/secret fields and unknown data are rejected.
- Added schema fixtures covering valid scene/clip data, missing asset/clip references, cyclic includes, invalid ordering, unbounded parallax, and rejected extra fields.
- `node --test packages/assets/tests/scene-schema.test.mjs` — exit 0 (3 tests).
- `pnpm docs:links` — exit 0 (566 Markdown files).
- `pnpm test:assets` — exit 0 (38 tests and docs asset check clean).
- Production scene and animation IDs remain unregistered until reviewed assets and pilot identity are available.
