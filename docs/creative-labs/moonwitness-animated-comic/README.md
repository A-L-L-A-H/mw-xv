# MoonWitness Animated Comic Creative Lab (`EP-LAB-01`)

> [!IMPORTANT]
> **Experimental Candidate Status Notice (`experimental-candidate-unapproved`)**  
> Everything under `docs/creative-labs/moonwitness-animated-comic/` is a sandboxed creative exploration and candidate storyboard/animation prototype. Nothing in this directory is promoted to canonical production asset status (`packages/assets/manifest.json` or `packages/assets/source/world/characters/character-registry.json`) without explicit human owner review and approval.

---

## 1. Lab Overview

The **MoonWitness Animated Comic Creative Lab** prototypes an original 12-panel animated comic and editorial storyboard episode (**`EP-LAB-01`: "WHEN THE MOON RISES, WE SHARE A MESSAGE"**) built around the approved Signal Riot / Moon City recurring characters **Kuro Signal** (`kuro-signal`, signal courier) and **Vesper Ink** (`vesper-ink`, zine archivist).

Key boundaries enforced in this lab:
- **Original Fictional Editorial Adaptation:** This episode is an original fictional adaptation inspired by MoonWitness II World Rules (`01`–`10`) and the MW-XV bounded `SIGNAL/RADIO` + zine archive domain. It is **not** a recovered historical transcript, does **not** fabricate user identities or metrics, and does **not** depict Allah, prophets, or sacred figures (`CAN-0011`).
- **Live Text Separation:** All dialogue, speaker badges, and panel captions are stored as structured JSON fields and rendered as accessible live HTML text outside the SVG/WebP artwork (`VISUAL_BIBLE.md`).
- **Strict Character Continuity:** Kuro Signal matches the 5.5-head hooded street courier model sheet (`kuro-signal-model-sheet-master.png`), and Vesper Ink is framed strictly waist-up behind her archive workbench (`vesper-ink-portrait-master.png`) or as a distant window silhouette—never an unapproved full-body redesign.
- **Static-First & Reduced-Motion Safe:** The theater preview loads in a paused static state on `P01`, contains zero `<audio>` elements, pauses automatically when the tab is hidden, and provides both a **Reduced-Motion Preview Toggle** and a **Static Comic Storyboard Grid**.

---

## 2. Quick-Start Local Server Command

From the repository root (`z:\repo\mw-xv`), run a local static HTTP server so the browser can fetch `data/storyboard.json`, `animations/*/clip.json`, and relative `../../../packages/assets/*` references cleanly:

```bash
# Option A: Using Node / npx
npx serve . -l 4173

# Option B: Using Python 3
python -m http.server 4173
```

Then open in your browser:

```text
http://localhost:4173/docs/creative-labs/moonwitness-animated-comic/index.html
```

---

## 3. Episode Synopsis — `EP-LAB-01`: "WHEN THE MOON RISES, WE SHARE A MESSAGE"

- **Central Theme:** `END OF AN ERA` · `CAPTURE → CONNECT → WITNESS → UNDERSTAND → PRESERVE → PROMOTE`
- **Core Rule Demonstrated:** *Incomplete evidence remains honestly incomplete.* (`MoonWitness II` World Rules `01`, `02`, `03`)
- **Total Duration:** `14,400 ms` across 12 panels (`P01`–`P12`) and 4 key-pose animation clips (`ANIM-A` through `ANIM-D`).

