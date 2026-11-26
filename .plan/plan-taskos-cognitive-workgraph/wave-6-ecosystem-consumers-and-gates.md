# Wave 6 — Ecosystem Consumers Wiring & Full Repo Gates (`T37`–`T44`)

**ADR Reference:** `.plan/plan-taskos-cognitive-workgraph/ADR-003-plan-taskos-cognitive-workgraph.md` (Decisions 6, 7)
**Depends On:** `T36` (`T37`–`T42` have strictly disjoint file ownership and can run in parallel `/swarm`!)
**Hard Rule:** Preserve `INV-004` (thin API addon boundary), `INV-006` (docs/architecture sync), `INV-009` (desktop zero-overlap), and `INV-014` (`manifest.httpPlugins` only).

---

## - [x] T37 — Wire `packages/orm-project` Plan-TaskOS Sync & 1:1 `ai.acceptance_criterion` Hydration

- **Owner File(s):** `packages/orm-project/package.json`, `packages/orm-project/src/plan-sync.ts`, `packages/orm-project/src/http-plugin.ts`, `packages/orm-project/tests/plan-sync.test.ts`
  - `packages/orm-project/package.json` (MODIFY — add `"@moonwitness/plan-taskos": "workspace:*"`)
  - `packages/orm-project/src/plan-sync.ts` (CREATE)
  - `packages/orm-project/src/http-plugin.ts` (MODIFY — mount `POST /projects/:id/plan-sync` + hydrate 1:1 `ai.acceptance_criterion` rows in `/projects/tasks/:id/work-contract`)
  - `packages/orm-project/tests/plan-sync.test.ts` (CREATE)
- **Depends On:** `T36`
- **Exact Spec:** `plan-sync.ts`: maps incoming `PlanSyncPayload` (`waves[]`, `tasks[]`, `dependencies[]`) using `normalizeOrmTaskCode` for `project.task.code` and exact canonical URN for `project.task.external_ref`:
  - `plan-sync.ts`: maps incoming `PlanSyncPayload` (`waves[]`, `tasks[]`, `dependencies[]`) using `normalizeOrmTaskCode` for `project.task.code` and exact canonical URN for `project.task.external_ref`:
    - Upserts `project.milestone` per Wave (`open` / `reached`).
    - Upserts `project.task` with `milestone_id`, `parent_id` (parent-first topological insert!), `priority`, `status`, `estimate_minutes`, `blocked_reason`, `external_ref = urn` — preserving human-owned Kanban `stage_id`, `assignee_id`, `reviewer_id` per Split-Authority!
    - Upserts acyclic `project.task_dependency` edges (`kind: 'blocks'`).
  - In `http-plugin.ts`:
    - Mount `POST ${prefix}/projects/:id/plan-sync` guarded by `requireCompanyContext` + `canAccess(..., 'create' & 'write')`.
    - Enhance `POST ${prefix}/projects/tasks/:id/work-contract` to accept optional `acceptance_criteria[]` & `owner_files[]` (or read them from `body`) and insert 1 `ai.acceptance_criterion` row per binary AC (falling back to single `task_completion` when omitted so existing tests remain 100% green!).
- **DO NOT:** Add any custom route files inside `apps/api/src/routes/` (`INV-014`).
- **Acceptance Criteria:** `packages/orm-project` tests (existing + new `plan-sync.test.ts`) pass 100%; `bun run api:addon:check` passes.
- **Expected Output:** Build, test, and addon boundary check exit `0`.
- **Verify:** `bun --filter @moonwitness/orm-project build; if ($?) { bun --filter @moonwitness/orm-project test }; if ($?) { bun run api:addon:check }`
- **Commit:**
  ```powershell
  git commit --only packages/orm-project/package.json packages/orm-project/src/plan-sync.ts packages/orm-project/src/http-plugin.ts packages/orm-project/tests/plan-sync.test.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-6-ecosystem-consumers-and-gates.md -m "feat(orm-project): T37 add /projects/:id/plan-sync and 1:1 ai.acceptance_criterion hydration"
  ```

