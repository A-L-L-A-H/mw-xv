# `@moonwitness/plan-taskos` — Cognitive WorkGraph OS Master Plan (Flash-Ready · 44 Micro-Tasks)

- **Plan ID:** `plan-taskos-cognitive-workgraph`
- **ADR:** `.plan/plan-taskos-cognitive-workgraph/ADR-003-plan-taskos-cognitive-workgraph.md`
- **Total Micro-Tasks:** `44` (`T01`–`T44`) — 100% autonomous, zero human decisions, zero overlap
- **Target Branch:** `dev`
- **End State:** Standalone pure TypeScript package `packages/plan-taskos` (`@moonwitness/plan-taskos`) with embedded Node 24 `node:sqlite` (WAL + FTS5) Cognitive Brain, 2-hop Knowledge Graph, Hybrid BM25+Ollama Recall, Non-REM Sleep Consolidation, DAG-Merkle Proof-Carrying Runner, Split-Authority Multi-Plane Projection Bus (`.plan/`, `orm-project` + `orm-ai`, `docs/`, `docs/tasks/tasks.json`, GitHub Issues, `/swarm`, OTel), portable CLI + MCP + `SKILL.md` (`.agents/skills/plan-taskos/SKILL.md`), and live wiring across `tools/agent-observatory`, `apps/desktop`, `packages/orm-project`, `packages/mcp-moonwitness`, and `apps/agent-observability`.

---

## 1. Flash Agent Autonomous Execution Loop (READ EVERY TURN)

Execute strictly **1 micro-task (`Txx`) per cycle** without asking the user any questions:

1. **Load Minimal Context:** Read this Master file to locate the first unchecked `- [ ] **Txx**`, then read **ONLY** the single Wave Playbook owning `Txx` (and `ADR-003` only if architectural rationale is needed).
2. **Verify Predecessor:** Confirm every task listed in `Depends On` is marked `[x]`.
3. **Implement `Txx`:** Edit ONLY the files listed under `Owner File(s)` for `Txx`. Follow `Exact Spec` and `DO NOT` strictly.
4. **Run `Verify` Command:** Must exit `0` and satisfy every bullet in `Acceptance Criteria` and `Expected Output`. Fix root causes immediately if anything fails.
5. **Update Tracking:** Change `- [ ]` -> `- [x]` for `Txx` in BOTH the Wave Playbook AND this Master file, and update the Progress Ledger row.
6. **Atomic Per-Micro-Task Commit & Push (`dev` only):**
   ```powershell
   git add <Txx-owner-files> .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/<wave-file>.md ; if ($?) { git commit --only <Txx-owner-files> .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/<wave-file>.md -m "<type>(<scope>): Txx <short-title>" } ; if ($?) { git push origin dev; if (-not $?) { git pull --rebase --autostash origin dev; if ($?) { git push origin dev } } }
   ```
   - **Pre-Commit Auto-Fix Recovery:** If the pre-commit hook runs `eslint --fix` and modifies a staged file, re-run the exact same `git commit --only ...` command once, then push to `origin dev`.
   - **NEVER** run `git add -A`, **NEVER** touch unrelated dirty files, **NEVER** pass `--force` or `--no-verify`, **NEVER** push to `main`.
7. **Hard Invariants:**
   - Windows PowerShell ONLY: chain commands with `; if ($?) { ... }`, NEVER `&&` (`INV-001`).
   - `packages/plan-taskos` MUST have ZERO imports from `@moonwitness/orm*`, `@moonwitness/ui`, `fastify`, `react`, `better-sqlite3`, or `tauri` (`INV-004`, `INV-009`).
   - Node engine pinned to `"24.x"` (`INV-005`); SQLite driver uses Node 24 built-in `node:sqlite` (`WAL` + `busy_timeout = 5000` + `FTS5`) with pure `InMemoryBrainStore` fallback.
   - `.plan/.brain/` and `.plan/*/.leases.local.json` MUST remain gitignored; NEVER commit binary `.sqlite` files or unredacted secrets (`episodes.jsonl` and `evidence/*.proof.json` MUST pass through `redactSensitiveText`).
   - Use backticks (not relative markdown links) for repo code paths in `.plan/*.md` so `scripts/check-docs.mjs` stays `0` findings.

