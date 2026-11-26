/**
 * T20 — Atomic Multi-Agent TTL Lease Manager.
 *
 * Uses SQLite `BEGIN IMMEDIATE` transactions for lock-free concurrent lease claims.
 * Reaps expired leases, mirrors active leases to `.plan/<plan-id>/.leases.local.json`.
 */

import type { BrainStorageDriver } from "../brain/storage.js";
import { join } from "node:path";import { writeFile, mkdir } from "node:fs/promises";

export interface LeaseClaimInput {
  readonly taskUrn: string;
  readonly agentRuntime: string;
  readonly sessionId: string;
  readonly modelTier?: string;
  readonly ttlSec?: number;
  readonly nowIso?: string;
}

export interface LeaseClaimResult {
  readonly ok: boolean;
  readonly lease?: LeaseRecord;
  readonly error?: "LEASE_CONFLICT" | "TASK_NOT_FOUND";
  readonly existingLease?: LeaseRecord;
}

export interface LeaseRecord {
  readonly task_urn: string;
  readonly agent_runtime: string;
  readonly session_id: string;
  readonly model_tier: string;
  readonly acquired_at: string;
  readonly expires_at: string;
  readonly renewed_at: string;
}

export interface LeaseRenewResult {
  readonly ok: boolean;
  readonly lease?: LeaseRecord;
  readonly error?: "LEASE_NOT_FOUND" | "SESSION_MISMATCH";
}

export interface LeaseReleaseResult {
  readonly ok: boolean;
  readonly error?: "LEASE_NOT_FOUND" | "SESSION_MISMATCH";
}

export interface ActiveLease {
  readonly taskUrn: string;
  readonly agentRuntime: string;
  readonly sessionId: string;
  readonly modelTier: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly renewedAt: string;
}

/**
 * Claim a task lease atomically using BEGIN IMMEDIATE transaction.
 * Reaps expired leases first. Returns LEASE_CONFLICT if another session holds an active lease.
 */
export async function claimTaskLease(
  store: BrainStorageDriver,
  input: LeaseClaimInput
): Promise<LeaseClaimResult> {
  const ttlSec = input.ttlSec ?? 900;
  const nowIso = input.nowIso ?? new Date().toISOString();
  const nowSec = Math.floor(new Date(nowIso).getTime() / 1000);
  const expiresSec = nowSec + ttlSec;
  const expiresIso = new Date(expiresSec * 1000).toISOString();

  const result = store.transactionImmediate((tx) => {
    // Reap expired leases first
    tx.run(`DELETE FROM leases WHERE expires_at <= ?;`, nowIso);

    // Check for existing active lease (unreleased)
    const existing = tx.get(
      `SELECT task_urn, agent_runtime, session_id, model_tier, acquired_at, expires_at, renewed_at
       FROM leases WHERE task_urn = ? AND expires_at > ? AND released = 0;`,
      input.taskUrn,
      nowIso
    ) as LeaseRecord | undefined;

    if (existing) {
      if (existing.session_id === input.sessionId) {
        // Same session - renew instead
        tx.run(
          `UPDATE leases SET expires_at = ?, renewed_at = ?, model_tier = ? WHERE task_urn = ? AND session_id = ?;`,
          expiresIso,
          nowIso,
          input.modelTier ?? existing.model_tier,
          input.taskUrn,
          input.sessionId
        );
        return { ok: true, lease: { ...existing, expires_at: expiresIso, renewed_at: nowIso, model_tier: input.modelTier ?? existing.model_tier } };
      }
      // Different session holds lease
      return { ok: false, error: "LEASE_CONFLICT" as const, existingLease: existing };
    }

    // Insert new lease
    tx.run(
      `INSERT INTO leases (task_urn, agent_runtime, session_id, model_tier, acquired_at, expires_at, renewed_at, released)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0);`,
      input.taskUrn,
      input.agentRuntime,
      input.sessionId,
      input.modelTier ?? "flash",
      nowIso,
      expiresIso,
      nowIso
    );

    return {
      ok: true,
      lease: {
        task_urn: input.taskUrn,
        agent_runtime: input.agentRuntime,
        session_id: input.sessionId,
        model_tier: input.modelTier ?? "flash",
        acquired_at: nowIso,
        expires_at: expiresIso,
        renewed_at: nowIso,
      },
    };
  });

  if (result.ok && result.lease) {
    await mirrorLeasesLocal(store, input.taskUrn.split(":")[4]?.split("/")[0] ?? "default");
  }

  return result;
}

/**
 * Renew an existing lease for the same session.
 */
