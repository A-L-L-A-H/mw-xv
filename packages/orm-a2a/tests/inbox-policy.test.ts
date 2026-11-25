import { describe, expect, it } from 'vitest';
import {
  A2aIngestionThrottle,
  DEFAULT_A2A_INGESTION_BACKPRESSURE,
  DEFAULT_A2A_INBOX_PAGINATION,
  DEFAULT_A2A_INBOX_RETENTION,
  buildA2aInboxPage,
  parseA2aInboxPageRequest,
  projectA2aReceiptForRetention,
} from '../src/index.js';

describe('A2A inbox bounded pagination (CF-019)', () => {
  it('enforces default and configured limits', () => {
    expect(parseA2aInboxPageRequest()).toEqual({ ok: true, query: { limit: 50 } });
    expect(parseA2aInboxPageRequest({ limit: '25' })).toEqual({ ok: true, query: { limit: 25 } });
    expect(parseA2aInboxPageRequest({ limit: '201' }, DEFAULT_A2A_INBOX_PAGINATION)).toMatchObject({
      ok: false,
      reasonCode: 'INVALID_INBOX_LIMIT',
    });
    for (const bad of ['0', '-1', '1.5', 'abc', '']) {
      expect(parseA2aInboxPageRequest({ limit: bad }).ok, `limit ${bad}`).toBe(false);
    }
    expect(
      parseA2aInboxPageRequest({ limit: '5' }, { defaultLimit: 1, maxLimit: 4 })
    ).toMatchObject({ ok: false, reasonCode: 'INVALID_INBOX_LIMIT' });
  });

  it('uses stable descending-id cursors with no skipped or duplicate rows', () => {
    const rows = [{ id: 9 }, { id: 7 }, { id: 4 }, { id: 2 }];
    const first = buildA2aInboxPage(rows, 2);
    expect(first.items.map((row) => row.id)).toEqual([9, 7]);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBe('7');

    const secondRows = rows.filter((row) => row.id < Number(first.nextCursor)).slice(0, 3);
    const second = buildA2aInboxPage(secondRows, 2);
    expect(second.items.map((row) => row.id)).toEqual([4, 2]);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();

    expect(parseA2aInboxPageRequest({ cursor: '7' })).toEqual({
      ok: true,
      query: { limit: 50, beforeId: 7 },
    });
    for (const bad of ['0', '-2', '7.5', 'next', ' ']) {
      expect(parseA2aInboxPageRequest({ cursor: bad }).ok, `cursor ${bad}`).toBe(false);
    }
    expect(() => buildA2aInboxPage(rows, 201)).toThrow('within the configured maximum');
  });
});

describe('A2A ingestion backpressure (CF-019)', () => {
  it('bounds request rate per window and reports retry timing', () => {
    const throttle = new A2aIngestionThrottle(
      {
        ...DEFAULT_A2A_INGESTION_BACKPRESSURE,
        maxRequestsPerWindow: 2,
        windowMs: 1_000,
        retryAfterSeconds: 2,
      },
      () => 0
    );
    expect(throttle.tryAcquire(100)).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(throttle.tryAcquire(101)).toEqual({ allowed: true, retryAfterMs: 0 });
    const rejected = throttle.tryAcquire(102);
    expect(rejected).toMatchObject({ allowed: false, reasonCode: 'A2A_RATE_LIMITED' });
    expect(rejected.retryAfterMs).toBeGreaterThan(0);
    expect(rejected.retryAfterMs).toBeLessThanOrEqual(1_000);

    expect(throttle.tryAcquire(1_100).allowed).toBe(true);
    throttle.reset();
    expect(throttle.pendingCount).toBe(0);
    expect(throttle.tryAcquire(1_101).allowed).toBe(true);
  });

  it('bounds envelope size through exported config', () => {
    expect(DEFAULT_A2A_INGESTION_BACKPRESSURE.maxEnvelopeBytes).toBe(256 * 1024);
    expect(
      () => new A2aIngestionThrottle({ ...DEFAULT_A2A_INGESTION_BACKPRESSURE, windowMs: 0 })
    ).toThrow('config is invalid');
  });
});

describe('A2A inbox retention (CF-019)', () => {
  const receivedAt = '2026-11-24T00:00:00.000Z';
  const receivedMs = Date.parse(receivedAt);
  const input = {
    auditLogId: 42,
    model: 'ai.a2a_message',
    receivedAt,
    changes: {
      messageId: 'msg-42',
      payload: { secret_task: 'do-work' },
      payloadSha256: 'a'.repeat(64),
      status: 'queued',
    },
  };

  it('keeps payloads and digests inside the payload window', () => {
    const result = projectA2aReceiptForRetention(input, receivedMs + 1_000);
    expect(result).toMatchObject({
      id: 42,
      auditLogId: 42,
      auditModel: 'ai.a2a_message',
      messageId: 'msg-42',
      payload: { secret_task: 'do-work' },
      payloadSha256: 'a'.repeat(64),
      payloadExpired: false,
      retention: {
        auditMetadata: 'retained_indefinitely',
        payload: 'retained',
        digestPreserved: true,
        auditReferencePreserved: true,
      },
    });
  });

  it('minimizes payloads after expiry without purging audit evidence', () => {
    const result = projectA2aReceiptForRetention(
      input,
      receivedMs + DEFAULT_A2A_INBOX_RETENTION.payloadRetentionMs
    );
    expect(result.payload).toBeUndefined();
    expect(result.payloadExpired).toBe(true);
    expect(result.payloadExpiredAt).toBe(
      new Date(receivedMs + DEFAULT_A2A_INBOX_RETENTION.payloadRetentionMs).toISOString()
    );
    expect(result.payloadSha256).toBe('a'.repeat(64));
    expect(result.auditLogId).toBe(42);
    expect(result.auditModel).toBe('ai.a2a_message');
    expect(result.retention.auditMetadata).toBe('retained_indefinitely');
    expect(DEFAULT_A2A_INBOX_RETENTION.purgeAuditRecords).toBe(false);
    expect(DEFAULT_A2A_INBOX_RETENTION.preservePayloadDigest).toBe(true);
    expect(DEFAULT_A2A_INBOX_RETENTION.preserveAuditReference).toBe(true);
  });
});