---

## - [x] T38 — Upgrade `apps/desktop` Observatory `plan-collector.ts` to Consume `@moonwitness/plan-taskos`

- **Owner File(s):** `apps/desktop/package.json`, `apps/desktop/src/observatory/plan-collector.ts`, `apps/desktop/src/observatory/types.ts`
  - `apps/desktop/package.json` (MODIFY — add `"@moonwitness/plan-taskos": "workspace:*"`)
  - `apps/desktop/src/observatory/plan-collector.ts` (MODIFY)
  - `apps/desktop/src/observatory/types.ts` (MODIFY — add optional `format`, `merkleRoot`, `proofSha256`, `attempts`, `leaseOwner`, `modelTier` fields)
- **Depends On:** `T36`
- **Exact Spec:** Wire `collectPlans()` to call `discoverPlans(repoRoot)` from `@moonwitness/plan-taskos` (supporting BOTH v2 Plan-TaskOS bundles AND legacy `.plan/*.md` files with zero breaking changes to existing `ObservatoryPlanSummary` consumers!).
  - Wire `collectPlans()` to call `discoverPlans(repoRoot)` from `@moonwitness/plan-taskos` (supporting BOTH v2 Plan-TaskOS bundles AND legacy `.plan/*.md` files with zero breaking changes to existing `ObservatoryPlanSummary` consumers!).
  - Enrich each task with optional `proofSha256`, `attempts`, `leaseOwner`, `modelTier`, and plan-level `format` + `merkleRoot` when `.plan/.brain/taskos.sqlite` or `evidence/*.proof.json` is present.
- **DO NOT:** Define any ORM model/addon in `apps/desktop` (`INV-009`).
- **Acceptance Criteria:** `apps/desktop` builds & passes `observatory.test.ts` + `check-desktop-non-overlap.mjs`.
- **Expected Output:** Typecheck, build, test, and non-overlap check exit `0`.
- **Verify:** `bun --filter @moonwitness/desktop typecheck; if ($?) { bun --filter @moonwitness/desktop build }; if ($?) { bun --filter @moonwitness/desktop test tests/observatory.test.ts }; if ($?) { node scripts/check-desktop-non-overlap.mjs }`
- **Commit:**
  ```powershell
  git commit --only apps/desktop/package.json apps/desktop/src/observatory/plan-collector.ts apps/desktop/src/observatory/types.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-6-ecosystem-consumers-and-gates.md -m "feat(desktop): T38 delegate observatory plan collection to @moonwitness/plan-taskos"
  ```

---

## - [x] T39 — Mount Read-Only Cognitive Brain Routes on `apps/desktop/src/local-api-server.ts`

- **Owner File(s):** `apps/desktop/src/local-api-server.ts`, `apps/desktop/tests/local-api-server.test.ts`
  - `apps/desktop/src/local-api-server.ts` (MODIFY)
  - `apps/desktop/tests/local-api-server.test.ts` (MODIFY — add Brain endpoint auth & query tests)
- **Depends On:** `T38`
- **Exact Spec:** Mount 3 authenticated read-only endpoints (active in both `workspace` and `developer` modes, returning `401` when `!req.auth`):
  - Mount 3 authenticated read-only endpoints (active in both `workspace` and `developer` modes, returning `401` when `!req.auth`):
    - `GET /api/desktop/observatory/brain/search?q=<query>&limit=15` -> calls `hybridRecall` on local `.plan/.brain/taskos.sqlite` (lazy-opened & cleanly closed in `stop()`!).
    - `GET /api/desktop/observatory/brain/impact?target=<path-or-urn>` -> calls `queryBlastRadiusImpact`.
    - `GET /api/desktop/observatory/brain/graph?planId=<id>` -> calls `exportSubgraph` returning `{ nodes, edges }` for Knowledge Graph visualization.
  - Ensure `stop()` closes the Brain SQLite handle cleanly (zero open handles in Vitest!).
