# 10 — MoonWitness Signal Riot Art Direction Bible

> **Scope:** Authoritative visual direction for the **MoonWitness Signal Riot** consumer experience overhaul across [`@moonwitness/ui`](../../../packages/ui/README.md), [`@moonwitness/assets`](../../../packages/assets/README.md), `apps/board`, `apps/desktop`, and `apps/ui-catalog`.
> **Baseline Audits:** Grounded in [02-visual-audit.md](./02-visual-audit.md), [03-component-inventory.md](./03-component-inventory.md), [05-design-system.md](./05-design-system.md), [06-animation-audit.md](./06-animation-audit.md), [09-visual-benchmark.md](./09-visual-benchmark.md), and [`packages/ui/TOKENS.md`](../../../packages/ui/TOKENS.md).

---

## 1. Universe Thesis: "MoonWitness Signal Riot"

**MoonWitness Signal Riot** is an **indie underground zine, kinetic manga, and tactile cartoon workbench** set inside Moon City—a nocturnal, neon-splattered metropolis where signal couriers, archivists, and builders route knowledge and operations beneath a giant halftone moon.

It rejects sterile enterprise SaaS gradients and generic rounded cards in favor of **assembled physical print craft**:
- **Hand-inked linework** (`#0d0d0d` variable-weight contours) paired with **newsprint warmth** (`#f3efe4`) and **charcoal night ink** (`#09090b` / `#0d0d0d`).
- **Four high-impact riot accents** (`#ffe031` signal yellow, `#ff2e88` riot magenta, `#00b8f0` signal cyan, `#c084fc` electric violet) strictly governed by paired dark-ink foregrounds and WCAG AA contrast ratios (`>= 4.5:1`).
- **100% Original IP:** Zero third-party characters, borrowed mascots, franchise silhouettes, or trademarked logos. All characters, emblems, environments, and stickers belong exclusively to the MoonWitness universe (`crown` emblem, `crew-01`, `kuro-signal`, `vesper-ink`).

---

## 2. The Four Cohesive Visual Pillars

Cross-referencing [05-design-system.md](./05-design-system.md) and [09-visual-benchmark.md](./09-visual-benchmark.md), every skin and surface translates one unified universe across four complementary modes:

| Pillar | Skin & Mode Binding | Primary Surface Polarity | Signature Materiality | Primary Consumer Surfaces |
| --- | --- | --- | --- | --- |
| **1. Funky Grunge Light** | `moonwitness-ink` (`light`) | Warm newsprint (`#f3efe4` / `#fff9eb`) + deep ink (`#0d0d0d`) | 7px ink halftone (`rgb(13 13 13 / 13%)`), crisp `2px` ink frames, offset shadows (`3px 3px 0`), yellow/magenta tape notes | Default `/board` light mode, Story Workbench reading view, editorial cards |
| **2. Funky Grunge Dark** | `moonwitness-ink` (`dark`) | Charcoal ink (`#0e0e10` / `#17171a`) + warm cream ink (`#f3efe4`) | Inverted night zine: cream paper-scrap stickers, neon rim highlights, fixed `#0d0d0d` text on `#ffe031` CTAs | Public `/` landing hero, `/login`, `/board` dark mode |
| **3. Riot / High Contrast** | `moonwitness-riot` (`light` / `dark`) + `moonwitness-high-contrast` | Stark `#f5efdf` / `#09090b` with `3px` ink borders & `4px`–`8px` hard shadows | Electric `#ff2e88` / `#ffe031` polarity swap, heavy comic gutters, zero ambiguity between expressive Riot (`moonwitness-riot`) and AAA accessibility (`moonwitness-high-contrast`) | Narrative hubs, Quest/Progression modals, opt-in Riot skin in Settings |
| **4. Cartoon / Comic Experience** | Cross-skin semantic layer (`--mw-comic-*`) | Comic panel surfaces (`#fff9eb` light / `#17171c` dark) + `#ffe031` SFX tags | `ComicPanel`, `MangaFrame`, `SpeechBubble` with SVG tail, `StickerBadge`, `CharacterDisplay`, `QuestCard`, `AchievementBadge`, `RewardPanel` | Onboarding welcome, Empty/Error states, AI HQ companion cues, Studio milestones |

> [!IMPORTANT]
> **Operational Clarity Boundary (from [`packages/ui/README.md`](../../../packages/ui/README.md)):** Expressive tilt (`--mw-comic-sticker-tilt: -2.4deg`), halftone washes, and character reactions frame **entry moments, empty states, milestones, and section headers**. Dense data tables, forms, KPI figures, and multi-line prose remain unrotated, high-contrast, and strictly tabular.

---

## 3. Color Palette & Contrast Governance

### 3.1 Master Palette Tokens

All artwork, UI skins, and character sheets derive from the canonical MoonWitness palette defined in [`packages/ui/TOKENS.md`](../../../packages/ui/TOKENS.md) and [05-design-system.md](./05-design-system.md):

