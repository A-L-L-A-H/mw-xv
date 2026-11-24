# 12 — MoonWitness Artwork & Asset Inventory

> **Scope:** Complete verified inventory of all **455** assets in [`packages/assets/manifest.json`](../../../packages/assets/manifest.json), [`packages/assets/licenses.json`](../../../packages/assets/licenses.json), and [`packages/assets/source/world/characters/character-registry.json`](../../../packages/assets/source/world/characters/character-registry.json), produced after executing [`packages/assets/scripts/generate-riot-universe.mjs`](../../../packages/assets/scripts/generate-riot-universe.mjs).
> **Companion Documents:** [10-art-direction-bible.md](./10-art-direction-bible.md) | [11-character-design-bible.md](./11-character-design-bible.md) | [13-asset-coverage.md](./13-asset-coverage.md)

---

## 1. Global Package Totals (Observed from `manifest.json` & Disk)

| Metric                                            | Count / Value                                                                                                          | Source / Gate                                                                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Total Manifest Entries**                        | **455**                                                                                                                | [`manifest.json`](../../../packages/assets/manifest.json)                                                                                        |
| **Runtime Assets Checked (`asset-qa.mjs`)**       | **401** (`10,387 KB` QA summary; `10,636,773 B` raw manifest sum excluding `source/` & `brand/source/`)                | [`asset-qa.mjs`](../../../packages/assets/scripts/asset-qa.mjs)                                                                                  |
| **Source Masters (`source/` + `brand/source/`)**  | **54** (`44,676 KB` QA summary; `45,748,438 B` across all 74 `kind: "source"` entries including `animation/crew-01-*`) | [`asset-qa.mjs`](../../../packages/assets/scripts/asset-qa.mjs)                                                                                  |
| **Self-Contained Validated SVGs**                 | **226** (`0` errors, `0` out-of-bounds failures)                                                                       | [`validate.mjs`](../../../packages/assets/scripts/validate.mjs), [`check-svg-bounds.mjs`](../../../packages/assets/scripts/check-svg-bounds.mjs) |
| **Signal Riot Pack (`pack: "riot-universe"`)**    | **204** (`190` runtime assets, `6,974,788 B`; `14` source masters, `15,116,622 B`)                                     | [`generate-riot-universe.mjs`](../../../packages/assets/scripts/generate-riot-universe.mjs)                                                      |
| **Moon City Pack (`pack: "moon-city"`)**          | **62** (including `crew-01` frames, `moon-city-scene.json`, environments)                                              | [`manifest.json`](../../../packages/assets/manifest.json)                                                                                        |
| **Core Brand / UI / Font / Sound (`pack` unset)** | **189**                                                                                                                | [`manifest.json`](../../../packages/assets/manifest.json)                                                                                        |
| **Source Provenance Records (`licenses.json`)**   | **62** total (`14` `riot-universe` entries, all `status: "approved"`, `termsVerified: true`)                           | [`licenses.json`](../../../packages/assets/licenses.json)                                                                                        |
| **Character Registry Entries**                    | **3** (`crew-01`, `kuro-signal`, `vesper-ink`)                                                                         | [`character-registry.json`](../../../packages/assets/source/world/characters/character-registry.json)                                            |

---

## 2. Inventory Breakdown by Manifest Kind (`455` Entries)

| `kind`               | Count | Format(s)                          | Package Directory                                 |
| -------------------- | ----: | ---------------------------------- | ------------------------------------------------- |
| `icon`               |    88 | `svg`                              | `icons/`                                          |
| `source`             |    74 | `png`, `svg`, `json`, `otf`, `ttf` | `source/`, `brand/source/`, `animation/crew-01-*` |
| `character-sprite`   |    58 | `png` (29), `webp` (29)            | `illustrations/riot-universe/characters/`         |
| `animation-frame`    |    32 | `png`                              | `animation/kuro-signal-*/`                        |
| `game-asset`         |    26 | `png` (13), `svg` (13)             | `illustrations/riot-universe/game/`               |
| `state-illustration` |    25 | `webp`                             | `illustrations/riot-universe/states/`             |
| `sticker`            |    24 | `png` (12), `svg` (12)             | `illustrations/riot-universe/stickers/`           |
| `material`           |    17 | `svg`                              | `materials/`                                      |
| `illustration`       |    14 | `svg`                              | `illustrations/`                                  |
| `artwork`            |    13 | `webp`                             | `illustrations/`                                  |
| `environment`        |    13 | `svg`                              | `environments/`                                   |
| `ornament`           |    11 | `svg`                              | `materials/`                                      |
| `animation-clip`     |     8 | `json`                             | `animation/kuro-signal-*/`                        |
| `animation-sheet`    |     8 | `png`                              | `animation/kuro-signal-*/`                        |
| `font`               |     8 | `woff2`                            | `fonts/`                                          |
| `sound`              |     7 | `wav`                              | `sounds/`                                         |
| `pattern`            |     5 | `svg`                              | `illustrations/`, `materials/`                    |
| `background`         |     4 | `webp`                             | `illustrations/riot-universe/backgrounds/`        |
| `lockup`             |     4 | `svg`                              | `brand/`                                          |
| `symbol`             |     4 | `svg`                              | `brand/`                                          |
| `wordmark`           |     4 | `svg`                              | `brand/`                                          |
| `app-icon`           |     2 | `png`                              | `brand/`                                          |
| `scene`              |     2 | `json`                             | `scenes/`                                         |
| `social-card`        |     2 | `png`, `svg`                       | `brand/`                                          |
| `favicon`            |     1 | `svg`                              | `brand/`                                          |
| `readme-banner`      |     1 | `svg`                              | `brand/`                                          |

