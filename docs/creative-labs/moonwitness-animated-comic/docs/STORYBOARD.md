# 12-Panel Storyboard Breakdown — `EP-LAB-01`: "WHEN THE MOON RISES, WE SHARE A MESSAGE"

**Episode ID:** `EP-LAB-01` · **Status:** `experimental-candidate`  
**Total Duration:** `14,400 ms` across 12 panels (`P01`–`P12`)  
**Machine-Readable Contract:** [`data/storyboard.json`](file:///z:/repo/mw-xv/docs/creative-labs/moonwitness-animated-comic/data/storyboard.json)

> [!NOTE]
> **Editorial & Visual Rules Enforced Across All 12 Panels**  
> 1. **Fictional Editorial Adaptation:** Original fictional adaptation inspired by `bjo163/moonwitness-II` World Rules `01`–`10` and `bjo163/moonwitnessxv` `SIGNAL/RADIO` domain—never presented as a recovered historical transcript or real user conversation.  
> 2. **Live Text Outside Artwork:** All dialogue, speaker tags, and captions live in `data/storyboard.json` and render in the HTML stage below/outside the SVG/WebP canvas (`VISUAL_BIBLE.md`).  
> 3. **Approved Cast Continuity:** On-screen roles are played exclusively by **Kuro Signal** (`kuro-signal`, 5.5 heads, hooded courier) and **Vesper Ink** (`vesper-ink`, 6 heads, framed strictly waist-up behind her workbench in `P05`–`P10` and as a distant window silhouette in `P11`–`P12`).  
> 4. **Deterministic Timing & Reduced Motion:** Every panel defines an exact `timingMs`, `staticFallbackAsset`, and `reducedMotionNote`. The sum of `timingMs` across `P01`..`P12` is **`14,400 ms`**.

---

## 1. Master Timing & Clip-Mapping Ledger

| Panel | Scene ID | Beat ID | Clip Path | Frame Indices | Shot Type | Comic Grammar | Timing (ms) | Static Fallback Asset |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| **P01** | `SCN-ROOF-01` | `null` | `null` | `[]` | `establishing-wide` | `panel-cut`, `deliberate-negative-space`, `halftone` | `1000` | `animations/anim-a-signal-detected/.webp` |
| **P02** | `SCN-ROOF-02` | `ANIM-A` | `animations/anim-a-signal-detected/clip.json` | `[0, 1, 2]` | `medium` | `panel-cut`, `frozen-impact`, `halftone` | `1100` | `animations/anim-a-signal-detected/.webp` |
| **P03** | `SCN-ROOF-03` | `ANIM-A` | `animations/anim-a-signal-detected/clip.json` | `[3, 4, 5]` | `close-up/split receiver+reaction` | `split-panel`, `expressive-typography`, `halftone` | `1200` | `animations/anim-a-signal-detected/.webp` |
| **P04** | `SCN-ROOF-04` | `ANIM-B` | `animations/anim-b-courier-move/clip.json` | `[0, 1, 2, 3, 4, 5, 6]` | `dynamic action wide` | `speed-lines`, `frozen-impact`, `ink-wipe` | `1900` | `animations/anim-b-courier-move/.webp` |
| **P05** | `SCN-ARCH-01` | `ANIM-C` | `animations/anim-c-archive-reaction/clip.json` | `[0, 1]` | `over-the-shoulder` | `panel-cut`, `halftone` | `1000` | `animations/anim-c-archive-reaction/.webp` |
| **P06** | `SCN-ARCH-02` | `ANIM-C` | `animations/anim-c-archive-reaction/clip.json` | `[2]` | `medium-close inspection` | `panel-cut`, `halftone`, `deliberate-negative-space` | `1100` | `animations/anim-c-archive-reaction/.webp` |
| **P07** | `SCN-ARCH-03` | `null` | `null` | `[]` | `split detail/negative space` | `split-panel`, `deliberate-negative-space`, `expressive-typography` | `1000` | `animations/shared-props/.webp` |
| **P08** | `SCN-ARCH-04` | `ANIM-C` | `animations/anim-c-archive-reaction/clip.json` | `[3]` | `character reaction` | `split-panel`, `frozen-impact`, `expressive-typography` | `1000` | `animations/anim-c-archive-reaction/.webp` |
| **P09** | `SCN-ARCH-05` | `ANIM-C` | `animations/anim-c-archive-reaction/clip.json` | `[4, 5]` | `measured restraint` | `panel-cut`, `deliberate-negative-space`, `halftone` | `1100` | `animations/anim-c-archive-reaction/.webp` |
| **P10** | `SCN-ARCH-06` | `ANIM-D` | `animations/anim-d-message-preserved/clip.json` | `[0, 1]` | `two-character composition` | `split-panel`, `halftone`, `ink-wipe` | `1200` | `animations/anim-d-message-preserved/.webp` |
| **P11** | `SCN-CITY-01` | `ANIM-D` | `animations/anim-d-message-preserved/clip.json` | `[2, 3]` | `rooftop relay pulse` | `panel-cut`, `deliberate-negative-space`, `halftone` | `1300` | `animations/anim-d-message-preserved/.webp` |
| **P12** | `SCN-CITY-02` | `ANIM-D` | `animations/anim-d-message-preserved/clip.json` | `[4, 5]` | `final wide shot` | `deliberate-negative-space`, `halftone`, `expressive-typography` | `1500` | `animations/anim-d-message-preserved/.webp` |
| **TOTAL** | — | 4 Animated Beats + 2 Static Holds | — | 25 total clip frames | All 12 required shot scales | All 8 comic grammar primitives | **`14400`** | 100% static fallback coverage |

---

## 2. Panel-by-Panel Director's Breakdown (`P01`–`P12`)

### `P01` · `SCN-ROOF-01` — Rooftop Horizon Watch (`1000 ms`)
- **Shot Scale & Grammar:** `establishing-wide` · `["panel-cut", "deliberate-negative-space", "halftone"]`
- **Backdrop Layers:** 7 canonical Moon City layers (`moon-city-sky.svg`, `moon-city-moon.svg`, `moon-city-clouds-far.svg`, `moon-city-skyline-far.svg`, `moon-city-clouds-near.svg`, `moon-city-skyline-mid.svg`, `moon-city-foreground.svg`)
- **Character Staging & Action:** Viewer-right rooftop rail silhouette; Kuro Signal leans lazily against the iron parapet watching the moonlit horizon while the portable receiver hangs quiet at the hip (`animations/anim-a-signal-detected/.webp`).
- **Live Caption:** `01 · MOON CITY ROOFTOP · ERA THRESHOLD: CAPTURE`
- **Live Dialogue (`NARRATOR`):** *"No carrier wave on the upper band yet—only rooftop wind and iron cables."*
- **Narrative Purpose:** Anchors MoonWitness II World Rule 01: *The Moon is the symbolic anchor of the Witness layer.*

### `P02` · `SCN-ROOF-02` — Sub-Band Four Spark (`1100 ms`)
- **Beat & Frames:** `ANIM-A` (`animations/anim-a-signal-detected/clip.json`, frames `[0, 1, 2]`)
- **Shot Scale & Grammar:** `medium` · `["panel-cut", "frozen-impact", "halftone"]`
- **Character Staging & Acting Intent:** Center-right medium framing. A cyan-magenta radio spark strikes Kuro's left headset antenna; Kuro compresses into a 140ms anticipation dip (`.webp`) and whips upright (`.webp`) with wide eyes and upward-flaring hoodie strings.
- **Expression/Pose Reference:** `../../../packages/assets/illustrations/riot-universe/characters/kuro-signal-expression-curious.webp`
- **Live Caption:** `02 · SIGNAL INTERCEPT · BEAT ANIM-A (FRAMES 01–03)`
- **Live Dialogue (`KURO SIGNAL`):** *"Wait—sub-band four just keyed open! Short pulse, low power!"*
- **Narrative Purpose:** Initiates the `CAPTURE → CONNECT` sequence with an unexpected nocturnal transmission.

### `P03` · `SCN-ROOF-03` — Partial Waveform Lock (`1200 ms`)
- **Beat & Frames:** `ANIM-A` (`animations/anim-a-signal-detected/clip.json`, frames `[3, 4, 5]`)
- **Shot Scale & Grammar:** `close-up/split receiver+reaction` · `["split-panel", "expressive-typography", "halftone"]`
- **Foreground Prop Overlay:** `animations/shared-props/.webp`
- **Character Staging & Acting Intent:** Kuro twists three-quarters on viewer-left, raising the matte charcoal portable receiver to eye level (`.webp`), settling into a focused squint (`.webp` → `.webp`) while the foreground split inset reveals three locked carrier bars and two dead drop-out slots.
- **Expression/Pose Reference:** `../../../packages/assets/illustrations/riot-universe/characters/kuro-signal-pose-holding-objects.webp`
- **Live Caption:** `03 · PARTIAL WAVEFORM LOCK · BEAT ANIM-A (FRAMES 04–06)`
- **Live Dialogue (`KURO SIGNAL`):** *"Three clean carrier bars... and two dead drop-outs. If I wait for a repeat, the drift will swallow it."*
- **Narrative Purpose:** Establishes that the raw evidence arrives incomplete from the moment of capture.

### `P04` · `SCN-ROOF-04` — Rooftop Courier Vault (`1900 ms`)
- **Beat & Frames:** `ANIM-B` (`animations/anim-b-courier-move/clip.json`, frames `[0, 1, 2, 3, 4, 5, 6]`)
- **Shot Scale & Grammar:** `dynamic action wide` · `["speed-lines", "frozen-impact", "ink-wipe"]`
- **Foreground FX Overlay:** `animations/comic-overlays/speed-lines-burst.svg`
- **Character Staging & Acting Intent:** Full left-to-right diagonal parkour transit: deep runner coil (`.webp`), 35-degree launch stretch (`.webp`), mid-air rooftop gap vault (`.webp`), comic smear dash (`.webp`, also static fallback), heel-plant skid (`.webp`), squash landing (`.webp`), and impatient arrival rebound at the archive hatch (`.webp`).
- **Expression/Pose Reference:** `../../../packages/assets/illustrations/riot-universe/characters/kuro-signal-pose-running.webp`
- **Live Caption:** `04 · COURIER TRANSIT · BEAT ANIM-B (FRAMES 01–07)`
- **Live Dialogue (`KURO SIGNAL`):** *"Hold the press, Vesper! Carrying a live fragment straight off the north array!"*
- **Narrative Purpose:** Embodies MoonWitness II *Breath Electric* kinetic energy moving observation from rooftop capture into the archive.

### `P05` · `SCN-ARCH-01` — Archive Workbench Handoff (`1000 ms`)
- **Beat & Frames:** `ANIM-C` (`animations/anim-c-archive-reaction/clip.json`, frames `[0, 1]`)
- **Shot Scale & Grammar:** `over-the-shoulder` · `["panel-cut", "halftone"]`
- **Backdrop Layer:** `../../../packages/assets/illustrations/riot-universe/backgrounds/bg-riot-arcade-workbench.webp`
- **Character Staging & Acting Intent:** Over-the-shoulder framing past Kuro's foreground hooded shoulder onto Vesper Ink framed strictly waist-up behind her warm lamp-lit workbench. Kuro slides the receiver and transfer slip onto the cutting mat (`.webp`); Vesper reaches deliberately with poised brass stylus (`.webp`).
- **Expression/Pose Reference:** `../../../packages/assets/illustrations/riot-universe/characters/vesper-ink-portrait.webp`
- **Live Caption:** `05 · ARCHIVE WORKBENCH HANDOFF · BEAT ANIM-C (FRAMES 01–02)`
- **Live Dialogue (`KURO SIGNAL`):** *"Fresh off the relay! Listen to the cadence—we can patch the missing bars and run the headline tonight!"*
- **Narrative Purpose:** Transitions from kinetic field capture into the Witness Archive workspace.

### `P06` · `SCN-ARCH-02` — Archivist Inspection (`1100 ms`)
- **Beat & Frames:** `ANIM-C` (`animations/anim-c-archive-reaction/clip.json`, frame `[2]`)
- **Shot Scale & Grammar:** `medium-close inspection` · `["panel-cut", "halftone", "deliberate-negative-space"]`
- **Character Staging & Acting Intent:** Waist-up medium-close portrait of Vesper Ink (`.webp`). Her violet-and-cyan forehead goggles catch the CRT glow as her eyes scan across the decoded clauses and pause sharply at the blank gap notches.
- **Expression/Pose Reference:** `../../../packages/assets/source/artwork/riot-universe/vesper-ink-portrait-master.png`
- **Live Caption:** `06 · ARCHIVIST INSPECTION · BEAT ANIM-C (FRAME 03)`
- **Live Dialogue (`VESPER INK`):** *"Carrier header is intact. Timestamp mark is clean. Let's see what actually crossed the wire."*
- **Narrative Purpose:** Models disciplined source inspection before any editorial judgment is made.

### `P07` · `SCN-ARCH-03` — Macro Evidence View: The Incomplete Slip (`1000 ms`)
- **Beat & Frames:** `null` (Static Macro Hold)
- **Shot Scale & Grammar:** `split detail/negative space` · `["split-panel", "deliberate-negative-space", "expressive-typography"]`
- **Backdrop Layer:** `../../../packages/assets/illustrations/riot-universe/backgrounds/bg-halftone-ink-dark.webp`
- **Foreground Prop Asset:** `animations/shared-props/.webp` (also `staticFallbackAsset`)
- **Character Staging & Acting Intent:** No character on screen; stark tabletop close-up surrounded by deep halftone negative space. The zine slip shows three verified cyan/yellow carrier bars and two torn-tape `[REDACTED / UNKNOWN]` void slots held by magenta binder clips.
- **Live Caption:** `07 · INCOMPLETE ARTIFACT · MACRO EVIDENCE VIEW`
- **Live Dialogue (`VESPER INK`):** *"Three verified clauses. Two unrecovered voids in the middle of the line."*
- **Narrative Purpose:** Visualizes MoonWitness II World Rule 03: *Mystery, unknown, and unresolved states are valid parts of the universe.*

### `P08` · `SCN-ARCH-04` — The Temptation to Infer (`1000 ms`)
- **Beat & Frames:** `ANIM-C` (`animations/anim-c-archive-reaction/clip.json`, frame `[3]`)
- **Shot Scale & Grammar:** `character reaction` · `["split-panel", "frozen-impact", "expressive-typography"]`
- **Foreground Expression Callout:** `../../../packages/assets/illustrations/riot-universe/characters/kuro-signal-expression-excited.webp`
- **Character Staging & Acting Intent:** Split-energy two-shot (`.webp`): Kuro lunges eagerly across the workbench corner on viewer-left, paired with the excited portrait callout, while Vesper stays rooted waist-up on viewer-right and raises her brass stylus vertically to halt the rush.
- **Live Caption:** `08 · TEMPTATION TO INFER · BEAT ANIM-C (FRAME 04)`
- **Live Dialogue (`KURO SIGNAL`):** *"We can infer the bridge from last week's frequency! Close the gap and publish the whole story!"*
- **Narrative Purpose:** Dramatizes the central editorial tension between inventing smooth closure and respecting evidence limits.

### `P09` · `SCN-ARCH-05` — Measured Archival Restraint (`1100 ms`)
- **Beat & Frames:** `ANIM-C` (`animations/anim-c-archive-reaction/clip.json`, frames `[4, 5]`)
- **Shot Scale & Grammar:** `measured restraint` · `["panel-cut", "deliberate-negative-space", "halftone"]`
- **Character Staging & Acting Intent:** Vesper lowers the slip back to the blotter and taps the two blank void zones with her brass stylus (`.webp`), then rests her hands framing the incomplete sheet with a yellow binder clip ready (`.webp`) while Kuro settles back in profile to listen.
- **Expression/Pose Reference:** `../../../packages/assets/illustrations/riot-universe/characters/vesper-ink-portrait.webp`
- **Live Caption:** `09 · WITNESS RULE · BEAT ANIM-C (FRAMES 05–06)`
- **Live Dialogue (`VESPER INK`):** *"A witness records what arrived, Kuro—not what we wish filled the silence. The gap stays marked as unknown."*
- **Narrative Purpose:** Enacts MoonWitness II World Rule 02: *A witness records an observation without forcing a final interpretation.*

### `P10` · `SCN-ARCH-06` — Sealed with Gaps Intact (`1200 ms`)
- **Beat & Frames:** `ANIM-D` (`animations/anim-d-message-preserved/clip.json`, frames `[0, 1]`)
- **Shot Scale & Grammar:** `two-character composition` · `["split-panel", "halftone", "ink-wipe"]`
- **Foreground Prop Overlay:** `animations/shared-props/.webp`
- **Character Staging & Acting Intent:** Harmonious two-character workbench staging (`.webp` → `.webp`): Kuro watches calmly from the left as Vesper aligns the partial slip inside a MoonWitness archive folio and seals the corner with two signal-yellow binder clips and hot-magenta gaffer tape, leaving the unknown void notch visibly preserved.
- **Live Caption:** `10 · SEALED WITH GAPS INTACT · BEAT ANIM-D (FRAMES 01–02)`
- **Live Dialogue (`KURO SIGNAL`):** *"Verified bars logged. Unresolved gaps bracketed. Ready for the night relay."*
- **Narrative Purpose:** Completes `PRESERVE → PROMOTE`—carrying forward what deserves to continue without falsifying missing pieces.

### `P11` · `SCN-CITY-01` — Quiet Rooftop Relay Pulse (`1300 ms`)
- **Beat & Frames:** `ANIM-D` (`animations/anim-d-message-preserved/clip.json`, frames `[2, 3]`)
- **Shot Scale & Grammar:** `rooftop relay pulse` · `["panel-cut", "deliberate-negative-space", "halftone"]`
- **Character Staging & Acting Intent:** Exterior nocturnal rooftop cut (`.webp` → `.webp`). The relay box indicator warms amber-cyan and emits one delicate, rhythmic concentric cyan-silver radio ring over distant apartment windows—deliberate restraint rather than an explosive spectacle.
- **Live Caption:** `11 · NIGHT RELAY TRANSMISSION · BEAT ANIM-D (FRAMES 03–04)`
- **Live Dialogue (`VESPER INK`):** *"When the moon rises, we share the message—exact where it holds, open where it breaks."*
- **Narrative Purpose:** Connects the archive workbench back to the nocturnal Moon City witness network.

### `P12` · `SCN-CITY-02` — Final Moon Witness Wide (`1500 ms`)
- **Beat & Frames:** `ANIM-D` (`animations/anim-d-message-preserved/clip.json`, frames `[4, 5]`)
- **Shot Scale & Grammar:** `final wide shot` · `["deliberate-negative-space", "halftone", "expressive-typography"]`
- **Character Staging & Acting Intent:** The faint radio ring dissolves into drifting night mist (`.webp`) as the camera holds on a serene wide Moon City skyline (`.webp`) with generous upper negative space, the silver crescent moon witnessing above, and two tiny shadowed silhouettes seated behind the warm lit archive loft window below.
- **Live Caption:** `12 · WHEN THE MOON WITNESS, WE SHARE A MESSAGE · END OF EP-LAB-01`
- **Live Dialogue (`NARRATOR`):** *"The record is kept. The silence between the bars remains free to speak when its time arrives."*
- **Narrative Purpose:** Closes `EP-LAB-01` on the foundational MoonWitness II anchor: the Moon witnesses, the record endures, and mystery remains valid.
