import { describe, expect, it } from 'vitest';
import {
  DesktopSyncEngine,
  computeCanonicalSha256,
  resolveSyncConflict,
  type SyncRecordVersion,
} from '../src/sync-engine.js';

describe('DesktopSyncEngine (Wave D.20)', () => {
  it('advances Lamport clock monotonically and computes deterministic SHA-256 digests', () => {
    const engine = new DesktopSyncEngine({ nodeId: 'desktop-alpha' });
    const first = engine.recordLocalMutation({
      entityType: 'project.task',
      entityId: 'task-1',
      operation: 'upsert',
      fields: { name: 'Ship Wave D.20', priority: 'high' },
      updatedAt: '2026-11-23T00:00:00.000Z',
    });
    const second = engine.recordLocalMutation({
      entityType: 'project.task',
      entityId: 'task-2',
      operation: 'delete',
      updatedAt: '2026-11-23T00:01:00.000Z',
    });

    expect(first.lamportClock).toBe(1);
    expect(second.lamportClock).toBe(2);
    expect(second.tombstone).toBe(true);
    expect(first.entrySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(engine.getStatus().pendingOutboxCount).toBe(2);
    expect(engine.getStatus().tombstoneCount).toBe(1);

    const hashA = computeCanonicalSha256({ b: 2, a: 1 });
    const hashB = computeCanonicalSha256({ a: 1, b: 2 });
    expect(hashA).toBe(hashB);
  });

  it('resolves conflicts deterministically across local_wins, remote_wins, and merged_fields', () => {
    const localHigh: SyncRecordVersion = {
      entityType: 'project.task',
      entityId: 'task-10',
      operation: 'upsert',
      lamportClock: 5,
      nodeId: 'desktop-a',
      updatedAt: '2026-11-23T01:00:00.000Z',
      fields: { name: 'Local Title' },
      tombstone: false,
    };
    const remoteLow: SyncRecordVersion = {
      entityType: 'project.task',
      entityId: 'task-10',
      operation: 'upsert',
      lamportClock: 3,
      nodeId: 'cloud-1',
      updatedAt: '2026-11-23T00:50:00.000Z',
      fields: { name: 'Remote Title' },
      tombstone: false,
    };
    expect(resolveSyncConflict(localHigh, remoteLow).resolution).toBe('local_wins');
    expect(resolveSyncConflict(remoteLow, localHigh).resolution).toBe('remote_wins');

    const localDisjoint: SyncRecordVersion = {
      ...localHigh,
      fields: { name: 'Local Title', stageId: 2 },
    };
    const remoteDisjoint: SyncRecordVersion = {
      ...remoteLow,
      fields: { name: 'Remote Title', description: 'Added remotely' },
    };
    const merged = resolveSyncConflict(localDisjoint, remoteDisjoint);
    expect(merged.resolution).toBe('merged_fields');
    expect(merged.resolvedFields).toEqual({
      name: 'Local Title',
      stageId: 2,
      description: 'Added remotely',
    });
    expect(merged.conflictingFields).toEqual(['name']);
  });

  it('builds a tamper-evident bidirectional sync plan with batchSha256 and respects tombstones', () => {
    const engine = new DesktopSyncEngine({ nodeId: 'desktop-beta' });
    const created = engine.recordLocalMutation({
      entityType: 'project.task',
      entityId: 'task-local',
      operation: 'upsert',
      fields: { name: 'Offline Task' },
    });
    const deleted = engine.recordLocalMutation({
      entityType: 'project.task',
      entityId: 'task-deleted',
      operation: 'delete',
    });
    expect(engine.acknowledgePushed([deleted.outboxId])).toBe(1);

    const plan = engine.planBidirectionalSync([
      {
        entityType: 'project.task',
        entityId: 'task-deleted',
        operation: 'upsert',
        lamportClock: 1, // older than local tombstone clock 2 -> ignored
        nodeId: 'cloud-1',
        updatedAt: '2026-11-23T00:00:00.000Z',
        fields: { name: 'Stale resurrect' },
        tombstone: false,
      },
      {
        entityType: 'project.task',
        entityId: 'task-remote',
        operation: 'upsert',
        lamportClock: 4,
        nodeId: 'cloud-1',
        updatedAt: '2026-11-23T00:05:00.000Z',
        fields: { name: 'New Remote Task' },
        tombstone: false,
      },
    ]);

    expect(plan.pushEntries.map((entry) => entry.outboxId)).toEqual([created.outboxId]);
    expect(plan.pullEntries.map((entry) => entry.entityId)).toEqual(['task-remote']);
    expect(plan.batchSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(engine.getStatus().lastBatchSha256).toBe(plan.batchSha256);
    expect(engine.getClock()).toBeGreaterThanOrEqual(4);
  });
});
