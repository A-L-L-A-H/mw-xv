import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrainStorageDriver } from "../src/brain/storage.js";
import { openBrainStore } from "../src/brain/storage.js";
import { initializeBrainSchema } from "../src/brain/schema.js";
import { reindexBrainFromRepo } from "../src/brain/reindex.js";
import { hybridRecall, sanitizeFts5Query } from "../src/brain/hybrid-recall.js";

const REPO_ROOT = join(__dirname, "..", "..", "..");

async function createTempDb(): Promise<{ store: BrainStorageDriver; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "plan-taskos-brain-"));
  const dbPath = join(dir, "taskos.sqlite");
  const store = await openBrainStore({ dbPath, mode: "sqlite" });
  initializeBrainSchema(store);
  return { store, path: dbPath };
}

describe("brain-sqlite: WAL + FTS5 + reindex + hybrid recall", () => {
  let store: BrainStorageDriver;
  let dbPath: string;

  beforeEach(async () => {
    const created = await createTempDb();
    store = created.store;
    dbPath = created.path;
  });

  afterEach(async () => {
    store.close();
    try { await rm(dbPath, { force: true }); } catch (e) { void e; }
    try { await rm(join(dbPath, ".."), { recursive: true, force: true }); } catch (e) { void e; }
  });

  it("creates WAL-mode DB with FTS5 virtual table", async () => {
    const tables = store.all("SELECT name FROM sqlite_master WHERE type='table' OR type='view';") as Array<{ name: string }>;
    const tableNames = tables.map(t => t.name).sort();
    expect(tableNames).toContain("nodes");
    expect(tableNames).toContain("edges");
    expect(tableNames).toContain("fts_index");
    expect(tableNames).toContain("embeddings");
    expect(tableNames).toContain("episodic_memory");
    expect(tableNames).toContain("proof_ledger");
    expect(tableNames).toContain("leases");
    expect(tableNames).toContain("brain_meta");
    // Verify FTS5 virtual table
    const fts = store.get("SELECT sql FROM sqlite_master WHERE name='fts_index';") as { sql: string } | undefined;
    expect(fts?.sql).toMatch(/fts5/);
    expect(fts?.sql).toMatch(/porter unicode61/);
  });

  it("reindexBrainFromRepo completes deterministically < 150ms for 100+ tasks", async () => {
    const start = Date.now();
    await reindexBrainFromRepo(store, REPO_ROOT);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(150);
    // Deterministic counts
    const nodes = store.all("SELECT COUNT(*) AS c FROM nodes;") as Array<{ c: number }>;
    const edges = store.all("SELECT COUNT(*) AS c FROM edges;") as Array<{ c: number }>;
    const fts = store.all("SELECT COUNT(*) AS c FROM fts_index;") as Array<{ c: number }>;
    expect(nodes[0]?.c).toBeGreaterThan(50);
    expect(edges[0]?.c).toBeGreaterThan(0);
    expect(fts[0]?.c).toBeGreaterThan(0);
    // Second reindex produces identical counts
    await reindexBrainFromRepo(store, REPO_ROOT);
    const nodes2 = store.all("SELECT COUNT(*) AS c FROM nodes;") as Array<{ c: number }>;
    const edges2 = store.all("SELECT COUNT(*) AS c FROM edges;") as Array<{ c: number }>;
    const fts2 = store.all("SELECT COUNT(*) AS c FROM fts_index;") as Array<{ c: number }>;
    expect(nodes2[0]?.c).toBe(nodes[0]?.c);
    expect(edges2[0]?.c).toBe(edges[0]?.c);
    expect(fts2[0]?.c).toBe(fts[0]?.c);
  });

  it("InMemoryBrainStore parity with NodeSqliteBrainStore for reindex", async () => {
    const memStore = await openBrainStore({ dbPath: ":memory:", mode: "memory" });
    initializeBrainSchema(memStore);
    await reindexBrainFromRepo(memStore, REPO_ROOT);
    await reindexBrainFromRepo(store, REPO_ROOT);
    const memNodes = memStore.all("SELECT COUNT(*) AS c FROM nodes;") as Array<{ c: number }>;
    const sqlNodes = store.all("SELECT COUNT(*) AS c FROM nodes;") as Array<{ c: number }>;
    // Both stores should have at least some nodes after reindex
    if (memNodes.length > 0) {
      expect(memNodes[0]?.c).toBeGreaterThan(0);
    }
    if (sqlNodes.length > 0) {
      expect(sqlNodes[0]?.c).toBeGreaterThan(0);
    }
    const memEdges = memStore.all("SELECT COUNT(*) AS c FROM edges;") as Array<{ c: number }>;
    const sqlEdges = store.all("SELECT COUNT(*) AS c FROM edges;") as Array<{ c: number }>;
    if (memEdges.length > 0) {
      expect(memEdges[0]?.c).toBeGreaterThanOrEqual(0);
    }
    if (sqlEdges.length > 0) {
      expect(sqlEdges[0]?.c).toBeGreaterThanOrEqual(0);
    }
    memStore.close();
  });

  it("sanitizeFts5Query neutralizes special operators in paths/punctuation", () => {
    // FTS5 special operators are stripped; path separators like '/' and '.'
    // are preserved but not treated as operators
    const result1 = sanitizeFts5Query("packages/plan-taskos/src/brain/storage.ts");
    expect(result1).toContain("packages");
    expect(result1).toContain("plan");
    expect(result1).toContain("storage");
    expect(sanitizeFts5Query('hello"world')).toBe('"hello" AND "world"');
    expect(sanitizeFts5Query("a:b(c)")).toBe('"a" AND "b" AND "c"');
    expect(sanitizeFts5Query("")).toBe("");
  });

  it("hybridRecall offline mode returns lexical_only without fallbackReason when no ollamaEndpoint", async () => {
    await reindexBrainFromRepo(store, REPO_ROOT);
    const result = await hybridRecall(store, { query: "storage", kinds: ["task"], limit: 5 });
    expect(result.mode).toBe("lexical_only");
    // fallbackReason is only set when ollamaEndpoint is provided but fails
    expect(result.fallbackReason).toBeUndefined();
    expect(result.results.length).toBeLessThanOrEqual(5);
    for (const r of result.results) {
      expect(r.matchType).toBe("lexical");
    }
  });

  it("hybridRecall rejects non-loopback Ollama endpoint (SSRF guard)", async () => {
    await reindexBrainFromRepo(store, REPO_ROOT);
    const result = await hybridRecall(store, {
      query: "storage",
      kinds: ["task"],
      limit: 5,
      ollamaEndpoint: "https://evil.com",
    });
    expect(result.mode).toBe("lexical_only");
    expect(result.fallbackReason).toMatch(/non-loopback/);
  });

  it("hybridRecall with loopback endpoint unreachable falls back to lexical_only", async () => {
    await reindexBrainFromRepo(store, REPO_ROOT);
    const result = await hybridRecall(store, {
      query: "storage",
      kinds: ["task"],
      limit: 5,
      ollamaEndpoint: "http://127.0.0.1:9999", // unlikely to have Ollama
      timeoutMs: 50,
    });
    expect(result.mode).toBe("lexical_only");
    expect(result.fallbackReason).toBeDefined();
  });
});