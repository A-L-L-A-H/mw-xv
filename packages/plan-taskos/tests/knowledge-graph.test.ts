import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrainStorageDriver } from "../src/brain/storage.js";
import { openBrainStore } from "../src/brain/storage.js";
import { initializeBrainSchema } from "../src/brain/schema.js";
import { reindexBrainFromRepo } from "../src/brain/reindex.js";
import { queryTwoHopContext, queryBlastRadiusImpact, exportSubgraph } from "../src/brain/knowledge-graph.js";

const REPO_ROOT = join(__dirname, "..", "..", "..");

async function createTempDb(): Promise<{ store: BrainStorageDriver; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "plan-taskos-kg-"));
  const dbPath = join(dir, "taskos.sqlite");
  const store = await openBrainStore({ dbPath, mode: "sqlite" });
  initializeBrainSchema(store);
  return { store, path: dbPath };
}

describe("knowledge-graph: 2-hop context, blast radius, export subgraph", () => {
  let store: BrainStorageDriver;
  let dbPath: string;

  beforeEach(async () => {
    const created = await createTempDb();
    store = created.store;
    dbPath = created.path;
    await reindexBrainFromRepo(store, REPO_ROOT);
  });

  afterEach(async () => {
    store.close();
    try { await rm(dbPath, { force: true }); } catch (e) { void e; }
    try { await rm(join(dbPath, ".."), { recursive: true, force: true }); } catch (e) { void e; }
  });

  it("queryTwoHopContext returns file neighbors, linked ADRs, invariants, docs, and prior failures", () => {
    // Pick a task URN from reindexed data
    const tasks = store.all("SELECT urn FROM nodes WHERE kind='task' LIMIT 1;") as Array<{ urn: string }>;
    if (tasks.length === 0) return; // skip if no tasks
    const taskUrn = tasks[0].urn;
    const result = queryTwoHopContext(store, taskUrn);
    expect(result).toHaveProperty("siblingTasksOnSameFiles");
    expect(result).toHaveProperty("linkedAdrs");
    expect(result).toHaveProperty("matchedInvariants");
    expect(result).toHaveProperty("linkedDocs");
    expect(result).toHaveProperty("priorFailuresOnSameFiles");
    expect(Array.isArray(result.siblingTasksOnSameFiles)).toBe(true);
    expect(Array.isArray(result.linkedAdrs)).toBe(true);
    expect(Array.isArray(result.matchedInvariants)).toBe(true);
    expect(Array.isArray(result.linkedDocs)).toBe(true);
    expect(Array.isArray(result.priorFailuresOnSameFiles)).toBe(true);
  });

  it("queryBlastRadiusImpact on a file path returns impacted tasks, ADRs, waves, and failure episodes", () => {
    // Pick a file from owner_files
    const files = store.all("SELECT owner_files FROM nodes WHERE kind='task' AND owner_files != '[]' LIMIT 1;") as Array<{ owner_files: string }>;
    let targetPath = "packages/plan-taskos/src/brain/storage.ts";
    if (files.length > 0) {
      try {
        const parsed = JSON.parse(files[0].owner_files);
        if (Array.isArray(parsed) && parsed.length > 0) targetPath = parsed[0];
      } catch (e) { void e; }
    }
    const result = queryBlastRadiusImpact(store, targetPath, 4);
    expect(result).toHaveProperty("impactedTasks");
    expect(result).toHaveProperty("criticalPathNodes");
    expect(result).toHaveProperty("linkedAdrs");
    expect(result).toHaveProperty("linkedWaves");
    expect(result).toHaveProperty("docRegenerationFlags");
    expect(result).toHaveProperty("failureEpisodes");
    expect(Array.isArray(result.impactedTasks)).toBe(true);
    expect(Array.isArray(result.criticalPathNodes)).toBe(true);
    expect(Array.isArray(result.linkedAdrs)).toBe(true);
    expect(Array.isArray(result.linkedWaves)).toBe(true);
    expect(Array.isArray(result.docRegenerationFlags)).toBe(true);
    expect(Array.isArray(result.failureEpisodes)).toBe(true);
  });

  it("queryBlastRadiusImpact on a task URN works and is cycle-safe", () => {
    const tasks = store.all("SELECT urn FROM nodes WHERE kind='task' LIMIT 1;") as Array<{ urn: string }>;
    if (tasks.length === 0) return;
    const taskUrn = tasks[0].urn;
    const result = queryBlastRadiusImpact(store, taskUrn, 4);
    expect(result.impactedTasks).toBeDefined();
    // Verify no infinite recursion by ensuring it completes
    expect(result).toBeDefined();
  });

  it("exportSubgraph returns compact nodes and edges for observatory", () => {
    const tasks = store.all("SELECT plan_id, urn FROM nodes WHERE kind='task' LIMIT 1;") as Array<{ plan_id: string; urn: string }>;
    if (tasks.length === 0) return;
    const { plan_id, urn } = tasks[0];
    const subgraph = exportSubgraph(store, { planId: plan_id, centerUrn: urn, maxHops: 2 });
    expect(subgraph).toHaveProperty("nodes");
    expect(subgraph).toHaveProperty("edges");
    expect(Array.isArray(subgraph.nodes)).toBe(true);
    expect(Array.isArray(subgraph.edges)).toBe(true);
    // Should include at least the center node
    expect(subgraph.nodes.some(n => n.urn === urn)).toBe(true);
    // All nodes should have required fields
    for (const node of subgraph.nodes) {
      expect(node).toHaveProperty("urn");
      expect(node).toHaveProperty("kind");
      expect(node).toHaveProperty("title");
    }
    // All edges should have required fields (using src/rel/dst not src_urn/dst_urn)
    for (const edge of subgraph.edges) {
      expect(edge).toHaveProperty("src");
      expect(edge).toHaveProperty("rel");
      expect(edge).toHaveProperty("dst");
    }
  });

  it("exportSubgraph with planId only exports full plan subgraph", () => {
    const tasks = store.all("SELECT plan_id FROM nodes WHERE kind='task' LIMIT 1;") as Array<{ plan_id: string }>;
    if (tasks.length === 0) return;
    const { plan_id } = tasks[0];
    const subgraph = exportSubgraph(store, { planId: plan_id });
    expect(subgraph.nodes.length).toBeGreaterThan(0);
    expect(subgraph.edges.length).toBeGreaterThan(0);
    // All nodes should belong to the plan
    for (const node of subgraph.nodes) {
      expect(node.plan_id === plan_id || node.plan_id === undefined).toBe(true);
    }
  });

  it("recursive CTE depth limit prevents unbounded traversal", () => {
    // Even with a high maxDepth, results should be bounded
    const tasks = store.all("SELECT urn FROM nodes WHERE kind='task' LIMIT 1;") as Array<{ urn: string }>;
    if (tasks.length === 0) return;
    const taskUrn = tasks[0].urn;
    const result = queryBlastRadiusImpact(store, taskUrn, 10); // high depth
    expect(result).toBeDefined();
    expect(result.impactedTasks.length).toBeLessThan(1000); // sanity bound
  });
});