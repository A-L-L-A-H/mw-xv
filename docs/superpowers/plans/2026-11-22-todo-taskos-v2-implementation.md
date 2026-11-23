# apps/todo TaskOS v2 Implementation Plan

> **Historical implementation plan — not a live backlog or proof of completion.** Its original 1,346-task estimate is unverified. The actual repository registry `docs/tasks/tasks.json` is currently zero-byte; the verified recovery inventory contains 627 candidate records pending tests and approval. Do not use this document's historical checkboxes or task count to drive current execution. Current SOT status is maintained in `docs/tasks/README.md`, `docs/tasks/RECOVERY-INVENTORY.md`, and `docs/roadmap/STABILIZATION-PLAN.md`.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full `moonwitness-tasks/v2` contract support in `apps/todo` (moonwitness-dx) including SQLite schema migrations, enriched Task struct, lossless import/export CLI, enhanced MCP tools, and Second Brain web UI.

**Architecture:** Additive SQLite migrations (9 & 10) extend the existing tasks table with 22 new columns and add documents/document_links/FTS5 tables. The Task struct gains 22 optional fields. CLI gains `import/export --format tasks-json`. MCP server exposes 6 new tools. Web UI adds Kanban badges, AC drawer, and Second Brain tab.

**Tech Stack:** Rust 2024, rusqlite 0.42 (with FTS5), axum 0.8, rmcp 3.10, React 19, Tailwind CSS, Vite, chrono, serde_json.

**Historical spec reference:** `docs/tasks/tasks.schema.json` (moonwitness-tasks/v2). The previous 1,346-task estimate is not a verified count; current migration inputs are documented in `docs/tasks/RECOVERY-INVENTORY.md` and the registry remains unavailable until recovery passes.

## Global Constraints

- Additive migrations only — never break existing SQLite boards
- Zero drift with `docs/tasks/tasks.json` — `pnpm tasks:validate` must pass 100%
- All 78 existing Rust tests must continue to pass
- `cargo test --manifest-path apps/todo/Cargo.toml` green at every commit

---

### Task 1: SQLite Migrations 9 & 10 (Schema Extension)

**Files:**
- Modify: `apps/todo/src/store.rs` (MIGRATIONS array)
- Test: `apps/todo/src/store.rs` (integration test module)

**Interfaces:**
- Produces: Migration 9 (22 task columns + unique index), Migration 10 (documents, document_links, FTS5)

- [ ] **Step 1: Write failing integration test for migrations**

Add to `apps/todo/src/store.rs` test module:
```rust
#[test]
fn migration_9_10_adds_taskos_v2_columns_and_documents_tables() {
    let (dir, store) = store();
    // Verify all 22 new columns exist
    let cols: Vec<String> = store.conn
        .prepare("PRAGMA table_info(tasks)").unwrap()
        .query_map([], |r| r.get::<_, String>(1)).unwrap()
        .collect::<Result<Vec<_>, _>>().unwrap();
    
    let expected = ["code", "series", "milestone", "horizon", "category", "priority",
                    "effort", "risk", "owner", "summary", "problem", "proposed_solution",
                    "acceptance_criteria_json", "validation_json", "evidence_json",
                    "blocked_reason", "source_ref_json", "scope_json", "depends_on",
                    "blocks_json", "refs_json", "task_type"];
    for col in expected {
        assert!(cols.contains(&col.to_string()), "Missing column: {}", col);
    }
    
    // Verify documents, document_links, global_search_fts tables exist
    let tables: Vec<String> = store.conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table'").unwrap()
        .query_map([], |r| r.get(0)).unwrap()
        .collect::<Result<Vec<_>, _>>().unwrap();
    assert!(tables.contains(&"documents".to_string()));
    assert!(tables.contains(&"document_links".to_string()));
    assert!(tables.contains(&"global_search_fts".to_string()));
    
    // Verify FTS5 triggers work
    store.conn.execute(
        "INSERT INTO documents (slug, layer, title, body, tags) VALUES ('test/doc', 'wiki', 'Test', 'Body', 'tag1,tag2')",
        []
    ).unwrap();
    let fts_count: i64 = store.conn.query_row(
        "SELECT count(*) FROM global_search_fts WHERE entity_type='document'",
        [], |r| r.get(0)
    ).unwrap();
    assert_eq!(fts_count, 1);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path apps/todo/Cargo.toml migration_9_10_adds_taskos_v2_columns_and_documents_tables`
