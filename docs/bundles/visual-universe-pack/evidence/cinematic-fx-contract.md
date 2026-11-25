# Shared cinematic FX contract

This contract composes the existing shared effects documented in `evidence/fx-reuse-map.md`; it does not create a second general-purpose effect library. W6-003/004/007 add implementation and visual specimens only after their scene-runtime dependencies are ready.

| Effect           | Intensity / duration cap                  | Content and static behavior                                                                                                                           |
| ---------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Impact / cut     | one brief accent, ≤480 ms                 | Existing impact burst or anime slam around the transition edge; no text/control occlusion. Reduced motion shows the destination state immediately.    |
| Slash / ink wipe | one pass, ≤360 ms                         | Existing slash/brush wipe as a decorative overlay that never captures pointer input; no-motion removes the overlay and reveals content synchronously. |
| Frame freeze     | one static frame, ≤120 ms if used         | Pause scene timeline only; do not freeze UI controls, network updates or accessibility announcements. Reduced motion omits the freeze.                |
| Particles        | ≤24 visible particles per effect, ≤900 ms | Use bounded scene-local particles only. Static mode renders none; any information is represented in text/state.                                       |
| Glow             | static or ≤480 ms                         | Use a soft brand token edge on artwork; no pulsing brightness on controls, text, status or warnings. Static glow is acceptable.                       |
| Camera shake     | ≤2 CSS px, ≤120 ms, one impulse           | Scene container only; never shake the document, dialog, focus target or controls. Reduced motion omits it.                                            |
| Ambient texture  | static; no required loop                  | Reuse existing texture layers. No perpetual animation or offscreen work.                                                                              |

All effects are decorative (`aria-hidden`, no focusable children), remain below interface controls, do not delay navigation, and have an immediate static/reduced-motion outcome. Use semantic UI state separately from the visual treatment. Existing CSS tokens and `prefers-reduced-motion` rules are the timing/disablement source; add no animation dependency by default.

## Verification boundary

This is a design contract, not a browser performance test or shipped FX preview. Existing UI component tests verify shared effect semantics and reduced motion. Catalog specimens and bounded particle performance are tracked by W6-003/004/007 after the scene timeline and transition prerequisites are delivered.
