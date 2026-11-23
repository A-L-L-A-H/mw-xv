import { createHash } from 'node:crypto';

export type SyncOperation = 'upsert' | 'delete';
export type SyncConflictResolution = 'local_wins' | 'remote_wins' | 'merged_fields';

export interface SyncRecordVersion {
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: SyncOperation;
  readonly lamportClock: number;
  readonly nodeId: string;
  readonly updatedAt: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly tombstone: boolean;
}

export interface SyncOutboxEntry extends SyncRecordVersion {
  readonly outboxId: string;
  readonly entrySha256: string;
}

export interface SyncConflictRecord {
  readonly entityType: string;
  readonly entityId: string;
  readonly resolution: SyncConflictResolution;
  readonly localClock: number;
  readonly remoteClock: number;
  readonly localNodeId: string;
  readonly remoteNodeId: string;
  readonly conflictingFields: readonly string[];
  readonly resolvedFields: Readonly<Record<string, unknown>>;
  readonly tombstone: boolean;
}

export interface SyncBatchPlan {
  readonly batchId: string;
  readonly nodeId: string;
  readonly lamportClock: number;
  readonly generatedAt: string;
  readonly pushEntries: readonly SyncOutboxEntry[];
  readonly pullEntries: readonly SyncRecordVersion[];
  readonly conflicts: readonly SyncConflictRecord[];
  readonly batchSha256: string;
}

export interface SyncEngineStatus {
  readonly nodeId: string;
  readonly lamportClock: number;
  readonly pendingOutboxCount: number;
  readonly tombstoneCount: number;
  readonly lastBatchSha256: string | null;
  readonly lastPlannedAt: string | null;
}

export interface RecordLocalMutationInput {
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: SyncOperation;
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly updatedAt?: string;
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeValue(entry));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry !== undefined) {
        sorted[key] = canonicalizeValue(entry);
      }
    }
    return sorted;
  }
  return value;
}