**Story Sequence:**
1. **Rooftop Watch (`P01`):** Under the silver crescent moon anchoring Moon City's nocturnal skyline, signal courier **Kuro Signal** waits by a high parapet rail with a quiet portable receiver.
2. **Signal Intercept (`P02`–`P03`, `ANIM-A`):** Sub-band four suddenly keys open. A cyan-magenta pulse sparks across Kuro's twin-ring headset antenna. Raising the matte charcoal receiver, Kuro captures three verified carrier bars interrupted by two dead drop-out voids.
3. **Courier Transit (`P04`, `ANIM-B`):** Refusing to lose the live packet to frequency drift, Kuro coils low and vaults across the moonlit rooftop gap, skidding to an impatient rebound stop at the archive loft hatch.
4. **Archive Workbench Handoff & Inspection (`P05`–`P07`, `ANIM-C`):** Inside the warm lamp-lit zine workshop, Kuro slides the receiver and transfer slip across the cutting mat to **Vesper Ink**. Framed waist-up with tinted brass forehead goggles and stylus in hand, Vesper inspects the macro artifact (`fragment-slip-incomplete.svg`): three intact clauses and two unrecovered `[REDACTED / UNKNOWN]` gap slots.
5. **Temptation vs. Restraint (`P08`–`P09`, `ANIM-C`):** Kuro lunges forward, eager to infer the missing bridge from last week's cadence and publish a complete headline immediately. Vesper raises her brass stylus vertically to halt the rush, tapping the blank gap slots: *"A witness records what arrived, Kuro—not what we wish filled the silence. The gap stays marked as unknown."*
6. **Preservation & Quiet Relay (`P10`–`P12`, `ANIM-D`):** Together they align the partial slip inside a MoonWitness archive folio (`archive-folio-sealed.svg`), sealing it with yellow binder clips and magenta gaffer tape while leaving the unknown gap visibly intact. Above the loft, the rooftop antenna emits one quiet, rhythmic concentric radio ring across the dark city before dissolving into the night mist beneath the witnessing moon.

---

## 4. File Index