Expected: FAIL — columns/tables don't exist yet

- [ ] **Step 3: Add Migration 9 (22 task columns + unique index)**

In `MIGRATIONS` array in `apps/todo/src/store.rs`, add after migration 8:
```rust
// Migration 9: Rich TaskOS v2 schema columns for tasks (add columns first, then populate, then unique index)
"ALTER TABLE tasks ADD COLUMN code TEXT;
 ALTER TABLE tasks ADD COLUMN series TEXT;
 ALTER TABLE tasks ADD COLUMN milestone TEXT;
 ALTER TABLE tasks ADD COLUMN horizon TEXT;
 ALTER TABLE tasks ADD COLUMN category TEXT;
 ALTER TABLE tasks ADD COLUMN priority TEXT;
 ALTER TABLE tasks ADD COLUMN effort TEXT;
 ALTER TABLE tasks ADD COLUMN risk TEXT;
 ALTER TABLE tasks ADD COLUMN owner TEXT;
 ALTER TABLE tasks ADD COLUMN summary TEXT;
 ALTER TABLE tasks ADD COLUMN problem TEXT;
 ALTER TABLE tasks ADD COLUMN proposed_solution TEXT;
 ALTER TABLE tasks ADD COLUMN acceptance_criteria_json TEXT;
 ALTER TABLE tasks ADD COLUMN validation_json TEXT;
 ALTER TABLE tasks ADD COLUMN evidence_json TEXT;
 ALTER TABLE tasks ADD COLUMN blocked_reason TEXT;
 ALTER TABLE tasks ADD COLUMN source_ref_json TEXT;
 ALTER TABLE tasks ADD COLUMN scope_json TEXT;
 ALTER TABLE tasks ADD COLUMN depends_on TEXT;
 ALTER TABLE tasks ADD COLUMN blocks_json TEXT;
 ALTER TABLE tasks ADD COLUMN refs_json TEXT;
 ALTER TABLE tasks ADD COLUMN task_type TEXT;",
// Migration 9b: Populate code column with unique defaults for existing tasks
"UPDATE tasks SET code = 'TASK-' || id WHERE code IS NULL;",
// Migration 9c: Add unique index after population
"CREATE UNIQUE INDEX tasks_by_code ON tasks(code);",
```

- [ ] **Step 4: Add Migration 10 (Documents, Links, FTS5)**

