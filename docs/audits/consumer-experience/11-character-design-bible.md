# 11 — MoonWitness Character Design Bible

> **Scope:** Canonical character sheets, visual identity rules, depiction policies, `character-registry.json` extensions, and master asset specifications for the **MoonWitness Signal Riot** universe.
> **Companion Document:** [10-art-direction-bible.md](./10-art-direction-bible.md)
> **Existing Registry:** [`packages/assets/source/world/characters/character-registry.json`](../../../packages/assets/source/world/characters/character-registry.json) | **Schema Validator:** [`packages/assets/scripts/character-registry-schema.mjs`](../../../packages/assets/scripts/character-registry-schema.mjs)

---

## 1. Cast Roster & Depiction Policies

MoonWitness separates **anonymous ambient crew silhouettes** (`crew-01`, preserved intact) from **named expressive Signal Riot guides** (`kuro-signal` and `vesper-ink`) introduced for consumer onboarding, empty/error reactions, workbench companionship, and progression rewards.

| `characterId` | Display Name | Role                                | `depictionPolicy`       | Primary Visual Niche                                                                     | Registry Status       |
| ------------- | ------------ | ----------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- | --------------------- |
| `crew-01`     | Crew-01      | `crew-member`                       | `anonymous-back-facing` | Ambient parallax rooftops, SceneLab walk/idle/turn/hair sprite loops                     | Preserved (`review`)  |
| `kuro-signal` | **Kuro**     | `signal-courier` (Primary Mascot)   | `identified-approved`   | Onboarding welcome, empty states, quest/achievement celebration, AI/Ops reaction bubbles | New (`riot-universe`) |
| `vesper-ink`  | **Vesper**   | `zine-archivist` (Supporting Guide) | `identified-approved`   | Knowledge archive, Story Workbench hints, Studio creation & synth tooling                | New (`riot-universe`) |

> [!NOTE]
> All characters are 100% original MoonWitness creations. No character likeness references any external anime, game franchise, or real individual.

---

## 2. Primary Mascot: `kuro-signal` ("Kuro")

### 2.1 Character Identity & Silhouette

- **Title:** Moon City Signal Courier
- **Archetype:** High-energy street-zine courier & signal runner who hops Moon City rooftops delivering dispatches, checking dead frequencies, and cheering completed quests.
- **Silhouette & Proportions:** Stylized anime/cartoon teen-young-adult proportions (`~5.5` heads tall) with an unmistakable **wide oversized hoodie hood**, **twin-tipped cyan/magenta headset antenna**, and **chunky oversized yellow-soled street boots** that anchor dynamic leaning stances.
- **Linework & Rendering:** Bold `#0d0d0d` hand-inked contours (`4px` outer silhouette, `2px` interior fold lines), flat cel shading with coarse comic halftone dot shadows, and crisp `#00b8f0` / `#ff2e88` rim highlights.

### 2.2 Costume & Color Specification

| Zone                  | Material & Detail                                                                                                                                                                                                                            | Palette Tokens                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Hair & Eyes**       | Tousled ink-black (`#0d0d0d`) spiky-layered bob framing expressive oversized manga eyes with `#ffe031` / `#00b8f0` specular catchlights; crisp ink brows.                                                                                    | `#0d0d0d`, `#f3efe4`, `#00b8f0`, `#ffe031` |
| **Hoodie**            | Oversized charcoal (`#17171a`) cropped-hem street hoodie with `#ff2e88` riot-magenta inner hood lining, painterly magenta ink splatters across sleeves/hem, and an iconic **3-spike yellow crown enamel pin** (`#ffe031`) on the left chest. | `#17171a`, `#ff2e88`, `#ffe031`, `#0d0d0d` |
| **Headset & Antenna** | Chunky retro-punk on-ear headphones with a `#00b8f0` cyan ear-cup ring, `#ff2e88` boom mic tab, and a short bent signal antenna tipped with a glowing `#00b8f0` / `#ffe031` beacon.                                                          | `#0d0d0d`, `#00b8f0`, `#ff2e88`, `#ffe031` |
| **Lower & Boots**     | Tapered charcoal cargo joggers (`#121216`) with magenta utility strap; chunky high-top street boots with thick `#ffe031` yellow lugged soles and `#f3efe4` cream laces.                                                                      | `#121216`, `#ffe031`, `#f3efe4`, `#ff2e88` |
| **Signature Props**   | Portable cassette/signal receiver box, fingerless charcoal hand wraps, adhesive bandage on cheek bridge (echoing [`home-hero-master.png`](../../../packages/assets/source/artwork/home-hero-master.png)).                                    | `#17171a`, `#f3efe4`, `#00b8f0`            |

