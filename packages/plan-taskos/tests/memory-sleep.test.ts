import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrainStorageDriver } from "../src/brain/storage.js";
import { openBrainStore } from "../src/brain/storage.js";
import { initializeBrainSchema } from "../src/brain/schema.js";
import { reindexBrainFromRepo } from "../src/brain/reindex.js";
import { recordEpisode, recallPitfallsForPaths, runNonRemSleepConsolidation, PROTECTED_GATES } from "../src/brain/episodic-memory.js";

const REPO_ROOT = join(__dirname, "..", "..", "..");

async function createTempDb(): Promise<{ store: BrainStorageDriver; path: string; repoDir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "plan-taskos-mem-"));
  const dbPath = join(dir, "taskos.sqlite");
  const store = await openBrainStore({ dbPath, mode: "sqlite" });
  initializeBrainSchema(store);
  // Create .plan/memory dir
  await mkdir(join(dir, ".plan", "memory"), { recursive: true });
  return { store, path: dbPath, repoDir: dir };
}

describe("episodic-memory: redaction, persistence, decay, clustering, protected gates", () => {
  let store: BrainStorageDriver;
  let dbPath: string;
  let repoDir: string;
  let skipClose = false;

  beforeEach(async () => {
    const created = await createTempDb();
    store = created.store;
    dbPath = created.path;
    repoDir = created.repoDir;
    skipClose = false;
    await reindexBrainFromRepo(store, REPO_ROOT);
  });

  afterEach(async () => {
    if (!skipClose) {
      store.close();
    }
    try { await rm(dbPath, { force: true }); } catch (e) { void e; }
    try { await rm(repoDir, { recursive: true, force: true }); } catch (e) { void e; }
  });

  it("recordEpisode redacts secrets from summary before storage", async () => {
    const result = await recordEpisode(store, repoDir, {
      summary: "Failed with API_KEY=sk-live-1234567890abcdef and JWT_SECRET=supersecret",
      kind: "failure",
      owner_files: ["packages/plan-taskos/src/brain/storage.ts"],
      task_urn: "urn:mw:work:moonwitness/test:W1/T01",
    });
    expect(result.redacted).toBe(true);
    expect(result.summary_redacted).not.toContain("sk-live-1234567890abcdef");
    expect(result.summary_redacted).not.toContain("supersecret");
    expect(result.summary_redacted).toContain("[REDACTED]");
    // Verify stored in DB
    const row = store.get("SELECT summary_redacted FROM episodic_memory WHERE episode_id = ?;", result.episode_id) as { summary_redacted: string } | undefined;
    expect(row?.summary_redacted).toBe(result.summary_redacted);
  });

  it("recordEpisode appends deterministic line to episodes.jsonl (Git-portable)", async () => {
    const result = await recordEpisode(store, repoDir, {
      summary: "Test episode for persistence with sk-live-1234567890abcdef",
      kind: "failure",
      owner_files: ["packages/plan-taskos/src/brain/storage.ts"],
    });
    const episodesFile = join(repoDir, ".plan", "memory", "episodes.jsonl");
    const content = await import("node:fs/promises").then(m => m.readFile(episodesFile, "utf8"));
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.summary).toContain("[REDACTED]"); // redacted
    expect(parsed.provenance_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("recallPitfallsForPaths ranks by path overlap, importance, and recency", async () => {
    // Record multiple episodes
    await recordEpisode(store, repoDir, {
      summary: "Old pitfall on storage.ts",
      kind: "pitfall",
      owner_files: ["packages/plan-taskos/src/brain/storage.ts"],
      importance_bps: 3000,
    });
    await recordEpisode(store, repoDir, {
      summary: "Important pitfall on storage.ts",
      kind: "pitfall",
      owner_files: ["packages/plan-taskos/src/brain/storage.ts"],
      importance_bps: 9000,
    });
    await recordEpisode(store, repoDir, {
      summary: "Unrelated pitfall on other.ts",
      kind: "pitfall",
      owner_files: ["packages/plan-taskos/src/core/urn.ts"],
      importance_bps: 9000,
    });

    const results = recallPitfallsForPaths(store, ["packages/plan-taskos/src/brain/storage.ts"], 3);
    expect(results.length).toBeGreaterThan(0);
    // Storage.ts episodes should rank higher than unrelated
    expect(results[0].owner_files).toContain("packages/plan-taskos/src/brain/storage.ts");
  });

  it("recallPitfallsForPaths bumps access_count and last_accessed_at", async () => {
    const res = await recordEpisode(store, repoDir, {
      summary: "Access counter test",
      kind: "pitfall",
      owner_files: ["packages/plan-taskos/src/brain/storage.ts"],
    });
    const before = store.get("SELECT access_count FROM episodic_memory WHERE episode_id = ?;", res.episode_id) as { access_count: number } | undefined;
    expect(before?.access_count).toBe(0);
    recallPitfallsForPaths(store, ["packages/plan-taskos/src/brain/storage.ts"], 1);
    const after = store.get("SELECT access_count FROM episodic_memory WHERE episode_id = ?;", res.episode_id) as { access_count: number } | undefined;
    expect(after?.access_count).toBe(1);
  });

  it("runNonRemSleepConsolidation marks stale low-salience episodes as decayed (reversible)", async () => {
    // Manually insert an old low-importance episode
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    store.exec(`
      INSERT INTO episodic_memory
      (episode_id, kind, summary_redacted, failure_pattern, owner_files, task_urn, plan_id, importance_bps, access_count, status, reversible, provenance_sha256, recorded_at)
      VALUES ('test:old:low', 'failure', 'old low salience', 'pattern-old', '["a.ts"]', 'urn:test', 'test', 100, 0, 'active', 1, 'abc', '${oldDate}');
    `);

    const result = runNonRemSleepConsolidation(store, { decayOlderThanDays: 90, minSalienceBps: 1000 });
    expect(result.decayed.length).toBeGreaterThan(0);
    const decayed = result.decayed.find(d => d.episode_id === "test:old:low");
    expect(decayed).toBeDefined();
    const row = store.get("SELECT status, reversible FROM episodic_memory WHERE episode_id = ?;", "test:old:low") as { status: string; reversible: number } | undefined;
    expect(row?.status).toBe("decayed");
    expect(row?.reversible).toBe(1);
  });

  it("runNonRemSleepConsolidation clusters recurring failure patterns into candidates and proposals", async () => {
    // Insert multiple episodes with same failure pattern
    for (let i = 0; i < 3; i++) {
      await recordEpisode(store, repoDir, {
        summary: `Failure ${i} on storage.ts`,
        kind: "failure",
        failure_pattern: "recurring-failure-pattern",
        owner_files: ["packages/plan-taskos/src/brain/storage.ts"],
        importance_bps: 5000,
      });
    }

    const result = runNonRemSleepConsolidation(store, { clusterMinOccurrences: 2 });
    expect(result.candidates.length).toBeGreaterThan(0);
    const candidate = result.candidates.find(c => c.topic === "recurring-failure-pattern");
    expect(candidate).toBeDefined();
    expect(candidate?.occurrence_count).toBeGreaterThanOrEqual(2);
    expect(result.proposals.length).toBeGreaterThan(0);
    // At least one proposal should be generated
    expect(result.proposals.length).toBeGreaterThan(0);
  });

  it("constitutional guard rejects weakening proposals targeting protected gates", async () => {
    // Insert episodes targeting protected gates
    await recordEpisode(store, repoDir, {
      summary: "We should weaken R0 gate to allow bypass",
      kind: "failure",
      failure_pattern: "weaken R0 gate",
      owner_files: ["packages/plan-taskos/src/brain/storage.ts"],
    });

    const result = runNonRemSleepConsolidation(store, { clusterMinOccurrences: 1 });
    // Find proposal related to R0
    const r0Proposal = result.proposals.find(p => p.rule_text.includes("R0") || p.rule_text.includes("weaken"));
    if (r0Proposal) {
      expect(r0Proposal.rejected).toBe(true);
      expect(r0Proposal.rejection_reason).toMatch(/protected gate/);
    }
    // All proposals must have automated_promotion_allowed = false and automated_self_accept = false
    for (const p of result.proposals) {
      expect(p.automated_promotion_allowed).toBe(false);
      expect(p.automated_self_accept).toBe(false);
    }
  });

  it("protected gates list matches expected invariants", () => {
    expect(PROTECTED_GATES).toContain("R0");
    expect(PROTECTED_GATES).toContain("R1");
    expect(PROTECTED_GATES).toContain("R2");
    expect(PROTECTED_GATES).toContain("R3");
    expect(PROTECTED_GATES).toContain("R4");
    expect(PROTECTED_GATES).toContain("check-desktop-non-overlap");
    expect(PROTECTED_GATES).toContain("check-api-addon-boundary");
    expect(PROTECTED_GATES).toContain("check-board-shared-ui");
    expect(PROTECTED_GATES).toContain("ai-drift-watchdog");
  });

  it("episodes.jsonl persistence survives DB deletion (reindex restores)", async () => {
    const res = await recordEpisode(store, repoDir, {
      summary: "Persistence test episode",
      kind: "failure",
      owner_files: ["packages/plan-taskos/src/brain/storage.ts"],
    });
    // Close the original store before deleting DB
    store.close();
    // Delete DB file
    await rm(dbPath, { force: true });
    // Reopen store (fresh)
    const newStore = await openBrainStore({ dbPath, mode: "sqlite" });
    initializeBrainSchema(newStore);
    // Reindex using the temp repo dir which has the episodes.jsonl
    await reindexBrainFromRepo(newStore, repoDir);
    // Episode should be restored
    const restored = newStore.get("SELECT episode_id FROM episodic_memory WHERE episode_id = ?;", res.episode_id);
    expect(restored).toBeDefined();
    newStore.close();
    // Prevent afterEach from trying to close the already-closed original store
    skipClose = true;
  });
});