In `MIGRATIONS` array, add after migration 9c:
```rust
// Migration 10: Second Brain documents, links, and FTS5 global search
"CREATE TABLE documents (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     slug        TEXT NOT NULL UNIQUE,
     layer       TEXT NOT NULL,
     title       TEXT NOT NULL,
     body        TEXT NOT NULL,
     tags        TEXT NOT NULL DEFAULT '',
     project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
     status      TEXT NOT NULL DEFAULT 'draft',
     created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
     updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
 );
 CREATE INDEX documents_by_layer ON documents(layer);
 CREATE INDEX documents_by_project ON documents(project_id);
 CREATE TABLE document_links (
     source_type TEXT NOT NULL,
     source_id   INTEGER NOT NULL,
     target_type TEXT NOT NULL,
     target_id   INTEGER NOT NULL,
     PRIMARY KEY (source_type, source_id, target_type, target_id)
 );
 CREATE VIRTUAL TABLE global_search_fts USING fts5(
     entity_type,
     entity_id UNINDEXED,
     title,
     body,
     tags,
     tokenize = 'porter unicode61'
 );
 CREATE TRIGGER documents_fts_insert AFTER INSERT ON documents BEGIN
     INSERT INTO global_search_fts (entity_type, entity_id, title, body, tags)
     VALUES ('document', NEW.id, NEW.title, NEW.body, NEW.tags);
 END;
 CREATE TRIGGER documents_fts_update AFTER UPDATE ON documents BEGIN
     UPDATE global_search_fts SET title = NEW.title, body = NEW.body, tags = NEW.tags
     WHERE entity_type = 'document' AND entity_id = NEW.id;
 END;
 CREATE TRIGGER documents_fts_delete AFTER DELETE ON documents BEGIN
     DELETE FROM global_search_fts WHERE entity_type = 'document' AND entity_id = OLD.id;
 END;
 CREATE TRIGGER tasks_fts_insert AFTER INSERT ON tasks BEGIN
     INSERT INTO global_search_fts (entity_type, entity_id, title, body, tags)
     VALUES ('task', NEW.id, NEW.title, NEW.description, NEW.tags);
 END;
 CREATE TRIGGER tasks_fts_update AFTER UPDATE ON tasks BEGIN
     UPDATE global_search_fts SET title = NEW.title, body = NEW.description, tags = NEW.tags
     WHERE entity_type = 'task' AND entity_id = NEW.id;
 END;
 CREATE TRIGGER tasks_fts_delete AFTER DELETE ON tasks BEGIN
     DELETE FROM global_search_fts WHERE entity_type = 'task' AND entity_id = OLD.id;
 END;",
```

- [ ] **Step 5: Update TASK_SELECT and task_row**

Modify `TASK_SELECT` constant and `task_row` function to include all 22 new columns.

- [ ] **Step 6: Run test to verify it passes**

Run: `cargo test --manifest-path apps/todo/Cargo.toml migration_9_10_adds_taskos_v2_columns_and_documents_tables`
Expected: PASS

- [ ] **Step 7: Run all 78 tests to ensure no regressions**

Run: `cargo test --manifest-path apps/todo/Cargo.toml`
Expected: 78 passed

- [ ] **Step 8: Commit**

```bash
git add apps/todo/src/store.rs
git commit -m "feat(todo): add TaskOS v2 migrations 9 & 10 with FTS5 search"
```

---

### Task 2: Enrich Task Struct & TaskPatch

**Files:**
- Modify: `apps/todo/src/store.rs` (Task, TaskPatch structs)
- Modify: `apps/todo/src/web.rs` (Patch struct)
- Modify: `apps/todo/src/mcp.rs` (UpdateTaskArgs, CreateTaskArgs structs)

**Interfaces:**
- Consumes: Task struct from Task 1
- Produces: Enriched Task, TaskPatch, web Patch, MCP args with 22 v2 fields

- [ ] **Step 1: Write test for enriched Task struct**

Add to store test module:
```rust
#[test]
fn task_struct_has_all_v2_fields() {
    let (dir, store) = store();
    let project = store.create_project("test", "Test", None).unwrap();
    let task = store.create_task_in(project.id, "Test Task", TaskPatch {
        description: Some("Description".into()),
        code: Some("TEST-001".into()),
        series: Some("TEST".into()),
        milestone: Some("M1".into()),
        horizon: Some("now".into()),
        category: Some("feature".into()),
        priority: Some("p1".into()),
        effort: Some("m".into()),
        risk: Some("low".into()),
        owner: Some("alice".into()),
        summary: Some("Short summary".into()),
        problem: Some("The problem".into()),
        proposed_solution: Some("The solution".into()),
        acceptance_criteria: Some(vec![serde_json::json!({"id": "ac-1", "text": "Criterion", "done": false})]),
        validation: Some(serde_json::json!({"commands": ["cargo test"], "expected": "Pass"})),
        evidence: Some(serde_json::json!({"paths": ["evidence.md"], "detailFile": null, "commitSha": null})),
        blocked_reason: Some("Waiting on dependency".into()),
        source_ref: Some(serde_json::json!({"file": "audit", "legacyId": "AUD-001"})),
        scope: Some(serde_json::json!({"packages": ["pkg1"], "files": ["file.rs"]})),
        depends_on: Some(vec!["DEP-001".into()]),
        blocks: Some(vec!["BLOCK-001".into()]),
        references: Some(vec!["REF-001".into()]),
        task_type: Some("feature".into()),
        ..Default::default()
    }).unwrap();
    
    assert_eq!(task.code, Some("TEST-001".to_string()));
    assert_eq!(task.series, Some("TEST".to_string()));
    assert_eq!(task.priority, Some("p1".to_string()));
    assert!(task.acceptance_criteria_json.is_some());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path apps/todo/Cargo.toml task_struct_has_all_v2_fields`