### 2.3 Expression & Pose Matrix

| Variant ID             | Framing                            | Visual Expression & Gesture                                                                            | Primary UI Surface                                         |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `model-sheet`          | Full turnaround (Front, Side, 3/4) | Neutral alert courier stance showing crown pin, headset antenna, back hoodie seam, and boot sole tread | Design reference & UI Catalog AssetBrowser                 |
| `portrait-happy`       | Bust (`1:1`)                       | Energetic wide grin, bright eyes, relaxed thumbs-up / collar tug                                       | Default `CharacterDisplay` companion & welcome cards       |
| `portrait-excited`     | Bust (`1:1`)                       | Starry-eyed hyped expression (`#ffe031` eye sparkles), open laugh, slight forward lean                 | Quest unlock, active live run, AI task ready               |
| `portrait-thinking`    | Bust (`1:1`)                       | Chin-tap curious tilt, narrowed analytical eye + raised brow, floating comic question energy (no text) | Empty filter results, Knowledge query prompt, Studio draft |
| `portrait-celebrating` | Bust (`1:1`)                       | Victory fist-pump, ecstatic grin, radiating `#ffe031` / `#ff2e88` comic halftone sparks                | `AchievementBadge`, `RewardPanel`, onboarding completion   |
| `fullbody-standing`    | Full body (`3:4`)                  | Dynamic contrapposto street stance, one hand adjusting headset antenna, boots planted                  | `/board` welcome card, Profile showcase, `EmptyState` hero |

---

## 3. Supporting Character: `vesper-ink` ("Vesper")

### 3.1 Character Identity & Silhouette

- **Title:** Underground Zine Archivist & Synth Tinkerer
- **Archetype:** Sharp-eyed archivist and hardware hacker who curates Moon City's printed lore, patches analog synths, and keeps story revisions organized.
- **Silhouette & Proportions:** Lithe `6`-head anime/cartoon silhouette with a sharp **asymmetric cropped silver-ink bob**, **round brass-rimmed tinted goggles pushed onto the forehead**, and a **scuffed work apron over rolled sleeves**.

### 3.2 Costume & Color Specification

| Zone                | Material & Detail                                                                                                                                                                                                      | Palette Tokens                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Hair & Eyes**     | Cropped silver-cream (`#f3efe4` / `#b6cad7`) angled bob with bold `#c084fc` violet and `#00b8f0` cyan dyed streaks on the left temple; calm, wry half-lidded ink eyes.                                                 | `#f3efe4`, `#b6cad7`, `#c084fc`, `#00b8f0`, `#0d0d0d` |
| **Goggles**         | Round retro-tinkerer goggles resting on forehead with `#c084fc` / `#00b8f0` tinted lenses and dark `#0d0d0d` strap.                                                                                                    | `#0d0d0d`, `#c084fc`, `#00b8f0`                       |
| **Outfit**          | Charcoal graphic-free tee under a scuffed warm-paper/olive utility apron (`#e4dcc8` / `#17171a` pockets) clipped with `#ffe031` binder clips and `#ff2e88` masking tape strips; crossbody tape-patched canvas satchel. | `#17171a`, `#f3efe4`, `#ffe031`, `#ff2e88`            |
| **Signature Props** | Tape-patched zine satchel, brass pocket ruler/stylus, mini synth patch cable coiled at belt.                                                                                                                           | `#0d0d0d`, `#ffe031`, `#c084fc`                       |

---

## 4. Existing Character Preservation: `crew-01`

[`packages/assets/source/world/characters/character-registry.json`](../../../packages/assets/source/world/characters/character-registry.json) defines `crew-01` (`anonymous-back-facing`, industrial workwear in `ink-900` / `paper-white` / `hot-magenta-500`, tool satchel + yellow cross badge).

**Preservation Rules:**

1. **Do NOT alter or overwrite** [`crew-01-sheet.svg`](../../../packages/assets/source/world/characters/crew-01-sheet.svg), `crew-01-pose-*.svg`, or `packages/assets/animation/crew-01-*/*.svg`.
2. Retain `crew-01` in `character-registry.json` with `depictionPolicy: "anonymous-back-facing"` and `prohibitedVariants: ["recognizable-face", "sacred-figure", "real-person-likeness"]`.
3. `kuro-signal` and `vesper-ink` complement `crew-01` as separate `identified-approved` entries—they never replace `crew-01` inside existing SceneLab parallax rigs (`moon-city-environment-master`).

