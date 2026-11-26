# MoonWitness design tokens

The reusable token package owns the palette, semantic light/dark mapping, typography, layout scales, motion policy, and contrast contract. Read the [published token guide](../../packages/ui/TOKENS.md) and [package instructions](../../packages/ui/README.md).

The Board imports `@moonwitness/ui/styles/tokens.css`; its Tailwind theme maps those values without redefining the palette. CI calculates semantic text and control contrast from the actual token source, including the light and dark mappings.

Active runtime typography is self-hosted through [the asset font stylesheet](../../packages/assets/fonts.css) and tracked in [asset license provenance](../../packages/assets/licenses.json) (`Anton`, `Road Rage`, `MoonWitness Grunge`, `Space Grotesk`, and `JetBrains Mono`). Unverified exploratory `.woff2` binaries formerly in `raw_arts/fonts/` were retired from Git and are never distributed in `packages/assets/`.
