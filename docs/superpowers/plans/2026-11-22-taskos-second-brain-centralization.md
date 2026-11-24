# TaskOS & Second Brain Centralization Implementation Plan

> **Historical planning artifact — not a current status report or active backlog.** The original 1,346-task estimate was not verified. On 2026-11-23, `docs/tasks/tasks.json` was confirmed zero-byte; the verified source inventory contains 627 candidate IDs, not a restored registry. No task records may be inferred from this plan or its original checklist. Current status and approval gates are maintained in `docs/tasks/README.md`, `docs/tasks/RECOVERY-INVENTORY.md`, and `docs/roadmap/STABILIZATION-PLAN.md`. Do not resume execution from this historical plan until TaskOS recovery is validated.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize all project work items, documentation backlog, and governance into a unified Smart TaskOS + Second Brain (`raw/`, `brain/`, `wiki/`), Release Manager, Changelog Engine, and Blueprint Registry powered by `apps/todo` (`moonwitness-dx`: Rust 2024 + SQLite + React 19 + MCP) with a canonical lossless JSON v2 contract (`docs/tasks/tasks.json`).

**Architecture:** A canonical `docs/tasks/tasks.schema.json` defines the `moonwitness-tasks/v2` data contract. A deterministic Node.js sweep script absorbs all 8 fragmented TODO/roadmap sources into a single master `docs/tasks/tasks.json` while maintaining 100% zero-drift compatibility with `ROADMAP.md` and `docs/roadmap/tasks.json`. The `apps/todo` Rust binary is upgraded with additive SQLite schema migrations, FTS5 global search, lossless import/export CLI commands, enhanced MCP tools, and a React 19 Kanban + Second Brain workspace.

**Tech Stack:** Rust 2024 (edition 2024, rusqlite 0.42 with FTS5, axum 0.8, rmcp 3.10), TypeScript/Node.js 22, React 19, Tailwind CSS, Vite, JSON Schema Draft-07.

**Spec:** Brainstorming session 2026-11-22 ("Universal ProjectOS: TaskOS + Second Brain + Release Manager + Blueprint Registry").

## Global Constraints

- Zero drift with `ROADMAP.md` and `docs/roadmap/tasks.json` (`pnpm automation:check:roadmap` and 14 roadmap test suites must pass 100%).
- Additive SQLite migrations only in `apps/todo/src/store.rs`; never break compatibility with existing SQLite boards.
- No destructive deletions of existing TODO files without archiving to `docs/archive/todos/`.
- Strict typing (TypeScript strict, no explicit `any`, clean Rust compilation with zero warnings).

---

### Task 1: Canonical JSON Schema Specification (`docs/tasks/tasks.schema.json`)

**Files:**
- Create: `docs/tasks/tasks.schema.json`
- Test: `scripts/tasks/validate-tasks.test.mjs`

**Interfaces:**
- Produces: JSON Schema Draft-07 validator for `moonwitness-tasks/v2` defining projects, tasks, acceptance criteria, scope, evidence, and documents.

- [ ] **Step 1: Write the failing test for schema validation**

Create `scripts/tasks/validate-tasks.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

test('tasks.schema.json is a valid Draft-07 JSON Schema and accepts valid v2 tasks payload', async () => {
  const schemaRaw = await fs.readFile('docs/tasks/tasks.schema.json', 'utf8');
  const schema = JSON.parse(schemaRaw);
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const sample = {
    schemaVersion: '2.0.0',
    format: 'moonwitness-tasks/v2',
    generatedAt: new Date().toISOString(),
    projects: [
      {
        slug: 'moonwitness',
        name: 'MoonWitness Platform',
        repos: ['A-L-L-A-H/mw-xv'],
        color: 'blue',
        statuses: ['backlog', 'todo', 'doing', 'review', 'blocked', 'done']
      }
    ],
    tasks: [
      {
        code: 'AUD-002',
        project: 'moonwitness',
        series: 'AUD',
        milestone: 'AUDIT-NOW',
        horizon: 'now',
        title: 'Integrate AI and Desktop packages to CI gate',
        summary: 'Short summary for card view',
        problem: '5 AI packages omitted from test runners',
        proposedSolution: 'Add packages to test:unit:built and ci.yml',
        category: 'dx',
        type: 'infrastructure',
        priority: 'p0',
        status: 'todo',
        human: false,
        owner: 'dev-team',
        assignee: null,
        risk: 'low',
        effort: 'm',
        scores: { impact: 5, confidence: 5, strategicValue: 5, effort: 3, priorityScore: 41.7 },
        dependsOn: [],
        blocks: ['AUD-005'],
        tags: ['ci', 'ai', 'conformance'],
        scope: {
          packages: ['@moonwitness/orm-ai'],
          files: ['package.json']
        },
        acceptanceCriteria: [
          { id: 'ac-1', text: 'All packages run in test:unit:built', done: false }
        ],
        validation: {
          commands: ['pnpm verify'],
          expected: 'Pass 100%'
        },
        evidence: {
          paths: [],
          detailFile: null,
          commitSha: null
        },
        references: [],
        blockedReason: null,
        sourceRef: { file: 'audit', legacyId: null },
        url: '',
        comments: []
      }
    ]
  };

  const valid = validate(sample);
  assert.equal(valid, true, JSON.stringify(validate.errors, null, 2));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tasks/validate-tasks.test.mjs`
