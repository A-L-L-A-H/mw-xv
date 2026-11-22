# Motion engine boundary decision — pending approval

**Status: recommendation; W5-001 remains in progress because its task explicitly requires human approval.** No dependency was added or removed.

## Inventory

- Board declares `motion@^13.5.0` in `apps/board/package.json`.
- Search of `apps/board/src` and `packages/ui/src` found no imports from `motion`, `framer-motion`, or Motion runtime APIs. Current shared motion is CSS/SVG in `packages/ui`; CSS tokens and reduced-motion rules are tested.
- `@moonwitness/assets` has no runtime dependencies. Sharp/font tooling is development-only.
- Existing catalog bundle budget passes: JavaScript 499,004 B raw / 145,835 B gzip against 524,288 B / 163,840 B; stylesheet 128,222 B / 23,100 B gzip against 131,072 B / 24,576 B.

## Recommendation

For the first Moon City scene, implement ordered static/image/vector layers, bounded CSS parallax, and CSS/SVG transitions using the existing UI package. Keep motion described as a small framework-independent scene contract and use CSS/SVG for rendering. Reevaluate the already-installed Motion package only if measured interaction requirements need timeline orchestration; do not add GSAP, Rive, Live2D, Pixi, Three/WebGL, a paid SDK, or another dependency by default. Keep character animation behind an adapter contract until approved identity art and real clips exist.

## Approval boundary

The task's acceptance includes choosing a boundary for the project. This record recommends the minimal CSS/SVG-first route but does not silently finalize that choice. No engine package changes are made. Any proprietary/paid SDK requires a separate explicit approval and licensing/bundle/performance proof.

## Verification

- `pnpm --filter @moonwitness/board list motion --depth 0` — exit 0; reports `motion@13.5.0`.
- Source search — exit 0; no runtime imports found in Board or UI.
- `pnpm ui:budget` — exit 0; both JavaScript and stylesheet budgets passed.
