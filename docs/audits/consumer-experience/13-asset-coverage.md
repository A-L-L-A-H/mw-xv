# 13 — MoonWitness Asset Coverage & Verification Matrix

> **Scope:** Asset coverage parity across [`@moonwitness/ui`](../../../packages/ui/README.md) canonical registry contracts, [`@moonwitness/assets`](../../../packages/assets/README.md) runtime artifacts, provenance gates, and validation runs.
> **Companion Documents:** [10-art-direction-bible.md](./10-art-direction-bible.md) | [11-character-design-bible.md](./11-character-design-bible.md) | [12-artwork-inventory.md](./12-artwork-inventory.md)

---

## 1. Canonical Registry Path Coverage (`@moonwitness/ui/lib/asset-registry` 1-to-1 Parity)

| Domain | Required Pattern | Expected Count | Actual on Disk & in `manifest.json` | Format & Dimensions | Coverage Status |
| --- | --- | ---: | ---: | --- | --- |
| **Kuro Expressions** | `illustrations/riot-universe/characters/kuro-signal-expression-<expr>.{webp,png}` | 16 pairs (32) | **32** | `512x512` transparent RGBA | **PASS (100%)** |
| **Kuro Poses** | `illustrations/riot-universe/characters/kuro-signal-pose-<pose>.{webp,png}` | 12 pairs (24) | **24** | `512x768` transparent RGBA | **PASS (100%)** |
| **Vesper Portrait** | `illustrations/riot-universe/characters/vesper-ink-portrait.{webp,png}` | 1 pair (2) | **2** | `512x512` transparent RGBA | **PASS (100%)** |
| **UI Empty States** | `illustrations/riot-universe/states/state-<slug>.webp` | 8 | **8** | `640x480` WebP | **PASS (100%)** |
| **UI System States** | `illustrations/riot-universe/states/state-<slug>.webp` | 9 | **9** | `640x480` WebP | **PASS (100%)** |
| **UI Experience States** | `illustrations/riot-universe/states/state-<slug>.webp` | 8 | **8** | `640x480` WebP | **PASS (100%)** |
| **Backgrounds** | `illustrations/riot-universe/backgrounds/bg-<slug>.webp` | 4 | **4** | `1376x768` WebP | **PASS (100%)** |
| **Stickers** | `illustrations/riot-universe/stickers/sticker-<slug>.{png,svg}` | 12 pairs (24) | **24** | `256x256` SVG + transparent PNG | **PASS (100%)** |
| **Game & Badges** | `illustrations/riot-universe/game/<slug>.{png,svg}` | 13 pairs (26) | **26** | `256x256` (`512x192` banner) SVG + PNG | **PASS (100%)** |
| **Animations** | `animation/kuro-signal-<clip>/kuro-signal-<clip>-{frame-01..04.png,sheet.png,clip.json}` | 8 clips (48) | **48** | `512x512` frames, `1024x1024` 2x2 sheet, JSON | **PASS (100%)** |
| **Parallax Scene** | `environments/riot-alley-{bg,mid,fg,decor}.svg` + `scenes/riot-alley-scene.json` | 5 | **5** | `2048x1152` SVGs + 5-layer JSON bundle | **PASS (100%)** |
| **Source Masters** | `source/artwork/riot-universe/*.png` | 14 | **14** | 3 direct AI + 11 Option A composites | **PASS (100%)** |
| **Total `riot-universe` Pack** | — | **204** | **204** | — | **PASS (100%)** |

---

## 2. Character & Environment Continuity Coverage

| Asset Group | Continuity Policy | Verification |
| --- | --- | --- |
| `crew-01` (preserved) | Anonymous back-facing crew silhouette (`anonymous-back-facing`) in `moon-city-scene.json` | Unmodified; `crew-01-sheet.svg` and 4 `animation/crew-01-*` clips remain intact (`crew-01` tested in [`moon-city-scene.test.mjs`](../../../packages/assets/tests/moon-city-scene.test.mjs)). |
| `kuro-signal` (new) | Identified Signal Courier (`identified-approved`) | Registered in [`character-registry.json`](../../../packages/assets/source/world/characters/character-registry.json) with non-overlapping `masterAssetIds` and `variantAssetIds`; verified in [`character-registry.test.mjs`](../../../packages/assets/tests/character-registry.test.mjs) and [`riot-universe.test.mjs`](../../../packages/assets/tests/riot-universe.test.mjs). |
| `vesper-ink` (new) | Identified Zine Archivist (`identified-approved`) | Registered in [`character-registry.json`](../../../packages/assets/source/world/characters/character-registry.json); exterior flood-fill preserves silver-cream hair (`#f3efe4`), sclera, and teeth (`alpha === 255`). |

---

## 3. Quota Cap & Remediation Coverage

- **9 Quota-Capped Calls (`HTTP 429 RESOURCE_EXHAUSTED`, `4h57m` reset):** Recorded in [11-character-design-bible.md](./11-character-design-bible.md#7-cutout--master-asset-specification-matrix-12-target-pngs--2-halftone-masters). All 9 targets were cleanly generated via deterministic Option A `sharp` + SVG compositing in [`generate-riot-universe.mjs`](../../../packages/assets/scripts/generate-riot-universe.mjs) using the 3 existing real AI character PNG masters and existing `raw_arts/art/*.png` plates.
- **Zero Duplicate Runtime Assets:** All `401` runtime assets have distinct SHA-256 hashes (except the 4 pre-existing documented brand SVG exceptions in [`asset-qa.mjs`](../../../packages/assets/scripts/asset-qa.mjs)).
- **Transfer Budget Compliance:** Every generated `riot-universe` runtime asset passes [`asset-qa.mjs`](../../../packages/assets/scripts/asset-qa.mjs) (`character-sprite <= 160 KB`, `state-illustration <= 160 KB`, `background <= 220 KB`, `sticker <= 64 KB`, `game-asset <= 120 KB`, `animation-frame <= 96 KB`, `animation-sheet <= 280 KB`).

---

## 4. Verification Gate Results (Executed After Final Generation)

| Command | Scope | Result |
| --- | --- | --- |
| `node packages/assets/scripts/generate-riot-universe.mjs` | Generates all `riot-universe` pack assets, updates `manifest.json` & `licenses.json` | **PASS** (`204` manifest entries, `14` source masters) |
| `node packages/assets/scripts/validate.mjs` | Schema, provenance, inventory parity across 10 dirs, SVG self-containment & ID prefixing | **PASS** (`226` validated SVGs, `0` inventory mismatches) |
| `node packages/assets/scripts/check-svg-bounds.mjs` | Chromium Playwright `getBBox()` vs `viewBox` across all SVGs | **PASS** (`226` SVG viewBoxes checked, `0` out-of-bounds failures) |
| `node packages/assets/scripts/asset-qa.mjs` | Duplicate SHA-256, byte budgets, folder ownership, orphan checks | **PASS** (`401` runtime assets `10,387 KB`, `54` source masters `44,676 KB`, `0` errors, `0` warnings) |
| `node --test packages/assets/tests/*.test.mjs` | Full `@moonwitness/assets` test suite including `character-registry.test.mjs` & `riot-universe.test.mjs` | **PASS** (`58/58` tests passing, `0` failures) |