---

## 2. Disjoint File Ownership & Dependency DAG (Zero Overlap Guarantee)

| Wave | Playbook | Tasks | Exclusive File Ownership | Depends On |
|---|---|---|---|---|
| **Wave 0 — Foundation & Schemas** | `.plan/plan-taskos-cognitive-workgraph/wave-0-foundation-and-schemas.md` | `T01`–`T05` | `packages/plan-taskos/package.json`, `tsconfig.json`, `tsconfig.check.json`, `vitest.config.ts`, `schemas/**`, `src/core/{urn,paths,redaction,types}.ts`, `.gitignore`, `Dockerfile`, `apps/whatsapp/Dockerfile`, `bun.lock` | None |
| **Wave 1 — WorkGraph Compiler & Prover** | `.plan/plan-taskos-cognitive-workgraph/wave-1-workgraph-compiler-and-prover.md` | `T06`–`T11` | `packages/plan-taskos/src/core/{loader,validator,disjoint-prover,dag,authority}.ts`, `packages/plan-taskos/tests/{loader-validator,disjoint-prover,dag-authority}.test.ts` | `T05` |
| **Wave 2 — Cognitive Brain & Memory** | `.plan/plan-taskos-cognitive-workgraph/wave-2-cognitive-brain-and-memory.md` | `T12`–`T18` | `packages/plan-taskos/src/brain/**`, `packages/plan-taskos/tests/{brain-sqlite,knowledge-graph,memory-sleep,merkle-dag}.test.ts` | `T05`, `T09` |
| **Wave 3 — Proof-Carrying Runner & Briefs** | `.plan/plan-taskos-cognitive-workgraph/wave-3-proof-runner-and-briefs.md` | `T19`–`T23` | `packages/plan-taskos/src/runner/**`, `packages/plan-taskos/tests/{brief-compiler,lease-lock,proof-runner}.test.ts` | `T11`, `T18` |
| **Wave 4 — Universal Projection Adapters** | `.plan/plan-taskos-cognitive-workgraph/wave-4-universal-projection-adapters.md` | `T24`–`T30` | `packages/plan-taskos/src/adapters/**`, `packages/plan-taskos/src/index.ts`, `packages/plan-taskos/tests/{adapters-plan-taskos,adapters-docs-github,adapters-orm-swarm}.test.ts` | `T11`, `T18`, `T23` |
| **Wave 5 — CLI, MCP, Skill & Root Scripts** | `.plan/plan-taskos-cognitive-workgraph/wave-5-cli-mcp-skill-and-dogfood.md` | `T31`–`T36` | `packages/plan-taskos/src/mcp/**`, `packages/plan-taskos/src/cli.ts`, `packages/plan-taskos/skill/**`, `.agents/skills/plan-taskos/**`, `package.json`, `packages/plan-taskos/tests/{cli-e2e,mcp-server}.test.ts` | `T30` |
| **Wave 6 — Ecosystem Consumers & Final Gates** | `.plan/plan-taskos-cognitive-workgraph/wave-6-ecosystem-consumers-and-gates.md` | `T37`–`T44` | `packages/orm-project/src/{plan-sync,http-plugin}.ts`, `apps/desktop/src/{observatory/plan-collector,local-api-server}.ts`, `tools/agent-observatory/server.mjs`, `packages/mcp-moonwitness/src/{plan-brain,server}.ts`, `apps/agent-observability/src/plan-telemetry.ts`, consumer tests, generated docs/diagrams | `T36` (`T37`–`T42` pairwise disjoint!) |

---

## 3. Global Micro-Task Checklist (`T01`–`T44`)

