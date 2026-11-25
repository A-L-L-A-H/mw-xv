import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrainStorageDriver } from "../src/brain/storage.js";
import { openBrainStore } from "../src/brain/storage.js";
import { initializeBrainSchema } from "../src/brain/schema.js";
import {
  claimTaskLease,
  renewTaskLease,
  releaseTaskLease,
  listActiveLeases,
  reapExpiredLeases,
} from "../src/runner/lease-manager.js";

async function createTempDb(): Promise<{ store: BrainStorageDriver; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "plan-taskos-lease-"));
  const dbPath = join(dir, "taskos.sqlite");
  const store = await openBrainStore({ dbPath, mode: "sqlite" });
  initializeBrainSchema(store);
  return { store, path: dbPath };
}

describe("lease-lock: atomic LEASE_CONFLICT, renew, release, TTL expiry reaping", () => {
  let store: BrainStorageDriver;
  let dbPath: string;
  const taskUrn = "urn:mw:work:test-plan:T01";
  const nowIso = new Date().toISOString();

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

  it("claimTaskLease succeeds for first claimant", async () => {
    const result = await claimTaskLease(store, {
      taskUrn,
      agentRuntime: "claude-code",
      sessionId: "session-1",
      modelTier: "flash",
      ttlSec: 900,
      nowIso,
    });
    expect(result.ok).toBe(true);
    expect(result.lease).toBeDefined();
    expect(result.lease?.task_urn).toBe(taskUrn);
    expect(result.lease?.session_id).toBe("session-1");
  });

  it("concurrent claim returns LEASE_CONFLICT for second claimant", async () => {
    // First claim
    await claimTaskLease(store, {
      taskUrn,
      agentRuntime: "claude-code",
      sessionId: "session-1",
      modelTier: "flash",
      ttlSec: 900,
      nowIso,
    });

    // Second claim should conflict
    const result = await claimTaskLease(store, {
      taskUrn,
      agentRuntime: "claude-code",
      sessionId: "session-2",
      modelTier: "flash",
      ttlSec: 900,
      nowIso,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("LEASE_CONFLICT");
  });

  it("same sessionId can renew lease", async () => {
    await claimTaskLease(store, {
      taskUrn,
      agentRuntime: "claude-code",
      sessionId: "session-1",
      modelTier: "flash",
      ttlSec: 900,
      nowIso,
    });

    const renewResult = await renewTaskLease(store, taskUrn, "session-1", 1800, nowIso);
    expect(renewResult.ok).toBe(true);
    expect(renewResult.lease).toBeDefined();
  });

  it("different sessionId cannot renew lease", async () => {
    await claimTaskLease(store, {
      taskUrn,
      agentRuntime: "claude-code",
      sessionId: "session-1",
      modelTier: "flash",
      ttlSec: 900,
      nowIso,
    });

    const renewResult = await renewTaskLease(store, taskUrn, "session-2", 1800, nowIso);
    expect(renewResult.ok).toBe(false);
    expect(renewResult.error).toBe("LEASE_NOT_FOUND");
  });

  it("releaseTaskLease works for owner session", async () => {
    await claimTaskLease(store, {
      taskUrn,
      agentRuntime: "claude-code",
      sessionId: "session-1",
      modelTier: "flash",
      ttlSec: 900,
      nowIso,
    });

    const releaseResult = await releaseTaskLease(store, taskUrn, "session-1");
    expect(releaseResult.ok).toBe(true);

    // After release, new session can claim
    const newClaim = await claimTaskLease(store, {
      taskUrn,
      agentRuntime: "claude-code",
      sessionId: "session-2",
      modelTier: "flash",
      ttlSec: 900,
      nowIso,
    });
    expect(newClaim.ok).toBe(true);
  });

  it("releaseTaskLease fails for non-owner session", async () => {
    await claimTaskLease(store, {
      taskUrn,
      agentRuntime: "claude-code",
      sessionId: "session-1",
      modelTier: "flash",
      ttlSec: 900,
      nowIso,
    });

    const releaseResult = await releaseTaskLease(store, taskUrn, "session-2");
    expect(releaseResult.ok).toBe(false);
    expect(releaseResult.error).toBe("LEASE_NOT_FOUND");
  });

  it("listActiveLeases returns active leases", async () => {
    await claimTaskLease(store, {
      taskUrn,
      agentRuntime: "claude-code",
      sessionId: "session-1",
      modelTier: "flash",
      ttlSec: 900,
      nowIso,
    });

    const leases = await listActiveLeases(store);
    expect(leases.length).toBeGreaterThanOrEqual(1);
    expect(leases.some((l) => l.taskUrn === taskUrn && l.sessionId === "session-1")).toBe(true);
  });

  it("reapExpiredLeases removes expired leases", async () => {
    const pastIso = new Date(Date.now() - 10000).toISOString(); // 10 seconds ago

    // Create an expired lease
    store.transactionImmediate((tx) => {
      tx.run(
        `INSERT INTO leases (task_urn, agent_runtime, session_id, model_tier, expires_at, acquired_at, renewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        taskUrn,
        "claude-code",
        "session-expired",
        "flash",
        pastIso,
        pastIso,
        pastIso
      );
    });

    // Reap expired leases
    const reaped = await reapExpiredLeases(store, nowIso);
    expect(reaped).toBeGreaterThanOrEqual(1);

    // Verify lease is gone
    const leases = await listActiveLeases(store);
    expect(leases.some((l) => l.sessionId === "session-expired")).toBe(false);
  });

  it("expired leases are reaped deterministically on new claim", async () => {
    const pastIso = new Date(Date.now() - 10000).toISOString();

    // Create an expired lease
    store.transactionImmediate((tx) => {
      tx.run(
        `INSERT INTO leases (task_urn, agent_runtime, session_id, model_tier, expires_at, acquired_at, renewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        taskUrn,
        "claude-code",
        "session-expired",
        "flash",
        pastIso,
        pastIso,
        pastIso
      );
    });

    // New claim should reap expired and succeed
    const result = await claimTaskLease(store, {
      taskUrn,
      agentRuntime: "claude-code",
      sessionId: "session-new",
      modelTier: "flash",
      ttlSec: 900,
      nowIso,
    });
    expect(result.ok).toBe(true);

    const leases = await listActiveLeases(store);
    expect(leases.some((l) => l.sessionId === "session-expired")).toBe(false);
    expect(leases.some((l) => l.sessionId === "session-new")).toBe(true);
  });
});