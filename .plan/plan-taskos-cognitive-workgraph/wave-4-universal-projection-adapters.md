# Wave 4 — Universal Split-Authority Projection Adapters (`T24`–`T30`)

**ADR Reference:** `.plan/plan-taskos-cognitive-workgraph/ADR-003-plan-taskos-cognitive-workgraph.md` (Decisions 6, 7)
**Depends On:** `T11`, `T18`, `T23`
**Hard Rule:** Every adapter MUST obey Split-Authority field ownership, compute normalized content-hash no-ops, and keep ZERO direct ORM/UI imports inside `packages/plan-taskos`!

---

## - [x] T24 — Implement Deterministic `.plan/<id>.md` Projector (`src/adapters/plan-md.adapter.ts`)

- **Owner File(s):** `packages/plan-taskos/src/adapters/plan-md.adapter.ts`
  - `packages/plan-taskos/src/adapters/plan-md.adapter.ts` (CREATE)
- **Depends On:** `T10`, `T17`
- **Exact Spec:** Implement `planMarkdownAdapter: ProjectionAdapter` rendering `.plan/<plan-id>.md` deterministically from a v2 `LoadedPlanBundle`:
  - Implement `planMarkdownAdapter: ProjectionAdapter` rendering `.plan/<plan-id>.md` deterministically from a v2 `LoadedPlanBundle`:
    - Header metadata (`Plan ID`, `ADR`, `Total Micro-Tasks`, `Target Branch`, `Merkle Root`).
    - Disjoint File Ownership & Dependency DAG table.
    - Global Micro-Task Checklist (`### Wave X — Title` + `- [x] **T01** — Title` or `- [ ] **T02** — Title`) matching `apps/desktop/src/observatory/plan-collector.ts` regex 100%!
    - Execution Progress Ledger with completed count, last commit SHA, and latest proof SHA-256 prefix.
  - Supports `--check` drift detection (normalized LF comparison, zero spurious diffs).
- **DO NOT:** Emit unescaped broken relative markdown links (wrap all file paths in backticks for `scripts/check-docs.mjs`!).
- **Acceptance Criteria:** Rendered `.plan/<id>.md` round-trips cleanly through `loadPlanBundle` and `plan-collector.ts`.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/adapters/plan-md.adapter.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-4-universal-projection-adapters.md -m "feat(plan-taskos): T24 implement deterministic observatory-compatible plan markdown projector"
  ```

---

## - [x] T25 — Implement Global TaskOS v2 Roll-Up & 5-Layer `documents[]` Adapter (`src/adapters/taskos-v2.adapter.ts`)

- **Owner File(s):** `packages/plan-taskos/src/adapters/taskos-v2.adapter.ts`
  - `packages/plan-taskos/src/adapters/taskos-v2.adapter.ts` (CREATE)
- **Depends On:** `T10`
- **Exact Spec:** Export `projectBundleToTaskosV2(bundle, options?: { foldMode?: 'wave' | 'plan' | 'task'; projectSlug?: string })`:
  - Export `projectBundleToTaskosV2(bundle, options?: { foldMode?: 'wave' | 'plan' | 'task'; projectSlug?: string })`:
    - Projects folded items into strict `moonwitness-tasks/v2` records (`docs/tasks/tasks.schema.json` compatible: `code`, `project`, `series`, `milestone`, `status`, `priority`, `dependsOn`, reciprocal `blocks`, `scope: { packages, files }`, `acceptanceCriteria[]`, `validation`, `evidence`, `sourceRef`, `metadata: { plan_urn, fold_mode, proof_merkle_root }`).
    - Projects plan ADRs, wave specs, and evidence summaries into `documents[]` using the 5-layer ontology (`raw | brain | wiki | blueprints | specs`) with `linkedTasks[]`.
  - Export `mergeTaskosV2Patch(existingRegistry, projected)` preserving all unrelated registry records untouched (zero data loss on existing 679 records!) and enforcing reciprocal `dependsOn`/`blocks`.
- **DO NOT:** Overwrite or drop unrelated tasks in `docs/tasks/tasks.json`.
- **Acceptance Criteria:** Projected records satisfy `docs/tasks/tasks.schema.json` (`additionalProperties: false`) with reciprocal edges intact.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/adapters/taskos-v2.adapter.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-4-universal-projection-adapters.md -m "feat(plan-taskos): T25 add taskos v2 portfolio roll-up and 5-layer documents adapter"
  ```

