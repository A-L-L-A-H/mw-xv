# W5-011 & W5-012 Scene Runtime Extraction and Optional Rig Engine Decisions

## W5-011 — Runtime package extraction (`done`, no speculative extraction)

Decision: **Keep the scene runtime inside `@moonwitness/ui` (`./components/layered-scene`, `./components/sprite-player`, `./lib/scene-*`, `./lib/character-adapter`) and `@moonwitness/types` (`./character-adapter`, `./scene`).**

Rationale:
- All runtime primitives (`scene-playback`, `scene-camera`, `scene-timeline`, `scene-test-harness`, `character-adapter`) are pure presentation/DOM primitives with zero app route, auth, or domain knowledge.
- Only two consumers (`@moonwitness/ui-catalog` and `@moonwitness/board`) currently consume them, both already depending directly on `@moonwitness/ui` and `@moonwitness/types`.
- `@moonwitness/ui` verified isolated tarball packaging (`verify-package.mjs`), tree-shakeable subpath exports, and bundle-budget compliance (`544,949 B` raw / `159,571 B` gzip JS in UI Catalog with lazy `SceneLab` split).
- Extracting a new `@moonwitness/scene-runtime` workspace package would add build/publish overhead with no additional isolation benefit today. Re-evaluate only if a non-React consumer requires framework-agnostic imperative bundles independently of `@moonwitness/ui`.

## W5-012 — Optional rig engine proof of concept (`skipped`)

Decision: **Explicitly skipped per `W5-012` criteria.**

Rationale:
- The baseline CSS/SVG/2.5D layered scene runtime (`LayeredScene`, `SpritePlayer`, `createSpriteSequenceAdapter`) completely satisfies Moon City idle, breathing, hair drift, cloud drift, parallax, timeline orchestration, and reduced-motion requirements with zero third-party engine dependencies or licensing risk.
- Adding Rive, Live2D, Pixi, Three, or GSAP is unnecessary for the verified visual deliverables and violates the default bundle/license budget without demonstrated unmet visual need.