---

## 5. `character-registry.json` Extension Contract (Synced with Checked-In Registry)

Compatible with [`character-registry-schema.mjs`](../../../packages/assets/scripts/character-registry-schema.mjs) (`schemaVersion: 1`, `ALLOWED_DEPICTION` includes `identified-approved`, no overlap between `masterAssetIds` and `variantAssetIds`):

```json
{
  "characterId": "kuro-signal",
  "role": "signal-courier",
  "depictionPolicy": "identified-approved",
  "silhouette": "oversized hooded street courier with twin-ring headset antenna and chunky lug-sole boots",
  "outfit": "ink-splattered charcoal and magenta hoodie with yellow crown pin, cargo joggers, yellow-soled boots",
  "paletteTokens": ["ink-black", "paper-cream", "signal-yellow", "riot-magenta", "signal-cyan"],
  "proportions": "stylized anime-cartoon 5.5 heads",
  "signatureProps": [
    "crown-enamel-pin",
    "signal-headset-antenna",
    "cheek-bandage",
    "portable-receiver"
  ],
  "allowedVariants": [
    "model-sheet",
    "expression-happy",
    "expression-excited",
    "expression-laughing",
    "expression-angry",
    "expression-confused",
    "expression-thinking",
    "expression-surprised",
    "expression-sad",
    "expression-crying",
    "expression-sleepy",
    "expression-curious",
    "expression-celebrating",
    "expression-embarrassed",
    "expression-determined",
    "expression-victory",
    "expression-disappointed",
    "pose-standing",
    "pose-sitting",
    "pose-walking",
    "pose-running",
    "pose-jumping",
    "pose-waving",
    "pose-pointing",
    "pose-reading",
    "pose-gaming",
    "pose-working",
    "pose-holding-objects",
    "pose-celebrating"
  ],
  "prohibitedVariants": ["sacred-figure", "real-person-likeness", "third-party-logo"],
  "masterAssetIds": [
    "source/artwork/riot-universe/kuro-signal-model-sheet-master.png",
    "source/artwork/riot-universe/kuro-signal-portrait-happy-master.png"
  ],
  "variantAssetIds": [
    "source/artwork/riot-universe/kuro-signal-portrait-excited-master.png",
    "source/artwork/riot-universe/kuro-signal-portrait-thinking-master.png",
    "source/artwork/riot-universe/kuro-signal-portrait-celebrating-master.png",
    "source/artwork/riot-universe/kuro-signal-fullbody-standing-master.png",
    "illustrations/riot-universe/characters/kuro-signal-expression-happy.webp",
    "illustrations/riot-universe/characters/kuro-signal-expression-excited.webp",
    "illustrations/riot-universe/characters/kuro-signal-expression-thinking.webp",
    "illustrations/riot-universe/characters/kuro-signal-expression-celebrating.webp",
    "illustrations/riot-universe/characters/kuro-signal-pose-standing.webp",
    "animation/kuro-signal-idle/kuro-signal-idle-clip.json",
    "animation/kuro-signal-wave/kuro-signal-wave-clip.json",
    "animation/kuro-signal-celebrate/kuro-signal-celebrate-clip.json"
  ],
  "license": "ISC",
  "status": "approved"
}
```

`vesper-ink` is registered alongside `crew-01` and `kuro-signal` with `masterAssetIds: ["source/artwork/riot-universe/vesper-ink-portrait-master.png"]`, `variantAssetIds: ["illustrations/riot-universe/characters/vesper-ink-portrait.webp", "illustrations/riot-universe/characters/vesper-ink-portrait.png", "illustrations/riot-universe/game/avatar-vesper.png"]`, `license: "ISC"`, and `status: "approved"`.

---

## 6. Consumer Surface Mapping (`apps/board`, `apps/desktop`, `apps/ui-catalog`)