---

## - [x] T26 — Implement Docs & Second-Brain Adapter (`src/adapters/docs.adapter.ts`)

- **Owner File(s):** `packages/plan-taskos/src/adapters/docs.adapter.ts`
  - `packages/plan-taskos/src/adapters/docs.adapter.ts` (CREATE)
- **Depends On:** `T04`, `T14`
- **Exact Spec:** Export `analyzeDocsImpact(tasks: readonly PlanTaskIR[])`:
  - Export `analyzeDocsImpact(tasks: readonly PlanTaskIR[])`:
    - Detects `INV-006` triggers statically from `owner_files[]`:
      - Touches `apps/api/src/routes/**`, `packages/orm-*/src/models*`, or root `package.json` -> `docs_impact: 'reference_regen'` (requires `bun run docs:generate` + `bun run architecture:generate`).
      - Touches `docs/**` or `README.md` -> `docs_impact: 'links_check'` (requires `bun run docs:links`).
  - Export `renderSecondBrainIndex(bundle, proofs, episodes)`: compiles a clean Markdown blueprint/summary card suitable for `docs/second-brain/` or `docs/decisions/` with zero broken relative links and deterministic Mermaid `flowchart TD` DAG.
- **DO NOT:** Emit HTML tags inside Mermaid node labels (always quote labels containing parentheses/brackets).
- **Acceptance Criteria:** Accurately flags `INV-006` doc-regen requirements and emits valid link-checked Markdown.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/adapters/docs.adapter.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-4-universal-projection-adapters.md -m "feat(plan-taskos): T26 add docs impact analyzer and second-brain markdown projection adapter"
  ```

---

## - [x] T27 — Implement Split-Authority GitHub Issues & Delivery Adapter (`src/adapters/github.adapter.ts`)

- **Owner File(s):** `packages/plan-taskos/src/adapters/github.adapter.ts`
  - `packages/plan-taskos/src/adapters/github.adapter.ts` (CREATE)
- **Depends On:** `T10`
- **Exact Spec:** Generalize `docs/roadmap/ISSUE-SYNC-CONTRACT.md` & `scripts/roadmap/sync-issues.mjs` into a pure, testable adapter:
  - Generalize `docs/roadmap/ISSUE-SYNC-CONTRACT.md` & `scripts/roadmap/sync-issues.mjs` into a pure, testable adapter:
    - **Adaptive Folding (`plan` | `wave` | `task`):**
      - `wave` (default): 1 managed GitHub Issue per Wave with live micro-task checklist (`- [x] **T01** — ... (\`sha\` · proof \`hash8\`)`).
      - `task`: 1:1 issue per task (exact parity with `M0.01`/`K0-001` roadmap issues).
      - `plan`: 1 tracking issue per Plan.
    - **Managed Block Fence:** emits `<!-- moonwitness-task: <repoId>:<key> -->` + `<!-- BEGIN MOONWITNESS MANAGED --> ... <!-- END MOONWITNESS MANAGED -->`, preserving human text (`## Catatan maintainer`) and non-managed labels verbatim!
    - **Zero-Loop Content Hash:** computes normalized SHA-256 of managed body + managed labels + milestone; identical remote state produces `operation: 'noop'`.
    - **Bounded Apply & Delivery Close Gate:** caps apply batch at `5`, detects duplicate markers (`conflict`) and orphans (`needs-triage`), NEVER closes an issue unless BOTH work proof (`work_status === 'done'`) AND `delivery_stage` satisfy `delivery_close_policy`!
    - **Inbound Intake:** `parseGitHubIssueToIntakeDraft(issue)` converts a human GitHub Issue into a clean `backlog` `PlanTaskIR` seed with `projections.github.issue_number`.