export function computeCanonicalSha256(payload: unknown): string {
  const canonicalJson = JSON.stringify(canonicalizeValue(payload));
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

function entityKey(entityType: string, entityId: string): string {
  return `${entityType}::${entityId}`;
}

function compareLamportOrder(
  localClock: number,
  localNodeId: string,
  remoteClock: number,
  remoteNodeId: string
): number {
  if (localClock !== remoteClock) {
    return localClock - remoteClock;
  }
  if (localNodeId === remoteNodeId) {
    return 0;
  }
  return localNodeId > remoteNodeId ? 1 : -1;
}

export function resolveSyncConflict(
  local: SyncRecordVersion,
  remote: SyncRecordVersion
): SyncConflictRecord {
  const order = compareLamportOrder(
    local.lamportClock,
    local.nodeId,
    remote.lamportClock,
    remote.nodeId
  );
  const localKeys = Object.keys(local.fields).sort();
  const remoteKeys = Object.keys(remote.fields).sort();
  const allKeys = Array.from(new Set([...localKeys, ...remoteKeys])).sort();
  const conflictingFields = allKeys.filter((key) => {
    const hasLocal = Object.prototype.hasOwnProperty.call(local.fields, key);
    const hasRemote = Object.prototype.hasOwnProperty.call(remote.fields, key);
    if (!hasLocal || !hasRemote) return false;
    return (
      JSON.stringify(canonicalizeValue(local.fields[key])) !==
      JSON.stringify(canonicalizeValue(remote.fields[key]))
    );
  });

  // Tombstone vs upsert or tombstone vs tombstone: strict LWW-Lamport wins
  if (local.tombstone || remote.tombstone) {
    const localWins = order >= 0;
    const winner = localWins ? local : remote;
    return {
      entityType: local.entityType,
      entityId: local.entityId,
      resolution: localWins ? 'local_wins' : 'remote_wins',
      localClock: local.lamportClock,
      remoteClock: remote.lamportClock,
      localNodeId: local.nodeId,
      remoteNodeId: remote.nodeId,
      conflictingFields,
      resolvedFields: winner.tombstone ? {} : { ...winner.fields },
      tombstone: winner.tombstone,
    };
  }

  const localOnlyKeys = localKeys.filter(
    (key) => !Object.prototype.hasOwnProperty.call(remote.fields, key)
  );
  const remoteOnlyKeys = remoteKeys.filter(
    (key) => !Object.prototype.hasOwnProperty.call(local.fields, key)
  );

  // Disjoint or complementary field updates: deterministic field-level CRDT merge
  if (localOnlyKeys.length > 0 && remoteOnlyKeys.length > 0) {
    const merged: Record<string, unknown> = {};
    for (const key of allKeys) {
      const hasLocal = Object.prototype.hasOwnProperty.call(local.fields, key);
      const hasRemote = Object.prototype.hasOwnProperty.call(remote.fields, key);
      if (hasLocal && !hasRemote) {
        merged[key] = local.fields[key];
      } else if (!hasLocal && hasRemote) {
        merged[key] = remote.fields[key];
      } else {
        merged[key] = order >= 0 ? local.fields[key] : remote.fields[key];
      }
    }
    return {
      entityType: local.entityType,
      entityId: local.entityId,
      resolution: 'merged_fields',
      localClock: local.lamportClock,
      remoteClock: remote.lamportClock,
      localNodeId: local.nodeId,
      remoteNodeId: remote.nodeId,
      conflictingFields,
      resolvedFields: merged,
      tombstone: false,
    };
  }

  const localWins = order >= 0;
  const winner = localWins ? local : remote;
  return {
    entityType: local.entityType,
    entityId: local.entityId,
    resolution: localWins ? 'local_wins' : 'remote_wins',
    localClock: local.lamportClock,
    remoteClock: remote.lamportClock,
    localNodeId: local.nodeId,
    remoteNodeId: remote.nodeId,
    conflictingFields,
    resolvedFields: { ...winner.fields },
    tombstone: false,
  };
}

export class DesktopSyncEngine {
  private readonly nodeId: string;
  private lamportClock: number;
  private readonly outbox = new Map<string, SyncOutboxEntry>();
  private readonly tombstones = new Map<string, number>();
  private lastBatchSha256: string | null = null;
  private lastPlannedAt: string | null = null;
  private sequence = 0;

  constructor(options?: { readonly nodeId?: string; readonly initialClock?: number }) {
    this.nodeId = options?.nodeId?.trim() || 'desktop-local';
    this.lamportClock =
      typeof options?.initialClock === 'number' &&
      Number.isInteger(options.initialClock) &&
      options.initialClock >= 0
        ? options.initialClock
        : 0;
  }

  public getClock(): number {
    return this.lamportClock;
  }

  public advanceClock(remoteClock?: number): number {
    if (
      typeof remoteClock === 'number' &&
      Number.isFinite(remoteClock) &&
      remoteClock > this.lamportClock
    ) {
      this.lamportClock = Math.floor(remoteClock);
    }
    this.lamportClock += 1;
    return this.lamportClock;
  }

  public recordLocalMutation(input: RecordLocalMutationInput): SyncOutboxEntry {
    const entityType = input.entityType.trim();
    const entityId = input.entityId.trim();
    if (!entityType || !entityId) {
      throw new Error('entityType and entityId are required for sync mutation');
    }
    const clock = this.advanceClock();
    this.sequence += 1;
    const tombstone = input.operation === 'delete';
    const fields: Record<string, unknown> = tombstone ? {} : { ...(input.fields ?? {}) };
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    const outboxId = `sync-${this.nodeId}-${clock}-${this.sequence}`;
    const coreRecord = {
      outboxId,
      entityType,
      entityId,
      operation: input.operation,
      lamportClock: clock,
      nodeId: this.nodeId,
      updatedAt,
      fields,
      tombstone,
    };
    const entrySha256 = computeCanonicalSha256(coreRecord);
    const entry: SyncOutboxEntry = { ...coreRecord, entrySha256 };

    const key = entityKey(entityType, entityId);
    this.outbox.set(key, entry);
    if (tombstone) {
      this.tombstones.set(key, clock);
    } else {
      this.tombstones.delete(key);
    }
    return entry;
  }

  public listPendingOutbox(): readonly SyncOutboxEntry[] {
    return Array.from(this.outbox.values()).sort((a, b) => a.lamportClock - b.lamportClock);
  }

  public acknowledgePushed(outboxIds: readonly string[]): number {
    const idSet = new Set(outboxIds);
    let removed = 0;
    for (const [key, entry] of this.outbox.entries()) {
      if (idSet.has(entry.outboxId)) {
        this.outbox.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  public planBidirectionalSync(remoteVersions: readonly SyncRecordVersion[] = []): SyncBatchPlan {
    let maxRemoteClock = this.lamportClock;
    for (const remote of remoteVersions) {
      if (remote.lamportClock > maxRemoteClock) {
        maxRemoteClock = remote.lamportClock;
      }
    }
    if (maxRemoteClock > this.lamportClock) {
      this.lamportClock = maxRemoteClock;
    }

    const remoteMap = new Map<string, SyncRecordVersion>();
    for (const remote of remoteVersions) {
      const key = entityKey(remote.entityType, remote.entityId);
      const existing = remoteMap.get(key);
      if (
        !existing ||
        compareLamportOrder(
          remote.lamportClock,
          remote.nodeId,
          existing.lamportClock,
          existing.nodeId
        ) > 0
      ) {
        remoteMap.set(key, remote);
      }
    }

    const pushEntries: SyncOutboxEntry[] = [];
    const pullEntries: SyncRecordVersion[] = [];
    const conflicts: SyncConflictRecord[] = [];

    for (const [key, localEntry] of this.outbox.entries()) {
      const remoteEntry = remoteMap.get(key);
      if (!remoteEntry) {
        pushEntries.push(localEntry);
        continue;
      }
      const conflict = resolveSyncConflict(localEntry, remoteEntry);
      conflicts.push(conflict);
      if (conflict.resolution === 'local_wins') {
        pushEntries.push(localEntry);
      } else if (conflict.resolution === 'remote_wins') {
        pullEntries.push(remoteEntry);
      } else {
        const mergedClock = this.advanceClock(remoteEntry.lamportClock);
        const mergedCore = {
          outboxId: `${localEntry.outboxId}-merged-${mergedClock}`,
          entityType: localEntry.entityType,
          entityId: localEntry.entityId,
          operation: 'upsert' as const,
          lamportClock: mergedClock,
          nodeId: this.nodeId,
          updatedAt: new Date().toISOString(),
          fields: conflict.resolvedFields,
          tombstone: false,
        };
        const mergedEntry: SyncOutboxEntry = {
          ...mergedCore,
          entrySha256: computeCanonicalSha256(mergedCore),
        };
        pushEntries.push(mergedEntry);
        pullEntries.push(mergedEntry);
      }
    }

    for (const [key, remoteEntry] of remoteMap.entries()) {
      if (this.outbox.has(key)) {
        continue;
      }
      const tombstoneClock = this.tombstones.get(key);
      if (tombstoneClock !== undefined && tombstoneClock >= remoteEntry.lamportClock) {
        continue;
      }
      pullEntries.push(remoteEntry);
    }

    pushEntries.sort(
      (a, b) => a.lamportClock - b.lamportClock || a.entityId.localeCompare(b.entityId)
    );
    pullEntries.sort(
      (a, b) => a.lamportClock - b.lamportClock || a.entityId.localeCompare(b.entityId)
    );
    conflicts.sort(
      (a, b) => a.entityType.localeCompare(b.entityType) || a.entityId.localeCompare(b.entityId)
    );

    const generatedAt = new Date().toISOString();
    const batchCore = {
      nodeId: this.nodeId,
      lamportClock: this.lamportClock,
      pushEntries,
      pullEntries,
      conflicts,
    };
    const batchSha256 = computeCanonicalSha256(batchCore);
    const batchId = `batch-${this.nodeId}-${this.lamportClock}-${batchSha256.slice(0, 12)}`;

    this.lastBatchSha256 = batchSha256;
    this.lastPlannedAt = generatedAt;

    return {
      batchId,
      nodeId: this.nodeId,
      lamportClock: this.lamportClock,
      generatedAt,
      pushEntries,
      pullEntries,
      conflicts,
      batchSha256,
    };
  }

  public getStatus(): SyncEngineStatus {
    return {
      nodeId: this.nodeId,
      lamportClock: this.lamportClock,
      pendingOutboxCount: this.outbox.size,
      tombstoneCount: this.tombstones.size,
      lastBatchSha256: this.lastBatchSha256,
      lastPlannedAt: this.lastPlannedAt,
    };
  }
}