| Surface / Route                                                                               | Asset / Character Variant                                              | UI Component Wrapper                             | Narrative Purpose                                                   |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| `/board` Welcome Strip & Onboarding                                                           | `scene-onboarding-welcome-master` + `kuro-signal` (`happy`)            | `CharacterDisplay` + `SpeechBubble`              | Warm Moon City studio welcome & quick-start checklist               |
| Empty / Zero-Result States (`ListView`, `KanbanView`, `KnowledgePage`, `LocalRagSearchPanel`) | `scene-empty-signal-static-master` or `kuro-signal` (`thinking`)       | `EmptyState` + `CharacterReaction`               | Replace blank text with illustrated signal-static cue + clear CTA   |
| `/board/studio` & `/board/stories/workbench`                                                  | `vesper-ink` (`portrait`) + `bg-riot-arcade-workbench-master`          | `CharacterDisplay` + `MangaFrame`                | Archivist tips, revision guidance, zine creative context            |
| `/board/ai/hq` & Desktop Doctor                                                               | `kuro-signal` (`excited` / `thinking`) + `bg-riot-street-alley-master` | `ComicPanel` + `CharacterReaction`               | Live dispatch hype vs. diagnostic inspection cue                    |
| Quest / Achievement / Reward Milestones                                                       | `scene-quest-victory-master` + `kuro-signal` (`celebrating`)           | `QuestCard` + `AchievementBadge` + `RewardPanel` | Tactile progression feedback paired with `useSfx().play('success')` |
| `apps/ui-catalog` AssetBrowser & SceneLab                                                     | `kuro-signal-model-sheet-master` + all 12 masters                      | `ArtworkFrame` + `CharacterPreview`              | Visual QA specimen matrix across skins & reduced motion             |

---

## 7. Cutout & Master Asset Specification Matrix (12 Direct AI Masters + 2 Procedural Halftone Masters)

Every source master lives under `packages/assets/source/artwork/riot-universe/`.

> [!NOTE]
> **Generation Provenance (`12/12` Direct AI Masters):** All **12** character, background, and narrative scene masters (`#1`–`#12`) are direct AI image-generation masters normalized to canonical dimensions (`1024x1024`, `1024x1536`, and `1376x768`). Only the two flat texture plates (`#13` `bg-halftone-paper-light-master.png` and `#14` `bg-halftone-ink-dark-master.png`) remain procedurally rasterized via `sharp` + SVG in [`packages/assets/scripts/generate-riot-universe.mjs`](../../../packages/assets/scripts/generate-riot-universe.mjs). All 14 source masters are registered in [`manifest.json`](../../../packages/assets/manifest.json) and [`licenses.json`](../../../packages/assets/licenses.json) (`status: "approved"`, `termsVerified: true`).

**Global Generation Constraints:**