| Token Role | Hex | Usage in Artwork & UI | Paired Readable Foreground |
| --- | --- | --- | --- |
| **Ink Black** | `#0d0d0d` / `#0a0a0c` | Primary linework, hard offset shadows, deep night silhouettes, text on bright accents | `#f3efe4` / `#f5efdf` |
| **Warm Paper** | `#f3efe4` / `#f5efdf` | Newsprint backdrops, torn paper scraps, speech bubble fills (light), moon glow | `#0d0d0d` |
| **Night Charcoal** | `#121216` / `#17171a` | Dark mode raised panels, Kuro's charcoal hoodie base, nocturnal alley shadows | `#f5efdf` |
| **Signal Yellow** | `#ffe031` | Primary CTAs, crown emblem pin, boot soles, SFX burst badges, active highlights | `#0a0a0c` (`15.03:1`) — **readable text on light:** `#6b5500` (`6.84:1`) |
| **Riot Magenta** | `#ff2e88` | Riot primary (dark), hoodie splatter/lining, neon signage, active nav rail | `#0a0a0c` (`5.65:1` — **never white text**) — **readable text on light:** `#a60e4f` (`7.15:1`) |
| **Signal Cyan** | `#00b8f0` | Headset antenna glow, CRT screen wash, skyline rim light, compact primary | `#0a0a0c` (`8.59:1`) — **readable text on light:** `#006e92` (`5.49:1`) |
| **Electric Violet** | `#c084fc` | Vesper's hair streak, twilight sky gradient, secondary quest badges | `#0a0a0c` (`7.49:1`) — **readable text on light:** `#6322cf` (`7.52:1`) |

### 3.2 Hard Color Rules

1. **Never place white (`#ffffff`) or light `--mw-ink-soft` text on `#ff2e88` or `#ffe031`.** Selected Settings cards and primary badges must pair saturated yellow/magenta surfaces with `#0a0a0c` / `--mw-on-accent` (resolving the P0 dark-mode Settings failure in [02-visual-audit.md](./02-visual-audit.md)).
2. **Reserve semantic status tokens (`--mw-error`, `--mw-success`, `--mw-warning`, `--mw-info`) for product state.** Brand `#ff2e88` magenta signals creative energy and active selection—never destructive errors.
3. **Every raster background keeps negative space.** Wide hero/masthead art places high-chroma magenta/cyan energy on the **right** or **perimeter**, preserving deep `#090d1c`–`#0d0d0d` dark ink behind left-aligned HTML typography (aligned with [`environment-kit.json`](../../../packages/assets/source/world/environments/environment-kit.json)).

---

## 4. Linework, Shading & Material Craft

### 4.1 Illustration & Cel-Shading Standards

All new character and scene masters under `packages/assets/source/artwork/riot-universe/` follow one unified rendering recipe so cutouts and scenes sit seamlessly beside existing Moon City masters (`home-hero-master.png`, `board-masthead-master.png`, `story-workbench-masthead-master.png`):

- **Outlines:** Bold, slightly tapered hand-inked `#0d0d0d` contours (`3px`–`5px` equivalent stroke weight at 1024px scale; heavier outer silhouette border for clean cutout separation, crisp thinner interior folds).
- **Shading:** Two-tone **flat cel shading + crisp Ben-Day halftone dot gradients** inside shadow planes. No muddy airbrush gradients or photorealistic 3D skin rendering.
- **Accents:** Sharp rim-light strokes in `#00b8f0` cyan, `#ff2e88` magenta, or `#ffe031` yellow to tie characters into Moon City's neon night palette.
- **Zero Baked Typography:** Master illustrations must contain **zero** embedded text, letters, numbers, comic captions, UI chrome, or watermarks. All speech, badges, and SFX labels are rendered in accessible HTML/SVG via `@moonwitness/ui`.

### 4.2 Frame & Texture Engineering (P0 Mask Fix)

Per [09-visual-benchmark.md](./09-visual-benchmark.md), stretched `--mw-chalk-mask` (`200x100` `preserveAspectRatio="none"`) overlays previously sliced across headers and table cells. Art direction requires:
- **Edge-safe 9-slice or outer border frames** preserving `--mw-torn-safe-inset` (`0.75rem`) around all text and focus rings.
- **Non-occluding textures:** Halftone dot grids (`--mw-comic-halftone-size: 6px`), grain, and tape strips live strictly on `pointer-events: none`, `aria-hidden="true"` layers behind foreground typography.
- **Hard Ink Elevation:** `--mw-shadow-ink` (`4px 4px 0 #0a0a0c` in Riot) and `--mw-shadow-anime-impact` (`4px 4px 0 #0a0a0c, 8px 8px 0 #ff2e88`) replace soft drop shadows.

---

## 5. Typography & Lettering Hierarchy

Aligned with the typography remediation in [05-design-system.md](./05-design-system.md):

