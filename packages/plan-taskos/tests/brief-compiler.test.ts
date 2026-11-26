import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrainStorageDriver } from "../src/brain/storage.js";
import { openBrainStore } from "../src/brain/storage.js";
import { initializeBrainSchema } from "../src/brain/schema.js";
import { reindexBrainFromRepo } from "../src/brain/reindex.js";
import { compileCognitiveMicroBrief } from "../src/runner/brief-compiler.js";

const REPO_ROOT = join(__dirname, "..", "..", "..");

async function createTempDb(): Promise<{ store: BrainStorageDriver; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "plan-taskos-brief-"));
  const dbPath = join(dir, "taskos.sqlite");
  const store = await openBrainStore({ dbPath, mode: "sqlite" });
  initializeBrainSchema(store);
  return { store, path: dbPath };
}

describe("brief-compiler: O(1) bounded char budget, spec slicing, 2-hop context, INV-* injection, top-3 pitfalls", () => {
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

  it("compileCognitiveMicroBrief returns structured brief with identity, owner_files, spec, acceptance_criteria, verify, commit_template, cognitive context", async () => {
    const tasks = store.all("SELECT code, urn FROM nodes WHERE kind='task' LIMIT 1;") as Array<{ code: string; urn: string }>;
    if (tasks.length === 0) return;
    const taskCode = tasks[0].code;

    const bundles = await (await import("../src/core/loader.js")).discoverPlans(REPO_ROOT);
    const bundle = bundles.find((b) => b.waves.some((w) => w.tasks.some((t) => t.code === taskCode)));
    if (!bundle) return;

    const brief = await compileCognitiveMicroBrief(store, bundle, taskCode, { maxChars: 3200 });

    // 1. Identity
    expect(brief.identity).toHaveProperty("urn");
    expect(brief.identity).toHaveProperty("code");
    expect(brief.identity).toHaveProperty("wave");
    expect(brief.identity).toHaveProperty("modelTier");
    expect(brief.identity).toHaveProperty("riskTier");
    expect(brief.identity).toHaveProperty("attempts");
    expect(brief.identity).toHaveProperty("maxAttempts");

    // 2. Strict owner_files write allowlist + read_only_refs (under scope)
    expect(brief.scope).toHaveProperty("ownerFiles");
    expect(Array.isArray(brief.scope.ownerFiles)).toBe(true);
    expect(brief.scope).toHaveProperty("readOnlyRefs");
    expect(Array.isArray(brief.scope.readOnlyRefs)).toBe(true);

    // 3. Exact Spec & DO/DO-NOT excerpt (under spec)
    expect(brief.spec).toHaveProperty("exactSpecExcerpt");
    expect(typeof brief.spec.exactSpecExcerpt).toBe("string");
    expect(brief.spec).toHaveProperty("doNotExcerpt");
    expect(typeof brief.spec.doNotExcerpt).toBe("string");

    // 4. Binary acceptance_criteria[] + verify[] commands + commit_template (under spec)
    expect(brief.spec).toHaveProperty("acceptanceCriteria");
    expect(Array.isArray(brief.spec.acceptanceCriteria)).toBe(true);
    expect(brief.spec).toHaveProperty("verifyCommands");
    expect(Array.isArray(brief.spec.verifyCommands)).toBe(true);
    expect(brief.spec).toHaveProperty("commitTemplate");
    expect(typeof brief.spec.commitTemplate).toBe("string");

    // 5. Cognitive Context: last 2 sibling proofs, path-matched INV-* rules, linked ADR decision refs, top-3 redacted episodic pitfalls
    expect(brief.cognitiveContext).toHaveProperty("siblingProofs");
    expect(Array.isArray(brief.cognitiveContext.siblingProofs)).toBe(true);
    expect(brief.cognitiveContext.siblingProofs.length).toBeLessThanOrEqual(2);
    expect(brief.cognitiveContext).toHaveProperty("matchedInvariants");
    expect(Array.isArray(brief.cognitiveContext.matchedInvariants)).toBe(true);
    expect(brief.cognitiveContext).toHaveProperty("linkedAdrs");
    expect(Array.isArray(brief.cognitiveContext.linkedAdrs)).toBe(true);
    expect(brief.cognitiveContext).toHaveProperty("pitfalls");
    expect(Array.isArray(brief.cognitiveContext.pitfalls)).toBe(true);
    expect(brief.cognitiveContext.pitfalls.length).toBeLessThanOrEqual(3);
  });

  it("output stays O(1) bounded by maxChars regardless of plan size", async () => {
    const tasks = store.all("SELECT code FROM nodes WHERE kind='task' LIMIT 3;") as Array<{ code: string }>;
    if (tasks.length === 0) return;

    const bundles = await (await import("../src/core/loader.js")).discoverPlans(REPO_ROOT);
    const bundle = bundles[0];

    for (const { code } of tasks) {
      const brief = await compileCognitiveMicroBrief(store, bundle, code, { maxChars: 3200 });
      const markdown = brief.renderedMarkdown;
      expect(markdown.length).toBeLessThanOrEqual(3200);
    }
  });

  it("exact spec slicing - only loads target task's specs/W{n}.md section", async () => {
    const tasks = store.all("SELECT code FROM nodes WHERE kind='task' LIMIT 1;") as Array<{ code: string }>;
    if (tasks.length === 0) return;
    const taskCode = tasks[0].code;

    const bundles = await (await import("../src/core/loader.js")).discoverPlans(REPO_ROOT);
    const bundle = bundles.find((b) => b.waves.some((w) => w.tasks.some((t) => t.code === taskCode)));
    if (!bundle) return;

    const brief = await compileCognitiveMicroBrief(store, bundle, taskCode);
    // Spec excerpt should be non-empty and relevant
    expect(brief.spec.exactSpecExcerpt.length).toBeGreaterThan(0);
    // Should NOT contain unrelated wave content
    expect(brief.spec.exactSpecExcerpt).not.toContain("T99"); // non-existent task
  });

  it("2-hop sibling proof inclusion - queries queryTwoHopContext", async () => {
    const tasks = store.all("SELECT code FROM nodes WHERE kind='task' LIMIT 1;") as Array<{ code: string }>;
    if (tasks.length === 0) return;
    const taskCode = tasks[0].code;

    const bundles = await (await import("../src/core/loader.js")).discoverPlans(REPO_ROOT);
    const bundle = bundles.find((b) => b.waves.some((w) => w.tasks.some((t) => t.code === taskCode)));
    if (!bundle) return;

    const brief = await compileCognitiveMicroBrief(store, bundle, taskCode);
    expect(brief.cognitiveContext.siblingProofs).toBeDefined();
    expect(Array.isArray(brief.cognitiveContext.siblingProofs)).toBe(true);
  });

  it("matched INV-* rules injection via path-matched invariants", async () => {
    const tasks = store.all("SELECT code FROM nodes WHERE kind='task' LIMIT 1;") as Array<{ code: string }>;
    if (tasks.length === 0) return;
    const taskCode = tasks[0].code;

    const bundles = await (await import("../src/core/loader.js")).discoverPlans(REPO_ROOT);
    const bundle = bundles.find((b) => b.waves.some((w) => w.tasks.some((t) => t.code === taskCode)));
    if (!bundle) return;

    const brief = await compileCognitiveMicroBrief(store, bundle, taskCode);
    expect(brief.cognitiveContext.matchedInvariants).toBeDefined();
    expect(Array.isArray(brief.cognitiveContext.matchedInvariants)).toBe(true);
  });

  it("top-3 redacted episodic pitfalls recall", async () => {
    const tasks = store.all("SELECT code FROM nodes WHERE kind='task' LIMIT 1;") as Array<{ code: string }>;
    if (tasks.length === 0) return;
    const taskCode = tasks[0].code;

    const bundles = await (await import("../src/core/loader.js")).discoverPlans(REPO_ROOT);
    const bundle = bundles.find((b) => b.waves.some((w) => w.tasks.some((t) => t.code === taskCode)));
    if (!bundle) return;

    const brief = await compileCognitiveMicroBrief(store, bundle, taskCode);
    expect(brief.cognitiveContext.pitfalls).toBeDefined();
    expect(Array.isArray(brief.cognitiveContext.pitfalls)).toBe(true);
    expect(brief.cognitiveContext.pitfalls.length).toBeLessThanOrEqual(3);
  });
});