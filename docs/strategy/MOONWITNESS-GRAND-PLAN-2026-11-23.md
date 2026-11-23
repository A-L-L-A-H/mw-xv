# MoonWitness Grand Plan — Consolidated Product & Engineering Direction

**Baseline date:** 2026-11-23 (Asia/Jakarta)  
**Target:** `A-L-L-A-H/mw-xv`  
**Source audit baseline:** `dev` at `7871a592db5488eafbaeeb0bfbbdc079a4231cfe`. During preparation, a non-overlapping update landed on `dev`: `a58a43327fbc9267a9840bb65b0ad2735b069907` (`docs(ui): document addon visual handoff`). This consolidation is layered on that latest commit; Codex must always fetch the newest `origin/dev` before acting.  
**Status:** consolidated strategy and execution map; this document does not override accepted ADRs, the master checklist, or evidence-based task completion.

> **One platform. One source of truth. Many experiences. Bounded agents. Verifiable work.**

## 1. Executive decision

MoonWitness XV is the canonical product and engineering platform. ROCKSOUL FLOW is an engineering workflow inside the platform, not a second application, ORM, AI runtime or project database. Historical `bjo163/*` repositories provide design history and behavioral requirements only under the current owner-approved K0-006 disposition. Target capabilities are rebuilt locally against MoonWitness contracts; no legacy code, prompts, assets, fixtures, dataset records or private archives are imported.

Product experiences and historical product families are consolidated into four verbs:

1. **PRESERVE** — source artifacts, editions, passages, media, rights, hashes and revision history.
2. **UNDERSTAND** — claims, evidence, counter-evidence, context, provenance, confidence and uncertainty.
3. **CREATE** — articles, stories, posters, comics, artwork, audio, video and interactive experiences.
4. **CONNECT** — people, teams, projects, community, messaging and bounded AI capabilities.

The operating principle is to reuse existing domain owners. A new package or service is justified only by a demonstrated responsibility gap, a canonical owner, a real consumer, tests, security boundaries and a documented rollback.

## 2. Exact target baseline and current governance


