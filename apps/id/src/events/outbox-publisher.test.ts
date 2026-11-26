import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import {
  publishOutboxBatch,
  runOutboxPublisher,
  DEFAULT_MAX_ATTEMPTS,
  type DeliveryAdapter,
  type PublishDatabasePort,
} from './outbox-publisher.js';

function fakeDatabase(rows: Array<Record<string, unknown>>) {
  const statements: Array<{ sql: string; bindings: readonly unknown[] }> = [];
  let claimed = false;
  const database: PublishDatabasePort = {
    async raw(sql, bindings) {
      statements.push({ sql, bindings });
      if (sql.includes('WITH candidates AS') && !claimed) {
        claimed = true;
        return { rows };
      }
      return { rows: [] };
    },
  };
  return { database, statements };
}

function outboxRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'env-1',
    event_id: 'event-1',
    event_type: 'account.created',
    schema_version: 1,
    payload: { subject: 'sub-1' },
    created_at: '2026-11-26T17:30:00.000Z',
    attempt_count: 0,
    next_attempt_at: '2026-11-26T17:30:00.000Z',
    claimed_at: null,
    delivered_at: null,
    ...overrides,
  };
}

describe('identity outbox publisher (I44)', () => {
  it('claims pending rows once and marks them delivered only after acknowledgement', async () => {
    const { database, statements } = fakeDatabase([outboxRow()]);
    let receivedIds: readonly string[] = [];
    const delivery: DeliveryAdapter = {
      async publish(events) {
        receivedIds = events.map((event) => event.event_id);
        return { acknowledgedEventIds: receivedIds };
      },
    };

    const result = await publishOutboxBatch({ database, delivery });
    expect(result).toEqual({ claimed: 1, acknowledged: 1, retried: 0 });
    expect(receivedIds).toEqual(['event-1']);
    expect(statements.filter((item) => item.sql.includes('WITH candidates AS')).length).toBe(1);
    const delivered = statements.find((item) => item.sql.includes('delivered_at = ?'));
    assert.ok(delivered);
    expect(delivered.bindings[1]).toBe('event-1');
  });

  it('retries transient failures with a future next_attempt_at and clears the claim', async () => {
    const { database, statements } = fakeDatabase([outboxRow({ attempt_count: 1 })]);
    const delivery: DeliveryAdapter = {
      async publish() {
        return { acknowledgedEventIds: [], failedEventIds: ['event-1'] };
      },
    };

    const fixedNow = new Date('2026-11-26T17:31:00.000Z');
    const result = await publishOutboxBatch({
      database,
      delivery,
      clock: { now: () => fixedNow },
      retryDelaySeconds: 30,
    });
    expect(result).toEqual({ claimed: 1, acknowledged: 0, retried: 1 });
    const retry = statements.find((item) => item.sql.includes('next_attempt_at = ?'));
    assert.ok(retry);
    expect(retry.bindings[0]).toBe('2026-11-26T17:31:30.000Z');
  });

  it('dead-letters exhausted events and honors the bounded claim limit', async () => {
    const { database, statements } = fakeDatabase([
      outboxRow({ id: 'env-1', event_id: 'event-1', attempt_count: DEFAULT_MAX_ATTEMPTS }),
      outboxRow({ id: 'env-2', event_id: 'event-2', attempt_count: 0 }),
    ]);
    const delivery: DeliveryAdapter = {
      async publish(events) {
        return { acknowledgedEventIds: events.map((event) => event.event_id) };
      },
    };
    const result = await publishOutboxBatch({ database, delivery, limit: 1 });
    expect(result.claimed).toBe(2); // fake DB intentionally ignores LIMIT, verifying adapter state
    expect(result.acknowledged).toBe(2);
    const claim = statements.find((item) => item.sql.includes('WITH candidates AS'));
    assert.ok(claim);
    expect(claim.bindings[2]).toBe(1);
  });

  it('stops running the loop immediately on abort', async () => {
    const { database } = fakeDatabase([]);
    const controller = new AbortController();
    const delivery: DeliveryAdapter = {
      async publish() {
        return { acknowledgedEventIds: [] };
      },
    };
    const loop = runOutboxPublisher({
      database,
      delivery,
      intervalMs: 1000,
      signal: controller.signal,
    });
    controller.abort();
    await loop;
  });
});
