import { describe, expect, it, vi } from 'vitest';
import {
  DesktopUpstreamSyncClient,
  type PullRemoteDeltasRequest,
  type PullRemoteDeltasResponse,
  type RemoteDelta,
} from '../src/sync-client.js';
import { resolveSyncConflict, type SyncRecordVersion, type SyncConflictRecord } from '../src/sync-engine.js';
import { ValidationError, AccessDeniedError } from '@moonwitness/types';

function makeClient(
  overrideFetch?: typeof fetch,
  overrideSleep?: (delayMs: number) => Promise<void>
) {
  return new DesktopUpstreamSyncClient({
    apiBaseUrl: 'https://api.example.com',
    fetchImpl: overrideFetch,
    sleepImpl: overrideSleep,
    knownSecrets: ['sk-secret-123', 'token-abc'],
    maxRetries: 2,
    baseDelayMs: 10,
    maxDelayMs: 50,
  });
}

describe('DesktopUpstreamSyncClient (pullRemoteDeltas)', () => {
  it('rejects invalid baseUrl on construction', () => {
    expect(() => new DesktopUpstreamSyncClient({ apiBaseUrl: 'not-a-url' })).toThrow(ValidationError);
    expect(() => new DesktopUpstreamSyncClient({ apiBaseUrl: 'ftp://example.com' })).toThrow(ValidationError);
    expect(() => new DesktopUpstreamSyncClient({ apiBaseUrl: 'https://user:pass@example.com' })).toThrow(ValidationError);
    expect(() => new DesktopUpstreamSyncClient({ apiBaseUrl: 'https://example.com#hash' })).toThrow(ValidationError);
  });

  it('validates companyId is positive integer', async () => {
    const client = makeClient();
    await expect(client.pullRemoteDeltas({ companyId: 0 })).rejects.toThrow(ValidationError);
    await expect(client.pullRemoteDeltas({ companyId: -1 })).rejects.toThrow(ValidationError);
    await expect(client.pullRemoteDeltas({ companyId: 1.5 })).rejects.toThrow(ValidationError);
  });

  it('maps pullRemoteDeltas request and response correctly', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: String(input), init: init! });
      return new Response(
        JSON.stringify({
          deltas: [
            {
              entityType: 'project.task',
              entityId: 'task-1',
              operation: 'upsert',
              lamportClock: 5,
              nodeId: 'cloud-1',
              updatedAt: '2026-11-23T01:00:00.000Z',
              fields: { name: 'Remote Task', status: 'open' },
              tombstone: false,
            },
            {
              entityType: 'project.task',
              entityId: 'task-2',
              operation: 'delete',
              lamportClock: 7,
              nodeId: 'cloud-1',
              updatedAt: '2026-11-23T01:05:00.000Z',
              fields: {},
              tombstone: true,
            },
          ],
          nextCursor: 'cursor-abc-123',
          serverClock: 10,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const client = makeClient(mockFetch);
    const options: PullRemoteDeltasRequest = {
      companyId: 42,
      sinceCursor: 'cursor-prev',
      localVersions: [
        {
          entityType: 'project.task',
          entityId: 'task-1',
          operation: 'upsert',
          lamportClock: 3,
          nodeId: 'desktop-local',
          updatedAt: '2026-11-23T00:50:00.000Z',
          fields: { name: 'Local Task', status: 'draft' },
          tombstone: false,
        },
      ],
    };

    const result: PullRemoteDeltasResponse = await client.pullRemoteDeltas(options);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(captured[0].url).toBe('https://api.example.com/api/desktop/sync/pull');
    expect(captured[0].init.method).toBe('POST');
    const sentBody = JSON.parse(captured[0].init.body as string);
    expect(sentBody).toEqual({
      companyId: 42,
      sinceCursor: 'cursor-prev',
      localVersions: options.localVersions,
    });

    expect(result.deltas).toHaveLength(2);
    expect(result.deltas[0].entityType).toBe('project.task');
    expect(result.deltas[0].entityId).toBe('task-1');
    expect(result.deltas[0].operation).toBe('upsert');
    expect(result.deltas[0].lamportClock).toBe(5);
    expect(result.deltas[1].entityType).toBe('project.task');
    expect(result.deltas[1].entityId).toBe('task-2');
    expect(result.deltas[1].operation).toBe('delete');
    expect(result.deltas[1].tombstone).toBe(true);
    expect(result.nextCursor).toBe('cursor-abc-123');
    expect(result.serverClock).toBe(10);
  });

  it('detects local_wins conflict (local clock higher)', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          deltas: [
            {
              entityType: 'project.task',
              entityId: 'task-conflict',
              operation: 'upsert',
              lamportClock: 3,
              nodeId: 'cloud-1',
              updatedAt: '2026-11-23T01:00:00.000Z',
              fields: { name: 'Remote Title' },
              tombstone: false,
            },
          ],
          nextCursor: 'next',
          serverClock: 5,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const client = makeClient(mockFetch);
    const result = await client.pullRemoteDeltas({
      companyId: 1,
      localVersions: [
        {
          entityType: 'project.task',
          entityId: 'task-conflict',
          operation: 'upsert',
          lamportClock: 5,
          nodeId: 'desktop-local',
          updatedAt: '2026-11-23T00:50:00.000Z',
          fields: { name: 'Local Title' },
          tombstone: false,
        },
      ],
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].resolution).toBe('local_wins');
    expect(result.conflicts[0].entityType).toBe('project.task');
    expect(result.conflicts[0].entityId).toBe('task-conflict');
    expect(result.conflicts[0].localClock).toBe(5);
    expect(result.conflicts[0].remoteClock).toBe(3);
  });

  it('detects remote_wins conflict (remote clock higher)', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          deltas: [
            {
              entityType: 'project.task',
              entityId: 'task-conflict',
              operation: 'upsert',
              lamportClock: 7,
              nodeId: 'cloud-1',
              updatedAt: '2026-11-23T01:00:00.000Z',
              fields: { name: 'Remote Title' },
              tombstone: false,
            },
          ],
          nextCursor: 'next',
          serverClock: 10,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const client = makeClient(mockFetch);
    const result = await client.pullRemoteDeltas({
      companyId: 1,
      localVersions: [
        {
          entityType: 'project.task',
          entityId: 'task-conflict',
          operation: 'upsert',
          lamportClock: 3,
          nodeId: 'desktop-local',
          updatedAt: '2026-11-23T00:50:00.000Z',
          fields: { name: 'Local Title' },
          tombstone: false,
        },
      ],
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].resolution).toBe('remote_wins');
    expect(result.conflicts[0].localClock).toBe(3);
    expect(result.conflicts[0].remoteClock).toBe(7);
  });

  it('detects merged_fields conflict (disjoint field updates)', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          deltas: [
            {
              entityType: 'project.task',
              entityId: 'task-merge',
              operation: 'upsert',
              lamportClock: 5,
              nodeId: 'cloud-1',
              updatedAt: '2026-11-23T01:00:00.000Z',
              fields: { name: 'Remote Title', description: 'Added remotely' },
              tombstone: false,
            },
          ],
          nextCursor: 'next',
          serverClock: 10,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const client = makeClient(mockFetch);
    const result = await client.pullRemoteDeltas({
      companyId: 1,
      localVersions: [
        {
          entityType: 'project.task',
          entityId: 'task-merge',
          operation: 'upsert',
          lamportClock: 5,
          nodeId: 'desktop-local',
          updatedAt: '2026-11-23T00:50:00.000Z',
          fields: { name: 'Local Title', stageId: 2 },
          tombstone: false,
        },
      ],
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].resolution).toBe('merged_fields');
    expect(result.conflicts[0].conflictingFields).toEqual(['name']);
    expect(result.conflicts[0].resolvedFields).toEqual({
      name: 'Local Title',
      stageId: 2,
      description: 'Added remotely',
    });
  });

  it('handles tombstone vs upsert conflict (strict LWW)', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          deltas: [
            {
              entityType: 'project.task',
              entityId: 'task-deleted',
              operation: 'upsert',
              lamportClock: 1,
              nodeId: 'cloud-1',
              updatedAt: '2026-11-23T00:00:00.000Z',
              fields: { name: 'Stale resurrect' },
              tombstone: false,
            },
          ],
          nextCursor: 'next',
          serverClock: 5,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const client = makeClient(mockFetch);
    const result = await client.pullRemoteDeltas({
      companyId: 1,
      localVersions: [
        {
          entityType: 'project.task',
          entityId: 'task-deleted',
          operation: 'delete',
          lamportClock: 2,
          nodeId: 'desktop-local',
          updatedAt: '2026-11-23T00:01:00.000Z',
          fields: {},
          tombstone: true,
        },
      ],
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].resolution).toBe('local_wins');
    expect(result.conflicts[0].tombstone).toBe(true);
    expect(result.conflicts[0].resolvedFields).toEqual({});
  });

  it('handles tombstone vs tombstone conflict', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          deltas: [
            {
              entityType: 'project.task',
              entityId: 'task-double-delete',
              operation: 'delete',
              lamportClock: 5,
              nodeId: 'cloud-1',
              updatedAt: '2026-11-23T01:00:00.000Z',
              fields: {},
              tombstone: true,
            },
          ],
          nextCursor: 'next',
          serverClock: 10,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const client = makeClient(mockFetch);
    const result = await client.pullRemoteDeltas({
      companyId: 1,
      localVersions: [
        {
          entityType: 'project.task',
          entityId: 'task-double-delete',
          operation: 'delete',
          lamportClock: 3,
          nodeId: 'desktop-local',
          updatedAt: '2026-11-23T00:50:00.000Z',
          fields: {},
          tombstone: true,
        },
      ],
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].resolution).toBe('remote_wins');
    expect(result.conflicts[0].tombstone).toBe(true);
  });

  it('retries on 429 and 5xx with exponential backoff', async () => {
    const calls: number[] = [];
    const mockFetch = vi.fn(async () => {
      calls.push(Date.now());
      if (calls.length < 3) {
        return new Response('Too Many Requests', { status: 429 });
      }
      return new Response(
        JSON.stringify({ deltas: [], nextCursor: 'done', serverClock: 1 }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const sleepCalls: number[] = [];
    const mockSleep = vi.fn(async (delayMs: number) => {
      sleepCalls.push(delayMs);
    });

    const client = makeClient(mockFetch, mockSleep);
    await client.pullRemoteDeltas({ companyId: 1 });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(sleepCalls).toHaveLength(2);
    expect(sleepCalls[0]).toBeGreaterThanOrEqual(10);
    expect(sleepCalls[1]).toBeGreaterThanOrEqual(sleepCalls[0]);
  });

  it('retries on network errors', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ deltas: [], nextCursor: 'done', serverClock: 1 }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );

    const client = makeClient(mockFetch);
    await client.pullRemoteDeltas({ companyId: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('redacts known secrets in error messages', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      new Response('Unauthorized: sk-secret-123', { status: 401 })
    );

    const client = makeClient(mockFetch);
    await expect(client.pullRemoteDeltas({ companyId: 1 })).rejects.toThrow(/\[REDACTED\]/);
  });

  it('does not redact unknown strings', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      new Response('Error: some-random-value', { status: 400 })
    );

    const client = makeClient(mockFetch);
    try {
      await client.pullRemoteDeltas({ companyId: 1 });
    } catch (e) {
      expect((e as Error).message).toContain('some-random-value');
    }
  });

  it('returns empty deltas and conflicts when server returns no deltas', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      new Response(
        JSON.stringify({ deltas: [], nextCursor: 'empty', serverClock: 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const client = makeClient(mockFetch);
    const result = await client.pullRemoteDeltas({ companyId: 1 });
    expect(result.deltas).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.nextCursor).toBe('empty');
    expect(result.serverClock).toBe(0);
  });
});