Expected: FAIL — fields don't exist on Task/TaskPatch

- [ ] **Step 3: Enrich Task struct in `apps/todo/src/store.rs`**

Add 22 optional fields to `Task` struct:
```rust
pub code: Option<String>,
pub series: Option<String>,
pub milestone: Option<String>,
pub horizon: Option<String>,
pub category: Option<String>,
pub priority: Option<String>,
pub effort: Option<String>,
pub risk: Option<String>,
pub owner: Option<String>,
pub summary: Option<String>,
pub problem: Option<String>,
pub proposed_solution: Option<String>,
pub acceptance_criteria_json: Option<String>,
pub validation_json: Option<String>,
pub evidence_json: Option<String>,
pub blocked_reason: Option<String>,
pub source_ref_json: Option<String>,
pub scope_json: Option<String>,
pub depends_on: Option<String>,      // JSON array of task codes
pub blocks_json: Option<String>,      // JSON array of task codes
pub refs_json: Option<String>,        // JSON array of task codes
pub task_type: Option<String>,
```

Update `task_row` to read all 22 columns (indices 12-33).

- [ ] **Step 4: Enrich TaskPatch struct**

Add same 22 fields (as `Option<...>` matching serde types) to `TaskPatch`.

- [ ] **Step 5: Update create_task_in**

Modify `create_task_in` to serialize v2 fields to JSON and insert all 27 columns.

- [ ] **Step 6: Run test to verify it passes**

Run: `cargo test --manifest-path apps/todo/Cargo.toml task_struct_has_all_v2_fields`
Expected: PASS

- [ ] **Step 6: Update web.rs Patch struct**

Add all 22 v2 fields to `Patch` struct in `apps/todo/src/web.rs` and update `update_task` handler.

- [ ] **Step 7: Update MCP args structs**

Add 22 fields to `UpdateTaskArgs` and `CreateTaskArgs` in `apps/todo/src/mcp.rs`. Update `update_task` and `create_task` handlers.

- [ ] **Step 8: Run all tests**

Run: `cargo test --manifest-path apps/todo/Cargo.toml`
Expected: 78 passed

- [ ] **Step 9: Commit**

```bash
git add apps/todo/src/store.rs apps/todo/src/web.rs apps/todo/src/mcp.rs
git commit -m "feat(todo): enrich Task, TaskPatch, and MCP args with TaskOS v2 fields"
```

---

### Task 3: Lossless Import/Export CLI

**Files:**
- Create: `apps/todo/src/import.rs`
- Modify: `apps/todo/src/export.rs` (add `TasksJson` format)
- Modify: `apps/todo/src/main.rs` (register CLI commands)

**Interfaces:**
- Consumes: `moonwitness-tasks/v2` JSON, enriched store
- Produces: `moonwitness-dx import <file> [--mode upsert|replace]`, `moonwitness-dx export --format tasks-json`

- [ ] **Step 1: Write test for round-trip import/export**