### Wave 0 — Foundation, Packaging & Schemas (`wave-0-foundation-and-schemas.md`)
- [x] **T01** — Scaffold `packages/plan-taskos` manifest (`package.json`, `tsconfig.json`, `tsconfig.check.json`, `vitest.config.ts`) & update `.gitignore` for `.plan/.brain/` and `.leases.local.json`
- [x] **T02** — Add `COPY packages/plan-taskos/package.json` to `Dockerfile` & `apps/whatsapp/Dockerfile` + sync `bun.lock` (`docker-workspace-manifests.test.mjs`)
- [x] **T03** — Author JSON Schemas 2020-12 (`schemas/{manifest,wave,proof,document}.schema.json`) for 6-plane WorkGraph IR v1
- [x] **T04** — Implement `src/core/urn.ts`, `src/core/paths.ts` (POSIX normalization + traversal guard), and `src/core/redaction.ts` (secret-scrubbing membrane)
- [x] **T05** — Define pure readonly 6-plane TypeScript contracts & `ProjectionAdapter` SPI in `src/core/types.ts`

### Wave 1 — WorkGraph Compiler, Disjoint Ownership Prover & DAG (`wave-1-workgraph-compiler-and-prover.md`)
- [x] **T06** — Implement dual-format bundle loader `src/core/loader.ts` (v2 `.plan/<id>/manifest.json` + waves/specs/proofs AND v1 legacy `.plan/*.md` parity)
- [x] **T07** — Implement AJV Schema + 1:1 `specs/*.md` ID parity + invariant path-matcher validator in `src/core/validator.ts`
- [x] **T08** — Implement Compile-Time Disjoint Write-Ownership Prover `src/core/disjoint-prover.ts` (transitive `depends_on` closure + POSIX glob intersection proof)
- [x] **T09** — Implement DAG engine `src/core/dag.ts` (cycle detection, topological depth, `ready`/`active`/`blocked`/`done` frontier, Boss Critical Path, swarm wave partitioning)
- [x] **T10** — Implement Split-Authority Field-Plane Reconciler `src/core/authority.ts` (per-plane ownership merger + normalized SHA-256 no-op fence)
- [x] **T11** — Add Wave 1 unit tests (`loader-validator.test.ts`, `disjoint-prover.test.ts`, `dag-authority.test.ts`) & pass Wave 1 gate

### Wave 2 — Embedded SQLite Cognitive Brain, Knowledge Graph & Memory (`wave-2-cognitive-brain-and-memory.md`)
- [x] **T12** — Implement `BrainStorageDriver` (`src/brain/storage.ts`): `NodeSqliteBrainStore` (`node:sqlite` WAL + `busy_timeout=5000` + FTS5) & `InMemoryBrainStore` fallback
- [x] **T13** — Implement 7-table schema migration & deterministic `<150ms` Git-to-SQLite reindexer (`src/brain/schema.ts`, `src/brain/reindex.ts`)
- [x] **T14** — Implement 2-hop Knowledge Graph query engine (`src/brain/knowledge-graph.ts`: recursive CTE `impact`, file-neighbor history, path-matched `INV-*` & `ADR` traversal)
- [x] **T15** — Implement Hybrid BM25 + optional loopback Ollama embedding recall (`src/brain/hybrid-recall.ts`, automatic offline `lexical_only` fallback)
- [x] **T16** — Implement Episodic Memory store (`src/brain/episodic-memory.ts`: redacted `.plan/memory/episodes.jsonl` sync + Non-REM decay & clustering + Protected-Gate Invariant Synthesizer with `automatedPromotionAllowed: false`)
- [x] **T17** — Implement RFC 6962 DAG-Merkle Proof Ledger (`src/brain/merkle-dag.ts`: parent-hash DAG proofs + `0x00`/`0x01` domain-separated wave/plan root + tamper verification)
- [x] **T18** — Add Wave 2 unit tests (`brain-sqlite.test.ts`, `knowledge-graph.test.ts`, `memory-sleep.test.ts`, `merkle-dag.test.ts`) & pass Wave 2 gate

