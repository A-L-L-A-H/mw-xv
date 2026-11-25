# ADR-003: `@moonwitness/plan-taskos` — Cognitive WorkGraph OS, Embedded Brain DB, & Multi-Plane Split-Authority Projection Bus

- **Status:** Accepted (Locked for Autonomous Execution)
- **Date:** 2026-11-25
- **Plan Tracker:** `.plan/plan-taskos-cognitive-workgraph.md` (`T01`–`T44`)

---

## 1. Context & Problem Statement

MoonWitness XV evolved three powerful but fragmented planning & execution systems:
1. **`.plan/` Sharded Markdown** (`.plan/coolify-sovereign-paas-single-db.md` + `ADR-001` + `wave-*.md` + `apps/desktop/src/observatory/plan-collector.ts`): ultra-granular micro-tasks (`M01`–`M66`), disjoint `Owner File(s)`, exact code specs, minimal context load, and live Desktop Observatory DAG — but regex-parsed with no JSON Schema validation, no `blocked`/`skipped` states, no bounded retry circuit breaker, and no cryptographic completion proof.
2. **TaskOS v2 & Pack `task.json`** (`docs/tasks/tasks.json` 42,803 lines + `docs/bundles/visual-universe-pack/task.json` 7,496 lines): strict AJV JSON Schema, `execution_policy`, per-criterion booleans (`acceptance_criteria_state`), structured `evidence[]`, and `documents[]` 5-layer ontology — but monolithic JSON blobs that blow LLM context budgets and cannot hold ergonomic multi-line code specs.
3. **Enterprise ORM, Docs & GitHub Delivery Silos** (`packages/orm-project` `project.*` + `packages/orm-ai` `ai.work_contract`/`ai.acceptance_criterion`, `docs/`, `scripts/roadmap/sync-issues.mjs`, `tools/agent-observatory`, `apps/desktop`, `packages/mcp-moonwitness`, `apps/agent-observability`): duplicated DAG evaluators, unlinked work/delivery lifecycles, no cross-run episodic memory or file-to-task knowledge graph, and no portable standalone package/skill usable outside MoonWitness.

---

## 2. Decision Drivers

- **Micro-Task Atomicity First:** Keep agent work decomposed to 1–3 owned files, 1–5 binary acceptance criteria, 1 verification run, and 1 atomic `git commit --only`.
- **Zero-Coupling Portability:** `packages/plan-taskos` MUST import ZERO ORM, UI, Fastify, React, or Tauri modules (`INV-004`, `INV-009`), running identically inside MoonWitness XV and in any external Git repository via `npx @moonwitness/plan-taskos` + `skill/SKILL.md`.
- **Git-First Cognitive Brain:** Fast local SQLite graph + FTS5 BM25 + optional local embeddings (`<10ms` recall) with ZERO binary merge conflicts in Git.
- **Zero Sync Loops:** Multi-plane synchronization across Git, PostgreSQL ORM, Docs, TaskOS v2, and GitHub Issues MUST obey strict per-field authority ownership and normalized content-hash no-op fencing.
- **Patent-Grade Technical Rigor:** Every safety guarantee (disjoint write ownership, scope containment, proof sealing, retry circuit breaking, protected-gate invariant synthesis) MUST be deterministic and unit-tested.

---

## 3. Architectural Decisions (Finalized & Stress-Tested)

### Decision 1 — Sharded Dual-Layer WorkGraph IR v1 + Universal URN
- **Chosen:** Represent plans as sharded bundles under `.plan/<plan-id>/`:
  - `manifest.json` (plan header, `execution_policy`, waves, projection config)
  - `ADR-NNN-<slug>.md` (immutable architectural decisions + repo gate invariants)
  - `waves/W{n}-<slug>.json` (pure structured 6-plane `PlanTaskIR` for 5–15 micro-tasks per shard, ~4–8 KB)
  - `specs/W{n}-<slug>.md` (rich fenced code blocks & `DO / DO-NOT` keyed 1:1 by `## Txx`)
  - `evidence/Txx.proof.json` (immutable runner-sealed proof envelope)
  - `.plan/<plan-id>.md` (deterministically projected Master Checklist + Progress Ledger, 100% compatible with existing Observatory parsers)
  Every node carries a canonical URN `urn:mw:work:<org>/<repo>:<plan-id>:<wave>/<task-id>` (and `urn:mw:doc:...` for documents).
- **Rejected:** Monolithic JSON containing escaped code strings (unreadable diffs, context bloat) or Markdown-only AST mutations (fragile status/evidence updates).
- **Consequence:** Loader supports BOTH v2 Plan-TaskOS bundles AND legacy v1 `.plan/*.md` files for zero-downtime migration.