- **DO NOT:** Expose unauthenticated routes or open Brain DB eagerly if `repoRoot` has no `.plan/` directory.
- **Acceptance Criteria:** `401` without auth; `200` with valid Bearer token; `local-api-server.test.ts` exits cleanly with zero hanging handles.
- **Expected Output:** Build and `local-api-server.test.ts` exit `0`.
- **Verify:** `bun --filter @moonwitness/desktop typecheck; if ($?) { bun --filter @moonwitness/desktop build }; if ($?) { bun --filter @moonwitness/desktop test tests/local-api-server.test.ts }`
- **Commit:**
  ```powershell
  git commit --only apps/desktop/src/local-api-server.ts apps/desktop/tests/local-api-server.test.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-6-ecosystem-consumers-and-gates.md -m "feat(desktop): T39 mount authenticated cognitive brain search, impact, and graph routes"
  ```

---

## - [x] T40 — Wire Standalone `tools/agent-observatory/server.mjs` to `@moonwitness/plan-taskos` Brain DB

- **Owner File(s):** `tools/agent-observatory/server.mjs`, `tools/agent-observatory/server.test.mjs`
  - `tools/agent-observatory/server.mjs` (MODIFY)
  - `tools/agent-observatory/server.test.mjs` (MODIFY — add Brain API tests)
- **Depends On:** `T36`
- **Exact Spec:** Import `@moonwitness/plan-taskos` (via `../../packages/plan-taskos/dist/index.js` with graceful fallback to existing inline parser if `dist/` not built yet!).
  - Import `@moonwitness/plan-taskos` (via `../../packages/plan-taskos/dist/index.js` with graceful fallback to existing inline parser if `dist/` not built yet!).
  - Upgrade `.plan/` discovery in `server.mjs` to surface v2 Plan-TaskOS bundles (`proofSha256`, `merkleRoot`, `attempts`, `leases`, `episodic_memory` count) alongside legacy `.plan/*.md`.
  - Expose read-only loopback routes on Observatory HTTP server (`SECURITY_HEADERS` applied):
    - `GET /api/brain/search?q=...`
    - `GET /api/brain/impact?target=...`
    - `GET /api/brain/graph?planId=...`
- **DO NOT:** Relax `SECURITY_HEADERS` CSP or write to Git from Observatory HTTP routes.
- **Acceptance Criteria:** `node --test tools/agent-observatory/server.test.mjs` passes 100%.
- **Expected Output:** All Observatory tests PASS (`fail 0`).
- **Verify:** `node --test tools/agent-observatory/server.test.mjs`
- **Commit:**
  ```powershell
  git commit --only tools/agent-observatory/server.mjs tools/agent-observatory/server.test.mjs .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-6-ecosystem-consumers-and-gates.md -m "feat(observatory): T40 wire tools/agent-observatory to plan-taskos cognitive brain db"
  ```

---

## - [ ] T41 — Add Read-Only Plan-TaskOS Brain Tools to `packages/mcp-moonwitness`

- **Owner File(s):** `packages/mcp-moonwitness/package.json`, `packages/mcp-moonwitness/src/plan-brain.ts`, `packages/mcp-moonwitness/src/server.ts`, `packages/mcp-moonwitness/tests/plan-brain.test.ts`
  - `packages/mcp-moonwitness/package.json` (MODIFY — add `"@moonwitness/plan-taskos": "workspace:*"`)
  - `packages/mcp-moonwitness/src/plan-brain.ts` (CREATE)
  - `packages/mcp-moonwitness/src/server.ts` (MODIFY — register read-only `plan_status`, `plan_recall`, `plan_impact` tools)
  - `packages/mcp-moonwitness/tests/plan-brain.test.ts` (CREATE)
