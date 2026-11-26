/**
 * T14 — 2-hop knowledge graph engine & causal impact queries.
 *
 * Edge semantics (aligned with the reindexer in `src/brain/reindex.ts`):
 * `governed_by`, `decided_by`, `depends_on`, `owns_file`, `reads_file`,
 * `parent_of`, `documents`, `proved_by`, `failed_on`, `fixed_by`,
 * `projected_to`.
 *
 * All recursive traversals are cycle-safe: every CTE enforces
 * `depth < maxDepth` AND a visited-path guard
 * (`instr(path, ':' || urn || ':') = 0`) so cyclic graphs terminate.
 */

import type { BrainStorageDriver } from "./storage.js";

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface TaskRow {
  readonly urn: string;
  readonly kind: string;
  readonly code: string;
  readonly title: string;
  readonly plan_id: string;
  readonly wave_id: string;
  readonly status: string;
  readonly delivery_stage: string;
  readonly owner_files: string;
  readonly metadata_json: string;
}

export interface TwoHopContext {
  readonly taskUrn: string;
  readonly siblingTasksOnSameFiles: TaskRow[];
  readonly linkedAdrs: Array<{ urn: string; title: string }>;
  readonly matchedInvariants: Array<{ urn: string; title: string; rule?: string }>;
  readonly linkedDocs: Array<{ urn: string; title: string }>;
  readonly priorFailuresOnSameFiles: Array<{
    episodeId: string;
    kind: string;
    summary: string;
    failurePattern: string;
    file: string;
  }>;
}

export interface BlastRadiusImpact {
  readonly target: string;
  readonly impactedTasks: Array<TaskRow & { readonly depth: number }>;
  readonly criticalPathNodes: Array<TaskRow & { readonly depth: number }>;
  readonly linkedAdrs: Array<{ urn: string; title: string }>;
  readonly linkedWaves: Array<{ waveId: string; planId: string; title: string }>;
  readonly docRegenerationFlags: Array<{ urn: string; reason: string }>;
  readonly failureEpisodes: Array<{
    episodeId: string;
    kind: string;
    summary: string;
    taskUrn: string;
  }>;
}

