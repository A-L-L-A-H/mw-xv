# Visual Authority Crosswalk

**Snapshot:** 2026-11-24 · **Status:** `ADDITIVE / NO APPROVAL CHANGED`  
**Why:** visual direction currently lives in two places — an **approved production direction** inside the visual-universe pack, and a **descriptive archive bible** inside this knowledge layer. They are not the same kind of document. This crosswalk says which one answers which question so no agent invents a third authority.

## 1. The two documents

| Authority | Path | Nature | Status |
|---|---|---|---|
| Approved XV visual direction | `docs/bundles/visual-universe-pack/evidence/visual-universe-bible-approved.md` | Normative brief for **new visual-universe production** | **Approved by the owner 2026-11-22** |
| Visual World Bible (production companion) | `docs/bundles/visual-universe-pack/VISUAL_BIBLE.md` | Detailed continuity rules (world, character, environment, motion, exclusions) | Pack document; inherits the approved direction |
| Creative & Visual Bible (archive) | `CREATIVE-VISUAL-BIBLE.md` | Descriptive map of **all generation families** (II, GOD PROMISE, XII, ROCKSOUL, A-L-L-A-H.COM, research poster), plus rights and sacred boundaries | Archive record, not an approval |

## 2. Precedence rules

| Question | Answer from | Note |
|---|---|---|
| How should **new MoonWitness XV** artwork look? | Approved direction + `VISUAL_BIBLE.md` | This is the only approved production brief. |
| How did **MoonWitness II / XII / ROCKSOUL / GOD PROMISE** look? | Archive `CREATIVE-VISUAL-BIBLE.md` §1 | Historical/descriptive; do not retroactively restyle. |
| May Allah, prophets or sacred figures be depicted? | [CAN-0011](CANON-REGISTRY.md) + archive §4 + approved "Do not depict Allah or sacred figures" | `LOCKED` boundary. Agreement across all sources; no reinterpretation. |
| May franchise characters, silhouettes, poses or panel layouts be copied? | Archive §5 + approved "Do not reproduce copyrighted characters…" | Rights boundary, not style preference. |
| Which palette, fonts and asset packages are reusable? | Approved direction → `packages/ui/TOKENS.md`, licensed fonts, `packages/assets` | Archive §6 documents the existing pipeline; it does not grant new rights. |
| Which motion approach? | Approved: CSS/SVG-first, Motion package retained pending measured requirement | Specialist/paid engines require new explicit approval. |
| Is a **pilot character identity** approved? | **No.** Separate gate in approved direction | Do not claim approval from this crosswalk. |
| Is a **final hero composition** approved? | **No.** Separate gate in approved direction | Moon City layer work may proceed; final composition may not be called approved. |

## 3. Apparent conflicts that are actually generation differences

- Archive "funky street-comic" (XII) vs approved "manga/zine-inspired ink contour, restrained cel shading, photocopy grain" (XV) — **different generations**, not a contradiction.
- Archive "metal / industrial / absurd" (ROCKSOUL) vs approved "restrained editorial/cinematic accents" (XV) — **different project families**.
- Archive "Lines / cinematic witness" (II) vs approved "layered urban night environment" (XV Moon City) — **different eras/worlds**.

None of these should be merged, re-labelled or "reconciled" into one style. The archive's purpose is to keep them distinct.

## 4. Shared exclusions (identical across authorities)

1. No depiction of Allah, prophets or sacred figures.
2. No reproduction of third-party characters, franchise silhouettes, costumes, marks, panel layouts or signature poses.
3. No invention of factual stories, places, metrics or signals as if real.
4. No identification of real crew/users in artwork.
5. No raw Library image bytes or unlicensed fonts copied into this public archive.

## 5. Maintenance rule

If the owner approves a new visual rule, update the **approved evidence file first**, then reflect the pointer here. Do not edit this crosswalk to grant approval. If a historical family gains a new source, update `CREATIVE-VISUAL-BIBLE.md` and regenerate [INDEX.json](INDEX.json). Visual assets themselves remain tracked in [LIBRARY-SOURCE-REGISTER.md](LIBRARY-SOURCE-REGISTER.md) and the asset manifest, not in this document.

## 6. Open visual gates (owner decisions, not AI decisions)

- Pilot character identity approval.
- Final Moon City hero composition approval.
- Per-image prompt/revision/rights review for the Library PNG families (#185, #188, `UNR-0043`).
- Source recovery for original poster masters and approved revisions (`UNR-0026`).
