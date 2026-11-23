# Product & Technology Map

**Snapshot:** 2026-11-23 · **Target:** `A-L-L-A-H/mw-xv`  
**Status:** architecture / product map, grounded in the MW-XV README, issue proposals, current docs and selected source repository READMEs. This document is not a deployment certification.

## 1. Unified product surfaces

| Surface | Purpose | Canonical MW-XV owner | Status at audit |
|---|---|---|---|
| Public MoonWitness home | Product identity and discovery | `apps/board` | Repository docs describe a public homepage in Board; feature-by-feature release requires evidence |
| Authenticated Board | Administrative/data-driven workspace | `apps/board`, `apps/api` | Exists in monorepo; exact-SHA CI and operational deployment are separate questions |
| Knowledge Explorer | Search/review source-backed knowledge | `packages/orm-knowledge`, `packages/corpus`, `packages/research`, Board | K8 roadmap work remains in progress |
| Story Workbench | Draft/review story and publication records | Existing knowledge/workflow packages and Board | Route and tests are in tree; narrative assets/canon are not all recovered |
| Creative Lab / SceneLab | Asset browse/review/preview | `packages/assets`, `apps/ui-catalog` | AUD-015–AUD-023 and existing W7/W9 work address remaining review/provenance/boundary gaps |
| Desktop local agent | Controlled local execution and patch review | `apps/desktop`, `packages/ai-runtime`, `packages/ai-mcp`, `packages/orm-ai` | Tauri v2 / local harness described; Issue #21 requires current upstream evaluation |
| Messaging channels | WhatsApp / channel adapters and notifications | `packages/orm-integration`, WhatsApp integration, `packages/orm-notification`, `packages/orm-storage` | Existing implementation and tests; live device/transport verification is a separate gate |
| Radio | Audio / schedule / live programme experience | Existing publication, jobs, storage and integration owners first | Product form remains undecided in Issue #16; no new ORM service assigned yet |
| Community | Discussions, follows, participation and proposals | Existing workflow/notification first; proposed `orm-community` only if accepted | Issue #15 proposal, not accepted implementation requirement |
| Experience / progression | Levels, mission progress and rewards | Existing project/workflow/notification first; proposed `orm-experience` only if accepted | Issue #15 proposal, not an implemented rewards system |
| Extension Hub | Discover approved addon manifests | Existing addon registry / installer ledger | Issue #15 proposal; no arbitrary code loading/hot-install promised |

## 2. Current technical baseline

MW-XV README declares:
- TypeScript strict monorepo.
- Node.js 24, pnpm 11.17 and PostgreSQL 16.
- Fastify 5 API and Next.js 16 Board.
- Metadata-driven ORM/addon model contract.
- REST generic API and JSON-RPC 2.0.
- Addon registry assembled from manifests.
- Auth, company/RBAC, audit and outbox.
- Durable job/lease/scheduler behavior.
- Packages for local AI, AI runtime/MCP, knowledge, corpus, research, assets and UI.

These are repository-declared baseline capabilities. They should be individually classified as implemented/tested, partial, planned or operationally verified using the exact current branch and CI evidence. A README feature table is not deployment evidence.

## 3. Non-duplicating domain ownership

| Concern | Existing owner | Do not add by default |
|---|---|---|
| Identity, user, role and authorization | `orm-base`, `packages/auth`, organization addon | Second IAM or community-owned auth |
| Task identity and lifecycle | TaskOS | Parallel markdown TODO / hand-maintained tracker |
| Source scripture text / edition / passages | `packages/corpus` | Second corpus database |
| Research candidate / evidence analysis | `packages/research` | Generic second research graph |
| Knowledge, story, editorial review and publication | `packages/orm-knowledge`, workflow | Duplicate CMS or publication store |
| File/object storage and attachment metadata | `packages/orm-storage` | Second asset database |
| Canonical visual files / manifest | `packages/assets` | Separate Creative Studio asset manager |
| Common components / tokens | `packages/ui` | Parallel shared UI framework |
| API routing and addon registration | Fastify API + addon registry | Second hub or arbitrary extension loader |
| Jobs, scheduler and outbox | `packages/jobs` | Separate uncoordinated queue |
| Notifications | `packages/orm-notification` | Duplicate community notification table |
| AI grants, runs, artifacts and obligations | `packages/orm-ai`, AI runtime | Parallel agent runner / memory store |
| Desktop execution | `apps/desktop` harness / risk gate | Second desktop app |
| Community social graph | Proposed Issue #15 scope | New addon before gap analysis |
| XP/reward claims | Proposed Issue #15 scope | Wallet/payment/reward ledger based on a concept alone |

## 4. Adjacent source projects — role and target mapping