### Decision 2 — Git-First Local Cognitive Brain via Node 24 Built-In `node:sqlite` (WAL + FTS5)
- **Chosen:** Materialize an ephemeral, `.gitignore`d local Cognitive Brain DB at `.plan/.brain/taskos.sqlite` using Node 24 built-in `node:sqlite` (`DatabaseSync`, `PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = 5000`, `PRAGMA foreign_keys = ON`) with a pure JS `InMemoryBrainStore` fallback behind `BrainStorageDriver`. Store 7 compact tables: `nodes`, `edges` (typed Knowledge Graph compatible with `packages/knowledge/src/concept-graph.ts`), `fts_index` (FTS5 BM25), `embeddings` (optional loopback Ollama `nomic-embed-text` float32 cache with automatic `lexical_only` fallback), `episodic_memory`, `proof_ledger`, and `leases`. Curated portable memories export to redacted `.plan/memory/episodes.jsonl`.
- **Rejected:** Requiring `better-sqlite3` native C++ compilation in core (Windows ABI risk `INV-002`) or external Postgres/Neo4j/Pinecone servers (kills offline CLI/Skill portability).
- **Consequence:** Zero external services, zero native builds, atomic multi-agent lease claiming via `BEGIN IMMEDIATE`, `<5ms` 2-hop graph & BM25 queries, and `<150ms` deterministic rebuild from Git shards if `.sqlite` is deleted.

### Decision 3 — Compile-Time Disjoint Write-Ownership Prover + Runtime `git diff` Scope Membrane
- **Chosen:** Normalize all `owner_files` and `read_only_refs` to POSIX relative paths (rejecting absolute paths and `..` traversal fail-closed). At plan compile time (`plan-taskos lint`), compute the transitive closure of `depends_on` and prove mathematically that every concurrently schedulable pair `(Ti, Tj)` has `intersect(owner_files(Ti), owner_files(Tj)) == empty` (unless serialized by a `mutex_resources` edge). At runtime (`plan-taskos verify`/`complete`), inspect `git diff --name-only` and fail closed if any mutated file falls outside `owner_files` (plus allowed plan state files).
- **Rejected:** Advisory `scope_hints` without compile-time conflict proofs or runtime diff checks.

