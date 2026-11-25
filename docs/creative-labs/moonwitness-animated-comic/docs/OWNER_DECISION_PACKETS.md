# Owner Decision Packets — MoonWitness Animated Comic Lab

**Status:** `PENDING OWNER REVIEW` · **Scope:** Governance handoff before any canonical production promotion.

## Packet 1 — `EP-LAB-01` Candidate Asset Promotion (`32` WebPs + `3` SVGs)
- **Assets:** `animations/anim-{a,b,c,d}-*/*.webp` (25 frames), `animations/shared-props/*.webp` (7 plates), `animations/comic-overlays/*.svg` (3 overlays).
- **Provenance:** 35 records across 6 `provenance.json` sidecars (`reviewState: "experimental-candidate-unapproved"`).
- **Owner Decision Required:** Approve visual quality, character continuity, and ISC licensing before registering in `packages/assets/manifest.json` and `packages/assets/licenses.json`.

## Packet 2 — `vesper-ink` Waist-Up Workbench Variant Expansion
- **Current Canon:** `character-registry.json` lists `allowedVariants: ["portrait"]`.
- **Lab Usage:** `ANIM-C` and `ANIM-D` keep Vesper strictly waist-up behind her archive workbench with zero invented full-body costume changes.
- **Owner Decision Required:** Approve adding `workbench-waist-up` to `vesper-ink.allowedVariants` if promoting `EP-LAB-01` to production.

## Packet 3 — Non-Canonical Candidate `PCC-SIGNAL-SWITCHBOARD-01`
- **File:** `docs/PROPOSED_CHARACTER_CANDIDATE.md` & `data/proposed-character-candidate.json`.
- **Policy:** Anonymous hooded/visor-masked silhouette; zero identifiable face; zero `CHR-####` ID assigned; zero auto-merge with `CHR-0002`, `CHR-0013`, or `CHR-0017`.
- **Owner Decision Required:** Approve or reject before creating concept art or assigning any canonical `CHR-####` ID.

## Packet 4 — Cross-Generation `CHR-0001`..`CHR-0019` Identity Crosswalk
- **Reference:** `docs/CHARACTER_GAP_RESEARCH.md` (19-row audit across MW-II, MW-XII, V10/V10.1, ROCKSOUL, MW-XV).
- **Guardrail:** All `UNRESOLVED` cross-generation pairs remain unmerged; `CAN-0011` / `CAN-0014` / `CAN-0015` exclusions remain permanently enforced.