### Wave 3 — Proof-Carrying Runner, Micro-Brief Compiler & TTL Leases (`wave-3-proof-runner-and-briefs.md`)
- [x] **T19** — Implement `O(1)` Cognitive Micro-Brief compiler (`src/runner/brief-compiler.ts`: 1 task + `owner_files` + `specs/*.md` slice + 2-hop neighbors + matched `INV-*` + top-3 episodic pitfalls)
- [x] **T20** — Implement atomic multi-agent TTL Lease manager (`src/runner/lease-manager.ts`: SQLite `BEGIN IMMEDIATE` claim/renew/release/stale-reap + `.leases.local.json` mirror)
- [x] **T21** — Implement runtime `git diff` scope membrane & verification executor (`src/runner/scope-gate.ts`: blocks edits outside `owner_files` + redacted stdout/stderr capture)
- [x] **T22** — Implement Proof-Carrying Task Runner (`src/runner/proof-runner.ts`: verify -> scope check -> seal DAG-Merkle `evidence/*.proof.json` -> bounded-attempt `flash->neon->argon->blocked` circuit breaker -> atomic `git commit --only`)
- [x] **T23** — Add Wave 3 unit tests (`brief-compiler.test.ts`, `lease-lock.test.ts`, `proof-runner.test.ts`) & pass Wave 3 gate

### Wave 4 — Universal Split-Authority Projection Adapters (`wave-4-universal-projection-adapters.md`)
- [x] **T24** — Implement deterministic `.plan/<id>.md` & Progress Ledger projector (`src/adapters/plan-md.adapter.ts`: 100% compatible with Desktop Observatory)
- [x] **T25** — Implement Global TaskOS v2 roll-up & 5-layer `documents[]` adapter (`src/adapters/taskos-v2.adapter.ts`: bijective status/priority map + `metadata.urn` link)
- [x] **T26** — Implement Docs & Second-Brain adapter (`src/adapters/docs.adapter.ts`: `INV-006` doc-impact detector, ADR/spec registry, broken-link guard)
- [x] **T27** — Implement Split-Authority GitHub Issues & Delivery adapter (`src/adapters/github.adapter.ts`: `plan|wave|task` adaptive folding, `<!-- BEGIN/END MOONWITNESS MANAGED -->`, content-hash no-op, bounded batch `<=5`, CI delivery close gate, inbound intake)
- [ ] **T28** — Implement Pure HTTP ORM Project/WorkContract adapter (`src/adapters/orm-http.adapter.ts`), `/swarm` model-tier exporter (`src/adapters/swarm.adapter.ts`), & OTel/Notification event hooks (`src/adapters/telemetry.adapter.ts`)
- [ ] **T29** — Wire clean public SDK barrel exports in `packages/plan-taskos/src/index.ts` & verify zero forbidden imports (`orm*`/`ui`/`fastify`/`react`)
- [ ] **T30** — Add Wave 4 adapter unit tests (`adapters-plan-taskos.test.ts`, `adapters-docs-github.test.ts`, `adapters-orm-swarm.test.ts`) & pass Wave 4 gate

### Wave 5 — CLI, Standalone MCP Server, Portable Skill & Dogfood (`wave-5-cli-mcp-skill-and-dogfood.md`)
- [ ] **T31** — Implement thin MCP tool handlers & stdio JSON-RPC server (`src/mcp/tools.ts`, `src/mcp/stdio-server.ts`: `plan_next`, `plan_recall`, `plan_impact`, `plan_claim`, `plan_complete`, `plan_graph`, `plan_sync`)
- [ ] **T32** — Implement full `plan-taskos` CLI (`src/cli.ts`: `init`, `lint`, `reindex`, `dag`, `next`, `recall`, `impact`, `claim`, `verify`, `complete`, `fail`, `block`, `sleep`, `sync`, `intake`, `export-swarm`, `mcp`)
- [ ] **T33** — Author portable Agent Skill & templates (`packages/plan-taskos/skill/SKILL.md`, `skill/templates/{manifest,wave,adr,spec}.*`, `skill/mcp-manifest.json`)
- [ ] **T34** — Install workspace skill mirror at `.agents/skills/plan-taskos/SKILL.md` & link with `hybrid-swarm-dag` / `frontier-research-scout` conventions
- [ ] **T35** — Add root `package.json` convenience scripts (`plan:lint`, `plan:reindex`, `plan:next`, `plan:sync`, `plan:mcp`)
- [ ] **T36** — Add Wave 5 CLI + MCP E2E tests (`cli-e2e.test.ts`, `mcp-server.test.ts`) & dogfood `plan-taskos lint` + `reindex` on `.plan/`

