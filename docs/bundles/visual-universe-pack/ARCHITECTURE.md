# Target Architecture and Ownership

## Principle

**One visual universe, one canonical asset inventory, shared presentation contracts, optional scene runtime, domain addons remain clean.**

```text
Visual Bible / Character Bible / Environment Bible
                    |
                    v
        @moonwitness/assets (canonical)
  masters / layers / sprites / scenes / sounds
       manifest + provenance + generators
                    |
           typed asset references
                    |
                    v
          @moonwitness/ui (shared)
 tokens / components / FX / scene viewport / adapters
                    |
         app-level scene orchestration
                    |
                    v
           apps/board (first consumer)
   Home / Signals / Archive / Crew / Stories
                    |
       optional additional consumers after proof

ORM/addons ---- domain data and permissions only
API ---------- HTTP/runtime assembly only
```

## Package responsibilities

### Existing packages to evolve

- `@moonwitness/assets`: canonical media, source masters, generated derivatives, manifest, provenance, licenses, build scripts, contact sheets and QA.
- `@moonwitness/ui`: design tokens, accessible components, anime/grunge UI FX, reusable scene presentation primitives, adapter interfaces and sound behavior.
- `@moonwitness/types`: only stable cross-package contracts that genuinely belong in shared types. Avoid dumping implementation details into it.
- `apps/ui-catalog`: Creative Lab/specimen and preview harness.
- `apps/board`: first end-user scene orchestration and production pilot.

### Optional package extraction

A package such as `@moonwitness/scene-runtime` is **conditional**, not predetermined. Extract only if:

1. The runtime has a stable framework-appropriate public contract.
2. More than one real consumer needs it.
3. It can remain independent of app routes, auth, ORM, API and domain logic.
4. Bundle and maintenance cost are justified.

Otherwise keep runtime orchestration in Board and reusable presentation APIs in `@moonwitness/ui`.

## Prohibited dependency directions

- ORM/addon -> assets/UI/browser runtime: prohibited.
- API -> browser renderer/image editor/animation SDK: prohibited.
- assets -> React/Next/Board: prohibited.
- UI -> API routes, ORM models or business permission: prohibited.
- One ORM addon -> another addon’s static artwork folder: prohibited.

## Domain-to-visual connection

A domain may refer to visual identifiers through app-level presentation maps. It must not store a binary artwork file or become dependent on a specific renderer. If users later upload/manage assets, reuse current attachment/storage ownership and authorization rather than mixing static package art with user content.

## Asset identifier strategy

- Stable machine ID independent of filename.
- Human-readable pack/category/tags.
- Source/master relation and generated variants.
- Character/subject identity and environment/scene relation.
- Dimensions, format, focal point, safe area, alpha/transparency, color profile where relevant.
- Layer ID, order, pivot, anchor and depth when layered.
- Animation clip/frame metadata when animated.
- License/provenance reference.
- Usage intent: decorative, meaningful content, preview-only or internal specimen.

## Data format rules

- Preserve a single canonical `packages/assets/manifest.json` and `licenses.json` unless source audit proves an existing alternative.
- Evolve schemas with explicit versioning and backward-compatible parser/migration tooling.
- Scene descriptors and clip descriptors may be separate source documents, but every referenced asset resolves through canonical manifest IDs.
- No duplicate asset inventories or unlinked manifests.
- Runtime should support stable fallback when an optional asset/clip is unavailable.

## Rendering strategy

1. CSS/SVG/Motion for UI micro-interactions and scene transitions.
2. Layered raster/vector planes for 2.5D environments.
3. Sprite/frame sequences for authored anime motion.
4. Optional rigged character adapter (Rive/Live2D or another approved engine) only after proof of need, licensing review and bundle testing.
5. Canvas/WebGL only when scene density/performance measurement demonstrates a need.

## Asset delivery

Source masters remain in source-controlled source locations or documented external production storage as repo conventions allow. Only optimized runtime derivatives are shipped by default. Build/pack tests verify all exports and consumer paths.
