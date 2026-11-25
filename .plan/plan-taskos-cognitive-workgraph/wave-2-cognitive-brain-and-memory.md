# Wave 2 — Embedded SQLite Cognitive Brain, Knowledge Graph & Memory (`T12`–`T18`)

**ADR Reference:** `.plan/plan-taskos-cognitive-workgraph/ADR-003-plan-taskos-cognitive-workgraph.md` (Decisions 2, 4, 5)
**Depends On:** `T05`, `T09`
**Hard Rule:** Use Node 24 built-in `node:sqlite` (`WAL` + `busy_timeout = 5000` + `FTS5`) with zero native addon dependencies (`better-sqlite3` FORBIDDEN) and pure `InMemoryBrainStore` fallback!

---

## - [x] T12 — Implement `BrainStorageDriver` (`NodeSqliteBrainStore` & `InMemoryBrainStore`)

- **Owner File(s):** `packages/plan-taskos/src/brain/storage.ts`
  - `packages/plan-taskos/src/brain/storage.ts` (CREATE)
- **Depends On:** `T05`
- **Exact Spec:** Define `BrainStorageDriver` interface (`mode: 'sqlite' | 'memory'`, `dbPath: string`, `exec`, `run`, `get`, `all`, `transactionImmediate<T>(fn)`, `close()`).
  - Define `BrainStorageDriver` interface (`mode: 'sqlite' | 'memory'`, `dbPath: string`, `exec`, `run`, `get`, `all`, `transactionImmediate<T>(fn)`, `close()`).
  - Implement `NodeSqliteBrainStore`:
    - Lazy-loads `node:sqlite` (`DatabaseSync`) so browser/sandboxed callers never crash at import time.
    - Creates parent dir `.plan/.brain/` automatically (unless `':memory:'`).
    - Executes on open: `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`.
    - `transactionImmediate(fn)` wraps `BEGIN IMMEDIATE ... COMMIT` with automatic `ROLLBACK` on error (guarantees atomic multi-agent lease acquisition under parallel `/swarm` concurrency!).
  - Implement `InMemoryBrainStore` providing a pure in-memory store for environments where `node:sqlite` is unavailable or explicitly disabled (`mode: 'memory'`).