### Wave 6 — Ecosystem Consumers Wiring & Full Repo Gates (`wave-6-ecosystem-consumers-and-gates.md`)
- [ ] **T37** — `packages/orm-project`: add `src/plan-sync.ts` + `POST /api/projects/:id/plan-sync` (project/milestone/task(parent)/dependency + 1:1 `ai.acceptance_criterion` hydration + URN in `external_ref`) + tests
- [ ] **T38** — `apps/desktop`: upgrade `apps/desktop/src/observatory/plan-collector.ts` to consume `@moonwitness/plan-taskos` loader + Brain graph/proof/lease metadata (100% legacy + `INV-009` compliant)
- [ ] **T39** — `apps/desktop`: mount read-only Brain endpoints (`/api/desktop/observatory/brain/{search,impact,graph}`) on `apps/desktop/src/local-api-server.ts` + tests
- [ ] **T40** — `tools/agent-observatory`: wire `tools/agent-observatory/server.mjs` to consume `@moonwitness/plan-taskos` Brain DB + Graph/Proof/Episode endpoints + update `server.test.mjs`
- [ ] **T41** — `packages/mcp-moonwitness`: add read-only Plan-TaskOS Brain tools (`plan_status`, `plan_recall`, `plan_impact`) in `packages/mcp-moonwitness/src/{plan-brain,server}.ts` + tests
- [ ] **T42** — `apps/agent-observability`: add `src/plan-telemetry.ts` emitting OTel spans & metrics for Plan-TaskOS lifecycle events + tests
- [ ] **T43** — `scripts/tasks/` & `scripts/roadmap/`: add parity test `scripts/tasks/plan-taskos-parity.test.mjs` proving TaskOS v2 + GitHub managed-block parity
- [ ] **T44** — Run full workspace verification & generator sync (`docs:generate`, `architecture:generate`, `docs:links`, `docker-workspace-manifests`, `ui:check`, `desktop:test`, `test:taskos`, `api:addon:check`) & close Progress Ledger

---

## 4. Execution Progress Ledger

| Wave | Task Range | Completed Tasks | Last Commit SHA | Latest Verification Evidence |
|---|---|---|---|---|
| Wave 0 | `T01`–`T05` | `5 / 5` | 8c45fbbb | `bun --filter @moonwitness/plan-taskos typecheck` exit 0 |
| Wave 1 | `T06`–`T11` | `6 / 6` | cb133e05 | `bun --filter @moonwitness/plan-taskos typecheck` exit 0 |
| Wave 2 | `T12`–`T18` | `7 / 7` | 2f3f6d11 | `bun --filter @moonwitness/plan-taskos typecheck` exit 0 |
| Wave 3 | `T19`–`T23` | `5 / 5` | 2f3f6d11 | `bun --filter @moonwitness/plan-taskos typecheck && bun --filter @moonwitness/plan-taskos build && bun --filter @moonwitness/plan-taskos test` (80/80) |
| Wave 4 | `T24`–`T30` | `4 / 7` | 67653d1b | `bun --filter @moonwitness/plan-taskos typecheck` exit 0 |
| Wave 5 | `T31`–`T36` | `0 / 6` | — | — |
| Wave 6 | `T37`–`T44` | `0 / 8` | — | — |