Expected: FAIL with "no such file or directory, open 'docs/tasks/tasks.schema.json'"

- [ ] **Step 3: Create `docs/tasks/tasks.schema.json`**

Write standard Draft-07 schema covering all 6 dimensions of Smart TaskOS and Second Brain documents.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tasks/validate-tasks.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/tasks/tasks.schema.json scripts/tasks/validate-tasks.test.mjs
git commit -m "feat(tasks): define canonical moonwitness-tasks/v2 JSON Schema"
```

---

### Task 2: Sweep & Consolidation Engine (`scripts/tasks/sweep-and-consolidate.mjs`)

**Files:**
- Create: `scripts/tasks/sweep-and-consolidate.mjs`
- Test: `scripts/tasks/sweep-and-consolidate.test.mjs`
- Target Output: `docs/tasks/tasks.json`

**Interfaces:**
- Consumes: `docs/roadmap/tasks.json`, `ROADMAP.md`, `docs/tasks/sources/todo-wa.md`, `docs/tasks/sources/todo.md`, `docs/tasks/sources/todo-desktop.md`, `docs/bundles/ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md`, `evolution/backlog.json`, Audit tasks (`AUD-001`..`AUD-014`).
- Produces: Consolidated, deduplicated, schema-valid `docs/tasks/tasks.json`.

- [ ] **Step 1: Write test for sweep and consolidation logic**

Create `scripts/tasks/sweep-and-consolidate.test.mjs`:
Verifies that:
1. All 227 roadmap tasks (`M0.01`–`M12.14`, `K0-001`–`K9-007`) are imported with preserved status, dependencies, and evidence.
2. WhatsApp checklist items (`P0-*`–`P3-*`) are ingested with `series: "WA"`, preserving checked/unchecked state.
3. Root `docs/tasks/sources/todo.md` open item `MW-CFG-003.3` is ingested as `series: "MW"`.
4. `docs/tasks/sources/todo-desktop.md` item `DSK-0.12` is ingested as `series: "DSK"`.
5. `todo-ai-corporation.md` item `PR.14` is ingested as `series: "AI"`.
6. Evolution backlog items (`EVO-001`–`EVO-004`) are ingested as `series: "EVO"`.
7. Audit backlog items (`AUD-001`–`AUD-014`) are ingested as `series: "AUD"`.
8. The output strictly validates against `docs/tasks/tasks.schema.json`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tasks/sweep-and-consolidate.test.mjs`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `scripts/tasks/sweep-and-consolidate.mjs`**

Implement deterministic parser that loads all source files, maps statuses (`complete` -> `done`, `in_progress` -> `doing`, `blocked` -> `blocked`, open -> `todo`), populates standard fields, assigns priorities, builds DAG blocks/dependsOn, and outputs canonical `docs/tasks/tasks.json`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tasks/sweep-and-consolidate.test.mjs`
Expected: PASS

- [ ] **Step 5: Generate canonical `docs/tasks/tasks.json`**

Run: `node scripts/tasks/sweep-and-consolidate.mjs`
Expected: Generates `docs/tasks/tasks.json` containing ~335 total tasks (227 M&K + 76 WA + 14 AUD + EVO + DSK + MW) with 0 validation errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/tasks/sweep-and-consolidate.mjs scripts/tasks/sweep-and-consolidate.test.mjs docs/tasks/tasks.json
git commit -m "feat(tasks): sweep and consolidate all workspace task sources into tasks.json v2"
```