---

## 3. Signal Riot Pack (`pack: "riot-universe"`, `204` Assets)

### 3.1 Source Masters (`source/artwork/riot-universe/`, `14` PNGs)

| File                                          | Dimensions  | Origin & Quota Notes                                                                                                          | Provenance Status                  |
| --------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `kuro-signal-model-sheet-master.png`          | `1376x768`  | Direct AI character turnaround master (front, side, 3/4 on `#ffffff`)                                                         | `approved` (`termsVerified: true`) |
| `kuro-signal-portrait-happy-master.png`       | `1024x1024` | Direct AI bust portrait master (`#ffffff`)                                                                                    | `approved` (`termsVerified: true`) |
| `vesper-ink-portrait-master.png`              | `1024x1024` | Direct AI bust portrait master (`#ffffff`)                                                                                    | `approved` (`termsVerified: true`) |
| `kuro-signal-portrait-excited-master.png`     | `1024x1024` | Option A composite (direct AI call hit `429 RESOURCE_EXHAUSTED`, `4h57m` reset)                                               | `approved` (`termsVerified: true`) |
| `kuro-signal-portrait-thinking-master.png`    | `1024x1024` | Option A composite (direct AI call hit `429 RESOURCE_EXHAUSTED`, `4h57m` reset)                                               | `approved` (`termsVerified: true`) |
| `kuro-signal-portrait-celebrating-master.png` | `1024x1024` | Option A composite (direct AI call hit `429 RESOURCE_EXHAUSTED`, `4h57m` reset)                                               | `approved` (`termsVerified: true`) |
| `kuro-signal-fullbody-standing-master.png`    | `1024x1536` | Option A extract from `kuro-signal-model-sheet-master.png` (`429 RESOURCE_EXHAUSTED`, `4h57m` reset)                          | `approved` (`termsVerified: true`) |
| `bg-riot-street-alley-master.png`             | `1376x768`  | Option A composite from `raw_arts/art/city-shadow.png` (`429 RESOURCE_EXHAUSTED`, `4h57m` reset)                              | `approved` (`termsVerified: true`) |
| `bg-riot-arcade-workbench-master.png`         | `1376x768`  | Option A composite from `raw_arts/art/night-shift.png` (`429 RESOURCE_EXHAUSTED`, `4h57m` reset)                              | `approved` (`termsVerified: true`) |
| `bg-halftone-paper-light-master.png`          | `1376x768`  | Option A procedural newsprint halftone plate                                                                                  | `approved` (`termsVerified: true`) |
| `bg-halftone-ink-dark-master.png`             | `1376x768`  | Option A procedural charcoal halftone plate                                                                                   | `approved` (`termsVerified: true`) |
| `scene-empty-signal-static-master.png`        | `1376x768`  | Option A composite from `raw_arts/art/crew-rooftop.png` + Kuro cutout (`429 RESOURCE_EXHAUSTED`, `4h57m` reset)               | `approved` (`termsVerified: true`) |
| `scene-onboarding-welcome-master.png`         | `1376x768`  | Option A composite from `raw_arts/art/city-shadow.png` + Kuro & Vesper cutouts (`429 RESOURCE_EXHAUSTED`, `4h57m` reset)      | `approved` (`termsVerified: true`) |
| `scene-quest-victory-master.png`              | `1376x768`  | Option A composite from `raw_arts/art/wallpaper-signal-city-wide.png` + Kuro cutout (`429 RESOURCE_EXHAUSTED`, `4h57m` reset) | `approved` (`termsVerified: true`) |

### 3.2 Character Cutouts (`illustrations/riot-universe/characters/`, `58` Files)

All character sprites use **4-edge exterior border flood-fill alpha keying** (`R>240, G>240, B>240` with 1px anti-aliased edge feathering) so corner pixels stay transparent (`alpha === 0`) while interior white eyes, teeth, cheek bandage, and Vesper's silver-cream hair stay strictly opaque (`alpha === 255`).