| Path (relative to `docs/creative-labs/moonwitness-animated-comic/`) | Role | Status |
| --- | --- | --- |
| [`README.md`](file:///z:/repo/mw-xv/docs/creative-labs/moonwitness-animated-comic/README.md) | Lab overview, quick-start commands, synopsis, file index, and production adoption checklist | Experimental lab doc |
| [`index.html`](file:///z:/repo/mw-xv/docs/creative-labs/moonwitness-animated-comic/index.html) | Self-contained 16:9 comic theater stage, static grid view, and provenance inspector | Experimental preview UI |
| [`styles.css`](file:///z:/repo/mw-xv/docs/creative-labs/moonwitness-animated-comic/styles.css) | Punk/grunge zine styling using self-hosted fonts and contrast-verified MoonWitness tokens | Experimental preview UI |
| [`app.js`](file:///z:/repo/mw-xv/docs/creative-labs/moonwitness-animated-comic/app.js) | Deterministic frame/panel player, keyboard shortcuts, reduced-motion handling, progressive preload | Experimental preview UI |
| [`data/manifest.json`](file:///z:/repo/mw-xv/docs/creative-labs/moonwitness-animated-comic/data/manifest.json) | Sandbox index linking storyboard, 4 clips, 6 provenance files, candidate JSON, and approved asset refs | Experimental data contract |
| [`data/storyboard.json`](file:///z:/repo/mw-xv/docs/creative-labs/moonwitness-animated-comic/data/storyboard.json) | Complete 12-panel storyboard data (`P01`–`P12`, `14400ms`, shot scales, comic grammar, live dialogue/captions) | Experimental data contract |
| [`data/proposed-character-candidate.json`](file:///z:/repo/mw-xv/docs/creative-labs/moonwitness-animated-comic/data/proposed-character-candidate.json) | Non-canonical candidate record (`PCC-SIGNAL-SWITCHBOARD-01`, no `CHR-####` ID) | Experimental candidate (`humanReviewRequired: true`) |
| [`docs/NARRATIVE_SOURCES.md`](file:///z:/repo/mw-xv/docs/creative-labs/moonwitness-animated-comic/docs/NARRATIVE_SOURCES.md) | Cross-repository source audit (8 sibling repositories + local MW-XV with exact SHAs & blob hashes) | Experimental research doc |
| [`docs/CHARACTER_GAP_RESEARCH.md`](file:///z:/repo/mw-xv/docs/creative-labs/moonwitness-animated-comic/docs/CHARACTER_GAP_RESEARCH.md) | 9-column comparison table across MW II, MW XII, V10/V10.1, and ROCKSOUL with strict non-merging identity rules | Experimental research doc |
| [`docs/PROPOSED_CHARACTER_CANDIDATE.md`](file:///z:/repo/mw-xv/docs/creative-labs/moonwitness-animated-comic/docs/PROPOSED_CHARACTER_CANDIDATE.md) | Design dossier for `PCC-SIGNAL-SWITCHBOARD-01` (Night Relay Operator / Signal Switchboard Minder) | Experimental proposal doc |
| [`docs/STORYBOARD.md`](file:///z:/repo/mw-xv/docs/creative-labs/moonwitness-animated-comic/docs/STORYBOARD.md) | Human-readable 12-panel director's breakdown, acting notes, camera grammar, and timing ledger | Experimental storyboard doc |
| `animations/anim-a-signal-detected/` | Beat 1 (`ANIM-A`, 6 key-pose SVG frames + `clip.json` + `provenance.json`) | Experimental animation clip |
| `animations/anim-b-courier-move/` | Beat 2 (`ANIM-B`, 7 key-pose SVG frames + `clip.json` + `provenance.json`) | Experimental animation clip |
| `animations/anim-c-archive-reaction/` | Beat 3 (`ANIM-C`, 6 key-pose SVG frames + `clip.json` + `provenance.json`) | Experimental animation clip |
| `animations/anim-d-message-preserved/` | Beat 4 (`ANIM-D`, 6 key-pose SVG frames + `clip.json` + `provenance.json`) | Experimental animation clip |
| `animations/shared-props/` | 3 narrative prop SVGs (`portable-receiver-closeup.svg`, `fragment-slip-incomplete.svg`, `archive-folio-sealed.svg`) + `provenance.json` | Experimental prop assets |
| `animations/comic-overlays/` | 3 transparent manga/zine FX overlays (`speed-lines-burst.svg`, `ink-wipe-mask.svg`, `halftone-corner-frame.svg`) + `provenance.json` | Experimental FX overlays |

---

## 5. Production Adoption Handoff Checklist (Human Review Gate)

Before any file from this creative lab is migrated into the canonical production pipeline (`packages/assets`, `packages/ui`, or `apps/ui-catalog`), a human reviewer must verify and approve each candidate item below:

- [ ] **1. Animation Clips (`animations/anim-a-signal-detected/` .. `animations/anim-d-message-preserved/`):**
  - Review key-pose silhouettes, line weights, and palette compliance against `docs/bundles/visual-universe-pack/VISUAL_BIBLE.md`.
  - Confirm Vesper Ink remains waist-up behind the workbench (or approve a dedicated full-body turnaround sheet first).
  - Upon approval, promote selected SVG frame sequences and `clip.json` descriptors into `packages/assets/animation/` and register their hashes, dimensions, and provenance in `packages/assets/manifest.json` and `packages/assets/licenses.json`.
- [ ] **2. Shared Narrative Props & Comic Overlays (`animations/shared-props/`, `animations/comic-overlays/`):**
  - Review `portable-receiver-closeup.svg`, `fragment-slip-incomplete.svg`, `archive-folio-sealed.svg`, `speed-lines-burst.svg`, `ink-wipe-mask.svg`, and `halftone-corner-frame.svg` for Pack D (Props), Pack G (Anime/Grunge FX), and Pack H (Editorial/Comic Materials) eligibility.
  - Confirm zero baked prose or fake metrics exist inside the vectors.
- [ ] **3. Storyboard & Scene Descriptor (`data/storyboard.json`, `docs/STORYBOARD.md`):**
  - Verify compatibility with the typed `SceneDefinition` and `TimelineTrack` contracts in `docs/bundles/visual-universe-pack/ANIMATION_RUNTIME.md`.
  - Decide whether `EP-LAB-01` enters `apps/ui-catalog` Creative Lab workspaces (`docs/bundles/visual-universe-pack/CREATIVE_LAB.md`) as an official scene fixture.
- [ ] **4. Proposed Character Candidate (`data/proposed-character-candidate.json`, `docs/PROPOSED_CHARACTER_CANDIDATE.md`):**
  - Evaluate `PCC-SIGNAL-SWITCHBOARD-01` (Night Relay Operator / Signal Switchboard Minder) for narrative necessity, visual silhouette distinctiveness, and zero collision with historical `CHR-0001`..`CHR-0019` records.
  - **Only if explicitly approved by the owner:** assign a canonical ID, author an approved master sheet, and register in `packages/assets/source/world/characters/character-registry.json`.
- [ ] **5. Cross-Repository Research Docs (`docs/NARRATIVE_SOURCES.md`, `docs/CHARACTER_GAP_RESEARCH.md`):**
  - Retain as source-qualified crosswalk references alongside `docs/knowledge/idea-archive/`; never flatten generation boundaries or auto-merge unresolved historical aliases.
