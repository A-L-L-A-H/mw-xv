# Initial Idea Relationship Map — 2026-11-23

**Record:** `BRAIN-ARCHIVE-0001`  
**Classification:** `PROPOSAL` — provisional synthesis from the supplied intake and existing MW-XV proposal records  
**Status:** `PROVISIONAL`; no canon changes and no feature authorization  
**Source intake:** [Total Idea Archive — Initial Intake](../raw/2026-11-23-total-idea-archive-intake.md)

## 1. Purpose

This document links the concepts explicitly named in the current intake to existing MW-XV proposal records. It is not a reconstruction of the user's full creative history, and it does not establish that similarly named projects share one universe, brand, product or canon.

## 2. Provisional relationship map

| Concept / workstream | Primary role in the current map | Existing record | Relationship decision |
|---|---|---|---|
| MoonWitness | Product / shared experience | [Issue #16](https://github.com/A-L-L-A-H/mw-xv/issues/16) | Product umbrella proposal; radio, messages, community and progression remain separately scoped |
| MoonWitness Radio | Audio / radio experience | [Issue #16](https://github.com/A-L-L-A-H/mw-xv/issues/16) | Product sub-experience; do not create a second storage, publication or notification owner |
| GOD PROMISE | Editorial / reflection format | [Issue #17](https://github.com/A-L-L-A-H/mw-xv/issues/17) | Keep its own editorial rules and source attribution |
| ROCKSOUL | Personal reflection / creative framework | [Issue #17](https://github.com/A-L-L-A-H/mw-xv/issues/17) | Related editorial track, but not automatically the same canon as GOD PROMISE |
| Asmaul Husna | Religious reference dataset and visual concept map | [Issue #18](https://github.com/A-L-L-A-H/mw-xv/issues/18) | Source/reference domain; visual concepts remain editorial metadata and must not define theology |
| Qāf Kāf kahf Kun | Concept label | [Issue #17](https://github.com/A-L-L-A-H/mw-xv/issues/17) | Link to GOD PROMISE as a recorded label only; meaning and historical development remain unresolved |
| HISTA | Framework label | [Issue #17](https://github.com/A-L-L-A-H/mw-xv/issues/17) | Preserve as a distinct framework seed until original definition and use are sourced |
| ANGEL WITH SHOTGUN | Creative / narrative label | [Issue #17](https://github.com/A-L-L-A-H/mw-xv/issues/17) | Keep as creative work; do not convert narrative symbolism into religious doctrine |
| Isa/Yesus | Religious / narrative topic | [Issue #17](https://github.com/A-L-L-A-H/mw-xv/issues/17) | Topic label only; source, canon and representation decisions require human review |
| AEQ / BABYDOLL Service Jam | Exploratory initiative | [Issue #22](https://github.com/A-L-L-A-H/mw-xv/issues/22) | Keep independent / unresolved; no automatic integration into MoonWitness |
| Artwork-first pipeline | Cross-cutting creative workflow | [Issue #19](https://github.com/A-L-L-A-H/mw-xv/issues/19) | Enables reviewed visual assets; not a new creative universe or asset manager |
| Evidence / source comparison | Research method | [Issue #20](https://github.com/A-L-L-A-H/mw-xv/issues/20) | Supports claims and provenance; does not decide creative canon by itself |
| Desktop AI harness | Internal engineering tool | [Issue #21](https://github.com/A-L-L-A-H/mw-xv/issues/21) | Supports controlled execution; separate from user-facing story and content canon |
| Extension Hub / Community / Experience | Product architecture proposal | [Issue #15](https://github.com/A-L-L-A-H/mw-xv/issues/15) | Parent proposal only; do not implement unapproved packages or duplicate existing owners |

## 3. Existing system ownership to reuse

The target's current architecture and proposal records indicate these intended owners:

- Scripture passages, editions and source provenance: existing `packages/corpus`.
- Evidence comparison and analysis: existing `packages/research`.
- Knowledge, editorial records, review and publication: existing `packages/orm-knowledge` and related workflows.
- Original artwork, variants, licenses and provenance: existing `packages/assets`.
- Product experience: existing `apps/board`.
- Desktop local execution: existing `apps/desktop` plus `packages/ai-runtime` / `packages/ai-mcp`.
- Cross-project work lifecycle: canonical TaskOS under `docs/tasks/`, not a second manually maintained issue list.

This is a reuse map derived from current MW-XV proposal/documentation; each detailed implementation still requires source inspection and acceptance evidence.

## 4. Canon and editorial protection

- Do not merge GOD PROMISE, ROCKSOUL, HISTA, ANGEL WITH SHOTGUN, AEQ/BABYDOLL or MoonWitness into one canon merely because they appear in one prompt.
- Preserve exact names, punctuation, capitalization and spelling as seen in the source; log later corrections as new revisions.
- Maintain separate fields for source text, translation, tafsir / scholarly commentary, personal reflection, metaphor and fictional narrative.
- Treat any numbering or sequence as locked only when an explicit user decision and source history prove it.
- Do not use an illustration as evidence for a religious or historical claim.
- Respect the explicit restriction against depicting Allah as a human, character or visual object.

## 5. Existing TaskOS dependencies and gaps

Existing TaskOS items already cover much of the underlying infrastructure:
- `K5-001` — local-only memory/archive ingestion manifest (recorded as done).
- `K5-002` — privacy redaction, revocation and retention controls (recorded as doing).
- `K5-003` — original/correction/provenance domain (recorded as doing).
- `K5-004` — story, episode, page/media manifest contracts (recorded as doing).
- `K5-005` — character canon and personal terminology reconciliation (recorded as doing).
- `M13.08` — Plan Forge / Memory Ledger document proposal export (recorded as done).

The actual completion criteria and evidence remain authoritative. The existence of these tasks does not prove every feature or every source archive is complete.

## 6. Unresolved decisions

1. The full relationship graph between the named concepts and any larger story universes.
2. First-known dates, original wording variants and correction history for each concept.
3. The detailed story, episode, character, alias and timeline catalog.
4. Which items are formal canon, exploratory fan concepts, creative inspiration or retired drafts.
5. Whether any concept outside MoonWitness is an independent project, a sub-brand, a campaign or only a personal note.
6. Which private sources may be used, for what purpose, and under what consent, retention and publication limits.

Do not resolve these by inference. Keep them `UNRESOLVED` until the original source or an explicit owner decision is available.

## 7. Backlog decision

No new GitHub issue is created by this initial map. Existing issues #15–#22 already cover the identified product, editorial, visual, research and concept proposals; #27 covers source-repository preservation. New execution tasks should be added only after checking those issues and the canonical TaskOS workflow in `docs/roadmap/ISSUE-SYNC-CONTRACT.md`.

**Next valid step:** source-by-source intake and evidence-backed triage. Do not mark the wider archive complete on the basis of this map.


## 8. Existing story, character and canon archive — reuse, do not recreate

The following public research documents already exist in the target. They are valuable source maps, but their own status warnings must travel with every downstream record:

- [Narrative archive index](../knowledge/narratives/INDEX.md)
- [V10.1 expanded narrative](../knowledge/narratives/MASTER_NARRATIVE_V10_1_EXPANDED.md)
- [V10 public draft / 99-chapter index](../knowledge/narratives/MASTER_NARRATIVE_V10_PUBLIC_DRAFT.md)
- [Source crosswalk](../knowledge/narratives/SOURCE_CROSSWALK_V10.md)
- [Historical progress ledger](../knowledge/narratives/PROGRESS_LEDGER_2023_2026.md)
- [V10 recovery gaps](../knowledge/narratives/RECOVERY_GAPS_V10.md)
- [Revelation / witness / canon / edition identity contract](../knowledge/revelation-identity.md)

**Status warning:** V10.1 explicitly describes itself as a public expanded research edition, not the original V9/V10 transcript and not approved final canon. Its private-source leads are not permission to retrieve, reconstruct or publish missing manuscripts. The 2023–2025 chronology contains historical leads, not a forensic timeline.

### Story structure already documented

The public narrative source records:
- A 99-chapter V10 editorial index and a 16-part V10.1 expanded companion.
- MoonWitness II as a story / witness platform concept with the sequence `CAPTURE → CONNECT → WITNESS → UNDERSTAND → PRESERVE → PROMOTE → MOVE FORWARD`.
- Thirteen named functions: Storytelling, Exposure, Change Advisory Board, Chasing Heart, Lovestruck, Breath Electric, Seduction, Fault Lines, Villain of the Story, Witness Archive, Sanity’s Last Breath, Past Presence and Promoting.
- Eight era labels: BEFORE LIGHT, THE ARRIVAL, THE WITNESS, THE RUNAWAYS, THE EXPOSURE, THE CHANGE, END OF AN ERA and NEXT PHASE.

These are `REPOSITORY-DOCUMENTED` editorial / lore records, not automatically a released product, verified external history or final author-approved canon. Retain their original files and their status labels.

### Character and alias handling

The public V10.1 text contains character candidates including THE SHADOW (number 00), A LAH / THE BOSS, DOGS FROM UNIVERSE, THE BLUE WITCH, DJ DAVID and other II / XII-era names. It lists multiple alias candidates and explicitly warns that alias similarity does not establish identity.

Use `UNKNOWN` / `UNRESOLVED` when identity is not evidenced. Keep persona, alias, appearance, source passage and identity decision as separate records. Do not combine names because they resemble each other or a real / religious figure.

### Existing unresolved continuity and source gaps

The V10 recovery-gap register already lists, among others:
- `00-MAIN GOD PROMISE` versus ROCKSOUL as distinct source leads requiring original-source recovery.
- World Patch #014 wording conflict: FAMILY WITHOUT FEAR versus THE WRONG WAY / HELLROAD.
- The Batteries four books and NPD 24:27 / 24:37 / 25:50 source and page-order gaps.
- Candidate alias conflicts across THE SHADOW, DOGS FROM UNIVERSE, ROCKSOUL, 4-LAH and WALTER variants.
- ZILL shadow-optics research versus ZILL tasawuf narrative as separate source leads.
- MYLUFT / MA’LŪF / AL-WADŪD / Honey / Queen R terminology requiring source separation.
- The distinction between historical dates, observation times, writing times and later corrections.

Preserve the gap register as a review queue. Do not convert it into new duplicate issues without checking the crosswalk and existing TaskOS tasks.

### Religious reference identity

The existing identity contract differentiates:
- `RevelationIdentity` — named revelation identity;
- `TextualWitness` — a specific source-backed textual witness;
- `Canon` — a tradition-scoped canon / collection classification;
- `Edition` — a publication or representation of a textual witness.

These are not interchangeable. Canon membership does not prove revelation identity; textual similarity does not establish identity equivalence. Preserve the source's evidence and version before any interpretive relationship is accepted.

### Archive decision

No second Story Bible, Character Bible or canon database is created here. The files above remain the source-backed public narrative archive. The new intake and this map act only as a navigation layer connecting current user-provided concepts to the existing evidence and unresolved gaps.


## 9. Backlog and TaskOS snapshot — 2026-11-23

This is a point-in-time read-only audit; it is not a replacement lifecycle registry.

### TaskOS

The canonical `docs/tasks/tasks.json` was read and parsed:
- 636 task records, 636 unique task codes, zero duplicate codes.
- Status distribution: 468 `done`, 49 `doing`, 97 `todo`, 22 `blocked`.
- Source groups: roadmap 239; audit 23; WhatsApp 112; archived open MW 7; AI Corporation PR lifecycle 14; Desktop 128; Evolution 4; Visual Universe 109.
- Two registered projects: `moonwitness` and `visual-universe`.

TaskOS README snapshot has an internal documentation inconsistency: its current-registry section reports 636, while residual migration/core-file sentences still say 627. This is a documentation discrepancy, not evidence that the JSON contains only 627 tasks. It has not been edited in this archive pass.

### GitHub Issues / Pull Requests

A paginated all-state audit of `/issues` filtered out pull-request objects, as required by the issue-sync contract:

| Object type | Total | Open | Closed |
|---|---:|---:|---:|
| GitHub Issues | 146 | 51 | 95 |
| Pull Requests returned by the Issues endpoint | 26 | 2 | 24 |

Among the 146 issues, 23 contain a TaskOS managed marker. All 23 marker identities are unique; no duplicate TaskOS markers were detected in the returned issue set.

Issues #15–#22 and #27 are still open. They already cover the expansion boundary, MoonWitness product vision, GOD PROMISE / ROCKSOUL editorial work, Asmaul Husna reference, artwork pipeline, research workflow, desktop AI evaluation, AEQ / BABYDOLL and source consolidation. This archive pass creates no duplicate issue and does not promote their proposals to accepted implementation tasks.

### Promotion and verification boundary

The `dev` branch contains the three new archive / inventory documents and their validation edits. The automation opened or refreshed [PR #81](https://github.com/A-L-L-A-H/mw-xv/pull/81), targeting `main`; it remains open and unmerged. Its diff includes a wider pre-existing development batch, not only this archive documentation. The latest exact-SHA CI and documentation checks were still pending when inspected. No successful merge, release or deployment is claimed.


## 10. Canonical archive navigation

The detailed, source-qualified archive now lives in [`docs/knowledge/idea-archive/README.md`](../knowledge/idea-archive/README.md). It links the idea catalog, project registry, canon registry, story and character bibles, visual/brand/product archives, religion/philosophy archive, history, repository report, unified proposal, execution roadmap, unresolved decisions and issue index.

This Brain document remains the first relationship synthesis. It must not be treated as the full archive or as a canon authority. Where its earlier provisional statements differ from an exact source in the archive, prefer the cited source file and keep the difference visible for review.
