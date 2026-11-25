# Validation Report — EP-LAB-01: WHEN THE MOON RISES, WE SHARE A MESSAGE (Studio 2.5D V2)

- **Lab Directory**: `docs/creative-labs/moonwitness-animated-comic/`
- **Episode ID**: `EP-LAB-01`
- **Review Status**: `experimental-candidate` (`experimental-candidate-unapproved`)
- **Pipeline**: Studio 2.5D Motion-Comic (reference-anchored 960×540 WebP keyframes + 60fps virtual camera choreography + stepped acting + vector comic overlays)
- **Verification Date**: `2026-11-25`

---

## 1. Exact Verification Commands & Exit Statuses

| Check | Command | Exit Code | Result |
| --- | --- | --- | --- |
| Structural, WebP Dimensions/Pixel-Diff, SVG XML, Provenance & Disk Path Gate | `node docs/creative-labs/moonwitness-animated-comic/scripts/validate-lab.mjs` | `0` | **PASSED (866 assertions, 0 failures)** |
| Headless Chromium E2E, Reduced-Motion & Responsive Gate | `node docs/creative-labs/moonwitness-animated-comic/scripts/playwright-verify.mjs` | `0` | **PASSED (37 assertions, 0 console/page/HTTP errors)** |
| Git Whitespace & Conflict Marker Check (Lab Scope) | `git diff --check -- docs/creative-labs/moonwitness-animated-comic` | `0` | **PASSED (0 errors)** |

---

## 2. File, Asset, Frame & Manifest Counts

- **Studio WebP Assets Validated**: `32` crisp `960×540` WebP assets (~2.3 MB total) anchored directly to approved canonical MW-XV masters (`kuro-signal-model-sheet-master.png`, `kuro-signal-fullbody-standing-master.png`, `vesper-ink-portrait-master.png`, `bg-riot-arcade-workbench.webp`, `bg-riot-street-alley.webp`):
  - `animations/anim-a-signal-detected`: `6` unique keyframes (`frame-01.webp`..`frame-06.webp`, `2300ms`)
  - `animations/anim-b-courier-move`: `7` unique keyframes (`frame-01.webp`..`frame-07.webp`, `1900ms`, left-to-right momentum continuity preserved)
  - `animations/anim-c-archive-reaction`: `6` unique keyframes (`frame-01.webp`..`frame-06.webp`, `4200ms`, strict waist-up Vesper Ink workbench continuity)
  - `animations/anim-d-message-preserved`: `6` unique keyframes (`frame-01.webp`..`frame-06.webp`, `4000ms`, subtle quiet concentric relay pulse)
  - `animations/shared-props`: `7` establishing, macro prop & cover plates (`p01-moon-city-establishing.webp`, `portable-receiver-closeup.webp`, `archive-loft-exterior.webp`, `fragment-slip-incomplete.webp`, `archive-folio-sealed.webp`, `episode-cover-keyart.webp`, `workbench-atmosphere.webp`)
- **Vector Comic Overlays Validated**: `3` transparent XML-valid SVGs (`speed-lines-burst.svg`, `ink-wipe-mask.svg`, `halftone-corner-frame.svg`)
- **Pixel-Level Frame Uniqueness**: Minimum consecutive frame Mean Absolute Difference (`minConsecutiveFrameMAD`) across all 25 keyframes = `16.23` (`>= 4.0` threshold, proving genuine distinct key-pose artwork with zero duplicate/translate clones)
- **Storyboard Panels**: `12` panels (`P01`..`P12`, `totalDurationMs === 14400`, all 16 required fields present)
- **Provenance Sidecars**: `6` `provenance.json` files covering `35` records (`32` WebPs + `3` SVGs), every entry carrying all 9 required fields and `reviewState === "experimental-candidate-unapproved"`
- **Non-Canonical Candidate**: `PCC-SIGNAL-SWITCHBOARD-01` (`experimental-noncanonical-proposed`, `0` canonical `CHR-####` IDs assigned)
- **Resolved Relative Paths**: `110` unique references across HTML/JSON manifests resolved against disk with `0` missing files.

---

## 3. Playwright Behavioral & Visual Quality Audit

All 7 Studio V2 screenshots were captured via headless Chromium and visually inspected:

1. `evidence/01-stage-anim-a-signal.png` — Desktop `1440×900` Theater Stage showing `P03` (`ANIM-A` Frame 3/3) with Kuro Signal under the crescent moon, angled `RECEIVER MACRO` picture-in-picture inset card, live speech bubble, acting note, and single-row transport bar all above the fold.
2. `evidence/02-stage-anim-b-courier.png` — Desktop `1440×900` Theater Stage showing `P04` (`ANIM-B` Frame 3/7) mid-air rooftop vault over neon alleys with transparent speed-line overlay.
3. `evidence/03-stage-anim-c-vesper.png` — Desktop `1440×900` Theater Stage showing `P08` (`ANIM-C` Frame 4) asymmetric two-shot contrasting Kuro's eager persuasion against Vesper's calm raised palm and brass stylus.
4. `evidence/04-stage-anim-d-preserved.png` — Desktop `1440×900` Theater Stage showing `P11` (`ANIM-D` Frame 4) parabolic rooftop dish radiating a quiet silver-cyan signal ripple toward answering apartment windows.
5. `evidence/05-static-storyboard-grid.png` — Full-page Static Comic Page layout displaying all 12 studio-illustrated panels (`P01`..`P12`) with printed speech bubbles, captions, and comic grammar tags while animation is stopped.
6. `evidence/06-reduced-motion-view.png` — Fresh context with `emulateMedia({ reducedMotion: 'reduce' })` verifying automatic `Reduced Motion: ON`, zero camera transforms/FX, and static `P10` two-shot with `ARCHIVAL FOLIO` macro inset.
7. `evidence/07-mobile-390-preview.png` — Mobile `390×844` responsive preview on `P03` confirming sharp opaque PiP inset, readable captions, and zero horizontal overflow (`scrollWidth <= innerWidth`).
