# Existing UI FX and motion inventory

## Source-backed reuse map

| Group     | Existing exports or CSS                                                                                                         | Use                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| UI micro  | `LoadingProgress`, `LoadingSpinner`, `SignalOrbit`, `LiveIndicator`, `InkUnderline`, `AccentMarker`                             | Loading, API-derived active state, emphasis and status without new domain effects |
| Cinematic | `AnimeImpactBurst`, `AnimeActionLines`, `GrungeStamp`, `GrungeDivider`, `MangaPanel`, `InkFrame`, `ZineSticker`, `SpeechBubble` | Short transitions, action accents, framed callouts and manga panels               |
| Ambient   | `EditorialTexture`, `SpeedLines`, `Doodle`, `DecorativeMotif`, `GrungeCanvas`                                                   | Static page atmosphere and restrained background texture                          |

`packages/ui/src/components/effects.tsx` contains the shared React/SVG effects. `packages/ui/src/styles/components.css` owns their scoped keyframes, including pulse/progress/spin, anime slam/slash/impact/speed sweep/brush wipe, grunge cel shake, ink draw and speech pop. Motion timings live in `tokens.css`. Reduced-motion rules disable or remove nonessential effects; visibility-aware hooks pause offscreen animation. Audio cues are separate in `components/audio.tsx` and `lib/audio-runtime.ts`, default muted, and require user activation.

## Gaps / reuse constraints

- No production Moon City scene layers, character sheet, character idle clip or scene-specific FX are registered in `packages/assets`.
- Do not add duplicate general-purpose manga effects. Build a scene transition by composing the existing shared burst/slash/wipe primitives after the approved visual contract.
- Keep ambient motion subtle, bounded and optional. Preserve reduced-motion and audio-consent behavior.
- Art and audio source files in `raw_arts/` are not treated as reviewed, licensed, provenance-registered package assets by this inventory.

## Verification

- `pnpm test:ui` — exit 0 (59 tests; package consumer/export verification passed).
- Existing task W1-007 confirms the reduced-motion/accessibility policy is already implemented and verified.
