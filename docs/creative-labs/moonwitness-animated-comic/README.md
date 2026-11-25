# MoonWitness Animated Comic Lab — EP-LAB-01

> **Status:** `experimental-candidate` (`experimental-candidate-unapproved`)
> **Episode:** **WHEN THE MOON RISES, WE SHARE A MESSAGE** (`EP-LAB-01`)
> **Rendering Pipeline:** Studio 2.5D Motion-Comic (*Spider-Verse* stepped keyframes + Riot Games 2.5D virtual camera choreography + reference-anchored 960×540 punk-manga WebP frames + vector comic overlays + live HTML typography)

---

## 1. Story Synopsis

*Original fictional editorial adaptation for Creative R&D — NOT a recovered historical transcript; contains zero real user identities, testimony, or personal data.*

1. **Moon City Rooftop (`P01`–`P03`, `ANIM-A`):** Under the watching silver halftone crescent moon, courier **Kuro Signal** catches a sudden faint carrier spark on sub-band four. The portable receiver locks three crisp signal bars and two dead dropouts.
2. **Rooftop Sprint (`P04`, `ANIM-B`):** Refusing to lose the fading trace, Kuro coils, vaults the neon alley chasm, streaks through a cyan-magenta chromatic smear dash, skids onto the archive loft roof, and knocks impatiently at the warm studio hatch.
3. **Archive Restraint (`P05`–`P09`, `ANIM-C`):** Zine archivist **Vesper Ink** (framed strictly waist-up behind her lamp-lit workbench honoring her approved portrait canon) inspects the strip beside her cyan CRT monitor. Kuro wants to infer the missing bridge and publish tonight; Vesper calmly raises one steady hand and brass stylus—*a witness records what arrived, not what we wish filled the silence.*
4. **Quiet Preservation (`P10`–`P12`, `ANIM-D`):** Together they clip the incomplete slip inside a kraft archival folio with yellow binder clips and magenta tape, keeping the blank voids intact. The rooftop parabolic dish emits one delicate concentric silver-cyan pulse across Moon City as distant windows answer softly beneath the crescent moon.

**Central dramatic theme:** *A message is worth preserving even when not every part is known.*

---

## 2. How to Run the Local Preview

Serve from the repository root (`z:\repo\mw-xv`) so relative paths to `../../../packages/assets/` resolve cleanly:

```powershell
python -m http.server 4173
```

Open:

```text
http://127.0.0.1:4173/docs/creative-labs/moonwitness-animated-comic/index.html
```

Controls:
- **Play / Pause / Replay** (`Space` / `R`), **Frame Stepping** (`←` / `→`), **Panel Stepping** (`[` / `]`)
- **Normal `1.0x` / Slow `0.45x`** (`S`) for acting timing study
- **Scope Selector:** Full 14.4s episode (`EP-LAB-01`) or single-beat loops (`ANIM-A`, `ANIM-B`, `ANIM-C`, `ANIM-D`)
- **View Modes:** Theater Stage, Static Comic Page (`G`), Reduced-Motion Preview (`M` + automatic `prefers-reduced-motion`), Cast & 2.5D Pipeline Drawer (`I`)
- Starts paused with zero autoplay audio and pauses automatically when hidden (`visibilitychange`).

---

## 3. Studio 2.5D Motion-Comic Pipeline (Why V2 Replaces Raw SVG Primitives)

Informed by *Spider-Verse* stepped framing, Riot Games 2.5D motion comics, and reference-locked sprite-sheet production:
- **Canonical Reference Locking:** Every 2×2 keyframe sheet is generated directly against approved MW-XV masters (`kuro-signal-model-sheet-master.png`, `kuro-signal-fullbody-standing-master.png`, `vesper-ink-portrait-master.png`, `bg-riot-arcade-workbench.webp`, `bg-riot-street-alley.webp`) to eliminate face drift and preserve exact silhouette, palette, goggles, pins, and line weight.
- **Auto-Trimmed Lanczos3 WebP Frames:** `scripts/slice-sheets.mjs` trims divider seams cleanly and exports 32 crisp `960×540` WebP assets (25 key-pose animation frames + 7 macro props & plates, ~2.3 MB total).
- **Hybrid Stepped Acting + 60fps Virtual Camera:** Illustrated key poses step crisply on twos/threes while CSS 2.5D camera push-ins, whip tilts, chromatic cyan/magenta impact hits, diagonal speed-line overlays, and angled picture-in-picture macro insets bring the comic page alive without baking text into artwork.

---

## 4. Directory Index

- `index.html`, `styles.css`, `app.js` — Self-contained 2.5D comic theater & static page viewer
- `data/storyboard.json`, `docs/STORYBOARD.md` — 12-panel storyboard (`P01`–`P12`, `14,400ms`)
- `data/manifest.json` — Experimental lab asset & provenance index
- `animations/anim-a-signal-detected/` — 6 WebP keyframes (`2300ms`) + `clip.json` + `provenance.json`
- `animations/anim-b-courier-move/` — 7 WebP keyframes (`1900ms`) + `clip.json` + `provenance.json`
- `animations/anim-c-archive-reaction/` — 6 WebP keyframes (`4200ms`) + `clip.json` + `provenance.json`
- `animations/anim-d-message-preserved/` — 6 WebP keyframes (`4000ms`) + `clip.json` + `provenance.json`
- `animations/shared-props/` — 7 WebP establishing, macro prop & cover plates + `provenance.json`
- `animations/comic-overlays/` — 3 transparent SVG graphic overlays (`speed-lines-burst.svg`, `ink-wipe-mask.svg`, `halftone-corner-frame.svg`) + `provenance.json`
- `docs/NARRATIVE_SOURCES.md` — Cross-repository narrative citations with exact GitHub commit & blob SHAs
- `docs/CHARACTER_GAP_RESEARCH.md` — 9-column cross-generation character comparison table
- `docs/PROPOSED_CHARACTER_CANDIDATE.md`, `data/proposed-character-candidate.json` — Non-canonical experimental candidate `PCC-SIGNAL-SWITCHBOARD-01`
- `scripts/slice-sheets.mjs`, `scripts/validate-lab.mjs`, `scripts/playwright-verify.mjs` — Slicing, structural/pixel validation & Playwright QA automation
- `evidence/` — 7 Playwright verification screenshots (`01`..`07`) + `VALIDATION_REPORT.md`

---

## 5. Production Adoption Handoff (Human Review Required)

No canonical production files were modified. If approved after owner visual & rights review:
1. Review and approve all 32 WebP candidate frames & 3 SVG overlays before promoting into `packages/assets/animation/` and `packages/assets/manifest.json` + `packages/assets/licenses.json`.
2. Review `vesper-ink` waist-up workbench poses before expanding `allowedVariants` in `packages/assets/source/world/characters/character-registry.json`.
3. Review `PCC-SIGNAL-SWITCHBOARD-01` separately before assigning any canonical `CHR-####` identifier.
4. Port the 2.5D stepped-keyframe + virtual-camera timeline player into `packages/ui` / `apps/ui-catalog` only under an approved visual-universe task.