| Source | Evidence from inspected README/root tree | MW-XV treatment |
|---|---|---|
| `moonwitness-II` | Public story/witness app, data and story/character/era YAML, rules and blueprint | Story/canon reference; no byte-copy under K0-006 |
| `moonwitness-xii-season-global-championships` | Next.js static archive, source/patch/character docs, no DB/ORM | Editorial archive reference; retain 33-slot semantics and gaps |
| `moonwitness-xiv` | Earlier TypeScript monorepo, corpus, ontology, apps/packages/docs | Architectural lineage and evidence reference |
| `moonwitnessxv` | XV program docs, multiple product/system blueprints | Historical reference only; current target is A-L-L-A-H/mw-xv |
| `A-L-L-A-H` | Empire / command-centre blueprint, UNILEX, Mizan, ARSY design | Research reference; proposed not production certified |
| `A-L-L-A-H.COM` | README describes Fastify/Next ecosystem with multiple surfaces and integrations | Product lineage reference; production claims need runtime checks |
| `dev-mw-blueprint` | GOD-PROMISE and Mizan Rust contracts / fixtures | Research and design reference; no automatic technical/religious authority |
| `rocksoul-mftl` | Story / belief intelligence corpus | STORY-domain source reference |
| `moonwitness-corpus` | RGBL/text corpus lineage, editions, rights and provenance | TEXT-domain source reference; the previous RGBL naming is a source alias/lineage, not counted as another repo |
| `rocksoul-legend` | Event/history reconstruction with evidence/counterevidence | EVENT-domain reference |
| `rocksoul-superhero` | Actor/person, witness, authorship and transmission | PERSON-domain reference |
| `rocksoul-aws` | “ANGEL WITH SHOTGUN”; semantic domain LAW | LAW-domain reference; keep creative label and code name distinct |
| `rocksoul-jizz` | Multi-perspective intelligence | PERSPECTIVE-domain reference |
| `rocksoul-correlation` | Cross-domain relation graph | RELATIONSHIP-domain reference; no causation/identity inference |
| `rocksoul-assets` | Versioned visual source/manifest/showcase | Visual reference only; individual rights and source provenance still required |
| `rocksoul-ui` | Production-oriented React UI grammar | UI reference; do not create a second package inside MW-XV without license and fit review |
| `moonframe` | Component library, themes, page templates and CLI | UI/visual reference; README says human visual sign-off remains incomplete |
| `rocksoul-community` | React/Vite community participation surface | Feature reference; submissions are explicitly noncanonical pending review |
| `rocksoul-platform` | IAM/admin ownership | Boundary reference; MW-XV identity remains in existing auth |
| `moonsky` | Standalone operator console, messaging store and local operator auth | Messaging reference; do not assume it is MW Radio or use its operator identity as MW-XV IAM |
| `rocksoul-game` | The Lost Signal browser demo; preproduction / story canon candidate | Optional story/game reference; not production game or approved final canon |
| `rocksoul-world` | Local-first Rust digital-world runtime | Research reference; no evidence it should replace Board/Desktop |
| `rocksouldx` | OpenCode-based coding workbench and ROCKSOUL FLOW roadmap | Desktop/coding harness comparison only; not all FLOW capability shipped |
| `antikythera-time` | M-Time software-only temporal protocol | Calendar/time research reference; v1 release readiness remains blocked on external review |
| `universal-ontology-engine` | OX-DX / Rust ontology resolution | Ontology research reference; MW-XV's own record contracts remain authoritative |
| `witness-semantic-engine` | Downstream language/semantic candidate analysis | Research reference; corpus ownership remains separate |
| `moonwitness-memory` | Local-first ChatGPT ZIP archive processor | Archived repository design reference; no ChatGPT account export was supplied to MW-XV |
| `moonwitness-reborn` | Prior TypeScript addon/AI assistant platform | Historical architecture lineage |
| `agilty` | README and raw GitHub metadata identify GPT4Free/g4f fork | Third-party model-aggregator fork; not an original AGI platform |

## 5. Engineering concepts from the owner's context

The following are indexed as owner-reported workstreams, not as audited current source code:
- Exatel / Trans Indonesia Supercorridor / IDPLAY: ISP / access / FTTH / cloud business context.
- AgentOPS Corridor: OLT/NMS operations.
- Caroline: WhatsApp customer-facing support style and customer interaction rules.
- FollowTrack AI: customer follow-up process.
- MoonShips Mini-PaaS: Loco.rs and SQLite-first product exploration.
- WhatsApp connector evaluation and preference to avoid OpenClaw.
- YouTube push/live/status monitoring.

Keep public docs high-level. Internal IP addressing, server names, customer identifiers, credentials, WhatsApp logs and deployment secrets do not belong in this public archive.

## 6. Target architecture proposal

MW-XV should remain the only forward platform target and reuse its current vertical slices:
- Board as the primary product surface.
- Fastify API and PostgreSQL as shared domain/control-plane.
- Addons as model/permission/data ownership contracts.
- Corpus/research/knowledge as source-to-interpretation pipeline.
- Assets/UI/UI Catalog for creative production.
- Desktop AI as a local execution harness behind capability/risk gates.
- TaskOS as work lifecycle source; GitHub Issues as human-facing projections.
- Human review for canon, theology, publication, private data and risky operations.

No new app, ORM, IAM, memory service, asset manager, UI framework, message store or queue is recommended solely because an old repository exists.