Add to export test module:
```rust
#[test]
fn import_export_roundtrip_preserves_all_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let home = Home::open(tmp.path().to_path_buf()).unwrap();
    let store = home.store().unwrap();
    let project = store.create_project("test", "Test", None).unwrap();
    
    // Create task with all v2 fields via store directly
    let task = store.create_task_in(project.id, "Roundtrip Task", TaskPatch {
        code: Some("RT-001".into()),
        series: Some("RT".into()),
        // ... all v2 fields
        ..Default::default()
    }).unwrap();
    
    // Export to tasks.json
    let out_path = tmp.path().join("tasks.json");
    export(&home, Format::TasksJson, None, Some(&out_path)).unwrap();
    
    // Import into fresh home
    let home2 = Home::open(tmp.path().join("home2")).unwrap();
    import_tasks_json(&home2, &out_path, ImportMode::Upsert).unwrap();
    
    let store2 = home2.store().unwrap();
    let imported = store2.find_task("RT-001").unwrap();
    assert_eq!(imported.code, Some("RT-001".to_string()));
    assert_eq!(imported.series, Some("RT".to_string()));
    // ... verify all v2 fields preserved
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path apps/todo/Cargo.toml import_export_roundtrip_preserves_all_fields`
Expected: FAIL — import/export not implemented

- [ ] **Step 3: Implement `apps/todo/src/import.rs`**

Parse `moonwitness-tasks/v2` JSON, upsert projects, upsert tasks by `code`, sync `task_waits` graph, import documents and `document_links`, bump change counter. Use single transaction.

- [ ] **Step 4: Implement `export --format tasks-json` in `apps/todo/src/export.rs`**

Add `TasksJson` variant to `Format` enum. Implement `collect_tasks_json` that reads all tasks/documents and emits canonical `moonwitness-tasks/v2` JSON.

- [ ] **Step 5: Register CLI commands in `main.rs`**

Add `Import { path, mode }` and extend `Export` with `TasksJson` format.

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test --manifest-path apps/todo/Cargo.toml import_export_roundtrip_preserves_all_fields`
Expected: PASS

- [ ] **Step 6: Verify CLI against canonical `docs/tasks/tasks.json`**

Run: `cargo run --manifest-path apps/todo/Cargo.toml -- --home /tmp/mw-dx-test import docs/tasks/tasks.json`
Expected: "Imported 1 projects and 1,346 tasks successfully."

- [ ] **Step 7: Run all tests**

Run: `cargo test --manifest-path apps/todo/Cargo.toml`
Expected: 78 passed

- [ ] **Step 8: Commit**

```bash
git add apps/todo/src/import.rs apps/todo/src/export.rs apps/todo/src/main.rs
git commit -m "feat(todo): add lossless import/export for moonwitness-tasks/v2"
```

---

### Task 4: Enhanced MCP Tools

**Files:**
- Modify: `apps/todo/src/mcp.rs`

**Interfaces:**
- Produces: 6 new MCP tools for agent-driven TaskOS + Second Brain workflows

- [ ] **Step 1: Write test for each new MCP tool**

Add tests for:
- `task_claim` — verifies dependency check, status transition, unblocks dependents
- `task_checklist_toggle` — toggles AC done status
- `task_submit_review` — validates all AC done before status=review
- `brain_quick_capture` — writes to `raw` layer
- `wiki_lookup` — reads from `wiki` layer
- `global_search` — searches tasks + docs via FTS5

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path apps/todo/Cargo.toml mcp_new_tools`
Expected: FAIL — tools not registered

- [ ] **Step 3: Implement new MCP tools in `mcp.rs`**

