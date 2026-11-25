# MW-XV: Implementation Plan — Unified Docs & Tasks System

**Version:** 1.0  
**Date:** 2026-11-24  
**Status:** DRAFT — For review before execution  
**Author:** AI Assistant (WorkBuddy)

---

## 1. Executive Summary

### Current State

- **apps/board** (Next.js 16, port 5173) — Main admin UI with generic model renderer (`/board/m/:model`)
- **apps/desktop** (Tauri v2 + Node sidecar) — Local-first agent harness with git worktree sandbox, MCP host, AI sidecar
- **apps/docs** (Vite + React Router) — Static documentation portal (build-time JSON bundle), **read-only**
- **packages/orm-project** — Complete task management models: `Project`, `ProjectStage`, `ProjectMilestone`, `ProjectTask`, `ProjectTaskDependency` with Kanban, DAG, AI dispatch, desktop worktree binding
- **docs/tasks/tasks.json** — 627 tasks (TaskOS registry, schema-validated)
- **docs/** — 700+ markdown files across 26 subfolders (architecture, blueprints, brain, decisions, design, engineering, knowledge, migration, operations, roadmap, specs, strategy, tasks, wiki, etc.)

### Problems to Solve

1. **Two docs systems** — `apps/docs` (static) vs Board generic renderer (dynamic) → confusion, duplicate maintenance
2. **Tasks in two places** — `tasks.json` (source of truth) vs empty `orm-project` tables → not synced
3. **No docs ORM model** — Docs live as files, not in DB → no versioning, no RBAC, no search via API
4. **apps/docs uses different stack** — Vite vs Next.js → auth not integrated, double maintenance

### Target Architecture

```
apps/board (NEXT.JS) — SINGLE SOURCE OF TRUTH FOR UI
├── /board/m/doc.page      → DocPage CRUD (list/create/edit/delete)
├── /board/m/doc.space     → DocSpace hierarchy management
├── /board/m/doc.revision  → Version history (immutable)
├── /board/projects        → ProjectTask Kanban + DAG + AI + Desktop (EXISTING)
├── /board/knowledge       → Research corpus (EXISTING)
└── /docs (optional)       → Wiki-style tree navigation (reads from same models)

apps/desktop (TAURI) — LOCAL EXECUTION ENVIRONMENT
├── Git worktree sandbox per task (EXISTING)
├── MCP host, AI sidecar (EXISTING)
├── Offline sync, PTY execution (EXISTING)
└── Tauri bridge → Board (EXISTING)

packages/orm-docs (NEW) — DOCS DATA LAYER
├── DocSpace (nested hierarchy, company-scoped)
├── DocPage (markdown, frontmatter, status, tags, space relation)
├── DocRevision (immutable history, diff-ready)
└── Manifest: menus, ModelAccess, seeds

packages/orm-project (EXISTING) — TASKS DATA LAYER
├── Project, ProjectStage, ProjectMilestone, ProjectTask, ProjectTaskDependency
├── Manifest: menus, ModelAccess, seeds, HTTP plugins, workflows
└── Board integration: ProjectsPage (Kanban + DAG + AI + Desktop)
```

### Key Principle

**No new apps.** Extend existing `apps/board` via ORM models. `apps/desktop` stays as execution bridge. `apps/docs` removed.

---

## 2. Detailed Work Breakdown

### Phase 1: Foundation — `packages/orm-docs` (Week 1)

#### 1.1 Package Structure

```
packages/orm-docs/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # Exports
│   ├── models.ts                # DocSpace, DocPage, DocRevision
│   ├── manifest.ts              # defineAddon, menus, ModelAccess, seeds
│   ├── views.ts                 # Optional: custom views for tree navigation
│   └── http-plugin.ts           # Optional: custom endpoints (search, tree)
├── tests/
│   └── models.test.ts
└── README.md
```

#### 1.2 Model Design: `DocSpace`

```typescript
// Nested hierarchy (Materialized Path or Adjacency List)
DocSpace = defineModel('doc.space', {
  table: 'doc_spaces',
  order: 'company_id asc, parent_id asc, sequence asc, name asc',
  displayField: 'name',
  unique: [['company', 'parent', 'code']],
  fields: {
    company: belongsTo(Company, { required: true }),
    parent: belongsTo('doc.space', { label: 'Parent Space' }), // self-referential
    code: string({ required: true, pattern: SLUG_PATTERN }), // e.g., 'guide', 'architecture'
    name: string({ required: true }),
    description: text(),
    sequence: integer({ required: true, default: 10 }),
    icon: string(), // optional: lucide icon name
    is_hidden: boolean({ required: true, default: false }),
  },
});
```

#### 1.3 Model Design: `DocPage`

```typescript
DocPage = defineModel('doc.page', {
  table: 'doc_pages',
  order: 'space_id asc, position asc, id desc',
  displayField: 'title',
  unique: [['company', 'space', 'slug']],
  fields: {
    company: belongsTo(Company, { required: true }),
    space: belongsTo(DocSpace, { required: true, label: 'Space' }),
    slug: string({ required: true, pattern: SLUG_PATTERN }),  // e.g., 'quickstart', 'api-reference'
    title: string({ required: true }),
    summary: text(),  // auto-extracted from markdown first paragraph
    body_markdown: text({ required: true }),  // raw markdown
    body_html: text(),  // rendered HTML (cached)
    frontmatter: json(),  // parsed YAML frontmatter
    status: enum(DOC_STATUSES, { required: true, default: 'draft' }),
    // DOC_STATUSES: ['draft', 'in_review', 'published', 'archived', 'superseded']
    tags: string({ array: true }),  // simple tag array
    position: integer({ required: true, default: 100 }),
    author: belongsTo(User, { label: 'Author' }),
    reviewer: belongsTo(User, { label: 'Reviewer' }),
    published_at: string({ pattern: ISO_DATETIME_PATTERN }),
    // Computed/virtual: revision_count, last_editor, word_count, reading_time
  },
})
```

#### 1.4 Model Design: `DocRevision`

```typescript
DocRevision = defineModel('doc.revision', {
  table: 'doc_revisions',
  order: 'page_id asc, created_at desc',
  displayField: 'version',
  fields: {
    company: belongsTo(Company, { required: true }),
    page: belongsTo(DocPage, { required: true }),
    version: integer({ required: true }), // 1, 2, 3...
    title: string({ required: true }),
    body_markdown: text({ required: true }),
    body_html: text(),
    frontmatter: json(),
    change_summary: string(), // user-provided: "Fixed typo in quickstart"
    editor: belongsTo(User, { required: true, label: 'Edited by' }),
    created_at: string({ required: true, pattern: ISO_DATETIME_PATTERN }),
  },
  unique: [['page', 'version']],
});
```

#### 1.5 Manifest: Menus & Access

```typescript
menus: [
  { model: DocSpace.modelName, label: 'Doc Spaces', group: 'Documentation', sequence: 10 },
  { model: DocPage.modelName, label: 'Doc Pages', group: 'Documentation', sequence: 11 },
  { model: DocRevision.modelName, label: 'Doc Revisions', group: 'Documentation', sequence: 12, developmentOnly: true },
]

ModelAccess seeds:
- group_user: read DocSpace, DocPage, DocRevision
- group_user: create/write DocPage (own spaces), create DocRevision on edit
- group_superadmin: full access
```

#### 1.6 Default Seeds (from current `docs/` structure)

```typescript
// Map current docs/ subfolders to DocSpace seeds
const spaceSeeds = [
  { code: 'guide', name: 'Developer Guide', parent: null, sequence: 10 },
  { code: 'architecture', name: 'Architecture', parent: null, sequence: 20 },
  { code: 'guide.tutorials', name: 'Tutorials', parent: 'guide', sequence: 10 },
  { code: 'guide.explanations', name: 'Explanations', parent: 'guide', sequence: 20 },
  { code: 'guide.reference', name: 'Reference', parent: 'guide', sequence: 30 },
  { code: 'guide.how-to', name: 'How-To', parent: 'guide', sequence: 40 },
  { code: 'operations', name: 'Operations', parent: null, sequence: 30 },
  { code: 'roadmap', name: 'Roadmap', parent: null, sequence: 40 },
  { code: 'specs', name: 'Specifications', parent: null, sequence: 50 },
  { code: 'design', name: 'Design', parent: null, sequence: 60 },
  { code: 'engineering', name: 'Engineering', parent: null, sequence: 70 },
  { code: 'knowledge', name: 'Knowledge Base', parent: null, sequence: 80 },
  { code: 'decisions', name: 'Architecture Decisions', parent: null, sequence: 90 },
  { code: 'blueprints', name: 'Blueprints', parent: null, sequence: 100 },
  { code: 'strategy', name: 'Strategy', parent: null, sequence: 110 },
  { code: 'migration', name: 'Migration', parent: null, sequence: 120 },
  { code: 'wiki', name: 'Wiki', parent: null, sequence: 130 },
  // ... etc for all 26 folders
];
```

#### 1.7 Acceptance Criteria Phase 1

- [ ] `pnpm build` passes for `orm-docs`
- [ ] `pnpm test:orm-docs` passes
- [ ] Models registered in ORM registry
- [ ] Menus appear in Board sidebar under "Documentation" group
- [ ] `/board/m/doc.space` and `/board/m/doc.page` render list/create/edit correctly
- [ ] RBAC works (user can create pages in spaces they have access to)

---

### Phase 2: Migration — Docs Files → Database (Week 1-2)

#### 2.1 Migration Script Design

```
scripts/docs/
├── migrate-docs-to-orm.ts         # Main entry point
├── parse-markdown.ts              # Frontmatter + content extraction
├── build-space-hierarchy.ts       # Infer DocSpace tree from folder structure
├── seed-docspaces.ts              # Bulk insert DocSpace seeds
├── seed-docpages.ts               # Bulk insert DocPage records
├── verify-migration.ts            # Count match, content hash compare
└── rollback-migration.ts          # Safety: truncate tables if needed
```

#### 2.2 Parsing Logic

```typescript
// For each .md file in docs/
interface ParsedDoc {
  relativePath: string; // e.g., 'guide/tutorials/quickstart.md'
  spacePath: string[]; // e.g., ['guide', 'tutorials']
  slug: string; // e.g., 'quickstart'
  frontmatter: Record<string, unknown>; // parsed YAML ---
  title: string; // frontmatter.title || first h1 || slug
  summary: string; // first paragraph (non-heading)
  bodyMarkdown: string; // full markdown content
  bodyHtml: string; // rendered via remark/rehype
  status: DocStatus; // map from frontmatter.status or 'published'
  tags: string[]; // frontmatter.tags || []
  author: string; // frontmatter.author || 'system'
  publishedAt: string; // frontmatter.date || file mtime
}
```

#### 2.3 Space Hierarchy Inference

```
docs/
├── guide/                    → DocSpace(code='guide', parent=null)
│   ├── tutorials/            → DocSpace(code='guide.tutorials', parent='guide')
│   ├── explanations/         → DocSpace(code='guide.explanations', parent='guide')
│   ├── reference/            → DocSpace(code='guide.reference', parent='guide')
│   └── how-to/               → DocSpace(code='guide.how-to', parent='guide')
├── architecture/             → DocSpace(code='architecture', parent=null)
├── operations/               → DocSpace(code='operations', parent=null)
└── ...
```

#### 2.4 Migration Steps

1. **Dry run** — Parse all files, build in-memory tree, log summary (spaces, pages, errors)
2. **Seed DocSpaces** — Bulk insert in topological order (parents first)
3. **Seed DocPages** — For each parsed doc, insert with `space_id` from hierarchy
4. **Verify** — Count match, spot-check 10 random pages (content hash, frontmatter)
5. **Commit** — Mark migration complete in meta table

#### 2.5 Acceptance Criteria Phase 2

- [ ] All 700+ markdown files parsed without data loss
- [ ] DocSpace hierarchy matches `docs/` folder structure (26+ spaces)
- [ ] DocPage count matches source file count
- [ ] Frontmatter preserved in `frontmatter` JSON field
- [ ] Rendered HTML cached in `body_html`
- [ ] Status mapping correct (draft/published/archived)
- [ ] Board `/board/m/doc.page` shows all pages with correct space grouping

---

### Phase 3: Tasks Import — `tasks.json` → `orm-project` (Week 2)

#### 3.1 Mapping Strategy

```typescript
// tasks.json (TaskOS v2) → ProjectTask (orm-project)
interface TaskMapping {
  // Direct mappings
  code → code (ProjectTask.code)
  title → title
  summary → description (first 500 chars)
  priority: 'p0'→'urgent', 'p1'→'high', 'p2'→'normal', 'p3'→'low'
  status: 'backlog'|'todo'|'doing'|'review'|'blocked'|'done' →
          'backlog'|'backlog'|'in_progress'|'review'|'blocked'|'done'
  assignee → assignee (User lookup by name/email)
  external_ref → external_ref (preserve original TaskOS code)

  // Extended mappings
  project → Project lookup by slug (create if missing)
  series → milestone or custom field
  category, type → tags array
  dependsOn, blocks → ProjectTaskDependency (blocks kind)
  acceptanceCriteria → JSON in description or custom field
  validation, evidence → JSON in description
  comments → separate model or JSON (defer to Phase 4)
}
```

#### 3.2 Project Creation from TaskOS Data

```typescript
// Extract unique projects from tasks.json
// TaskOS has: project, series, milestone fields
// Map to orm-project: Project (by project slug), ProjectMilestone (by milestone)
```

#### 3.3 Import Script

```
scripts/tasks/
├── import-taskos-to-orm.ts        # Main entry
├── map-taskos-to-project.ts       # Transformation logic
├── create-projects-milestones.ts  # Ensure parent records exist
├── seed-project-tasks.ts          # Bulk insert ProjectTask
├── seed-dependencies.ts           # Insert ProjectTaskDependency
├── verify-import.ts               # Count, spot-check, DAG integrity
└── rollback-import.ts             # Safety
```

#### 3.4 Acceptance Criteria Phase 3

- [ ] All 627 tasks imported
- [ ] Project/Milestone hierarchy created from TaskOS data
- [ ] Dependencies (blocks/relates_to) preserved
- [ ] `external_ref` = original TaskOS code for traceability
- [ ] `/board/projects` Kanban shows all tasks in correct stages
- [ ] DAG view shows correct blocked/ready counts
- [ ] TaskOS sync button in ProjectsPage works (round-trip)

---

### Phase 4: Cleanup & Polish (Week 2-3)

#### 4.1 Remove `apps/docs`

- [ ] Delete `apps/docs/` folder
- [ ] Remove from `pnpm-workspace.yaml`
- [ ] Update README references
- [ ] Add redirect in Board: `/docs/*` → `/board/m/doc.page` (optional middleware)

#### 4.2 Remove `docs/` folder (source files)

- [ ] Verify all content in DB
- [ ] Archive `docs/` to `docs.archive/` (git history preserved)
- [ ] Delete `docs/` from working tree
- [ ] Update `.gitignore` if needed

#### 4.3 Wiki-Style Navigation (Optional but Recommended)

Create a dedicated page in Board for tree browsing:

```
apps/board/src/app/board/docs/page.tsx  → Wiki home (space tree)
apps/board/src/app/board/docs/[...slug]/page.tsx  → Page render with sidebar tree
```

- Reads from `DocSpace` + `DocPage` via API
- Left sidebar: collapsible space tree
- Right pane: rendered markdown (from `body_html`)
- Breadcrumb, prev/next, edit button (links to `/board/m/doc.page/:id`)

#### 4.4 Auto-Revision on Edit

- Hook in `DocPage` write path (HTTP plugin or ORM lifecycle)
- On update: create `DocRevision` with previous content
- Limit: keep last 50 revisions per page

#### 4.5 Search Integration

- Add full-text search endpoint in `orm-docs/http-plugin.ts`
- Use PostgreSQL `tsvector` on `title`, `body_markdown`, `tags`
- Wire into Board global search (Cmd+K)

---

### Phase 5: Desktop Integration Validation (Week 3)

#### 5.1 Test Worktree Binding for Imported Tasks

- [ ] Open `/board/projects`
- [ ] Click "Bind Worktree" on a task imported from TaskOS
- [ ] Verify git worktree created, FLOW Cockpit opens
- [ ] Make changes, commit, verify sync back to Board

#### 5.2 Test AI WorkContract Dispatch

- [ ] Click "Dispatch AI" on imported task
- [ ] Verify WorkContract created with correct task context
- [ ] Verify stage sync works (task stage ↔ contract status)

#### 5.3 Offline Mode

- [ ] Test Desktop offline: create task, edit doc
- [ ] Reconnect: verify sync to Board/DB

---

## 3. Technical Decisions & Rationale

| Decision                                                       | Rationale                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Adjacency List for DocSpace** (parent_id)                    | Simpler than Materialized Path; recursive CTE for tree queries; sufficient for <500 spaces |
| **Markdown stored raw + HTML cached**                          | Raw for editing/diff; HTML for fast render; re-render on save                              |
| **Frontmatter as JSON**                                        | Flexible, queryable, preserves all metadata without schema changes                         |
| **DocRevision immutable**                                      | Audit trail, diff capability, rollback; storage cheap                                      |
| **Status enum: draft/in_review/published/archived/superseded** | Matches Docmost/Outline patterns; covers workflow                                          |
| **Tags as string[]**                                           | Simple, PostgreSQL GIN index for search; no many-to-many overhead                          |
| **No separate apps/docs or apps/task**                         | Board generic renderer + ORM = zero new UI code; single auth/RBAC                          |
| **Import tasks.json with external_ref**                        | Preserves TaskOS identity; enables round-trip sync                                         |
| **Phase 3 before Phase 4 cleanup**                             | Verify import works before destroying source files                                         |

---

## 4. Risk Assessment & Mitigation

| Risk                                                | Likelihood | Impact | Mitigation                                                 |
| --------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------- |
| Migration script loses frontmatter/data             | Low        | High   | Dry-run with checksums; spot-check 10%                     |
| Board generic renderer doesn't handle markdown well | Medium     | Medium | Test early; fallback to custom page if needed              |
| TaskOS import misses dependencies                   | Medium     | High   | Validate DAG integrity post-import; visual verify in Board |
| `apps/docs` removal breaks external links           | Low        | Medium | Add redirect middleware; update README                     |
| Performance with 700+ pages in generic list view    | Low        | Low    | Pagination + search already in ModelPage                   |
| Desktop worktree binding fails for old tasks        | Medium     | Medium | Test 5 sample tasks; fix `external_ref` mapping            |

---

## 5. Resource & Timeline Estimate

| Phase                 | Tasks  | Estimated Days       | Dependencies                   |
| --------------------- | ------ | -------------------- | ------------------------------ |
| 1. `orm-docs` package | 7      | 3                    | None                           |
| 2. Docs migration     | 6      | 3                    | Phase 1 done                   |
| 3. Tasks import       | 6      | 2                    | Phase 1 done (parallel with 2) |
| 4. Cleanup & polish   | 8      | 3                    | Phases 2, 3 done               |
| 5. Desktop validation | 3      | 1                    | Phase 3 done                   |
| **Total**             | **30** | **~12 working days** |                                |

**Parallelizable:** Phases 2 & 3 can run in parallel (different scripts, different models).

---

## 6. Success Metrics

| Metric                                     | Target                           |
| ------------------------------------------ | -------------------------------- |
| Docs migration completeness                | 100% files, 0 data loss          |
| Tasks import completeness                  | 627/627 tasks, 100% dependencies |
| Board `/board/m/doc.page` load time        | <500ms (p95)                     |
| Board `/board/projects` Kanban render      | <1s (627 tasks)                  |
| Search latency (docs + tasks)              | <200ms                           |
| Zero regression in existing Board features | All existing tests pass          |
| `apps/docs` removal                        | No broken links in README, docs  |

---

## 7. Rollback Plan

If critical issue discovered post-deployment:

1. **Docs migration rollback:** `pnpm exec tsx scripts/docs/rollback-migration.ts` → truncates `doc_spaces`, `doc_pages`, `doc_revisions`
2. **Tasks import rollback:** `pnpm exec tsx scripts/tasks/rollback-import.ts` → truncates `project_tasks`, `project_task_dependencies`, `project_milestones`, `project_stages`, `project_projects` (preserves default seeds)
3. **Code rollback:** `git revert` commits for `orm-docs` package and Board wiki pages
4. **Restore `apps/docs`:** `git restore apps/docs` + `pnpm install` (if absolutely needed)

---

## 8. Next Steps (Immediate)

1. **Review this plan** — Stakeholder sign-off
2. **Create `packages/orm-docs`** — Start Phase 1.1
3. **Set up test DB** — Isolated schema for migration dry-runs
4. **Pair-program migration scripts** — Ensure parsing logic handles edge cases

---

## Appendix A: Current `docs/` Folder Inventory

```
docs/
├── addons/              (4 files)
├── agents/              (1 file)
├── ai-corporation/      (7 files)
├── archive/             (5 files)
├── architecture/        (24 files)
├── assets/              (189 files - images, diagrams)
├── blueprints/          (1 file)
├── brain/               (2 files)
├── decisions/           (13 files)
├── design/              (94 files)
├── engineering/         (17 files)
├── governance/          (3 files)
├── guide/               (23 files)
│   ├── tutorials/
│   ├── explanations/
│   ├── reference/
│   └── how-to/
├── knowledge/           (40 files)
├── migration/           (7 files)
├── operations/          (13 files)
├── raw/                 (3 files)
├── roadmap/             (282 files - evidence, milestones)
├── security/            (1 file)
├── specs/               (1 file)
├── strategy/            (2 files)
├── superpowers/         (3 files)
├── tasks/               (5 files - tasks.json, schema, README, RECOVERY-INVENTORY)
├── testing/             (4 files)
├── wiki/                (1 file)
└── transform.md
```

**Total: ~700+ markdown files, 26 top-level folders**

---

## Appendix B: `tasks.json` Summary

```json
{
  "schemaVersion": "2.0.0",
  "projects": [...],      // Project definitions with custom statuses
  "tasks": [627 items],   // Each with: code, project, series, title, status, priority,
                          // category, type, dependsOn, blocks, acceptanceCriteria,
                          // validation, evidence, sourceRef, comments, metadata
  "documents": [...]      // References to docs (not markdown content)
}
```

**Status breakdown:** 468 done, 49 doing, 89 todo, 21 blocked

---

_End of Plan — Ready for Review_