| Role | Token | Primary Face | Usage Rules |
| --- | --- | --- | --- |
| **Riot / Grunge Title** | `--mw-font-grunge` | `'MoonWitness Grunge'` | Hero headlines, punk mastheads, zine cover banners |
| **Expressive Brush** | `--mw-font-brush` | `'Road Rage'` | Section ribbons, split-tone callouts, short comic SFX (`2–4` words max) |
| **Display & Metrics** | `--mw-font-display` | `'Anton'` | KPI numerals, compact headers, quest counters, badge stamps |
| **UI & Editorial Body** | `--mw-font-sans` | `'Space Grotesk'` | Controls, tables, speech bubble copy, form labels, prose |
| **Technical Metadata** | `--mw-font-mono` | `'JetBrains Mono'` (`400`, `600`, `700`) | Route IDs, asset IDs, timestamps, coordinates, shortcuts |

---

## 6. Environment & Scene Direction

Complementing the 10-layer parallax kit in [`environment-kit.json`](../../../packages/assets/source/world/environments/environment-kit.json), the **Signal Riot** universe adds two wide 16:9 atmospheric backdrops and three narrative character scenes:

1. **Riot Street Alley (`bg-riot-street-alley-master.png`, 16:9):** Rain-slicked nocturnal back-alley behind Moon City transit arches. Wet asphalt reflects `#ff2e88` magenta and `#00b8f0` cyan neon tubing; wheatpaste zine shapes (abstract geometric silhouettes, zero readable text) peel off brick walls; a massive halftone cream moon hangs in the upper-right night sky. Left third stays dark and low-contrast for overlay copy.
2. **Riot Arcade & Creative Workbench (`bg-riot-arcade-workbench-master.png`, 16:9):** Underground studio/workbench interior lit by `#00b8f0` CRT glow and `#ffe031` desk lamp. Features stacked CRT monitors showing abstract waveforms (no text), tape-patched zine pinboards, soldering gear, cassette decks, and sticker-bombed tool drawers.
3. **Narrative Scene Compositions:**
   - `scene-empty-signal-static-master.png` — Quiet nocturnal rooftop mood for empty/no-signal states (Kuro seated on a crate tuning a portable receiver beneath the halftone moon).
   - `scene-onboarding-welcome-master.png` — Warm inviting studio threshold for onboarding/welcome strips (Kuro & Vesper greeting the user at the Moon City doorway).
   - `scene-quest-victory-master.png` — High-voltage celebration burst for milestone/quest completion (Kuro leaping mid-air with glowing yellow signal crown emblem and comic halftone burst).

---

## 7. Kinetic Motion & Audio Grammar

Grounded in [06-animation-audit.md](./06-animation-audit.md):

- **Stepped Comic Snaps:** Interactive comic surfaces (`ComicPanel`, `StickerBadge`, `SpeechBubble`) use `--mw-motion-comic-pop` (`200ms`), `--mw-motion-comic-wipe` (`280ms`), and `--mw-motion-ease-comic-snap` (`cubic-bezier(0.22, 1.35, 0.36, 1)`), with stepped keyframes (`steps(3, end)`) for impact bursts and idle character micro-frames.
- **No Invisible-on-Mount Traps:** Entrance animations must never leave elements paused at `opacity: 0` before `IntersectionObserver` resolves.
- **Reduced Motion Parity:** Under `prefers-reduced-motion: reduce`, all motion tokens (`--mw-motion-comic-*`, `--mw-motion-draw`, `--mw-motion-spin`) resolve to `0ms`, `LayeredScene` collapses to its static fallback image, `SpritePlayer` pins `staticFrameIndex`, and `SceneParticles` / `ComicSceneTransition` render static legible geometry.
- **Sound Policy:** Short synthesized UI cues (`ui-success.wav`, `ui-signal.wav`, `ui-alert.wav`) fire via `useSfx()` only on meaningful user actions (save, quest complete, dispatch, auth) and remain muted until explicit user unmute via `SoundToggle`.

---

## 8. Master Artwork & Provenance Contract

All 12 master files target `packages/assets/source/artwork/riot-universe/*.png`:
- **Cutout Assets (7 files):** Character sheets, portraits, and full-body poses are generated on a **solid pure `#ffffff` backdrop** (or `#f3efe4`/`#ffffff` clean sheet backdrop for the turnaround) so Wave 3A asset-processing scripts (`sharp` alpha keying) can isolate clean transparent PNG/WebP sprites without color-fringe halos.
- **Full-Bleed Scenes & Environments (5 files):** Generated at native 16:9 / 4:3 framing with **zero embedded text** and registered in [`packages/assets/manifest.json`](../../../packages/assets/manifest.json) and [`packages/assets/licenses.json`](../../../packages/assets/licenses.json) with full provenance before Wave 3B UI wiring.
- **Character Specifications & Prompts:** Defined in [11-character-design-bible.md](./11-character-design-bible.md).