Register 6 new tools with proper JsonSchema. Each tool runs in `run` or `run_for` closure with proper error handling.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path apps/todo/Cargo.toml mcp_new_tools`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `cargo test --manifest-path apps/todo/Cargo.toml`
Expected: 78 passed

- [ ] **Step 6: Commit**

```bash
git add apps/todo/src/mcp.rs
git commit -m "feat(todo): add 6 TaskOS/Second Brain MCP tools"
```

---

### Task 5: Web UI — Smart Kanban + Second Brain Tab

**Files:**
- Modify: `apps/todo/web/src/types.ts` (TaskV2, Document, Layer types)
- Modify: `apps/todo/web/src/api.ts` (new API calls)
- Modify: `apps/todo/web/src/App.tsx` (UI components)
- Modify: `apps/todo/web/src/app.css` (styles)

**Interfaces:**
- Consumes: `/api/board`, `/api/tasks`, `/api/documents`, `/api/search`
- Produces: Enhanced Kanban with badges/drawer, Second Brain viewer/editor

- [ ] **Step 1: Update TypeScript types**

Define `TaskV2`, `AcceptanceCriterion`, `ScopeSpec`, `ValidationSpec`, `Document`, `Layer` in `types.ts`.

- [ ] **Step 2: Update API client**

Add calls for `listDocuments`, `getDocument`, `saveDocument`, `toggleAcceptanceCriterion`, `importTasks`, `globalSearch`.

- [ ] **Step 3: Implement Kanban enhancements**

Task Card: `code` badge, `priority` (P0:red, P1:orange, P2:blue, P3:gray), `horizon` pill, AC progress bar (`2/4`), Human/Agent indicator.

Task Drawer: Summary, Problem/Solution, Scope tags, Interactive AC checklist, Validation commands copy button, Evidence/Document backlinks.

- [ ] **Step 4: Implement Second Brain tab**

Navigation: **Kanban Board** | **Second Brain** tabs.

Second Brain View: Split pane with tree sidebar (`raw/`, `brain/`, `wiki/`, `blueprints/`, `specs/`) and Markdown reader/editor with live preview. Toolbar for New/Edit/Delete/Save.

- [ ] **Step 5: Implement global search bar**

Debounced input → `/api/search?q=` → unified results list (tasks + docs) with type badges.

- [ ] **Step 6: Build frontend**

Run: `pnpm --filter moonwitness-dx-web build`
Expected: Clean bundle output in `apps/todo/web/dist`

- [ ] **Step 6: Commit**

```bash
git add apps/todo/web/src/
git commit -m "feat(todo-web): add smart Kanban badges, AC drawer, and Second Brain viewer"
```

---

### Task 6: Full Integration Verification

**Files:**
- Test: All workspace test suites

- [ ] **Step 1: Run tasks validator and roadmap checker**

Run: `pnpm tasks:validate && pnpm automation:check:roadmap`
Expected: PASS (0 errors, perfect parity)

- [ ] **Step 2: Run Rust tests**

Run: `cargo test --manifest-path apps/todo/Cargo.toml`
Expected: 78 passed

- [ ] **Step 3: Run full workspace build**

Run: `pnpm build && pnpm --filter moonwitness-dx-web typecheck`
Expected: PASS

- [ ] **Step 4: Import canonical tasks into local moonwitness-dx**

Run: `cargo run --manifest-path apps/todo/Cargo.toml -- --home /tmp/mw-dx-test import docs/tasks/tasks.json`
Expected: "Imported 1 projects and 1,346 tasks successfully."

- [ ] **Step 5: Export and verify round-trip**

Run: `cargo run --manifest-path apps/todo/Cargo.toml -- --home /tmp/mw-dx-test export --format tasks-json /tmp/roundtrip.json`
Run: `node -e "const a=require('./docs/tasks/tasks.json'); const b=require('/tmp/roundtrip.json'); console.log(a.tasks.length===b.tasks.length?'PASS':'FAIL')"`
Expected: PASS

- [ ] **Step 6: Commit final verification**

```bash
git commit --allow-empty -m "chore(todo): complete TaskOS v2 and Second Brain implementation"
```

---

## Execution Options

This plan document was created and saved; its existence does **not** prove its implementation steps completed. Treat its checkboxes as historical planning context, not current project status.

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

If Subagent-Driven chosen:
- REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
- Fresh subagent per task + two-stage review

If Inline Execution chosen:
- REQUIRED SUB-SKILL: Use superpowers:executing-plans
- Batch execution with checkpoints for review