- **Depends On:** `T36`
- **Exact Spec:** Keep `packages/mcp-moonwitness` strictly **read-only** (respecting package description & contract!).
  - Keep `packages/mcp-moonwitness` strictly **read-only** (respecting package description & contract!).
  - Expose 3 new tools:
    - `plan_status` (returns all discovered plans, wave progress, Boss Critical Path, Merkle root, active leases)
    - `plan_recall` (FTS5 BM25 offline search across plans, ADRs, specs, and episodic memory)
    - `plan_impact` (2-hop blast radius for a given file path or task URN)
- **DO NOT:** Expose write/mutation tools inside read-only `packages/mcp-moonwitness` (mutations belong in `plan-taskos mcp --allow-write`).
- **Acceptance Criteria:** `packages/mcp-moonwitness` build & Vitest suites pass 100%.
- **Expected Output:** Build and test exit `0`.
- **Verify:** `bun --filter @moonwitness/mcp-moonwitness build; if ($?) { bun --filter @moonwitness/mcp-moonwitness test }`
- **Commit:**
  ```powershell
  git commit --only packages/mcp-moonwitness/package.json packages/mcp-moonwitness/src/plan-brain.ts packages/mcp-moonwitness/src/server.ts packages/mcp-moonwitness/tests/plan-brain.test.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-6-ecosystem-consumers-and-gates.md -m "feat(mcp-moonwitness): T41 add read-only plan_status, plan_recall, and plan_impact brain tools"
  ```

---

## - [ ] T42 — Add OpenTelemetry Plan-TaskOS Lifecycle Spans & Metrics in `apps/agent-observability`

- **Owner File(s):** `apps/agent-observability/package.json`, `apps/agent-observability/src/plan-telemetry.ts`, `apps/agent-observability/src/index.ts`, `apps/agent-observability/tests/plan-telemetry.test.ts`
  - `apps/agent-observability/package.json` (MODIFY — add `"@moonwitness/plan-taskos": "workspace:*"`)
  - `apps/agent-observability/src/plan-telemetry.ts` (CREATE)
  - `apps/agent-observability/src/index.ts` (MODIFY — export `createOtelPlanTelemetrySink`)
  - `apps/agent-observability/tests/plan-telemetry.test.ts` (CREATE)
- **Depends On:** `T36`
- **Exact Spec:** Implement `createOtelPlanTelemetrySink(options?)` satisfying `@moonwitness/plan-taskos` `PlanTelemetrySink` interface:
  - Implement `createOtelPlanTelemetrySink(options?)` satisfying `@moonwitness/plan-taskos` `PlanTelemetrySink` interface:
    - Emits OTel spans (`plan.task.claimed`, `plan.task.verified`, `plan.task.proof_sealed`, `plan.task.retry_escalated`, `plan.task.blocked`, `plan.wave.completed`) with attributes `plan.id`, `plan.task.urn`, `plan.task.code`, `plan.model_tier`, `plan.attempts`, `plan.proof.sha256` (NEVER raw secrets or unredacted output!).
    - Records counters/histograms (`plan_task_duration_ms`, `plan_task_completions_total`, `plan_task_retries_total`).
- **Acceptance Criteria:** `apps/agent-observability` typecheck, build, and tests pass 100%.
- **Expected Output:** Build and test exit `0`.
- **Verify:** `bun --filter @moonwitness/agent-observability build; if ($?) { bun --filter @moonwitness/agent-observability test }`
- **Commit:**
  ```powershell
  git commit --only apps/agent-observability/package.json apps/agent-observability/src/plan-telemetry.ts apps/agent-observability/src/index.ts apps/agent-observability/tests/plan-telemetry.test.ts .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-6-ecosystem-consumers-and-gates.md -m "feat(agent-observability): T42 add otel span and metric sink for plan-taskos lifecycle"
  ```

---

## - [ ] T43 — Add TaskOS v2 & GitHub Sync Parity Verification Test (`scripts/tasks/plan-taskos-parity.test.mjs`)

- **Owner File(s):** `scripts/tasks/plan-taskos-parity.test.mjs`
  - `scripts/tasks/plan-taskos-parity.test.mjs` (CREATE)
