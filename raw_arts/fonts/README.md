# Archival Source Fonts (`raw_arts/fonts/`)

This directory holds **9 source-only archival `.woff2` font binaries** from early MoonWitness visual explorations.

## Non-Distribution & Provenance Gate

Per [the asset schema validator](../../packages/assets/scripts/asset-schema.mjs#L155-L157) (`validateSourceProvenance`), unverified rights must never enter `packages/assets/` distribution. None of the files in `raw_arts/fonts/` have verified upstream provenance or distribution clearance in [the package license manifest](../../packages/assets/licenses.json):

- Do **not** copy or move these `.woff2` files into `packages/assets/fonts/`.
- Do **not** reference these binaries from [the hosted font stylesheet](../../packages/assets/fonts.css) or [design token documentation](../../docs/design/tokens.md) runtime stacks.
- All runtime UI and editorial typography uses the five verified, self-hosted families in [the hosted font stylesheet](../../packages/assets/fonts.css):
  - **`Anton`** (SIL OFL 1.1) — compact display metrics and labels
  - **`Road Rage`** (SIL OFL 1.1) — subsetted short editorial display headings
  - **`MoonWitness Grunge`** (ISC, generated via `packages/assets/scripts/generate-brand-font.mjs`) — primary MoonWitness grunge/brush display headings, ribbons, and stamps
  - **`Space Grotesk`** (SIL OFL 1.1) — body copy, navigation, controls, and tables
  - **`JetBrains Mono`** (SIL OFL 1.1, weights 400/600/700) — technical IDs, timestamps, and code

## Archival File Inventory

| File | Family & Embedded Metadata | Weight / Format | Size (bytes) | SHA-256 | Role vs. Active Hosted Fonts | Status |
| --- | --- | --- | ---: | --- | --- | --- |
| `cinzel-400.woff2` | `Cinzel` v2.000 (`NDISCOVER/Cinzel`, embedded OFL URL, no standalone license/source record) | 400 (`OS/2`), variable TrueType (`fvar`) | 25,904 | `09941FB1C169C38FD414536B37690057FC01B3117A5C63DD6571186540C8F370` | Early serif display exploration; superseded by `Anton`, `Road Rage`, and `MoonWitness Grunge` for display and `Space Grotesk` for UI/editorial copy. | Archival source-only; unverified rights, excluded from distribution |
| `cinzel-600.woff2` | `Cinzel` v2.000 (byte-identical copy of `cinzel-400.woff2`) | Variable TrueType (`fvar`) | 25,904 | `09941FB1C169C38FD414536B37690057FC01B3117A5C63DD6571186540C8F370` | Duplicate variable binary for weight 600 slot in early serif exploration; superseded by `Anton`, `Road Rage`, and `MoonWitness Grunge`. | Archival source-only; unverified rights, excluded from distribution |
| `cinzel-700.woff2` | `Cinzel` v2.000 (byte-identical copy of `cinzel-400.woff2`) | Variable TrueType (`fvar`) | 25,904 | `09941FB1C169C38FD414536B37690057FC01B3117A5C63DD6571186540C8F370` | Duplicate variable binary for weight 700 slot in early serif exploration; superseded by `Anton`, `Road Rage`, and `MoonWitness Grunge`. | Archival source-only; unverified rights, excluded from distribution |
| `saksi-hand-400.woff2` | `Saksi Hand` Regular v1.000 (embedded MoonWitness 2026 non-redistribution notice; no generator/source record) | 400 (`OS/2`), CFF OpenType (`OTTO`) | 42,876 | `F95C435AF61D2D97CCE15DD4F8D8557E886D6323B17D60E8A175D70534FD04FD` | Early handwritten zine-note exploration; superseded by `MoonWitness Grunge` and `Road Rage`. | Archival source-only; unverified provenance, excluded from distribution |
| `saksi-hand-700.woff2` | `Saksi Hand` Bold v1.000 (embedded MoonWitness 2026 non-redistribution notice; no generator/source record) | 700 (`OS/2`), CFF OpenType (`OTTO`) | 46,956 | `C67CADE9032C5E3F2A285163FDE15DD1CF17434F8801E393F02D78FD6967EDA8` | Early bold handwritten exploration; superseded by `MoonWitness Grunge` and `Road Rage`. | Archival source-only; unverified provenance, excluded from distribution |
| `saksi-marker-400.woff2` | `Saksi Marker` Regular v1.000 (embedded MoonWitness 2026 non-redistribution notice; no generator/source record) | 400 (`OS/2`), CFF OpenType (`OTTO`) | 51,432 | `AF80C0D5126476CE82BBB2AEC61507F358BFF7843E25F9AF35A8663304F97C66` | Early marker/brush display exploration; superseded by `MoonWitness Grunge`, `Road Rage`, and `Anton`. | Archival source-only; unverified provenance, excluded from distribution |
| `saksi-marker-700.woff2` | `Saksi Marker` Bold v1.000 (embedded MoonWitness 2026 non-redistribution notice; no generator/source record) | 700 (`OS/2`), CFF OpenType (`OTTO`) | 50,460 | `8DEE82E9D8183D2642E5B17A5589667A23DB36CD86E1AD78FC2D6CC5E4A6345F` | Early bold marker display exploration; superseded by `MoonWitness Grunge`, `Road Rage`, and `Anton`. | Archival source-only; unverified provenance, excluded from distribution |
| `saksi-mono-400.woff2` | `Saksi Mono` Regular v1.000 (embedded MoonWitness 2026 non-redistribution notice; no generator/source record) | 400 (`OS/2`), CFF OpenType (`OTTO`) | 17,712 | `3B1FF197C7F588926F717F613348A5E117A663C4C2A744E815E828295A32BEE2` | Early monospace exploration; superseded by `JetBrains Mono` (400/600/700). | Archival source-only; unverified provenance, excluded from distribution |
| `saksi-mono-700.woff2` | `Saksi Mono` Bold v1.000 (embedded MoonWitness 2026 non-redistribution notice; no generator/source record) | 700 (`OS/2`), CFF OpenType (`OTTO`) | 16,840 | `65307DB1CEEEC374F2EB764C53998462243A0B7E6E2FB3D348F1E3DE1F78BB0B` | Early bold monospace exploration; superseded by `JetBrains Mono` (`font-weight: 700`). | Archival source-only; unverified provenance, excluded from distribution |