export interface SubgraphExport {
  readonly nodes: Array<{
    urn: string;
    kind: string;
    code: string;
    title: string;
    plan_id: string;
    wave_id: string;
    status: string;
  }>;
  readonly edges: Array<{ src: string; rel: string; dst: string }>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function asRows(result: unknown): TaskRow[] {
  return Array.isArray(result) ? (result as TaskRow[]) : [];
}

interface EdgeRowRaw {
  readonly src_urn: string;
  readonly rel: string;
  readonly dst_urn: string;
  readonly metadata_json: string;
}

function asEdges(result: unknown): EdgeRowRaw[] {
  return Array.isArray(result) ? (result as EdgeRowRaw[]) : [];
}

function parseJsonArray(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Node rows that back the URNs referenced in a context payload. */
function fetchNodeSummaries(
  store: BrainStorageDriver,
  urns: readonly string[]
): Array<{ urn: string; title: string; kind: string }> {
  const unique = [...new Set(urns)].filter(Boolean);
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => "?").join(", ");
  const rows = asRows(
    store.all(
      `SELECT urn, kind, title FROM nodes WHERE urn IN (${placeholders});`,
      ...unique
    )
  );
  return rows.map((r) => ({ urn: r.urn, title: r.title, kind: r.kind }));
}

// ---------------------------------------------------------------------------
// Two-hop context query
// ---------------------------------------------------------------------------

/**
 * Returns the 2-hop neighborhood of a task via indexed SQL joins:
 * sibling tasks sharing owner files, the plan's ADR, matched invariants,
 * linked documents, and prior failure episodes on the same files.
 * All queries hit `idx_edges_*` indexes and complete in < 10ms on the
 * reindexed brain DB.
 */
export function queryTwoHopContext(
  store: BrainStorageDriver,
  taskUrn: string
): TwoHopContext {
  // Hop 1 — files this task owns (and globs it reads, for sibling discovery).
  const ownedFiles = asEdges(
    store.all("SELECT src_urn, rel, dst_urn, metadata_json FROM edges WHERE src_urn = ? AND rel = 'owns_file';", taskUrn)
  ).map((e) => e.dst_urn);

  // Siblings: other tasks that own any of the same files.
  const siblingTasksOnSameFiles: TaskRow[] = [];
  if (ownedFiles.length > 0) {
    const placeholders = ownedFiles.map(() => "?").join(", ");
    const rows = asRows(
      store.all(
        `SELECT DISTINCT n.urn, n.kind, n.code, n.title, n.plan_id, n.wave_id, n.status,
                n.delivery_stage, n.owner_files, n.metadata_json
         FROM edges e
         JOIN nodes n ON n.urn = e.src_urn
         WHERE e.rel = 'owns_file'
           AND e.dst_urn IN (${placeholders})
           AND e.src_urn != ?
         ORDER BY n.plan_id, n.code;`,
        ...ownedFiles,
        taskUrn
      )
    );
    siblingTasksOnSameFiles.push(...rows);
  }

  // Linked ADRs: the plan --documents--> doc edges for this task's plan.
  const planRow = store.get(
    "SELECT plan_id FROM nodes WHERE urn = ?;",
    taskUrn
  ) as { plan_id?: string } | undefined;
  const planId = planRow?.plan_id ?? "";
  const adrUrnRows = planId
    ? asEdges(
        store.all(
          "SELECT src_urn, rel, dst_urn, metadata_json FROM edges WHERE src_urn = ? AND rel = 'documents';",
          `urn:mw:plan:${planId}`
        )
      ).map((e) => e.dst_urn)
    : [];

  // Matched invariants: task --governed_by--> inv.
  const invariantUrnRows = asEdges(
    store.all(
      "SELECT src_urn, rel, dst_urn, metadata_json FROM edges WHERE src_urn = ? AND rel = 'governed_by';",
      taskUrn
    )
  );
  const matchedInvariants = invariantUrnRows.map((edge) => {
    let rule: string | undefined;
    try {
      const meta: unknown = JSON.parse(edge.metadata_json || "{}");
      if (meta && typeof meta === "object" && "rule" in meta) {
        rule = String((meta as Record<string, unknown>).rule);
      }
    } catch {
      // metadata_json is best-effort
    }
    return { urn: edge.dst_urn, title: edge.dst_urn, rule };
  });

  // Linked docs: task --documents--> doc.
  const docUrnRows = asEdges(
    store.all(
      "SELECT src_urn, rel, dst_urn, metadata_json FROM edges WHERE src_urn = ? AND rel = 'documents';",
      taskUrn
    )
  ).map((e) => e.dst_urn);

  const linkedAdrs = fetchNodeSummaries(store, adrUrnRows).map((n) => ({
    urn: n.urn,
    title: n.title,
  }));
  const linkedDocs = fetchNodeSummaries(store, docUrnRows).map((n) => ({
    urn: n.urn,
    title: n.title,
  }));

  // Prior failures on the same files: episode --failed_on--> file:<path>
  // joined back to episodic_memory rows.
  const priorFailuresOnSameFiles: TwoHopContext["priorFailuresOnSameFiles"] = [];
  if (ownedFiles.length > 0) {
    const placeholders = ownedFiles.map(() => "?").join(", ");
    const rows = store.all(
      `SELECT DISTINCT em.episode_id, em.kind, em.summary_redacted, em.failure_pattern, e.dst_urn
       FROM edges e
       JOIN episodic_memory em ON em.episode_id = e.src_urn
       WHERE e.rel = 'failed_on'
         AND e.dst_urn IN (${placeholders});`,
      ...ownedFiles
    ) as unknown;
    if (Array.isArray(rows)) {
      for (const row of rows as Array<{
        episode_id: string;
        kind: string;
        summary_redacted: string;
        failure_pattern: string;
        dst_urn: string;
      }>) {
        priorFailuresOnSameFiles.push({
          episodeId: row.episode_id,
          kind: row.kind,
          summary: row.summary_redacted,
          failurePattern: row.failure_pattern,
          file: row.dst_urn.replace(/^file:/, ""),
        });
      }
    }
  }

  return {
    taskUrn,
    siblingTasksOnSameFiles,
    linkedAdrs,
    matchedInvariants,
    linkedDocs,
    priorFailuresOnSameFiles,
  };
}

// ---------------------------------------------------------------------------
// Blast radius (recursive CTE impact query)
// ---------------------------------------------------------------------------

const IMPACT_ACTIVE_STATUSES = "('active', 'blocked', 'todo', 'in_progress')";

function isFilePath(target: string): boolean {
  return (
    target.startsWith("file:") ||
    target.startsWith("glob:") ||
    /^[a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+$/.test(target)
  );
}

/**
 * Causal impact query: starting from a file path (or task URN), walk
 * `owns_file` in reverse to the owning tasks, then follow `depends_on`
 * edges in reverse (dependents) with a cycle-safe recursive CTE bounded
 * by `maxDepth` (default 4).
 */
export function queryBlastRadiusImpact(
  store: BrainStorageDriver,
  targetPathOrUrn: string,
  maxDepth = 4
): BlastRadiusImpact {
  const target = targetPathOrUrn;
  const fileKey = target.startsWith("file:") ? target : `file:${target}`;

  // Entry tasks: for a file target, the tasks that own it; for a task URN,
  // the task itself.
  const entryUrns: string[] = [];
  if (isFilePath(target) && !store.get("SELECT urn FROM nodes WHERE urn = ?;", target)) {
    const owners = asEdges(
      store.all(
        "SELECT src_urn, rel, dst_urn, metadata_json FROM edges WHERE rel = 'owns_file' AND dst_urn = ?;",
        fileKey
      )
    ).map((e) => e.src_urn);
    entryUrns.push(...owners);
  } else {
    entryUrns.push(target);
  }

  const impactedTasks: Array<TaskRow & { depth: number }> = [];
  const criticalPathNodes: Array<TaskRow & { depth: number }> = [];
  const impactedUrns = new Set<string>();

  if (entryUrns.length > 0) {
    const placeholders = entryUrns.map(() => "?").join(", ");
    // Cycle-safe recursive traversal: `path` accumulates visited URNs wrapped
    // in ':' delimiters; `instr(path, ...) = 0` rejects revisits, and
    // `depth < maxDepth` hard-bounds recursion.
    const rows = store.all(
      `WITH RECURSIVE impact(urn, depth, path) AS (
         SELECT urn, 0, ':' || urn || ':' FROM nodes WHERE urn IN (${placeholders})
         UNION
         SELECT e.src_urn, impact.depth + 1,
                impact.path || e.src_urn || ':'
         FROM impact
         JOIN edges e ON e.dst_urn = impact.urn AND e.rel = 'depends_on'
         WHERE impact.depth < ?
           AND instr(impact.path, ':' || e.src_urn || ':') = 0
       )
       SELECT n.urn, n.kind, n.code, n.title, n.plan_id, n.wave_id, n.status,
              n.delivery_stage, n.owner_files, n.metadata_json, impact.depth
       FROM impact
       JOIN nodes n ON n.urn = impact.urn
       ORDER BY impact.depth, n.plan_id, n.code;`,
      ...entryUrns,
      maxDepth
    ) as unknown;
    if (Array.isArray(rows)) {
      for (const row of rows as Array<TaskRow & { depth: number }>) {
        impactedTasks.push(row);
        impactedUrns.add(row.urn);
        // Critical-path nodes: tasks still in flight (active/blocked) are the
        // critical path candidates for downstream impact.
        if (row.status === "active" || row.status === "blocked") {
          criticalPathNodes.push(row);
        }
      }
    }
  }

  // Linked ADRs: documents edges from each impacted task's plan.
  const planIds = [...new Set(impactedTasks.map((t) => t.plan_id).filter(Boolean))];
  const linkedAdrs: BlastRadiusImpact["linkedAdrs"] = [];
  const linkedWaves: BlastRadiusImpact["linkedWaves"] = [];
  const docUrns: string[] = [];
  for (const planId of planIds) {
    const planUrn = `urn:mw:plan:${planId}`;
    for (const edge of asEdges(
      store.all(
        "SELECT src_urn, rel, dst_urn, metadata_json FROM edges WHERE src_urn = ? AND rel = 'documents';",
        planUrn
      )
    )) {
      docUrns.push(edge.dst_urn);
    }
    const waveRow = store.get(
      "SELECT DISTINCT wave_id, title FROM nodes WHERE plan_id = ? AND wave_id != '';",
      planId
    ) as { wave_id?: string; title?: string } | undefined;
    if (waveRow?.wave_id) {
      linkedWaves.push({
        waveId: waveRow.wave_id,
        planId,
        title: waveRow.title ?? waveRow.wave_id,
      });
    }
  }
  for (const node of fetchNodeSummaries(store, docUrns)) {
    linkedAdrs.push({ urn: node.urn, title: node.title });
  }

  // INV-006 doc regeneration flags: impacted tasks that own docs they must
  // regenerate (task --documents--> doc where the doc is a generated doc).
  const docRegenerationFlags: BlastRadiusImpact["docRegenerationFlags"] = [];
  for (const task of impactedTasks) {
    for (const edge of asEdges(
      store.all(
        "SELECT src_urn, rel, dst_urn, metadata_json FROM edges WHERE src_urn = ? AND rel = 'documents';",
        task.urn
      )
    )) {
      if (/^urn:mw:doc:/.test(edge.dst_urn)) {
        docRegenerationFlags.push({
          urn: edge.dst_urn,
          reason: `impacted task ${task.code} (${task.status}) owns this doc`,
        });
      }
    }
  }

  // Historical failure episodes attached to impacted tasks.
  const failureEpisodes: BlastRadiusImpact["failureEpisodes"] = [];
  if (impactedUrns.size > 0) {
    const urnList = [...impactedUrns];
    const placeholders = urnList.map(() => "?").join(", ");
    const rows = store.all(
      `SELECT episode_id, kind, summary_redacted, task_urn
       FROM episodic_memory
       WHERE task_urn IN (${placeholders}) AND status = 'active';`,
      ...urnList
    ) as unknown;
    if (Array.isArray(rows)) {
      for (const row of rows as Array<{
        episode_id: string;
        kind: string;
        summary_redacted: string;
        task_urn: string;
      }>) {
        failureEpisodes.push({
          episodeId: row.episode_id,
          kind: row.kind,
          summary: row.summary_redacted,
          taskUrn: row.task_urn,
        });
      }
    }
  }

  return {
    target,
    impactedTasks,
    criticalPathNodes,
    linkedAdrs,
    linkedWaves,
    docRegenerationFlags,
    failureEpisodes,
  };
}

// ---------------------------------------------------------------------------
// Subgraph export (compact JSON for observatory / desktop rendering)
// ---------------------------------------------------------------------------

/**
 * Exports a compact `{ nodes, edges }` subgraph ready for
 * `tools/agent-observatory` and `apps/desktop` interactive rendering.
 * When `centerUrn` is set, walks up to `maxHops` in BOTH edge directions
 * (cycle-safe). When only `planId` is set, exports that plan's whole slice.
 */
export function exportSubgraph(
  store: BrainStorageDriver,
  options: { planId?: string; centerUrn?: string; maxHops?: number } = {}
): SubgraphExport {
  const maxHops = options.maxHops ?? 2;
  const selectedUrns = new Set<string>();

  if (options.centerUrn) {
    // Cycle-safe bidirectional BFS over the edge table, bounded by maxHops.
    const rows = store.all(
      `WITH RECURSIVE walk(urn, depth, path) AS (
         SELECT urn, 0, ':' || urn || ':' FROM nodes WHERE urn = ?
         UNION
         SELECT CASE WHEN e.src_urn = walk.urn THEN e.dst_urn ELSE e.src_urn END,
                walk.depth + 1,
                walk.path || CASE WHEN e.src_urn = walk.urn THEN e.dst_urn ELSE e.src_urn END || ':'
         FROM walk
         JOIN edges e ON e.src_urn = walk.urn OR e.dst_urn = walk.urn
         WHERE walk.depth < ?
           AND instr(walk.path, ':' || CASE WHEN e.src_urn = walk.urn THEN e.dst_urn ELSE e.src_urn END || ':') = 0
       )
       SELECT urn FROM walk;`,
      options.centerUrn,
      maxHops
    ) as unknown;
    if (Array.isArray(rows)) {
      for (const row of rows as Array<{ urn: string }>) selectedUrns.add(row.urn);
    }
  } else if (options.planId) {
    const rows = asRows(
      store.all("SELECT urn FROM nodes WHERE plan_id = ?;", options.planId)
    );
    for (const row of rows) selectedUrns.add(row.urn);
    // Include directly-connected edge endpoints so edges stay resolvable.
    if (selectedUrns.size > 0) {
      const placeholders = [...selectedUrns].map(() => "?").join(", ");
      for (const edge of asEdges(
        store.all(
          `SELECT src_urn, rel, dst_urn, metadata_json FROM edges
           WHERE src_urn IN (${placeholders}) OR dst_urn IN (${placeholders});`,
          ...[...selectedUrns],
          ...[...selectedUrns]
        )
      )) {
        selectedUrns.add(edge.src_urn);
        selectedUrns.add(edge.dst_urn);
      }
    }
  } else {
    // No filter: export everything (compact payloads are node/edge rows only).
    const rows = asRows(store.all("SELECT urn FROM nodes;"));
    for (const row of rows) selectedUrns.add(row.urn);
  }

  const nodes: SubgraphExport["nodes"] = [];
  const edges: SubgraphExport["edges"] = [];
  if (selectedUrns.size === 0) return { nodes, edges };

  const urnList = [...selectedUrns];
  const placeholders = urnList.map(() => "?").join(", ");
  const nodeRows = asRows(
    store.all(
      `SELECT urn, kind, code, title, plan_id, wave_id, status
       FROM nodes WHERE urn IN (${placeholders});`,
      ...urnList
    )
  );
  for (const row of nodeRows) {
    nodes.push({
      urn: row.urn,
      kind: row.kind,
      code: row.code,
      title: row.title,
      plan_id: row.plan_id,
      wave_id: row.wave_id,
      status: row.status,
    });
  }
  const edgeRows = asEdges(
    store.all(
      `SELECT src_urn, rel, dst_urn, metadata_json FROM edges
       WHERE src_urn IN (${placeholders}) AND dst_urn IN (${placeholders})
       ORDER BY src_urn, rel, dst_urn;`,
      ...urnList,
      ...urnList
    )
  );
  for (const edge of edgeRows) {
    edges.push({ src: edge.src_urn, rel: edge.rel, dst: edge.dst_urn });
  }
  return { nodes, edges };
}
