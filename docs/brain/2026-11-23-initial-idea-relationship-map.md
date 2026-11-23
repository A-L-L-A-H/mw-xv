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
