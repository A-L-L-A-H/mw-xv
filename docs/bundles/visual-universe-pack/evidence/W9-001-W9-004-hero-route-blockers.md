# W9-001 through W9-004 — Scene and route blockers

Date: 2026-11-23
Source branch: `dev` at `a3fa6da`

## W9-001 — Moon City scene definition

The canonical environment scene and source assets validate, but the scene is not ready for production assembly. The current `crew-01` registry entry remains `status: review`; its face and pilot identity are explicitly pending separate approval. The Magpie-generated Moon City masters and derivatives are recorded as non-distributable because provider/model terms have not been verified. The project charter also requires human approval of the pilot identity and final hero visual. No generic approval message identifies a specific pilot or resolves the asset terms.

Evidence:

- `packages/assets/source/world/characters/character-registry.json` — `crew-01` is back-facing, anonymous, and in review; the registry says faces remain unspecified pending pilot approval.
- `packages/assets/licenses.json` — generated Moon City sources remain unverified/non-distributable.
- `evidence/moon-city-asset-tool-blocker.md` — contact review and unresolved licensing/character gaps.
- `pnpm test:assets` — exit 0; scene and asset references validate, 56 tests pass. This validates structure, not identity or rights acceptance.

W9-001 remains blocked until the pilot identity and asset distribution terms are explicitly resolved. No production character was bound to a real user or crew member.

## W9-002 and W9-003 — Homepage scene and transitions

The current homepage has editorial hero artwork, but it does not satisfy the requested production vertical slice with approved layered scene assets, one approved recurring character, a loopable idle clip, bounded camera/parallax, FX, responsive crops, and a static/reduced-motion fallback. Those tasks depend on W9-001 and remain blocked rather than being credited to the existing static homepage.

## W9-004 — Signals and Archive

`rg --files apps/board/src/app` found no `/signals` or `/archive` production routes. No route, archive record, signal, map, or metric was invented. The task remains blocked on W9-001 and the absent route contract; a catalog specimen can be added only after its scope is approved in the existing catalog.