- **DO NOT:** Import `better-sqlite3` or leave unclosed file descriptors after `close()`.
- **Acceptance Criteria:** `openBrainStore({ dbPath: ':memory:' })` succeeds on Node 24 and executes `CREATE VIRTUAL TABLE ... USING fts5`.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/brain/storage.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-2-cognitive-brain-and-memory.md -m "feat(plan-taskos): T12 add node:sqlite wal+fts5 brain storage driver and memory fallback"
  ```

---

## - [x] T13 — Implement 7-Table Cognitive Schema & Deterministic Git-to-SQLite Reindexer

- **Owner File(s):** `packages/plan-taskos/src/brain/schema.ts`, `packages/plan-taskos/src/brain/reindex.ts`
  - `packages/plan-taskos/src/brain/schema.ts` (CREATE)
  - `packages/plan-taskos/src/brain/reindex.ts` (CREATE)
- **Depends On:** `T06`, `T12`
- **Exact Spec:** `schema.ts`: idempotent DDL (`CREATE TABLE IF NOT EXISTS`) for all 7 tables (`nodes`, `edges`, `fts_index` FTS5 `tokenize = 'porter unicode61'`, `embeddings`, `episodic_memory`, `proof_ledger`, `leases`) plus `brain_meta` (`schema_version`, `last_reindexed_at`, `plan_count`, `node_count`, `edge_count`) and edge indexes (`idx_edges_to`, `idx_edges_rel`).
  - `schema.ts`: idempotent DDL (`CREATE TABLE IF NOT EXISTS`) for all 7 tables (`nodes`, `edges`, `fts_index` FTS5 `tokenize = 'porter unicode61'`, `embeddings`, `episodic_memory`, `proof_ledger`, `leases`) plus `brain_meta` (`schema_version`, `last_reindexed_at`, `plan_count`, `node_count`, `edge_count`) and edge indexes (`idx_edges_to`, `idx_edges_rel`).
  - `reindex.ts`: export `reindexBrainFromRepo(store, repoRoot)`:
    - Loads all plans via `discoverPlans(repoRoot)` (both v2 bundles and legacy `.plan/*.md`), `.agents/rules/learned-invariants.md`, and `.plan/memory/episodes.jsonl` (if present).
    - Rebuilds `nodes`, `edges` (`depends_on`, `parent_of`, `owns_file`, `reads_file`, `governed_by`, `decided_by`, `documents`, `proved_by`, `failed_on`, `fixed_by`, `projected_to`), `fts_index`, and `proof_ledger` inside a single transaction while preserving live unexpired `leases`.
    - Completes full repo reindex in `< 150ms` for 200+ tasks.
- **DO NOT:** Mutate any Git-tracked files during `reindexBrainFromRepo`.
- **Acceptance Criteria:** Deleting `.plan/.brain/taskos.sqlite` and running `reindexBrainFromRepo` reproduces identical `nodes`, `edges`, and `fts_index` counts deterministically.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/brain/schema.ts packages/plan-taskos/src/brain/reindex.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-2-cognitive-brain-and-memory.md -m "feat(plan-taskos): T13 implement 7-table cognitive brain schema and deterministic git reindexer"
  ```

---

## - [x] T14 — Implement 2-Hop Knowledge Graph Engine & Causal Impact Query (`src/brain/knowledge-graph.ts`)

- **Owner File(s):** `packages/plan-taskos/src/brain/knowledge-graph.ts`
  - `packages/plan-taskos/src/brain/knowledge-graph.ts` (CREATE)
- **Depends On:** `T13`
- **Exact Spec:** Align edge semantics with `packages/knowledge/src/concept-graph.ts` (`governed_by`, `decided_by`, `depends_on`, `owns_file`, `documents`, `proved_by`, `failed_on`, `fixed_by`, `projected_to`).
  - Align edge semantics with `packages/knowledge/src/concept-graph.ts` (`governed_by`, `decided_by`, `depends_on`, `owns_file`, `documents`, `proved_by`, `failed_on`, `fixed_by`, `projected_to`).
  - Export:
    - `queryTwoHopContext(store, taskUrn)`: returns `{ siblingTasksOnSameFiles, linkedAdrs, matchedInvariants, linkedDocs, priorFailuresOnSameFiles }` via indexed SQL graph joins (`< 10ms`).
    - `queryBlastRadiusImpact(store, targetPathOrUrn, maxDepth = 4)`: SQLite `WITH RECURSIVE` traversal returning impacted active/blocked tasks, downstream critical-path nodes, linked ADRs, linked GitHub waves, `INV-006` doc regeneration flags, and historical failure episodes.
    - `exportSubgraph(store, { planId?, centerUrn?, maxHops? })`: returns compact `{ nodes, edges }` JSON payload ready for `tools/agent-observatory` and `apps/desktop` interactive graph rendering.
- **DO NOT:** Allow unbounded cyclic recursion in SQL CTEs (enforce `depth < maxDepth` and visited path string guard).
- **Acceptance Criteria:** Cycle-safe recursive CTE traversal; querying a file path returns all owning tasks, downstream dependents, ADRs, and invariants.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/brain/knowledge-graph.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-2-cognitive-brain-and-memory.md -m "feat(plan-taskos): T14 add 2-hop knowledge graph traversal and recursive impact engine"
  ```

---

## - [x] T15 — Implement Hybrid BM25 + Optional Local Ollama Embedding Recall (`src/brain/hybrid-recall.ts`)

- **Owner File(s):** `packages/plan-taskos/src/brain/hybrid-recall.ts`
  - `packages/plan-taskos/src/brain/hybrid-recall.ts` (CREATE)
- **Depends On:** `T13`
- **Exact Spec:** Export `hybridRecall(store, input: { query, kinds?, limit?, ollamaEndpoint?, embeddingModel?, timeoutMs?, fetchFn? }): Promise<HybridRecallResult>`:
  - Export `hybridRecall(store, input: { query, kinds?, limit?, ollamaEndpoint?, embeddingModel?, timeoutMs?, fetchFn? }): Promise<HybridRecallResult>`:
    - Runs SQLite FTS5 `bm25(fts_index)` query (sanitizing FTS5 special operators so punctuation/paths never throw syntax errors!).
    - When `ollamaEndpoint` is configured AND verified strictly loopback (`127.0.0.1` / `localhost` / `[::1]` — SSRF fail-closed!): fetches embedding for query (`AbortController`, default `800ms` timeout), compares cosine similarity against cached `embeddings` blobs for top-24 lexical candidates, and fuses via weighted Reciprocal Rank Fusion (`mode: 'hybrid'`).
    - When Ollama is absent/offline/times out: falls back cleanly with zero error to `mode: 'lexical_only'` + `fallbackReason`.
    - Redacts every returned snippet via `redactSensitiveText`.
- **DO NOT:** Send any query or snippet to non-loopback network hosts.
- **Acceptance Criteria:** Works 100% offline in `lexical_only` mode; rejects non-loopback `ollamaEndpoint` URLs; never leaks secrets in snippets.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/brain/hybrid-recall.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-2-cognitive-brain-and-memory.md -m "feat(plan-taskos): T15 add fts5 bm25 and loopback ollama hybrid recall engine"
  ```

---

## - [x] T16 — Implement Episodic Memory, Non-REM Sleep Consolidation & Protected-Gate Invariant Synthesizer

- **Owner File(s):** `packages/plan-taskos/src/brain/episodic-memory.ts`
  - `packages/plan-taskos/src/brain/episodic-memory.ts` (CREATE)
- **Depends On:** `T13`
- **Exact Spec:** Implement redacted episodic memory operations:
  - Implement redacted episodic memory operations:
    - `recordEpisode(store, repoRoot, input)`: scrubs `summary` via `redactSensitiveText`, computes `provenance_sha256`, writes to SQLite `episodic_memory` + graph edge (`failed_on`/`fixed_by`/`learned_from`) AND appends deterministic line to `.plan/memory/episodes.jsonl` (Git-portable!).
    - `recallPitfallsForPaths(store, ownerFiles, limit = 3)`: ranks `status = 'active'` episodes by path overlap + `importance_bps` + recency, bumping `access_count` and `last_accessed_at`.
  - Implement `runNonRemSleepConsolidation(store, options)` (aligned with `packages/ai-runtime/src/sleep-dream.ts` & `invariant-synthesizer.ts`):
    - Reversible decay of stale low-salience episodes (`status = 'decayed'`, `reversible: true`).
    - Clusters recurring `failure_pattern` episodes (`>= 2` occurrences on matching topic/paths) into `SemanticCandidate[]` and `InvariantRuleProposal[]`.
    - **Constitutional Guard:** Hard-enforces `automatedPromotionAllowed: false` and `automatedSelfAccept: false`; rejects any candidate containing weakening patterns (`weaken|disable|bypass|skip|remove`) targeting protected gates (`R0-R4`, `check-desktop-non-overlap`, `check-api-addon-boundary`, `check-board-shared-ui`, `ai-drift-watchdog`).
- **DO NOT:** Auto-edit `.agents/rules/learned-invariants.md` or allow `automatedPromotionAllowed: true`.
- **Acceptance Criteria:** Episodes persist cleanly across DB deletion via `episodes.jsonl`; protected-gate weakening proposals are rejected fail-closed.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/brain/episodic-memory.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-2-cognitive-brain-and-memory.md -m "feat(plan-taskos): T16 add episodic memory, non-rem sleep consolidation, and protected invariant synthesizer"
  ```

---

## - [x] T17 — Implement RFC 6962 DAG-Merkle Proof Ledger (`src/brain/merkle-dag.ts`)

- **Owner File(s):** `packages/plan-taskos/src/brain/merkle-dag.ts`
  - `packages/plan-taskos/src/brain/merkle-dag.ts` (CREATE)
- **Depends On:** `T04`, `T13`
- **Exact Spec:** Implement RFC 6962 domain-separated hashing (`0x00` leaf prefix, `0x01` internal node prefix — exact parity with `packages/ai-runtime/src/merkle-ledger.ts`):
  - Implement RFC 6962 domain-separated hashing (`0x00` leaf prefix, `0x01` internal node prefix — exact parity with `packages/ai-runtime/src/merkle-ledger.ts`):
    - `hashProofLeaf(envelope)`: `SHA-256(0x00 || canonicalJson(envelopeWithoutSelfHash))`.
    - `sealProofEnvelope(draft, parentProofHashes)`: sorts unique 64-hex `parentProofHashes` (derived strictly from `depends_on` predecessors so parallel `/swarm` workers NEVER collide!), computes `envelope_sha256`, returns sealed `ProofEnvelope`.
    - `computeMerkleRoot(leafHashes)`: deterministic RFC 6962 Merkle tree root over sorted proof leaves.
    - `verifyProofChain(proofs, tasks)`: verifies every `envelope_sha256` matches recomputed hash AND every `depends_on` predecessor's proof hash is present in `parent_proof_hashes` (detecting any tampering or skipped dependency!).
- **DO NOT:** Depend on wall-clock linear order across unrelated parallel tasks.
- **Acceptance Criteria:** Tampering with any field in a `ProofEnvelope` fails `verifyProofChain` deterministically; parallel disjoint proofs compose cleanly with zero hash race.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/brain/merkle-dag.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-2-cognitive-brain-and-memory.md -m "feat(plan-taskos): T17 add parallel-safe rfc6962 dag-merkle proof ledger and verifier"
  ```

---

## - [x] T18 — Add Wave 2 Unit Tests & Pass Wave 2 Brain Gate

- **Owner File(s):** `packages/plan-taskos/tests/brain-sqlite.test.ts`, `packages/plan-taskos/tests/knowledge-graph.test.ts`, `packages/plan-taskos/tests/memory-sleep.test.ts`, `packages/plan-taskos/tests/merkle-dag.test.ts`
  - `packages/plan-taskos/tests/brain-sqlite.test.ts` (CREATE)
  - `packages/plan-taskos/tests/knowledge-graph.test.ts` (CREATE)
  - `packages/plan-taskos/tests/memory-sleep.test.ts` (CREATE)
  - `packages/plan-taskos/tests/merkle-dag.test.ts` (CREATE)
- **Depends On:** `T12`, `T13`, `T14`, `T15`, `T16`, `T17`
- **Exact Spec:** `brain-sqlite.test.ts`: tests WAL + `FTS5` creation, `<150ms` deterministic rebuild after deleting `.sqlite`, `InMemoryBrainStore` parity, and loopback-only Ollama SSRF guard + offline `lexical_only` fallback.
  - `brain-sqlite.test.ts`: tests WAL + `FTS5` creation, `<150ms` deterministic rebuild after deleting `.sqlite`, `InMemoryBrainStore` parity, and loopback-only Ollama SSRF guard + offline `lexical_only` fallback.
  - `knowledge-graph.test.ts`: tests 2-hop file-neighbor recall, recursive `impact` blast radius, cycle safety, and `exportSubgraph`.
  - `memory-sleep.test.ts`: tests secret redaction on episode capture, `episodes.jsonl` persistence, reversible Non-REM decay, clustering into invariant proposals, and fail-closed rejection of protected-gate weakening.
  - `merkle-dag.test.ts`: tests RFC 6962 leaf/node hashing, parallel disjoint parent-hash sealing, and tamper detection.
- **Acceptance Criteria:** All Wave 1 + Wave 2 Vitest suites pass with zero hanging handles.
- **Expected Output:** Build and all tests exit `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos build; if ($?) { bun --filter @moonwitness/plan-taskos test }`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/tests/brain-sqlite.test.ts packages/plan-taskos/tests/knowledge-graph.test.ts packages/plan-taskos/tests/memory-sleep.test.ts packages/plan-taskos/tests/merkle-dag.test.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-2-cognitive-brain-and-memory.md -m "test(plan-taskos): T18 add wave 2 tests for sqlite brain, knowledge graph, sleep memory, and merkle dag"
  ```