export async function renewTaskLease(
  store: BrainStorageDriver,
  taskUrn: string,
  sessionId: string,
  ttlSec = 900,
  nowIso?: string
): Promise<LeaseRenewResult> {
  const now = nowIso ?? new Date().toISOString();
  const nowSec = Math.floor(new Date(now).getTime() / 1000);
  const expiresSec = nowSec + ttlSec;
  const expiresIso = new Date(expiresSec * 1000).toISOString();

  const result = store.transactionImmediate((tx) => {
    const existing = tx.get(
      `SELECT task_urn, agent_runtime, session_id, model_tier, acquired_at, expires_at, renewed_at
       FROM leases WHERE task_urn = ? AND session_id = ? AND expires_at > ? AND released = 0;`,
      taskUrn,
      sessionId,
      now
    ) as LeaseRecord | undefined;

    if (!existing) {
      return { ok: false, error: "LEASE_NOT_FOUND" as const };
    }

    tx.run(
      `UPDATE leases SET expires_at = ?, renewed_at = ? WHERE task_urn = ? AND session_id = ?;`,
      expiresIso,
      now,
      taskUrn,
      sessionId
    );

    return {
      ok: true,
      lease: { ...existing, expires_at: expiresIso, renewed_at: now },
    };
  });

  if (result.ok && result.lease) {
    await mirrorLeasesLocal(store, taskUrn.split(":")[4]?.split("/")[0] ?? "default");
  }

  return result;
}

/**
 * Release a lease held by the given session.
 */
export async function releaseTaskLease(
  store: BrainStorageDriver,
  taskUrn: string,
  sessionId: string
): Promise<LeaseReleaseResult> {
  const result = store.transactionImmediate((tx) => {
    const existing = tx.get(
      `SELECT 1 FROM leases WHERE task_urn = ? AND session_id = ? AND released = 0;`,
      taskUrn,
      sessionId
    );

    if (!existing) {
      return { ok: false, error: "LEASE_NOT_FOUND" as const };
    }

    tx.run(
      `UPDATE leases SET released = 1 WHERE task_urn = ? AND session_id = ?;`,
      taskUrn,
      sessionId
    );

    return { ok: true };
  });

  if (result.ok) {
    await mirrorLeasesLocal(store, taskUrn.split(":")[4]?.split("/")[0] ?? "default");
  }

  return result;
}

/**
 * List all active (unexpired, unreleased) leases.
 */
export async function listActiveLeases(store: BrainStorageDriver): Promise<ActiveLease[]> {
  const nowIso = new Date().toISOString();
  const rows = store.all(
    `SELECT task_urn, agent_runtime, session_id, model_tier, acquired_at, expires_at, renewed_at
     FROM leases WHERE expires_at > ? AND released = 0 ORDER BY acquired_at;`,
    nowIso
  ) as LeaseRecord[];

  return rows.map((r) => ({
    taskUrn: r.task_urn,
    agentRuntime: r.agent_runtime,
    sessionId: r.session_id,
    modelTier: r.model_tier,
    acquiredAt: r.acquired_at,
    expiresAt: r.expires_at,
    renewedAt: r.renewed_at,
  }));
}

/**
 * Reap expired leases deterministically.
 */
export async function reapExpiredLeases(store: BrainStorageDriver, nowIso?: string): Promise<number> {
  const now = nowIso ?? new Date().toISOString();
  let count = 0;

  store.transactionImmediate((tx) => {
    const result = tx.run(`DELETE FROM leases WHERE expires_at <= ?;`, now);
    count = (result as { changes: number }).changes ?? 0;
  });

  return count;
}

/**
 * Mirror active leases to gitignored .leases.local.json for lightweight readers.
 */
async function mirrorLeasesLocal(store: BrainStorageDriver, planId: string): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    const rows = store.all(
      `SELECT task_urn, agent_runtime, session_id, model_tier, acquired_at, expires_at, renewed_at
       FROM leases WHERE expires_at > ? AND released = 0;`,
      nowIso
    ) as LeaseRecord[];

    const leasesLocal = rows.map((r) => ({
      taskUrn: r.task_urn,
      agentRuntime: r.agent_runtime,
      sessionId: r.session_id,
      modelTier: r.model_tier,
      acquiredAt: r.acquired_at,
      expiresAt: r.expires_at,
      renewedAt: r.renewed_at,
    }));

    const localPath = join(process.cwd(), ".plan", planId, ".leases.local.json");
    await mkdir(join(localPath, ".."), { recursive: true });
    await writeFile(localPath, JSON.stringify({ leases: leasesLocal, updatedAt: nowIso }, null, 2), "utf8");
  } catch {
    // Non-fatal: mirroring is best-effort
  }
}