- **Zero embedded text, letters, numbers, signatures, UI widgets, or watermarks** in any of the masters.
- **100% original MoonWitness visual design** (no third-party IP/logos).
- **Cutout Assets (#1–#7):** Pure solid `#ffffff` background, closed `#0d0d0d` outer ink silhouette with no soft outer drop shadow onto the white backdrop, enabling clean exterior border flood-fill alpha keying via `sharp` (preserving interior white eyes, teeth, cheek bandage, and silver-cream hair at `alpha === 255`).

| #   | Filename (`packages/assets/source/artwork/riot-universe/...`) | Origin & Status                                        | Aspect / Framing                       | Detailed Specification                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `kuro-signal-model-sheet-master.png`                          | **Direct AI Master** (`1376x768`, `#ffffff` backdrop)  | 16:9 / 3-pose sheet (Front, Side, 3/4) | Stylized anime-cartoon street-zine punk courier "Kuro": tousled ink-black hair, expressive manga eyes, adhesive cheek bandage, oversized charcoal `#17171a` hoodie with `#ff2e88` magenta lining/ink splatters and small `#ffe031` yellow 3-spike crown pin on chest, retro headset with `#00b8f0` cyan ring & short antenna, charcoal cargos, chunky boots with thick `#ffe031` yellow soles. Bold `#0d0d0d` hand-inked outlines, flat + halftone cel shading. Zero text or labels. |
| 2   | `kuro-signal-portrait-happy-master.png`                       | **Direct AI Master** (`1024x1024`, `#ffffff` backdrop) | 1:1 centered bust                      | Same Kuro design: energetic wide grin, bright eyes, one hand giving relaxed thumbs-up near hoodie collar, crown pin visible, cyan/magenta headset antenna crisp. Bold `#0d0d0d` closed outer outline, flat + halftone cel shading, solid `#ffffff` backdrop, zero text.                                                                                                                                                                                                              |
| 3   | `kuro-signal-portrait-excited-master.png`                     | **Direct AI Master** (`1024x1024`, `#ffffff` backdrop) | 1:1 centered bust                      | Normalized 1024x1024 RGB on `#ffffff`. Starry-eyed hyped Kuro bust expression driving `excited`, `laughing`, `surprised`, and `determined` cutouts plus the `wave` animation clip.                                                                                                                                                                                                                                                                                                   |
| 4   | `kuro-signal-portrait-thinking-master.png`                    | **Direct AI Master** (`1024x1024`, `#ffffff` backdrop) | 1:1 centered bust                      | Normalized 1024x1024 RGB on `#ffffff`. Chin-tap analytical Kuro bust expression driving `thinking`, `confused`, `curious`, `sleepy`, `sad`, `crying`, and `disappointed` cutouts plus `think` and `loading` animation clips.                                                                                                                                                                                                                                                         |
| 5   | `kuro-signal-portrait-celebrating-master.png`                 | **Direct AI Master** (`1024x1024`, `#ffffff` backdrop) | 1:1 centered bust                      | Normalized 1024x1024 RGB on `#ffffff`. Victory fist-pump Kuro bust expression driving `celebrating` and `victory` cutouts plus `celebrate` and `success` animation clips.                                                                                                                                                                                                                                                                                                            |
| 6   | `kuro-signal-fullbody-standing-master.png`                    | **Direct AI Master** (`1024x1536`, `#ffffff` backdrop) | 2:3 full-body centered                 | Normalized 1024x1536 RGB (`fit: contain` on `#ffffff` preserving head, antenna, and yellow boot soles). Drives front-facing full-body pose cutouts (`standing`, `waving`, `pointing`, `celebrating`, `jumping`, `holding-objects`, `gaming`).                                                                                                                                                                                                                                        |
| 7   | `vesper-ink-portrait-master.png`                              | **Direct AI Master** (`1024x1024`, `#ffffff` backdrop) | 1:1 centered bust                      | Original supporting character "Vesper": underground zine archivist & synth tinkerer, cropped silver-cream (`#f3efe4`) bob with `#c084fc` violet and `#00b8f0` cyan streak, round tinted `#c084fc`/`#00b8f0` goggles resting on forehead, calm wry expression, scuffed utility apron with `#ffe031` clips & `#ff2e88` tape over charcoal tee, crossbody tape-patched satchel strap. Bold `#0d0d0d` closed outline, halftone cel shading, solid `#ffffff` backdrop, zero text.         |
| 8   | `bg-riot-street-alley-master.png`                             | **Direct AI Master** (`1376x768`, RGB PNG)             | 16:9 full-bleed                        | Direct AI nocturnal street alley master (`bg-riot-street-alley.webp` source + `access-denied`/`not-found` system state backdrop).                                                                                                                                                                                                                                                                                                                                                    |
| 9   | `bg-riot-arcade-workbench-master.png`                         | **Direct AI Master** (`1376x768`, RGB PNG)             | 16:9 full-bleed                        | Direct AI arcade studio workbench master (`bg-riot-arcade-workbench.webp` source + `loading`/`maintenance` state backdrop).                                                                                                                                                                                                                                                                                                                                                          |
| 10  | `scene-empty-signal-static-master.png`                        | **Direct AI Master** (`1376x768`, RGB PNG)             | 16:9 full-bleed                        | Direct AI empty-signal rooftop scene master driving empty/offline/error UI state vignettes.                                                                                                                                                                                                                                                                                                                                                                                          |
| 11  | `scene-onboarding-welcome-master.png`                         | **Direct AI Master** (`1376x768`, RGB PNG)             | 16:9 full-bleed                        | Direct AI onboarding doorway scene master driving `first-time`, `welcome`, `onboarding`, `discover`, `explore`, and `profile` UI state vignettes.                                                                                                                                                                                                                                                                                                                                    |
| 12  | `scene-quest-victory-master.png`                              | **Direct AI Master** (`1376x768`, RGB PNG)             | 16:9 full-bleed                        | Direct AI quest victory burst scene master driving `success`, `achievement`, `completion`, and `celebration` UI state vignettes.                                                                                                                                                                                                                                                                                                                                                     |
| 13  | `bg-halftone-paper-light-master.png`                          | **Procedural Halftone** (`1376x768`)                   | 16:9 full-bleed                        | Warm newsprint `#f3efe4` texture with Ben-Day halftone dots and ink corner registration marks (`bg-halftone-paper-light.webp` source).                                                                                                                                                                                                                                                                                                                                               |
| 14  | `bg-halftone-ink-dark-master.png`                             | **Procedural Halftone** (`1376x768`)                   | 16:9 full-bleed                        | Deep charcoal `#0e0e10` texture with halftone dot grid and cyan/magenta rim vignette (`bg-halftone-ink-dark.webp` source).                                                                                                                                                                                                                                                                                                                                                           |