- **Kuro Expressions (`32` files = `16` x `.png` + `.webp`, `512x512`):** `happy`, `excited`, `laughing`, `angry`, `confused`, `thinking`, `surprised`, `sad`, `crying`, `sleepy`, `curious`, `celebrating`, `embarrassed`, `determined`, `victory`, `disappointed` (`kuro-signal-expression-<expr>.{png,webp}`).
- **Kuro Poses (`24` files = `12` x `.png` + `.webp`, `512x768`):** `standing`, `sitting`, `walking`, `running`, `jumping`, `waving`, `pointing`, `reading`, `gaming`, `working`, `holding-objects`, `celebrating` (`kuro-signal-pose-<pose>.{png,webp}`).
- **Vesper Portrait (`2` files = `.png` + `.webp`, `512x512`):** `vesper-ink-portrait.{png,webp}`.

### 3.3 UI State Vignettes (`illustrations/riot-universe/states/`, `25` WebP Files, `640x480`)

- **Empty States (`8`):** `state-empty-dashboard.webp`, `state-no-search-results.webp`, `state-no-notifications.webp`, `state-empty-collection.webp`, `state-no-favorites.webp`, `state-no-messages.webp`, `state-no-activity.webp`, `state-first-time.webp`.
- **System States (`9`):** `state-loading.webp`, `state-success.webp`, `state-error.webp`, `state-offline.webp`, `state-network-disconnected.webp`, `state-maintenance.webp`, `state-access-denied.webp`, `state-not-found.webp`, `state-unexpected-failure.webp`.
- **Experience States (`8`):** `state-welcome.webp`, `state-onboarding.webp`, `state-discover.webp`, `state-explore.webp`, `state-profile.webp`, `state-achievement.webp`, `state-completion.webp`, `state-celebration.webp`.

### 3.4 Backgrounds (`illustrations/riot-universe/backgrounds/`, `4` WebP Files, `1376x768`)

`bg-riot-street-alley.webp`, `bg-riot-arcade-workbench.webp`, `bg-halftone-paper-light.webp`, `bg-halftone-ink-dark.webp`.

### 3.5 Stickers (`illustrations/riot-universe/stickers/`, `24` Files = `12` x `.png` + `.svg`, `256x256`)

`sticker-speech-bubble-shout`, `sticker-speech-bubble-thought`, `sticker-comic-boom`, `sticker-lightning-bolt`, `sticker-riot-star`, `sticker-street-flame`, `sticker-pixel-heart`, `sticker-hand-arrow`, `sticker-paint-splash`, `sticker-motion-burst`, `sticker-torn-tape-x`, `sticker-graffiti-crown`.

### 3.6 Game & Badges (`illustrations/riot-universe/game/`, `26` Files = `13` x `.png` + `.svg`)

`avatar-kuro`, `avatar-vesper`, `avatar-frame-riot`, `badge-signal-scout`, `badge-archive-keeper`, `badge-story-architect`, `badge-zero-drift`, `rank-rookie`, `rank-vanguard`, `rank-legend`, `quest-banner` (`512x192`), `reward-crate`, `level-up-burst` (all square entries `256x256`).

### 3.7 Animations (`animation/kuro-signal-<clip>/`, `48` Files across `8` Clips)

Clips: `idle`, `blink`, `wave`, `celebrate`, `think`, `loading`, `success`, `error`. Each clip folder contains:

- 4 distinct transparent PNG frames (`kuro-signal-<clip>-frame-01.png`..`04.png`, `512x512`).
- 1 2x2 PNG sprite sheet atlas (`kuro-signal-<clip>-sheet.png`, `1024x1024`).
- 1 clip descriptor (`kuro-signal-<clip>-clip.json`) with validated `spriteSheet` metadata in [`manifest.json`](../../../packages/assets/manifest.json).

### 3.8 5-Layer Parallax Scene (`environments/riot-alley-*.svg` + `scenes/riot-alley-scene.json`, `5` Files)

- Layer 0 (`sky-backdrop`): `illustrations/riot-universe/backgrounds/bg-riot-street-alley.webp`
- Layer 1 (`alley-bg`): `environments/riot-alley-bg.svg` (`2048x1152`)
- Layer 2 (`alley-mid`): `environments/riot-alley-mid.svg` (`2048x1152`)
- Layer 3 (`alley-fg`): `environments/riot-alley-fg.svg` (`2048x1152`)
- Layer 4 (`alley-decor`): `environments/riot-alley-decor.svg` (`2048x1152`)
- Scene descriptor: `scenes/riot-alley-scene.json` (`riot-alley-hero`, `mobile` & `desktop` breakpoints, `kuro-signal-idle` & `kuro-signal-wave` clips).
