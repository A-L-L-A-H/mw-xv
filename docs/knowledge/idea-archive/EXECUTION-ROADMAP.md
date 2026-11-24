# Execution Roadmap — Knowledge Archive to Product Delivery

**Snapshot:** 2026-11-23 · **Status:** sequencing proposal  
Execution status belongs in TaskOS. This roadmap is a navigation plan, not a parallel task lifecycle tracker.

## Delivery lanes

- **LOCAL AI:** small atomic work, repository-local tests, source extraction, doc maintenance and code tasks with explicit acceptance.
- **CLOUD AI:** cross-project research, comparative source audit, synthesis, relationship analysis, large document review and external source verification.
- **HUMAN REVIEW:** canon, theology, private data, copyright/rights, publication, product decisions and security-sensitive approvals.

## Phase sequence

| Phase | Workstream                                                   | Priority | Primary lane                       | Dependencies                                                      | Ready state / exit condition                                                                    |
| ----- | ------------------------------------------------------------ | -------- | ---------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| P0    | Full source access / memory export inventory                 | P0       | HUMAN REVIEW + LOCAL AI            | ChatGPT export, local drives, repo access                         | Each source has access, classification, rights and retention decision                           |
| P1    | Public repo inventory / exact refs / private-resource census | P0       | CLOUD AI + LOCAL AI                | GitHub access, owner-controlled mirror targets                    | Every in-scope source and non-repo resource is enumerated; blockers remain explicit             |
| P2    | Mirror / LFS / backup / restore proof                        | P0       | LOCAL AI + HUMAN REVIEW            | P1, storage, secrets owner                                        | Two controlled restore-tested copies per required source; no source retired                     |
| P3    | Story / canon / character recovery                           | P1       | CLOUD AI + HUMAN REVIEW            | authorized original manuscripts and repo artifacts                | Story Bible / character IDs tied to exact sources; owner resolves conflicts                     |
| P4    | Religious / textual reference verification                   | P1       | CLOUD AI + HUMAN REVIEW            | exact editions, translation, source rights                        | Source text, translation, tafsir, personal reflection and visual analogy separated and reviewed |
| P5    | Creative / visual recovery and art registry                  | P1       | CLOUD AI + LOCAL AI + HUMAN REVIEW | original master files, prompt history, rights                     | Asset manifest and visual bible have source, rights, review, variants and status                |
| P6    | Project / brand / product portfolio decisions                | P1       | CLOUD AI + HUMAN REVIEW            | P3–P5 discovery and current MW-XV owner map                       | Integrated vs independent vs archive/defer decided per project                                  |
| P7    | MW-XV architecture / feature readiness                       | P1       | LOCAL AI + CLOUD AI                | accepted product scope                                            | Existing domain owners mapped; no duplicate IAM/ORM/assets/AI/runtime                           |
| P8    | TaskOS / GitHub issue reconciliation                         | P1       | LOCAL AI + HUMAN REVIEW            | accepted scope; TaskOS contract                                   | Canonical task source updated through safe workflow and bounded managed issue sync              |
| P9    | Feature vertical slices                                      | P2       | LOCAL AI + HUMAN REVIEW            | all accepted dependencies                                         | Small units pass exact-SHA CI, browser/accessibility and security checks                        |
| P10   | Public release / source retirement                           | P0 gate  | HUMAN REVIEW + LOCAL AI            | all archive, rights, restore, CI, deployment and dependency tests | Explicit approval, no unresolved preservation risk, tested rollback/redirects                   |

P0 preservation is a prerequisite for any old repository retirement, not necessarily a prerequisite to continue all MW-XV development.

## Parallelism and ownership

| Lane         | Work it can do independently                                                                                                   | Must not do                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| LOCAL AI     | parse source metadata, update registry docs, implement accepted small tasks, unit/integration tests, generate hashes/manifests | alter locked canon, publish private content, bypass risk gates, bulk copy legacy assets                  |
| CLOUD AI     | compare source docs, classify claims and gaps, research external standards, map ideas/projects, draft proposals                | treat a README as proof of deployment, ingest private data, auto-approve religious/canon/right decisions |
| HUMAN REVIEW | decide canon, aliases, publication, private-data consent, rights, product MVP, security exceptions and retirement              | approve an artifact without provenance or exact review context                                           |