- **Depends On:** `T36`
- **Exact Spec:** Write a `node:test` parity gate confirming:
  - Write a `node:test` parity gate confirming:
    1. TaskOS v2 records projected by `@moonwitness/plan-taskos` (`projectBundleToTaskosV2`) pass `validateTaskRegistryData` from `scripts/tasks/validate-tasks.mjs` with `valid === true`!
    2. GitHub managed-block output from `@moonwitness/plan-taskos` preserves `<!-- BEGIN MOONWITNESS MANAGED -->` / `<!-- END MOONWITNESS MANAGED -->` markers and `## Catatan maintainer` parity with `scripts/roadmap/sync-issues.mjs`.
- **Acceptance Criteria:** `node --test scripts/tasks/plan-taskos-parity.test.mjs` passes with `fail 0`.
- **Expected Output:** `fail 0` and exit `0`.
- **Verify:** `node --test scripts/tasks/plan-taskos-parity.test.mjs`
- **Commit:**
  ```powershell
  git commit --only scripts/tasks/plan-taskos-parity.test.mjs .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-6-ecosystem-consumers-and-gates.md -m "test(tasks): T43 verify plan-taskos parity with taskos v2 validator and github issue sync"
  ```

---

## - [ ] T44 — Full Workspace Generator Sync, Boundary Gates & Ledger Closeout

- **Owner File(s):** `docs:generate`, `bun.lock`, `.plan/plan-taskos-cognitive-workgraph.md`
  - Generated docs/diagrams from `docs:generate` & `architecture:generate` (MODIFY if changed)
  - `bun.lock` (MODIFY if changed by Wave 6 workspace deps)
  - `.plan/plan-taskos-cognitive-workgraph.md` (MODIFY — mark `44 / 44` complete in Progress Ledger)
- **Depends On:** `T37`, `T38`, `T39`, `T40`, `T41`, `T42`, `T43`
- **Exact Spec:** Sync `bun.lock` if Wave 6 consumer `package.json` additions changed lockfile (`bun install --frozen-lockfile --dry-run` MUST exit `0`).
  - Sync `bun.lock` if Wave 6 consumer `package.json` additions changed lockfile (`bun install --frozen-lockfile --dry-run` MUST exit `0`).
  - Run single-pass generators (`INV-006`, `INV-010`): `bun run docs:generate` and `bun run architecture:generate`.
  - Run full verification matrix:
    1. `bun --filter @moonwitness/plan-taskos test`
    2. `bun --filter @moonwitness/orm-project test`
    3. `bun run desktop:test`
    4. `node --test tools/agent-observatory/server.test.mjs`
    5. `bun --filter @moonwitness/mcp-moonwitness test`
    6. `bun --filter @moonwitness/agent-observability test`
    7. `node --test scripts/tasks/plan-taskos-parity.test.mjs scripts/docker-workspace-manifests.test.mjs`
    8. `bun run test:taskos`
    9. `bun run ui:check`
    10. `bun run api:addon:check`
    11. `bun run docs:links`
    12. `bun run plan:reindex` & `bun run plan:lint`
- **Acceptance Criteria:** Every single one of the 12 gates exits `0`, zero lockfile drift, zero broken doc links, Progress Ledger closed `44 / 44`.
- **Expected Output:** All 12 gates pass with exit `0`.
- **Verify:** `bun run docs:generate; if ($?) { bun run architecture:generate }; if ($?) { bun run docs:links }; if ($?) { node --test scripts/docker-workspace-manifests.test.mjs scripts/tasks/plan-taskos-parity.test.mjs }; if ($?) { bun run ui:check }; if ($?) { bun run api:addon:check }; if ($?) { bun run plan:reindex }; if ($?) { bun run plan:lint }`
- **Commit:**
  ```powershell
  git commit --only bun.lock docs .plan/plan-taskos-cognitive-workgraph.md .plan/plan-taskos-cognitive-workgraph/wave-6-ecosystem-consumers-and-gates.md -m "chore(plan-taskos): T44 sync docs/architecture and close 44-task cognitive workgraph plan"
  ```