---

### Task 3: Zero-Drift Roadmap Synchronizer & Validator (`scripts/tasks/validate-tasks.mjs` & `sync-roadmap.mjs`)

**Files:**
- Create: `scripts/tasks/validate-tasks.mjs`
- Create: `scripts/tasks/sync-roadmap.mjs`
- Modify: `package.json:620-630` (add root npm scripts `tasks:validate` and `tasks:sync`)
- Test: `scripts/tasks/roadmap-parity.test.mjs`

**Interfaces:**
- Consumes: `docs/tasks/tasks.json`
- Produces: Verifies schema validity, DAG cycle freedom, and exact 1:1 status parity with `ROADMAP.md` and `docs/roadmap/tasks.json`.

- [ ] **Step 1: Write test for roadmap parity**

Create `scripts/tasks/roadmap-parity.test.mjs`:
Verifies that every task with prefix `M` or `K` in `docs/tasks/tasks.json` matches the status, title, milestone, and evidence in `docs/roadmap/tasks.json` and `ROADMAP.md` checkboxes.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tasks/roadmap-parity.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `validate-tasks.mjs` and `sync-roadmap.mjs`**

Implement `validate-tasks.mjs` (runs in CI) and `sync-roadmap.mjs` (bidirectional sync). Add `"tasks:validate": "node scripts/tasks/validate-tasks.mjs"` and `"tasks:sync": "node scripts/tasks/sync-roadmap.mjs"` to root `package.json`.

- [ ] **Step 4: Run tests and validation**

Run: `pnpm tasks:validate && pnpm automation:check:roadmap`
Expected: PASS with 0 problems.

- [ ] **Step 5: Commit**

```bash
git add scripts/tasks/validate-tasks.mjs scripts/tasks/sync-roadmap.mjs scripts/tasks/roadmap-parity.test.mjs package.json
git commit -m "feat(tasks): add zero-drift validation and roadmap synchronization tools"
```

---

### Task 4: Second Brain Directory Hierarchy & Archive Consolidation

**Files:**
- Create: `docs/second-brain/raw/README.md`
- Create: `docs/second-brain/brain/README.md`
- Create: `docs/second-brain/wiki/README.md`
- Create: `docs/meta/blueprints-registry.md`
- Create: `docs/meta/specs-registry.md`
- Create: `docs/tasks/README.md`
- Move & Archive:
  - `docs/tasks/sources/todo-foundation.md` -> `docs/archive/todos/todo-foundation.md`
  - `docs/tasks/sources/todo-ui.md` -> `docs/archive/todos/todo-ui.md`
  - `docs/tasks/sources/todo-wa.md` -> `docs/archive/todos/todo-wa.md`
  - `docs/tasks/sources/todo-desktop.md` -> `docs/archive/todos/todo-desktop.md`
  - `docs/tasks/sources/todo.md` -> `docs/archive/todos/todo.md`
- Replace root `docs/tasks/sources/todo.md` with authoritative pointer to `docs/tasks/tasks.json` and `apps/todo`.

- [ ] **Step 1: Create README guides in `docs/` subdirectories**

Define exact purpose, lifecycles, and frontmatter templates for `raw/`, `brain/`, `wiki/`, `blueprints/`, `specs/`, and `tasks/`.

- [ ] **Step 2: Archive finished and legacy todo files**

Move `docs/tasks/sources/todo-foundation.md`, `docs/tasks/sources/todo-ui.md`, `docs/tasks/sources/todo-wa.md`, `docs/tasks/sources/todo-desktop.md`, and old `docs/tasks/sources/todo.md` to `docs/archive/todos/`.
Create a clean, canonical root `docs/tasks/sources/todo.md` that directs developers and agents to `docs/tasks/tasks.json` and `apps/todo`, preserving any scripts referencing root `docs/tasks/sources/todo.md`.

- [ ] **Step 3: Verify workspace scripts & documentation links**

Run: `pnpm docs:links && pnpm automation:check:roadmap`
Expected: PASS without broken internal links.