## Ready / blocked rules

- Ready means all dependencies, source files, owner, acceptance and verification steps are present.
- Blocked means a specific source, consent, rights, external test, human decision or dependency is missing.
- Research-first is not implementation authorization.
- Documentation-only work does not automatically create a new TaskOS task or app version.
- Issue writing follows `docs/roadmap/ISSUE-SYNC-CONTRACT.md`; no issue can close merely because a PR merged.

## Existing issue entry points

| Existing issue | Workstream                                                   | Current use                                                                                       |
| -------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| #15            | Extension / Community / Experience / architecture boundaries | proposal; accept only bounded gaps                                                                |
| #16            | MoonWitness product vision, Message and Radio                | product research and decision                                                                     |
| #17            | GOD PROMISE / ROCKSOUL content workflow                      | source-backed editorial work                                                                      |
| #18            | Asmaul Husna source dataset and visual concepts              | reference and rights review                                                                       |
| #19            | Artwork-first creative pipeline                              | use existing asset / UI Catalog                                                                   |
| #20            | Research and evidence methods                                | reproducible research workflow                                                                    |
| #21            | Desktop AI harness evaluation                                | reuse existing Tauri / risk-gate architecture                                                     |
| #22            | AEQ / BABYDOLL                                               | preserve independent concept; owner decision                                                      |
| #27            | bjo163 source preservation / retirement                      | P0 mirror / rights / restore / non-import gate                                                    |
| #173           | CRAYON v1.3 and companion-paper version reconciliation       | framework source review; keep distinct from RGBL                                                  |
| #174           | Dīn Allah / Universal Iman Foundation four-book charter      | edition, source-witness and evidence-layer review                                                 |
| #175           | Quantum–Fe Stone Energy                                      | separate safe low-temperature thermal path from lab-only ferrite research                         |
| #176           | MoonWitness RPG / 25-prophet concept vs The Lost Signal      | preserve separate game lineages pending first-source recovery                                     |
| #177           | MoonWitness OS v2.0 / Mīzān model                            | recover first source and verify scale / axis definitions before canonization                      |
| #178–#181      | Four MoonWitness story leads                                 | recover one primary source / revision chain per title; keep every record draft until owner review |
| #182           | 22-file MoonWitness Library foundation pack                  | content/provenance audit only; no code import or project merge                                    |
| #183           | Total Idea Archive completion parent                         | coordinate source recovery, review and human decision gaps; link bounded child issues             |
| #184           | TaskOS `AUD-024`                                             | managed projection for tablet Axe coverage; lifecycle remains in canonical TaskOS                 |
| #185           | 203 Library PNG provenance                                   | private metadata index; no public file IDs, raw image upload or assumed rights                    |
| #186           | TaskOS `AUD-009`                                             | managed projection for logger I/O/redaction work; lifecycle remains in canonical TaskOS           |
| #187           | Private ChatGPT export intake                                | owner-supplied private/local export; privacy and retention review before parsing                  |

There are also current engineering tasks and managed Issues for cloud foundation, A2A identity, jobs/outbox, SceneLab, UI visual review, CI and the roadmap. Do not create new work where a current task already owns the same files or acceptance.

## Current execution state

- Knowledge archive: initial stable catalog and bibles are committed on `dev` (see archive index).
- Repository census: 280 accessible repo records; exact public CSV is committed; deep audit remains incomplete.
- TaskOS: dev 637 unique tasks; 96 todo, 49 doing, 24 blocked, 468 done at blob `4d677b63`; main remains at 627.
- Story / canon: II and XII exact source records sampled; full manuscript recovery is open.
- Issue consolidation: #15–#22 and #27 remain the original product/source entry points; un-managed proposals #173–#183, #185 and #187 cover source-recovery / archive discovery, while #184 and #186 are TaskOS-managed projections. The current issue index records 161 issues and 26 PRs.
- Promotion / CI: automatic PR #81 remains a separate protected promotion batch. Do not merge or claim release from archive-doc commits alone.