> **Superseding live-state correction — 2026-11-23:** The registry is not empty. The earlier zero-byte statement came from an incomplete large-file read and is withdrawn. Direct Git-blob inspection confirms a populated TaskOS registry. At the audit baseline, `dev` (`08e7e3cbdcdfdfa2214196b5622da9b6184d4918`) contains **636 unique task records** (468 done, 49 doing, 97 todo, 22 blocked; blob `210f91e853a7241b6b3249ed65c1ca79b98274b3`); `main` (`5dd3da3389cdd4b55ef1a538f0dc46c13918f108`) contains **627** (468 done, 49 doing, 89 todo, 21 blocked; blob `8216b6503d154d635112be96c41939a9efd38390`). All main IDs exist on dev; dev has nine additional audit records, `AUD-015`–`AUD-023`. The earlier 627-record owner-approved migration remains a valid historical checkpoint, not the current dev total. PR [#81](https://github.com/A-L-L-A-H/mw-xv/pull/81) is still open and not release-ready: exact-SHA CI has TaskOS test, generated docs asset and Gitleaks failures; PostgreSQL integration and JS/TS CodeQL were cancelled. See [ACTIVE-PLAN.md](../roadmap/ACTIVE-PLAN.md) and [TaskOS Recovery Inventory](../tasks/RECOVERY-INVENTORY.md) for the verified detail. The following original planning-baseline subsections are retained as historical snapshots, not current status.



### 2.2 Original repository state checked (historical; superseded by the live-state correction)

| Item | Observed state |
|---|---|
| Target repository | `A-L-L-A-H/mw-xv` |
| Default branch | `main`; engineering work is performed on `dev` |
| `dev` at first source audit | `7871a592db5488eafbaeeb0bfbbdc079a4231cfe` |
| `dev` immediately before this consolidation commit | `a58a43327fbc9267a9840bb65b0ad2735b069907` |
| `main` at the current stabilization baseline | `2a9d78333433b783a80bcb82f6ac7f7ad95f6c2d` |
| Common ancestor at checkpoint | `a6cd74a6f189e7ea053b046e94a06ea2d36530fc` |
| Branch relationship | `dev` is ahead of `main`; exact count and current SHA are maintained in [Active Plan](../roadmap/ACTIVE-PLAN.md) |
| Release status | M12.14 remains `in_progress`; its evidence still lists PR.14 as awaiting maintainer/CODEOWNER approval |
| Desktop / FLOW status | M13.01–M13.12 are recorded complete on `dev`; M13.09–M13.12 still need exact-current-SHA CI and promotion review |

PR #30 merged the older `dev` head `a6cd74a` into `main`. That does not mean the current `dev` head was promoted. Before another promotion, reconcile the 17 main-only commits and 2 dev-only commits using the accepted main→dev synchronization process (M1.09), review the full diff, and rerun the relevant acceptance gates. Do not solve divergence with force-push, blind rebase, or a third branch.

### 2.3 Original roadmap and TaskOS counts (historical recovery baseline; superseded)

The verified source inventory currently has **239 roadmap-index tasks** (174 M-series + 65 K-series): **157 complete**, **47 in progress**, and **35 todo**. `ROADMAP.md` has 157 checked and 82 unchecked task IDs, matching the 239-task index.

The expanded TaskOS registry is **not currently populated**: `docs/tasks/tasks.json` is zero-byte. A source audit identified 627 unique candidate task IDs across eight source groups (roadmap, WhatsApp, Desktop, archived legacy MW, AI Corporation PR governance, evolution, audit, and Visual Universe). The calculated initial import distribution is 468 done, 49 doing, 89 todo and 21 blocked; these are migration expectations, not live TaskOS counts. The earlier 1,346-record claim was not substantiated and is not used as an import target.

During recovery, completion authority is the roadmap checkbox plus evidence; `docs/roadmap/tasks.json` is the M/K identity/dependency/detail index; GitHub Issues are operational/human triage views; delivery state requires exact SHA, CI, promotion and release evidence. After a fully validated one-time restore, TaskOS will own lifecycle for all repository projects, and roadmap/TODO/Visual Universe lists become projections. No static totals should be used as current progress.

### 2.4 Original release boundary (historical; verify current PR/CI before acting)

M12.14 remains in progress until the exact current source SHA, hosted checks and required maintainer approval are reconciled. An older successful test run or merged PR for a prior `dev` head is not evidence for the current branch head. M13 is an independently authorized engineering workstream, not a release blocker and not an application deployment authorization.

## 3. Canonical platform architecture

### 3.1 Shared foundation

The existing foundation remains authoritative:

- `@moonwitness/orm` and programmatic `orm-*` addons own durable models, fields, relations, access metadata and seeds.
- `orm-base` / auth own platform identity, company and access boundaries.
- `orm-project`, `orm-workflow` and `@moonwitness/jobs` own project/task/workflow state and durable job lifecycles.
- `orm-storage`, `packages/assets` and artifact manifests own storage metadata, asset provenance and content-addressed artifacts.
- `orm-knowledge`, `packages/corpus`, `packages/knowledge` and `packages/research` own source-grounded records, evidence and analysis.
- `apps/api` remains the thin HTTP boundary; durable domain logic belongs to its owning addon.
- No second ORM, traditional parallel SQL migration stream, shadow business database, duplicate identity, task authority, message store, memory database or UI framework.

### 3.2 Experience planes

| Experience | Responsibility | Must not become |
|---|---|---|
| **Board — Control Plane** | Project administration, task planning, research, review, approval, operations and evidence inspection | A local shell/PTY host or second domain database |
| **Desktop — Local Execution Plane** | Tauri v2 shell, local sidecar, isolated Git worktrees, bounded PTY, allowlisted file inspection, stdio/loopback MCP and offline evidence queue | A second Board UI, ORM, identity system or self-approving agent |
| **Public Web — Publication Plane** | Discover and read only approved, rights-cleared, revisioned content | A direct view of private drafts, unreviewed testimony or candidate AI data |
| **Radio / Messaging** | Approved channel adapters, inboxes, delivery state and publishing | A second user identity or independent message authority |

Board remains the source of operational intent and approvals. Desktop executes scoped work locally. Server-side MoonWitness state and independent review determine accepted completion.

### 3.3 Two separate AI boundaries

- **`@moonwitness/local-ai`:** K7 local-only, loopback, tool-free suggestions; `AI_MODE=disabled` remains the default. It must not receive shell, MCP, filesystem or worktree tools.
- **`@moonwitness/ai-runtime`:** general bounded workforce execution, provider classification routing, tools, durable jobs, capability grants, risk tiers, PCW and evaluations.
- **`@moonwitness/ai-mcp`:** stateless MCP boundary through approved domain services and capability gateway.
- **PCW:** proof artifacts and server-recomputed digests; local execution cannot self-mark accepted; independent review and obligation continuity remain mandatory.
- Data classified `local_only` or `restricted` cannot silently fall back to cloud.

## 4. Product-domain consolidation

| Domain | Canonical responsibility | Product families / history mapped here |
|---|---|---|
| Corpus | Exact source artifact, work, expression, edition, language, passage, rights and ingestion provenance | RGBL, Qur'an/hadith and other source-text references, Key Witness source records |
| Knowledge | Scoped concepts, claims/assertions, evidence refs, relations and provenance | Research vocabularies, concepts, source-aware references |
| Research | Counter-evidence, comparison, uncertainty, source-scoped people/witnesses, event reconstruction and explainable relations | Story × Event × Person, MFTL/Legend/Superhero/Correlation requirements |
| Creation | Briefs, series, entries, revisions, original/derived assets and publication workflow | GOD PROMISE, ROCKSOUL creative collections, MoonWitness Radio, posters, comics, visual stories |
| Project & Workflow | Task, milestone, DAG dependency, WorkContract, review and delivery | ROCKSOUL FLOW, Task Deck, Plan Forge and project management |
| Community | Participation, discussion, contribution, moderation and proposals | ROCKSOUL Community requirements |
| Communication | Channel operators, messages, inbox, delivery events and notifications | MOONSKY / Telegram / WhatsApp requirements, implemented through existing integration addons |
| AI Workforce | Agents, team/taskforce, grants, budgets, durable runs, memory candidates, evaluation and obligations | AI Corporation / local desktop agent harness |

Product names are collections or experiences, not automatic package boundaries. A new addon is proposed only after checking the existing canonical owner and proving a durable responsibility gap.

## 5. ROCKSOUL FLOW — actual capability status

The M13.01 reuse audit was performed against target source and tests at its recorded SHA, and the following implementation cards have since been completed:

| Capability | Actual status in target | Existing owner / implementation | Remaining gap or caution |
|---|---|---|---|
| Repo Radar | **Implemented foundation** (M13.02) | `@moonwitness/ai-runtime` `buildRepoSnapshot`; Desktop `WorktreeSandbox.inspectRepoSnapshot`; SHA-pinned Git revision, manifests/docs, digests and incomplete-scan markers | Keep read-only; refresh/large-workspace ergonomics require a later measured task |
| Overlap Detector | **Implemented foundation** (M13.03) | `detectCapabilityOverlap`, six advisory states and offline benchmark in `@moonwitness/ai-runtime` / `@moonwitness/ai-evaluation` | Advisory only; do not auto-delete tasks, migrate data or suppress requirements |
| Prompt Forge | **Implemented foundation** (M13.04) | `compileExecutionPacket` and Desktop bridge; redaction, scope validation, locked criteria and verification commands | Packet creation is not task approval or permission to execute |
| Plan Forge | **Partial** | `orm-project` task/milestone/dependency DAG, `orm-ai` WorkContract/criteria, `ai-runtime` workforce planner and `orm-workflow` approvals | Versioned Markdown plan projection/import reconciliation and goal-to-plan drafting are not yet proven complete |
| Task Deck | **Partial; next priority** | Project DAG, WorkContract, jobs/leases/fencing, cancellation, worktree isolation and Board Project Command | Existing WorkContract creation route does not check the computed DAG readiness before new creation; queued project task to local Desktop run is also not fully bound |
| Proof Gate | **Partial** | `pcw-verifier`, SHA-256 artifacts, server-side accepted transition, independent review and obligation continuity | Explicit pass/fail/skipped/not_applicable/not_run matrix and automatic changed-file vs WorkContract scope finding are not yet covered by the reuse contract |
| Memory Ledger | **Partial** | `orm-ai` candidate memories / skill versions, evaluator, ablation, independent promotion and revocation | No approved-memory deduplication against repository agent rules with a human-reviewed documentation patch proposal |
| Visual DNA Lab | **Partial** | `packages/assets` provenance/rights registry, `packages/ui`, UI Catalog, AssetBrowser, SceneLab and FXLab | Per-project/external-repository Design Profile brief exporter is still a candidate gap |
| Workspace Orbit | **Not yet audited / unregistered** | Existing repository/workspace inspection may provide some primitives | Do not assume it is missing or build a multi-repo executor before a separate read-only gap audit |

The audit describes what was inspected; package folders or README claims alone are not proof of completeness. Test entries in M13.01 identify existing coverage. The M13.02–M13.04 evidence records later focused test executions for those implementation slices.

## 6. Immediate next task — M13.05

**M13.05 — Gate WorkContract creation on project-task dependency readiness** is the single next registered feature task.

Evidence-backed reason:

- `GET /projects/:id/board` returns the canonical task dependency graph and the test fixture explicitly shows `task2` in `dag.blocked_task_ids`.
- The existing `POST /projects/tasks/:id/work-contract` route creates a new `WorkContract` after a company-scoped task lookup, without consulting that readiness graph.
- The same route test later creates a WorkContract for the blocked task, so the mismatch is visible in current source and test behavior.
- `buildProjectDependencyGraph` in `packages/orm-project/src/sync.ts` is the canonical semantic owner: only active `blocks` edges count; `relates_to` and inactive edges do not; blockers with status `done` or `cancelled` are resolved.

M13.05 must extend the existing route and tests, not add a second DAG, database, route or model. It gates **creation of a new WorkContract**; it must not claim to guard every later agent run-start path. Existing linked-contract idempotency stays intact, and the transaction/locking boundary must be checked against actual dependency writers before claiming race safety.

Detailed card: [`docs/roadmap/14-desktop-engineering.md`](../roadmap/14-desktop-engineering.md)  
Local agent instructions: [`docs/roadmap/rock-soul-flow-m13-05-handoff.md`](../roadmap/rock-soul-flow-m13-05-handoff.md)

## 7. Conditional follow-on sequence (not yet registered task IDs)

These are candidate decisions, not approved backlog cards. Register only when the preceding task is reviewed and the current source still proves the gap.

1. **Proof Gate evidence matrix:** add the five execution states with mandatory skipped reason and a changed-file vs WorkContract scope report, while keeping final acceptance server-side and independent.
2. **Task Deck → Desktop run binding:** connect a ready approved task/WorkContract to a scoped local worktree run through the existing Desktop bridge; no auto-dispatch, auto-push or approval bypass.
3. **Plan Forge:** versioned human-readable plan projection and reconciliation over existing Project/WorkContract IDs; Markdown is not a second task database and completed IDs remain stable.
4. **Memory Ledger:** candidate memory to repository-rule comparison and human-reviewed patch proposal; never edit live policy or capability grants automatically.
5. **Visual DNA Lab:** per-project Design Profile brief generated from target-owned assets, tokens and visual evidence; artwork-first 2D (SVG/PNG/APNG/WebM/Lottie) remains the default and 3D is optional.
6. **Workspace Orbit audit:** read-only multi-repository identity, commit/ref and dependency map. No cross-repository agent writes until authority, leases, evidence and approval have a separate design.
7. **FLOW Cockpit:** only after the foundations have measured gaps and verified contracts, unify the experiences inside existing Board/Desktop surfaces rather than building eight or nine separate dashboards.

## 8. Legacy source disposition — K0-006 is binding

K0-006 evidence records the owner decision dated 2026-10-15: the chosen product is rebuilt locally from requirements and newly authored material, with **no legacy source-code copy, no legacy corpus-record migration, no external runtime/API/submodule/fetch dependency**. Historical public refs and notices are metadata, not build inputs or a license grant.

Selected source refs most relevant to the plan were checked as follows on 2026-11-23:

| Legacy repository | Observed source ref | What is useful as requirement/history | Current disposition |
|---|---|---|---|
| `bjo163/rocksouldx` | `dev @ fa54486799b34a4e9304691d7e61b6822c4bdd1f` | FLOW lifecycle and product blueprint. README identifies it as OpenCode-derived; root LICENSE is MIT with OpenCode copyright/notice. | Clean-room requirement reference only; no code, prompts, patches, fixtures or assets imported |
| `bjo163/moonwitness-corpus` | `main @ 534a21893728de64b5f28f27ea600e8609d7b8c4` | RGBL source/edition/passage/assertion/evidence/provenance concepts | Reference only; no corpus bytes, passages or old IDs imported. A dataset README's CC0 statement is scoped to that dataset description, not a blanket repository grant |
| `bjo163/rocksoul-assets` | `main @ fd6a545160312bfe4b3419d846961abbcd7bfabd` | Asset taxonomy, SVG/raster/motion/audio registries and visual language | Reference only; asset, font, media and trademark rights are not blanket-cleared |
| `bjo163/moonframe` | `main @ f6ffc03b38e0f272ed18bd3ae977c0f9586e3571` | Component/skin/template and visual grammar ideas | Reference only; use target `packages/ui` and UI Catalog |
| `bjo163/moonsky` | `main @ 1f9884bcffc9daa2fa69595278bf8b41f2c0e0b2` | Inbox, channel adapter and delivery lifecycle requirements | Clean-room requirements only; use existing integration/WhatsApp/notification addons |
| `bjo163/moonwitness-memory` | `main @ e4cc8b9ab43b089ec1b957dac4855f3e2c079b9a` (repository archived) | Historical archive-intake ideas | Do not import private conversations or archive content; preserve privacy, consent and retention boundaries |
| `bjo163/rocksoul-world` | `main` (Apache-2.0 metadata) | Local-first world/operator experience ideas | Reference only; no second Rust runtime |
| `bjo163/rocksoul-mind` | fork of `jingyaogong/minimind` | Small-model research history | Do not import/port without independent upstream and rights review; no model installation is authorized by this plan |

The public inventory contains 148 repositories from the 2026-11-22 owner search. That is a metadata inventory, not a full source, private-resource, deployment, license or privacy audit. The deeper review covers only selected repositories and paths. Do not claim all 148 were audited line-by-line.

### Required disposition vocabulary

- `CLEAN_ROOM_REBUILD`: use requirements/behavior as design input and write new target implementation; no source bytes copied.
- `REFERENCE_ONLY`: historical or visual reference only; no code/data/asset incorporation.
- `METADATA_ARCHIVE`: retain repository/ref/path/hash/notice metadata only.
- `RESEARCH_FIRST`: further read-only fit analysis; not an import permission.
- `DO_NOT_IMPORT`: no use of source code/data/assets under current scope.
- `REOPEN_K0-006`: mandatory owner decision and source-specific rights/privacy review before any future external content import.

The labels `ADAPT` and `ADOPT_SELECTIVELY` must not be interpreted as permission to port code or reuse files under the current K0-006 decision. Unknown or unverified rights mean no redistribution. The legacy owner remains intact until every retirement gate (private repositories, refs, LFS, releases, artifacts, services, DNS, dependencies, local-only data, recovery and explicit owner approval) is evidenced.

## 9. Content, research and editorial principles

- Keep exact source, edition, translation, tafsir/commentary, personal note, paraphrase and AI-generated explanation as distinct record types.
- A project-specific Asmaul Husna sequence is a named/versioned list profile, not a destructive replacement of other scholarly list variants. The Indonesian project profile's sequence corrections (#67 Al-Aḥad, #68 Aṣ-Ṣamad, #69 Al-Qādir and #71–74) must remain distinct from upstream source assertions.
- Religious content must label personal interpretation and creative adaptation clearly. Do not depict Allah as a human figure or give AI output religious-authority status. Qur'anic text, hadith wording, translation and tafsir require their own source/edition and verification.
- Historical/story research distinguishes Story, Event, Person, witness and transmission; similarity is not identity, correlation is not causation, and testimony is not automatically a verified event.
- Legal research must carry jurisdiction and authority; computed astronomical/calendar results are not by themselves religious authority decisions.
- Private archives, witness records, account data and conversations require strict consent, data minimization, retention, deletion/revocation and PUBLIC-deny-by-default behavior. Do not import private or minor-related material as public corpus.

## 10. Experience and visual direction

- Preserve a clear editorial/research workspace for source-grounded work and a separate creation workflow for public-facing artifacts.
- GOD PROMISE, ROCKSOUL, MoonWitness Radio and related creative series are projects/collections within Creation, not separate source-of-truth platforms.
- Artwork-first 2D is the default for visual production: authored SVG/PNG/APNG/WebM/Lottie and approved audio. 3D/Three.js/Blender are optional explorations, never prerequisites.
- Keep source artwork, generated artwork, derived compositions, text layers, attribution, license and publication revision linked but distinct.
- Design systems and asset catalogues should reuse `packages/ui`, `packages/assets` and `apps/ui-catalog`; do not copy the legacy Moonframe component library or build a parallel rendering kit.

## 11. Local Codex execution contract

For M13.05, Codex should:

1. Inspect `git status --short --branch`, applicable `AGENTS.md`, exact `origin/dev` SHA and package/test scripts. Do not reset or discard user changes.
2. Stay on the existing `dev` branch. Do not create a feature branch. Do not merge/rebase `main` to resolve the current divergence; that requires a separate M1.09 reconciliation.
3. Read the M13.05 handoff, ADR 0007/0008, the route, route tests, ORM dependency builder, and current transaction/permission patterns.
4. Implement only the server-side new-WorkContract readiness invariant and its focused tests. Do not expand to a Board redesign or local Desktop dispatch.
5. Verify the exact commands recorded on the M13.05 card, plus Prettier and `git diff --check`. Run PostgreSQL/concurrency tests if transaction/locking semantics change.
6. Write `docs/roadmap/evidence/M13.05.md` with exact base/result SHAs, changed files, commands and exit codes; separate pass/fail/skipped/not-run.
7. Commit with task ID `M13.05`, push normally to `dev`, verify the remote SHA, and leave `main` untouched. Mark complete only when all acceptance criteria are evidenced.

## 12. Explicit non-goals

No wholesale repository migration, no bjo163 account closure in this batch, no OpenCode fork/second agent runtime, no new ORM or database, no new local model download/training, no automatic publication, no AI self-approval, no secret access, no 3D prerequisite, no app deployment and no protected-branch bypass.

---

## Decision summary

The near-term goal is not to build every historical project or every ROCKSOUL FLOW screen. It is to make the existing MoonWitness platform coherent and trustworthy: correct roadmap authority, enforce dependency readiness at the server boundary, produce evidence for each change, and only then expose a unified FLOW experience over existing platform owners.
