# Repository Consolidation Report — bjo163 to A-L-L-A-H/mw-xv

**Audit date:** 2026-11-23 · **Target:** `A-L-L-A-H/mw-xv` · **Branch:** `dev`  
**Related owner decision:** K0-006 no-legacy-import boundary · **Tracking:** [Issue #27](https://github.com/A-L-L-A-H/mw-xv/issues/27)

## 1. Scope and evidence

### Repository metadata census

GitHub repository search `user:bjo163` returned:

| Search page | Results |
|---|---:|
| 1 | 100 |
| 2 | 100 |
| 3 | 80 |
| 4 | 0 |
| **Total** | **280 unique** |

| Visibility | Count |
|---|---:|
| Public | 148 |
| Private | 132 |
| Archived among public results | 1 |
| **Total** | **280** |

All 148 public repository names matched the existing MW-XV public inventory CSV. The only archived public repository returned was `bjo163/moonwitness-memory`.

Files:
- [Public inventory snapshot 2026-11-23](../../migration/inventory/bjo163-public-repositories-2026-11-23.csv)
- [Metadata search evidence](../../migration/ACCESSIBLE-REPO-SEARCH-SNAPSHOT-2026-11-23.md)
- [Existing legacy source matrix](../../migration/SOURCE-MIGRATION-MATRIX.md)
- [Retirement gates](../../migration/MIGRATION-ACCEPTANCE.md)

### 2026-11-24 endpoint cross-check (additive)

A later pass re-queried the same owner with a different GitHub API endpoint. The counts are **endpoint-specific and must not be collapsed into one fact**:

| Query | Result | Note |
|---|---:|---|
| 3 × paginated `GET /search/repositories?q=user:bjo163` (2026-11-23) | 280 | 148 public + 132 private; the census used above |
| `GET /search/repositories?q=user:bjo163&per_page=1` (2026-11-24) | 90 | current search index result |
| `gh repo list bjo163 --limit 500` (2026-11-24) | 150 | 148 public + 2 private + 1 archived (`moonwitness-memory`) |

The 148-public figure is stable across the 2026-11-23 and 2026-11-24 observations. `moonwitness-memory` was verified as archived on 2026-11-24 and its README describes a **local** ChatGPT-ZIP ingestion engine (import, SHA-256, SQLite/FTS5, Gemini extraction, optional Drive backup). It is an intake *tool*, not the source export itself; no conversation history was recovered from it. Any future count in this report must name the endpoint and date used. No repository was created, modified, archived or deleted by either pass.

### Depth of audit

| Level | Count | Work performed |
|---|---:|---|
| Repository metadata | 280 | Name, visibility, default branch, size and archived state via GitHub search |
| Public README + root tree selected review | 30 | README and root-level directory/file inventory |
| Public metadata only (not deep-read) | 118 | In CSV with `METADATA_ONLY` |
| Private metadata only | 132 | Counted and intentionally not named or content-inspected in public report |
| Complete code/security/license audit | 0 | Not claimed |

The 30 selected repositories were chosen because they are directly related to MoonWitness, ROCKSOUL research/creative systems, A-L-L-A-H / Empire, UI, assets, messaging, AI, ontology or semantic-engine work. A README/root-tree review is not a substitute for source implementation review, test execution, dependency/license audit or live runtime verification.

### Inspected source files

The selected repository review included README and root-tree reads for:
`moonwitness-II`, `moonwitness-xii-season-global-championships`, `A-L-L-A-H`, `A-L-L-A-H.COM`, `dev-mw-blueprint`, `rocksoul-mftl`, `moonwitness-corpus`, `rocksoul-assets`, `rocksoul-ui`, `moonframe`, `moonsky`, `empire-of-the-light`, `rocksoul-community`, `rocksoul-platform`, `rocksoul-superhero`, `rocksoul-legend`, `rocksoul-correlation`, `rocksoul-jizz`, `rocksoul-game`, `rocksoul-world`, `rocksoul-aws`, `antikythera-time`, `universal-ontology-engine`, `witness-semantic-engine`, `moonwitness-memory`, `moonwitness-reborn`, `moonwitness-xiv`, `moonwitnessxv`, `rocksouldx`, and `agilty`.

Additional selected exact document reads:
- MoonWitness II `data/characters.yaml`, `data/eras.yaml`, `data/stories.yaml`, `docs/WORLD_RULES.md`, `docs/MASTER_BLUEPRINT.md`.
- MoonWitness XII `docs/CHARACTER_CANON_V3_AND_ROADMAP.md`, `docs/MASTER_BUG_PATCH_33_V2.md`, `docs/CONCEPT_SOURCE_INVENTORY_2026-10-21.md`.
- `bjo163/A-L-L-A-H/docs/MASTER_BLUEPRINT.md`.
- `bjo163/A-L-L-A-H.COM/GOAL.md`.

These exact files and blob identifiers are recorded in the archive's Story Bible and relationship map. They are source pointers, not import authorization.

## 2. Repository group inventory

The 148-public-row CSV groups the current visible public owner search into preliminary thematic categories:

| Preliminary group | Public repos | Audit interpretation |
|---|---:|---|
| MoonWitness | 17 | Story/product generations and associated platform experiments |
| ROCKSOUL research / creative | 17 | STORY/EVENT/PERSON/TEXT/LAW/PERSPECTIVE/RELATIONSHIP, UI and assets |
| Empire / religion / knowledge | 3 | A-L-L-A-H / Empire knowledge and source frameworks |
| AI agent platform | 12 | Agent frameworks, provider aggregation, model/automation experiments |
| Messaging / media automation | 10 | WhatsApp, channel and media automation |
| ISP / network infrastructure | 19 | ISP, DNS, network, OLT and observability-related tools |
| Platform / data / tooling | 10 | Databases, search, platform and developer tooling |
| Other / unclassified | 60 | Historical, generic, personal, unrelated or not yet examined |
| **Total** | **148** | Group assignment is a first-pass label, not a legal or ownership determination |

Private repositories are not distributed by theme in the public CSV/report because exposing their names or descriptions is not required to record the count.

## 3. Selected source matrix

| Repository | Purpose from inspected README | Current evidence / maturity | Relation to MW-XV | Recommended disposition |
|---|---|---|---|---|
| `moonwitness-II` | Story & Witness platform, eras, stories, character data, world rules | Public content YAML, app and tests in root tree; lore records include `review` and `draft` | Story/canon reference | REFERENCE_ONLY |
| `moonwitness-xii-season-global-championships` | Static editorial archive and championship registry | Next.js static data, 33 indexed slots; explicit source/approval caveats | XII history and patch concepts | REFERENCE_ONLY |
| `moonwitness-xiv` | Earlier TypeScript monorepo lineage | Apps, packages, corpus, docs, tests, deployments in root tree | Architecture and history | REFERENCE_ONLY |
| `moonwitnessxv` | Earlier XV program blueprint | Multiple app/system specs; README says some milestones planned-only | Architecture/source history | REFERENCE_ONLY |
| `A-L-L-A-H` | Empire command center / UNILEX / ARSY blueprint | Repo docs say design baseline proposed, not production certified | Knowledge/agent governance reference | RESEARCH_FIRST |
| `A-L-L-A-H.COM` | Unified MoonWitness / Empire product hub | README / GOAL declares multi-surface Fastify/Next platform; needs source/runtime verification | Product lineage | RESEARCH_FIRST |
| `dev-mw-blueprint` | GOD-PROMISE / MIZAN / governance contracts | Rust crates, JSON contracts and fixtures visible | Research and concept reference | REFERENCE_ONLY |
| `moonwitness-corpus` (RGBL lineage) | Exact text / scripture corpus | Dataset, rights, editions and source metadata structures visible | MW-XV corpus/research | RESEARCH_FIRST; no import |
| `rocksoul-mftl` | Narrative/belief intelligence | Source-first STORY corpus | Research story domain | CLEAN_ROOM_REBUILD only after owner rights gate |
| `rocksoul-legend` | Event/history intelligence | Source/counterevidence model | Research event domain | CLEAN_ROOM_REBUILD only after owner rights gate |
| `rocksoul-superhero` | Actor/person/witness/transmission | Source-first actor chain | Research identity / provenance | CLEAN_ROOM_REBUILD only after owner rights gate |
| `rocksoul-aws` | “ANGEL WITH SHOTGUN”; LAW analysis | Legal authority and jurisdiction model | Research law domain | REFERENCE_ONLY; legal review required |
| `rocksoul-jizz` | Perspective and framing intelligence | Staged source research and perspective model | Research perspective domain | CLEAN_ROOM_REBUILD only after owner rights gate |
| `rocksoul-correlation` | Typed relation / public evidence graph | Domain map and uncertainty rule | Cross-domain links | CLEAN_ROOM_REBUILD only after owner rights gate |
| `rocksoul-assets` | Canonical visual source/asset packs | README claims release v1.3.1 / 1,544 delivery assets; individual rights not audited | MW-XV `packages/assets` | REFERENCE_ONLY; rights per source |
| `rocksoul-ui` | Production-oriented React UI grammar | Distinct package/source and test folders | MW-XV `packages/ui` | REFERENCE_ONLY |
| `moonframe` | React components, skins and page templates | README reports component/template inventory, but human sign-off incomplete | Existing UI Catalog comparison | RESEARCH_FIRST |
| `rocksoul-community` | Community participation interface | Active route surface; proposals noncanonical until review | Proposed Issue #15 | RESEARCH_FIRST |
| `rocksoul-platform` | Admin / IAM / access authority | Role and permission contracts | MW-XV auth / organization | DO_NOT_IMPORT; use target auth |
| `moonsky` | Standalone messaging console | Own PostgreSQL schema and operator identity | MW-XV integration/WhatsApp | RESEARCH_FIRST |
| `rocksoul-game` | THE LOST SIGNAL narrative game | README says preproduction; local demo exists, no final canon or production game claim | Optional story/game experience | REFERENCE_ONLY |
| `rocksoul-world` | Local-first Rust world runtime | Cargo workspace and runtime docs | Desktop / experience research | REFERENCE_ONLY |
| `rocksouldx` | OpenCode-based coding workbench and ROCKSOUL FLOW | FLOW is a roadmap/plan, not all shipped | MW-XV desktop/AI harness | RESEARCH_FIRST |
| `antikythera-time` | M-Time temporal software | Software-only; v1 remains blocked on external review | Calendar/time research | REFERENCE_ONLY |
| `universal-ontology-engine` | OX-DX Rust ontology engine | Rust crates, schema/spec/test directories | MW-XV ontology comparison | RESEARCH_FIRST |
| `witness-semantic-engine` | Downstream semantic candidates | Milestones implemented/review-pending by README | Research comparison | RESEARCH_FIRST |
| `moonwitness-memory` | Local ChatGPT archive intelligence | Repository marked archived; README describes ZIP archive ingestion | Archive intake reference | METADATA_ARCHIVE / REFERENCE_ONLY |
| `moonwitness-reborn` | Earlier TypeScript model-driven addon/agent platform | Monorepo and CI docs visible | Architecture lineage | REFERENCE_ONLY |
| `agilty` | GPT4Free/g4f | README identifies GPT4Free project; raw repository metadata says fork | Model/provider experiment | DO_NOT_IMPORT as a claimed original AGI system |

**Maturity caveat:** the recommendations above are conservative first-pass dispositions from README/docs/root-tree, not full legal/security/code assessments. K0-006 remains the current import boundary.

## 4. Critical findings

1. **Many repositories encode distinct domain ownership.** MFTL (STORY), LEGEND (EVENT), SUPERHERO (PERSON), corpus/RGBL (TEXT), AWS (LAW), JIZZ (PERSPECTIVE) and CORRELATION (RELATIONSHIP) explicitly state separate source owners. This argues against flattening them into one untyped store.
2. **There are multiple platform generations and prototypes.** MW II, XII, XIV, older XV and current MW-XV should be recorded as a lineage, not copied into parallel runtime apps.
3. **Visual assets and UI are separately governed.** `rocksoul-assets`, `rocksoul-ui` and `moonframe` have their own manifests, builds and release contracts; MW-XV already owns `packages/assets`, `packages/ui` and `apps/ui-catalog`.
4. **Community is not canonical research truth or IAM.** Source README keeps discussion, proposal and public profile separate from the Platform identity and the research-domain records.
5. **MOONSKY is a standalone operator/messaging system.** It has its own DB and operator identity; it is not automatically MoonWitness Radio nor MW-XV IAM.
6. **MoonWitness Memory could support local archive preservation, but no ChatGPT export was supplied.** Its readme says it can preserve uploaded ZIPs and extract records; it does not authorize a public import of private conversation material.
7. **AGI branding must not overstate repository identity.** `agilty` is identified in its README and raw GitHub metadata as a GPT4Free/g4f fork.
8. **The old archive namespace is not ready for retirement.** Mirror, exact refs, LFS, releases, issues, packages, deployments, rights and restore drills remain P0 gates.

## 5. Preservation and import decision

The current owner-approved K0-006 boundary remains active:
- No legacy code, corpus record, data, prompt, fixture, artwork, font, sound or private conversation bytes are imported into MW-XV under the current scope.
- No bulk code copy and no second ORM/IAM/storage/AI runtime/UI system.
- Public visibility does not grant redistribution rights for every asset or source-derived dataset.
- Unknown source rights or missing consent means no bytes are redistributed.
- If future imported material is needed, K0-006 must be explicitly reopened and a source-specific manifest must identify repo/ref/commit/path/blob/hash/license/rights/privacy/target path/reviewer/test/delivery evidence first.

## 6. P0 preservation gaps

Not audited / not proven by the current metadata search:
- All branch and tag heads / exact source commits for all 280 repositories.
- Git mirrors and restoration from independent backup locations.
- Git LFS object completeness and restoration.
- Issues, PRs, review comments, discussions, wikis and release assets for all repos.
- Package registries, container images, Pages, Actions artifacts, workflow secrets and webhooks.
- DNS, domains, certificates, deployment resources and external production consumers.
- Local-only repositories, media masters, prompt histories and backups.
- Full license, third-party notice, privacy and consent review for each repo and asset.

No repository, account or resource was modified, archived, deleted or retired by this audit.