- [ ] **Step 4: Commit**

```bash
git add docs/raw docs/brain docs/wiki docs/blueprints docs/specs docs/tasks docs/archive docs/tasks/sources/todo.md
git commit -m "docs(governance): establish Second Brain hierarchy and archive legacy todo files"
```

---

### Task 5: Upgrade `apps/todo` SQLite Engine (`store.rs` & `schema.sql`)

**Files:**
- Modify: `apps/todo/src/schema.sql`
- Modify: `apps/todo/src/store.rs`
- Test: `apps/todo/tests/store_v2_test.rs` (or inline Rust test in `store.rs`)

**Interfaces:**
- Produces: SQLite migration 9 & 10 adding:
  - `tasks` columns: `code`, `series`, `milestone`, `horizon`, `category`, `task_type`, `priority`, `risk`, `effort`, `owner`, `assignee`, `summary`, `problem`, `proposed_solution`, `scope_json`, `acceptance_criteria_json`, `validation_json`, `evidence_json`, `references_json`, `scores_json`, `source_ref_json`, `blocked_reason`, `human_gate`.
  - `documents` table (`id`, `slug`, `layer`, `title`, `body`, `tags`, `project_id`, `created_at`, `updated_at`).
  - `document_links` table (`source_type`, `source_id`, `target_type`, `target_id`).
  - `global_search_fts` virtual table (FTS5) with sync triggers.

- [ ] **Step 1: Write Rust integration test for v2 store and documents**

Create test in `apps/todo/src/store.rs` test module:
Tests adding a task with rich v2 fields, adding a document in `brain` layer, querying via FTS5, and unblocking dependent tasks.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path apps/todo/Cargo.toml test_store_v2`
Expected: FAIL (compilation error, fields do not exist).

- [ ] **Step 3: Update `MIGRATIONS` in `apps/todo/src/store.rs` and models**

Add migration 9 (`tasks` rich columns + index on `code`) and migration 10 (`documents` + `document_links` + `global_search_fts` FTS5). Update `Task`, `TaskPatch`, and add `Document`, `DocumentPatch`, and FTS search methods.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path apps/todo/Cargo.toml`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/todo/src/store.rs apps/todo/src/schema.sql
git commit -m "feat(todo): add v2 rich task schema, documents, and FTS5 search to SQLite store"
```

---

### Task 6: Implement Lossless CLI Importer & Exporter (`apps/todo/src/import.rs` & `export.rs`)

**Files:**
- Create: `apps/todo/src/import.rs`
- Modify: `apps/todo/src/export.rs`
- Modify: `apps/todo/src/main.rs`
- Test: `apps/todo/src/import.rs` test module

**Interfaces:**
- Produces: CLI commands `moonwitness-dx import <FILE>` and `moonwitness-dx export --format tasks-json`.

- [ ] **Step 1: Write test for JSON v2 import and round-trip export**

Write test reading sample `tasks.json` payload, importing into an in-memory SQLite store, and verifying that export yields identical task codes, criteria, and dependencies.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path apps/todo/Cargo.toml test_import_v2`
Expected: FAIL.

- [ ] **Step 3: Implement `apps/todo/src/import.rs` and update `export.rs`**

Parse `moonwitness-tasks/v2` JSON, upsert projects, upsert tasks by `code`, sync `task_waits` graph, import comments and criteria, and update change counter.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path apps/todo/Cargo.toml`
Expected: PASS.

- [ ] **Step 5: Verify CLI import against repository `docs/tasks/tasks.json`**

Run: `cargo run --manifest-path apps/todo/Cargo.toml -- --home /tmp/mw-dx-test import docs/tasks/tasks.json`
Expected: Prints "Imported X projects and ~335 tasks successfully."

- [ ] **Step 6: Commit**

```bash
git add apps/todo/src/import.rs apps/todo/src/export.rs apps/todo/src/main.rs
git commit -m "feat(todo): add lossless import and export for moonwitness-tasks/v2"
```

---

### Task 7: Extend REST API & MCP Server (`apps/todo/src/web.rs` & `mcp.rs`)

**Files:**
- Modify: `apps/todo/src/web.rs`
- Modify: `apps/todo/src/mcp.rs`
- Test: `apps/todo/src/mcp.rs` test module

**Interfaces:**
- Produces:
  - REST routes: `GET/POST /api/documents`, `GET/PATCH/DELETE /api/documents/{id}`, `POST /api/import`, `GET /api/export`.
  - MCP Tools: `task_claim`, `task_checklist_toggle`, `task_submit_review`, `brain_quick_capture`, `wiki_lookup`, `global_search`.

- [ ] **Step 1: Write test for MCP tools and REST document endpoints**

Test calling MCP `task_claim` (verifies unblocked check), `task_checklist_toggle` (toggles AC status), and `brain_quick_capture` (writes to `raw` layer).

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path apps/todo/Cargo.toml test_mcp_v2`
Expected: FAIL.

