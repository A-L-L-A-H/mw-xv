# Validation Report — EP-LAB-01: WHEN THE MOON RISES, WE SHARE A MESSAGE

- **Lab Directory**: `docs/creative-labs/moonwitness-animated-comic/`
- **Episode ID**: `EP-LAB-01`
- **Review Status**: `experimental-candidate` (`experimental-candidate-unapproved`)
- **Verification Date**: `2026-11-25`

---

## 1. Exact Verification Commands & Exit Statuses

| Check | Command | Exit Code | Result |
| --- | --- | --- | --- |
| Structural, SVG, JSON, Provenance & Disk Path Gate | `node docs/creative-labs/moonwitness-animated-comic/scripts/validate-lab.mjs` | `0` | **PASSED (1,254 assertions, 0 failures)** |
| Headless Chromium E2E, Reduced-Motion & Responsive Gate | `node docs/creative-labs/moonwitness-animated-comic/scripts/playwright-verify.mjs` | `0` | **PASSED (44 assertions, 0 console/page/HTTP errors)** |
| Git Whitespace & Conflict Marker Check (Lab Scope) | `git diff --check -- docs/creative-labs/moonwitness-animated-comic` | `0` | **PASSED (0 errors)** |

---

## 2. File, Asset, Frame & Manifest Counts

- **Total Lab Files**: `61` files under `docs/creative-labs/moonwitness-animated-comic/`
- **SVG Assets Validated**: `31` SVGs (`viewBox="0 0 960 540"`, balanced XML tags, 0 `<script>` elements, 0 unescaped `&` entities, 0 baked dialogue sentences inside animation frame SVGs)
  - `animations/anim-a-signal-detected`: `6` unique hand-authored key-pose frames (`frame-01.svg` .. `frame-06.svg`, `2300ms`)
  - `animations/anim-b-courier-move`: `7` unique hand-authored key-pose frames (`frame-01.svg` .. `frame-07.svg`, `1900ms`)
  - `animations/anim-c-archive-reaction`: `6` unique hand-authored key-pose frames (`frame-01.svg` .. `frame-06.svg`, `4200ms`)
  - `animations/anim-d-message-preserved`: `6` unique hand-authored key-pose frames (`frame-01.svg` .. `frame-06.svg`, `4000ms`)
  - `animations/shared-props`: `3` prop SVGs (`portable-receiver-closeup.svg`, `fragment-slip-incomplete.svg`, `archive-folio-sealed.svg`)
  - `animations/comic-overlays`: `3` overlay SVGs (`speed-lines-burst.svg`, `ink-wipe-mask.svg`, `halftone-corner-frame.svg`)
- **Total Animation Frames**: `25` unique key-pose frames across 4 clips (`>= 25` threshold met; consecutive frames verified for distinct path/geometry attributes)
- **Storyboard Panels**: `12` panels (`P01` .. `P12`) in `data/storyboard.json`
  - `totalDurationMs`: `14400` (`sum(timingMs) === 14400`)
  - All 16 required per-panel fields present and non-empty
- **Provenance Manifests**: `6` `provenance.json` files containing `31` provenance records total
  - Every record contains all 9 required fields (`assetId`, `characterId`, `sourceOrReference`, `creatorOrGenerator`, `creationMethod`, `licenseStatus`, `sourceDerivativeRelationship`, `reviewState`, `intendedUsage`)
  - All `31/31` records enforce `reviewState === "experimental-candidate-unapproved"`
- **Non-Canonical Character Candidate**: `data/proposed-character-candidate.json`
  - `candidateId`: `PCC-SIGNAL-SWITCHBOARD-01`
  - `status`: `experimental-noncanonical-proposed` (`0` canonical `CHR-####` IDs assigned)
- **Resolved Disk Paths**: `64` unique relative asset/data references across `index.html`, `styles.css`, `app.js`, `data/manifest.json`, `data/storyboard.json`, and all 4 `clip.json` manifests resolved against disk with `0` missing files.
- **Canonical Production Isolation**: `0` canonical registries (`packages/assets/manifest.json`, `licenses.json`, `character-registry.json`, `docs/tasks/tasks.json`, `docs/bundles/visual-universe-pack/**`, `apps/**`, `packages/ui/**`) modified by the lab workstream.

---

## 3. Playwright Behavioral & Visual Quality Audit

All 7 evidence screenshots were captured via headless Chromium and visually inspected:

1. `evidence/01-stage-anim-a-signal.png` — Desktop `1440x900` Theater Stage showing `P02` (`ANIM-A`, Frame 3/3 whip reaction & antenna spark). Crisp Signal Riot contrast (`#0d0d0d` ink on `#ffe031` yellow and `#ff2e88` magenta badges), live HTML caption/dialogue strip below the 16:9 stage.
2. `evidence/02-stage-anim-b-courier.png` — Desktop `1440x900` Theater Stage showing `P04` (`ANIM-B`, Frame 3/7 apex rooftop vault with diagonal speed lines overlay).
3. `evidence/03-stage-anim-c-vesper.png` — Desktop `1440x900` Theater Stage showing `P06` (`ANIM-C`, Vesper Ink waist-up analytical inspection of the incomplete fragment slip with two magenta dashed gap slots).
4. `evidence/04-stage-anim-d-preserved.png` — Desktop `1440x900` Theater Stage showing `P11` (`ANIM-D`, Frame 2/2 rooftop relay dish emitting one concentric cyan-silver pulse ring over Moon City).
5. `evidence/05-static-storyboard-grid.png` — Full-page Static Comic Storyboard Grid rendering all 12 panels (`P01`..`P12`) simultaneously with static fallback artwork, speaker tags, dialogue boxes, captions, and comic grammar pills while playback is stopped.
6. `evidence/06-reduced-motion-view.png` — Fresh browser context with `emulateMedia({ reducedMotion: 'reduce' })` verifying automatic `Reduced Motion: ON` activation and single-frame static fallback (`Frame 1 / 1`) on `P09`.
7. `evidence/07-mobile-390-preview.png` — Mobile `390x844` viewport on `P03` confirming responsive controls, 3-column filmstrip grid, readable receiver close-up, and zero horizontal overflow (`scrollWidth <= innerWidth`).
