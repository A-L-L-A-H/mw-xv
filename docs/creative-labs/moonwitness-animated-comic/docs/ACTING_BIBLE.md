# MoonWitness Animated Comic — Acting & Timing Bible

**Scope:** Experimental Creative Lab (`docs/creative-labs/moonwitness-animated-comic/`)  
**Status:** `experimental-candidate`

## 1. Character Acting Contrast Matrix

| Dimension | `kuro-signal` (Signal Courier) | `vesper-ink` (Zine Archivist) |
| --- | --- | --- |
| **Energy Baseline** | Kinetic, bouncy, slightly impatient | Economical, composed, analytical |
| **Framing Cadence** | Animated on **twos** (`110–260ms`) during action; sharp holds | Animated on **threes/fours** (`420–1100ms`); minimal micro-tilts |
| **Line of Action** | Strong 25–35° diagonals, deep crouches, whip overshoots | Vertical grounded spine behind workbench; slight 4–6° head tilts |
| **Secondary Motion** | Spiky bob flare, magenta hood drawstrings, dangling hip strap | Violet/cyan bob lock sway, brass goggle glint, steady stylus poise |
| **Canon Framing Rule** | Full-body + 3/4 + close-up approved (`5.5 heads`) | **Strict waist-up / workbench framing** honoring approved portrait canon (`6 heads`) |

## 2. Stepped Framerate × 60fps Virtual Camera Grammar
- **Character Keyframes:** Step crisply on twos/threes (no floaty CSS tweening of flat cutouts).
- **Virtual Camera Rig:** Smooth 60fps subtle push-ins (`1.00 → 1.06`), whip tilts (`±1.5°`), and pointer parallax (`±8px`).
- **Impact & Smear Beats:** Reserved strictly for high-energy moments (`ANIM-A-F03`, `ANIM-B-F04/05`, `ANIM-C-F04`); never used on calm archival or finale beats (`ANIM-D`).
- **Accessibility:** All camera transforms, chromatic hits, and Canvas FX collapse cleanly to deterministic static fallback poses under `prefers-reduced-motion: reduce`, explicit Reduced Motion toggle, or `navigator.connection.saveData`.