- **DO NOT:** Make unmockable live network calls inside planning functions (injectable `GitHubTransport` interface!).
- **Acceptance Criteria:** Re-running plan on identical remote issues produces 100% `noop`; human maintainer notes survive every update; manual close without proof flags `needs-triage`.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/adapters/github.adapter.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-4-universal-projection-adapters.md -m "feat(plan-taskos): T27 add split-authority github issues adapter with adaptive folding and intake"
  ```

---

## - [x] T28 — Implement ORM HTTP, `/swarm` Exporter & OTel/Notification Event Adapters

- **Owner File(s):** `packages/plan-taskos/src/adapters/orm-http.adapter.ts`, `packages/plan-taskos/src/adapters/swarm.adapter.ts`, `packages/plan-taskos/src/adapters/telemetry.adapter.ts`
  - `packages/plan-taskos/src/adapters/orm-http.adapter.ts` (CREATE)
  - `packages/plan-taskos/src/adapters/swarm.adapter.ts` (CREATE)
  - `packages/plan-taskos/src/adapters/telemetry.adapter.ts` (CREATE)
- **Depends On:** `T09`, `T10`, `T19`
- **Exact Spec:** `orm-http.adapter.ts`: pure HTTP payload builder + optional `fetch` client speaking to `POST /api/projects/:id/plan-sync` & `POST /api/projects/tasks/:id/work-contract`:
  - `orm-http.adapter.ts`: pure HTTP payload builder + optional `fetch` client speaking to `POST /api/projects/:id/plan-sync` & `POST /api/projects/tasks/:id/work-contract`:
    - Maps `Plan -> project`, `Wave -> milestone`, `Micro-Task -> task (parent_code, milestone_code, external_ref = urn, normalized code)`, `depends_on -> dependency`, `acceptance_criteria[] -> 1:1 ai.acceptance_criterion[]`, `owner_files + verify + spec_ref -> scope_json`.
  - `swarm.adapter.ts`: exports `exportSwarmWaveManifest(store, bundle, { waveId?, maxParallel = 4 })`:
    - Uses `selectDisjointFrontier` + `compileCognitiveMicroBrief` + hybrid model routing (`INV-008`: `flash -> gemini-3.8-flash-low`, `neon -> gemini-4-neon-low`, `argon -> gemini-4-argon-low`) to generate ready-to-dispatch disjoint `/swarm` worker briefs!
  - `telemetry.adapter.ts`: defines zero-dependency `PlanTelemetrySink` & `OperatorAlertSink` interfaces emitting typed lifecycle events (`task.claimed`, `task.verified`, `task.proof_sealed`, `task.retry_escalated`, `task.blocked`, `wave.completed`, `sleep.invariant_proposed`) consumable by `apps/agent-observability` (OTel) and `apps/whatsapp` / `orm-notification`.
- **DO NOT:** Import `@moonwitness/orm*` or `@opentelemetry/*` directly inside `packages/plan-taskos`!
- **Acceptance Criteria:** Zero ORM/OTel runtime dependencies in `packages/plan-taskos/package.json`; all 3 adapters compile cleanly.
- **Expected Output:** Typecheck exits `0`.
- **Verify:** `bun --filter @moonwitness/plan-taskos typecheck`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/adapters/orm-http.adapter.ts packages/plan-taskos/src/adapters/swarm.adapter.ts packages/plan-taskos/src/adapters/telemetry.adapter.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-4-universal-projection-adapters.md -m "feat(plan-taskos): T28 add orm-http, swarm model-tier exporter, and telemetry event adapters"
  ```

---

## - [x] T29 — Wire Public SDK Barrel (`src/index.ts`) & Verify Zero-Coupling Boundary

- **Owner File(s):** `packages/plan-taskos/src/index.ts`
  - `packages/plan-taskos/src/index.ts` (CREATE)
- **Depends On:** `T24`, `T25`, `T26`, `T27`, `T28`
- **Exact Spec:** Export clean public API surface from `src/index.ts`: core (`urn`, `paths`, `redaction`, `types`, `loader`, `validator`, `disjoint-prover`, `dag`, `authority`), brain (`storage`, `schema`, `reindex`, `knowledge-graph`, `hybrid-recall`, `episodic-memory`, `merkle-dag`), runner (`brief-compiler`, `lease-manager`, `scope-gate`, `proof-runner`), and adapters (`plan-md`, `taskos-v2`, `docs`, `github`, `orm-http`, `swarm`, `telemetry`).
  - Export clean public API surface from `src/index.ts`: core (`urn`, `paths`, `redaction`, `types`, `loader`, `validator`, `disjoint-prover`, `dag`, `authority`), brain (`storage`, `schema`, `reindex`, `knowledge-graph`, `hybrid-recall`, `episodic-memory`, `merkle-dag`), runner (`brief-compiler`, `lease-manager`, `scope-gate`, `proof-runner`), and adapters (`plan-md`, `taskos-v2`, `docs`, `github`, `orm-http`, `swarm`, `telemetry`).
- **Acceptance Criteria:** `bun --filter @moonwitness/plan-taskos build` compiles `dist/` cleanly with `.d.ts` declarations and zero forbidden imports (`@moonwitness/orm`, `@moonwitness/ui`, `fastify`, `react`, `better-sqlite3`, `tauri`).
- **Expected Output:** Build exits `0` and boundary check prints `T29 OK`.
- **Verify:** `bun --filter @moonwitness/plan-taskos build; if ($?) { node -e "const fs=require('fs'),p=require('path'); function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name); if(e.isDirectory()) walk(f); else if(f.endsWith('.ts')){const s=fs.readFileSync(f,'utf8'); if(/@moonwitness\/orm|@moonwitness\/ui|better-sqlite3|fastify|tauri/.test(s)) {console.error('FORBIDDEN IMPORT:',f); process.exit(1);}}}} walk('packages/plan-taskos/src'); console.log('T29 OK')" }`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/src/index.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-4-universal-projection-adapters.md -m "feat(plan-taskos): T29 wire public sdk barrel exports and enforce zero-coupling boundary"
  ```

---

## - [x] T30 — Add Wave 4 Adapter Unit Tests & Pass Wave 4 Gate

- **Owner File(s):** `packages/plan-taskos/tests/adapters-plan-taskos.test.ts`, `packages/plan-taskos/tests/adapters-docs-github.test.ts`, `packages/plan-taskos/tests/adapters-orm-swarm.test.ts`
  - `packages/plan-taskos/tests/adapters-plan-taskos.test.ts` (CREATE)
  - `packages/plan-taskos/tests/adapters-docs-github.test.ts` (CREATE)
  - `packages/plan-taskos/tests/adapters-orm-swarm.test.ts` (CREATE)
- **Depends On:** `T29`
- **Exact Spec:** `adapters-plan-taskos.test.ts`: tests deterministic `.plan/<id>.md` projection + round-trip parse + TaskOS v2 roll-up AJV schema compliance & reciprocal `dependsOn`/`blocks`.
  - `adapters-plan-taskos.test.ts`: tests deterministic `.plan/<id>.md` projection + round-trip parse + TaskOS v2 roll-up AJV schema compliance & reciprocal `dependsOn`/`blocks`.
  - `adapters-docs-github.test.ts`: tests `INV-006` doc-impact detection, GitHub `wave`/`task`/`plan` folding, managed-block preservation of `## Catatan maintainer`, hash no-op idempotency, bounded batch `<=5`, manual close `needs-triage`, and inbound issue intake.
  - `adapters-orm-swarm.test.ts`: tests ORM `plan-sync` payload generation (dotted code normalization + URN `external_ref` + 1:1 `acceptance_criteria`), `/swarm` disjoint frontier model-tier routing, and telemetry sink emission.
- **Acceptance Criteria:** All Wave 1–4 Vitest suites pass with exit `0`.
- **Expected Output:** Build and all tests pass.
- **Verify:** `bun --filter @moonwitness/plan-taskos build; if ($?) { bun --filter @moonwitness/plan-taskos test }`
- **Commit:**
  ```powershell
  git commit --only packages/plan-taskos/tests/adapters-plan-taskos.test.ts packages/plan-taskos/tests/adapters-docs-github.test.ts packages/plan-taskos/tests/adapters-orm-swarm.test.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-4-universal-projection-adapters.md -m "test(plan-taskos): T30 add wave 4 unit tests for all multi-plane projection adapters"
  ```