- [ ] **Step 3: Implement web routes and MCP tool handlers**

Wire document handlers in `web.rs` and register new tools in `mcp.rs` using `rmcp::tool`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path apps/todo/Cargo.toml`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/todo/src/web.rs apps/todo/src/mcp.rs
git commit -m "feat(todo): add document REST endpoints and rich MCP tools for TaskOS and Second Brain"
```

---

### Task 8: Enhance Web Frontend with Smart Kanban & Second Brain (`apps/todo/web`)

**Files:**
- Modify: `apps/todo/web/src/types.ts`
- Modify: `apps/todo/web/src/api.ts`
- Modify: `apps/todo/web/src/App.tsx`
- Modify: `apps/todo/web/src/app.css`

**Interfaces:**
- Consumes: `/api/board`, `/api/tasks`, `/api/documents`, `/api/search`
- Produces: Enhanced React 19 Kanban board with rich task badges, drawer for Acceptance Criteria & Scope, and Second Brain Document/Wiki viewer.

- [ ] **Step 1: Update TypeScript types in `apps/todo/web/src/types.ts`**

Define `TaskV2`, `AcceptanceCriterion`, `ScopeSpec`, `ValidationSpec`, `Document`, `Layer`.

- [ ] **Step 2: Update API client in `apps/todo/web/src/api.ts`**

Add calls for `listDocuments`, `getDocument`, `saveDocument`, `toggleAcceptanceCriterion`, `importTasks`.

- [ ] **Step 3: Implement UI components in `App.tsx`**

- Task Card: Show `code`, `priority` badge (P0: red, P1: orange, P2: blue, P3: gray), `horizon` pill, AC progress bar (`2/4`), and Human/Agent indicator.
- Task Drawer: Structured sections for Summary, Problem & Proposed Solution, Scope (packages/files tags), Interactive Acceptance Criteria checklist, Validation commands with copy button, Evidence and Document backlinks.
- Navigation Header: Add tab switcher: **Kanban Board** | **Second Brain (Raw / Brain / Wiki)**.
- Second Brain View: Split pane with tree sidebar (`raw/`, `brain/`, `wiki/`, `blueprints/`, `specs/`) and Markdown reader/editor with live preview.

- [ ] **Step 4: Build frontend and verify no typecheck or bundle errors**

Run: `pnpm --filter moonwitness-dx-web build`
Expected: PASS with clean bundle output in `apps/todo/web/dist`.

- [ ] **Step 5: Commit**

```bash
git add apps/todo/web/src/
git commit -m "feat(todo-web): add smart Kanban badges, AC drawer, and Second Brain viewer in React 19"
```

---

### Task 9: Full Monorepo Parity & End-to-End Verification

**Files:**
- Test: Run all workspace test suites, roadmap validation, and verification gates.

- [ ] **Step 1: Run tasks validator and roadmap checker**

Run: `pnpm tasks:validate && pnpm automation:check:roadmap`
Expected: PASS (0 errors, perfect parity).

- [ ] **Step 2: Run Rust tests in `apps/todo`**

Run: `cargo test --manifest-path apps/todo/Cargo.toml`
Expected: PASS (all unit and integration tests pass).

- [ ] **Step 3: Run full workspace build and diagnostics**

Run: `pnpm build && pnpm --filter moonwitness-dx-web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit final verification adjustments**

```bash
git commit --allow-empty -m "chore(tasks): complete TaskOS and Second Brain centralization verification"
```

---

## Execution Options

This plan document was created and saved; that does **not** prove its implementation steps completed. The original execution checklist is historical context only. Use the current stabilization and TaskOS recovery records before planning or executing new work.

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