### Decision 4 — DAG-Merkle Proof-Carrying Task Transitions (Parallel-Swarm Safe)
- **Chosen:** Forbid direct `todo -> done` transitions. `plan-taskos complete <id>` runs `verify[]`, scrubs secrets via `redaction.ts`, enforces the `git diff` scope membrane, verifies all mandatory binary `acceptance_criteria`, seals `evidence/<id>.proof.json` referencing **`parent_proof_hashes`** (sorted SHA-256 digests of its exact `depends_on` predecessors' proof envelopes), computes RFC 6962 (`0x00` leaf / `0x01` node) wave/plan Merkle roots, and executes atomic `git commit --only`.
- **Rejected:** A single global linear `prev_proof_sha256` chain (would cause Git merge conflicts when parallel `/swarm` workers complete disjoint micro-tasks concurrently!).
- **Consequence:** Parallel swarms commit concurrently with zero proof-chain conflicts while preserving full DAG cryptographic tamper detection.

### Decision 5 — `O(1)` Cognitive Micro-Brief Compiler + Non-REM Sleep Consolidation
- **Chosen:** `plan-taskos next --brief` executes a 2-hop graph + hybrid BM25/vector recall returning a bounded ~400–600 token Micro-Brief containing ONLY: active task metadata, `owner_files`, extracted `specs/W{n}.md#<id>`, last 2 sibling proofs touching the same files, path-matched `INV-*` rules + `ADR` refs, and top-3 high-salience `episodic_memory` pitfalls. Failed verification attempts capture redacted failure episodes, escalate `model_tier` (`flash -> neon -> argon`) up to `max_attempts` (default `2`), and trip to `blocked` while unlocking disjoint ready frontiers. `plan-taskos sleep` runs reversible Non-REM decay & clustering (`sleep-dream.ts` pattern) and drafts invariant proposals (`invariant-synthesizer.ts` pattern) with hard-enforced `automatedPromotionAllowed: false`.

### Decision 6 — Split-Authority Multi-Plane Projection Bus & Adaptive Granularity Folding
- **Chosen:** Generalize `ISSUE-SYNC-CONTRACT.md` into a 6-plane `ProjectionAdapter` SPI with strict per-field authority ownership and normalized SHA-256 no-op fencing:
  - **Git Plan Bundle:** owns spec, DAG, `owner_files`, `verify[]`, AC definitions, proof envelopes.
  - **ORM PostgreSQL (`packages/orm-project` + `packages/orm-ai`):** owns company, team, Kanban `stage`, `assignee`, `reviewer`, `due_date`, live `ai.work_contract` execution. Maps `Plan -> project.project`, `Wave -> project.milestone`, `Micro-Task -> project.task (parent_id + external_ref = URN)`, `DAG -> project.task_dependency`, `AC -> 1:1 ai.acceptance_criterion`. Solves `TASK_CODE_PATTERN` non-dot mismatch by keeping exact canonical URN in `external_ref` and normalizing `code` (`M0.01` -> `M0_01`).
  - **Docs (`docs/`):** owns ADRs, guides, second-brain (`raw|brain|wiki|blueprints|specs`), auto-injects `INV-006` doc-regen checks when `owner_files` touch routes/models/packages.
  - **GitHub Issues & Delivery:** owns remote assignees, human labels, `## Catatan maintainer`, and separate Delivery Stage (`verified_dev | in_main | released`). Supports **Adaptive Granularity Folding** (`wave` default folds 10–15 micro-tasks into 1 clean managed checklist issue; `task` keeps 1:1 parity with `M0.01`/`K0-001`; `plan` creates 1 master tracking issue).

### Decision 7 — Dual Packaging: Monorepo Core System + Portable Standalone Skill & MCP
- **Chosen:** Ship `packages/plan-taskos` with SDK exports, `plan-taskos` CLI binary, built-in stdio MCP server (`plan-taskos mcp`), and bundled `skill/SKILL.md` (mirrored to `.agents/skills/plan-taskos/SKILL.md`). Wire MoonWitness consumers cleanly across `tools/agent-observatory`, `apps/desktop`, `packages/orm-project`, `packages/mcp-moonwitness`, `apps/agent-observability` (OTel spans/metrics), and `scripts/tasks/*`.

### Decision 8 — Eight Interlocking Patent-Grade Technical Claims
1. Compile-Time Disjoint Write-Ownership Prover over Concurrent Agent DAGs + Runtime `git diff` Scope Membrane.
2. `O(1)` Token-Budgeted Micro-Brief Compiler with Path-Matched Constitutional Invariant Injection.
3. DAG-Structured Proof-Carrying Task Transitions (Parallel-Safe Parent-Hash Merkle Envelopes).
4. Split-Authority Multi-Plane Projection Bus with Normalized Content-Hash No-Op Fencing.
5. Adaptive Granularity Folding across Heterogeneous Work Surfaces (Micro-Task <-> Wave/Plan).
6. Bounded-Attempt Circuit Breaker with Automatic Model-Tier Escalation (`flash -> neon -> argon -> blocked`) & `R0`–`R4` Policy Binding.
7. Git-Rebuildable Local Cognitive Graph DB (`node:sqlite` WAL + FTS5) with 2-Hop Path-Aware Pitfall Injection.
8. Non-REM Episodic Memory Consolidation into Protected-Gate Constitutional Invariant Proposals (`automatedPromotionAllowed: false`).

---

## 4. Repository Gate Invariants

| Gate | Command / Check | Requirement |
|---|---|---|
| Package Boundary | `node scripts/check-desktop-non-overlap.mjs` & `bun run api:addon:check` | Zero `defineModel`/`defineAddon` in `packages/plan-taskos` or `apps/desktop`; zero forbidden imports. |
| Docker Manifests | `node --test scripts/docker-workspace-manifests.test.mjs` | Both `Dockerfile` and `apps/whatsapp/Dockerfile` copy `packages/plan-taskos/package.json` before `bun install --frozen-lockfile`. |
| Node Parity | `engines.node = "24.x"` | Matched across `packages/plan-taskos/package.json` (`INV-005`). |
| Docs & Architecture | `bun run docs:generate`, `bun run architecture:generate`, `bun run docs:links` | Zero broken links; generated reference & diagrams up to date (`INV-006`). |
| Desktop & Observatory | `bun run desktop:test` & `node --test tools/agent-observatory/server.test.mjs` | All Desktop Observatory, Brain endpoints, and standalone Observatory tests pass with zero leaked handles. |
| TaskOS & ORM Project | `bun run test:taskos` & `bun --filter @moonwitness/orm-project test` | TaskOS v2 registry validation, `plan-sync`, and `ai.work_contract` 1:1 AC hydration pass 100%. |
