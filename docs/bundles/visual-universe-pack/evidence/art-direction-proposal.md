# Canonical art direction proposal — pending approval

**Status: proposal only.** This does not lock the canonical production art direction. User approval is required before applying the style to production assets or marking W1-001 complete.

## Identity and palette

Keep MoonWitness XV's existing identity and token system as the source of truth. Use the current semantic tokens for ink/black, paper/white, hot magenta, electric blue/cyan and signal yellow; do not introduce a parallel palette or recolor semantic states. Proposed visual emphasis: ink and paper carry most surfaces; magenta and cyan mark editorial/cinematic accents; signal yellow is reserved for high-attention callouts. Validate every token pairing against existing WCAG AA tests.

## Image-making language

Interpret the supplied punk-zine and manga reference DNA through original work: confident black ink contours, restrained cel shading, photocopy grain, halftone, occasional torn-paper edges, and hand-drawn motion accents. Keep grain/edge treatments on decorative layers and below text and controls. Avoid copied franchise silhouettes, costumes, logos, panels, signature poses, or recognizable characters.

## Intensity tiers

- **Product chrome:** clean, stable, high-contrast; no texture behind dense data or forms.
- **Editorial:** light grain and small ink accents around headings or empty states.
- **Cinematic:** layered original urban environment and manga transitions, bounded to immersive story surfaces.
- **Ambient:** low-contrast, slow, sparse atmosphere; static first frame is complete and reduced motion disables movement.

## Moon City scene proposal

A night city skyline under one large moon, with separate original sky, moon, cloud, distant skyline, near skyline, and foreground layers. Parallax would be subtle and bounded. Existing shared UI effects should provide the short transition. No location/map implication, live city signal, metrics, or public-story content should be embedded. Production art, canonical character, and final hero remain separately reviewable gates.

## Exclusions and safeguards

No sacred figures; do not depict Allah. No unlicensed music or copied anime IP. No identifying real crew or users. Keep readable product UI outside the artwork. Preserve static/reduced-motion fallback, keyboard focus, audio off by default and explicit opt-in.

## Current implementation references

`packages/ui/TOKENS.md`, `packages/ui/README.md`, `packages/ui/src/styles/tokens.css`, `packages/ui/src/styles/themes.css`, and `packages/ui/src/components/effects.tsx` were reviewed. Existing UI tests enforce palette contrast and shared motion conventions. This proposal reuses those constraints without adding tokens or runtime dependencies.
