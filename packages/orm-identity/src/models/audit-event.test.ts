import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  IdentityAuditEvent,
  MAX_EVENT_DATA_KEYS,
  MAX_EVENT_DATA_STRING_LENGTH,
  redactAuditMetadata,
  REDACTED_EVENT_VALUE,
} from './audit-event.js';
import {
  claimOutboxEvents,
  completeOutboxEvent,
  OutboxEvent,
  retryOutboxEvent,
  sanitizeOutboxPayload,
} from './outbox-event.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const migrationsDirectory = path.join(repositoryRoot, 'apps/id/src/database/migrations');

function auditEvent(overrides: Record<string, unknown> = {}): IdentityAuditEvent {
  return IdentityAuditEvent.fromJson({
    actor_type: 'account',
    actor_id: 'acct-1',
    action: 'account.created',
    subject_type: 'account',
    subject_id: 'acct-1',
    correlation_id: 'corr-1',
    metadata: {},
    ...overrides,
  });
}

function outboxEvent(overrides: Record<string, unknown> = {}): OutboxEvent {
  return OutboxEvent.fromJson({
    event_id: 'event-1',
    event_type: 'identity.account.created',
    schema_version: 1,
    payload: { accountSubject: 'subject-1' },
    ...overrides,
  });
}

describe('identity.audit_event model', () => {
  it('sets identity, timestamp and correlation fields on insert', () => {
    const event = auditEvent();
    event.$beforeInsert({} as never);

    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.correlation_id).toBe('corr-1');
    expect(IdentityAuditEvent.tableName).toBe('identity.audit_event');
  });

  it('redacts sensitive structured metadata and bounds payload size', () => {
    const password = 'super-secret-password';
    const token = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.signature';
    const privateKey = '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----';
    const metadata = redactAuditMetadata({
      password,
      nested: { refreshToken: token, privateKey, safe: 'ok' },
      list: [{ clientSecret: password }, 'safe'],
      long: 'x'.repeat(MAX_EVENT_DATA_STRING_LENGTH + 100),
      excess: Object.fromEntries(
        Array.from({ length: MAX_EVENT_DATA_KEYS + 10 }, (_, index) => [`key${index}`, index])
      ),
    });
    const serialized = JSON.stringify(metadata);

    expect(metadata.password).toBe(REDACTED_EVENT_VALUE);
    expect((metadata.nested as Record<string, unknown>).refreshToken).toBe(REDACTED_EVENT_VALUE);
    expect((metadata.nested as Record<string, unknown>).privateKey).toBe(REDACTED_EVENT_VALUE);
    expect((metadata.list as unknown[])[0]).toEqual({ clientSecret: REDACTED_EVENT_VALUE });
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(privateKey);
    expect((metadata.long as string).length).toBeLessThanOrEqual(MAX_EVENT_DATA_STRING_LENGTH + 1);
    expect(Object.keys(metadata.excess as object)).toHaveLength(MAX_EVENT_DATA_KEYS);
  });

  it('rejects updates and deletes so records stay append-only', () => {
    const event = auditEvent();

    expect(() => event.$beforeUpdate({} as never, {} as never)).toThrow('append-only');
    expect(() => event.$beforeDelete({} as never)).toThrow('append-only');
  });

  it('redacts metadata again during JSON serialization', () => {
    const event = auditEvent({ metadata: { authorization: 'Bearer secret' } });
    const json = JSON.stringify(event.toJSON());

    expect(json).toContain(REDACTED_EVENT_VALUE);
    expect(json).not.toContain('Bearer secret');
  });
});

describe('identity.outbox_event model', () => {
  it('initializes retry state and sanitizes payload', () => {
    const event = outboxEvent({ payload: { refreshToken: 'secret-token', actor: 'acct-1' } });
    event.$beforeInsert({} as never);
    const json = event.toJSON() as Record<string, unknown>;

    expect(event.attempt_count).toBe(0);
    expect(event.next_attempt_at).toBe(event.created_at);
    expect(json.payload).toEqual({
      refreshToken: REDACTED_EVENT_VALUE,
      actor: 'acct-1',
    });
    expect(OutboxEvent.tableName).toBe('identity.outbox_event');
  });

  it('claims pending rows atomically and increments attempt count', async () => {
    const raw = vi.fn(async (_sql: string, _bindings: readonly unknown[]) => ({
      rows: [
        {
          event_id: 'event-1',
          event_type: 'identity.account.created',
          schema_version: 1,
          payload: {},
          attempt_count: 1,
          claimed_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    }));
    const now = new Date('2026-01-01T00:00:00.000Z');
    const claimed = await claimOutboxEvents({ database: { raw }, now, limit: 5 });

    expect(raw).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE SKIP LOCKED'),
      ['2026-01-01T00:00:00.000Z', '2025-12-31T23:59:00.000Z', 5, '2026-01-01T00:00:00.000Z']
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0].attempt_count).toBe(1);
  });

  it('does not double-claim locked or already delivered rows', async () => {
    let rows: Array<Record<string, unknown>> = [];
    const raw = vi.fn(async (_sql: string, _bindings: readonly unknown[]) => ({ rows }));
    const options = {
      database: { raw },
      now: new Date('2026-01-01T00:00:00.000Z'),
    };

    const first = await claimOutboxEvents(options);
    expect(first).toHaveLength(0);
    rows = [{ event_id: 'event-2', attempt_count: 1 }];
    const second = await claimOutboxEvents(options);
    expect(second).toHaveLength(1);

    const sql = String(raw.mock.calls[0][0]);
    expect(sql).toContain('delivered_at IS NULL');
    expect(sql).toContain('claimed_at IS NULL OR claimed_at <= ?');
  });

  it('rejects invalid claim limits before touching the database', async () => {
    const raw = vi.fn(async () => ({ rows: [] }));

    await expect(
      claimOutboxEvents({ database: { raw }, limit: 0 })
    ).rejects.toThrow('positive safe integer');
    await expect(
      claimOutboxEvents({ database: { raw }, limit: 1001 })
    ).rejects.toThrow('must not exceed 1000');
    expect(raw).not.toHaveBeenCalled();
  });

  it('keeps delivery state when completing and retrying events', async () => {
    const delivered = vi.fn(async (_sql: string, _bindings: readonly unknown[]) => ({
      rows: [{ event_id: 'event-1', delivered_at: '2026-01-01T00:00:01.000Z', attempt_count: 2 }],
    }));
    const retried = vi.fn(async (_sql: string, _bindings: readonly unknown[]) => ({
      rows: [{
        event_id: 'event-1',
        next_attempt_at: '2026-01-01T00:00:31.000Z',
        attempt_count: 2,
        delivered_at: null,
      }],
    }));
    const now = new Date('2026-01-01T00:00:00.000Z');

    const completed = await completeOutboxEvent('event-1', { database: { raw: delivered }, now });
    const retry = await retryOutboxEvent('event-1', { database: { raw: retried }, now }, 30);

    expect(completed?.delivered_at).toBe('2026-01-01T00:00:01.000Z');
    expect(retry?.attempt_count).toBe(2);
    expect(retry?.delivered_at).toBeNull();
    expect(String(delivered.mock.calls[0][0])).toContain('delivered_at = ?');
    expect(String(retried.mock.calls[0][0])).toContain('next_attempt_at = ?');
    expect(retried.mock.calls[0][1]).toEqual(['2026-01-01T00:00:30.000Z', 'event-1']);
  });
});

describe('identity audit and outbox migrations', () => {
  it('creates dedicated tables with the required indexes', async () => {
    const audit = await readFile(
      path.join(migrationsDirectory, '008_identity_audit_event.js'),
      'utf8'
    );
    const outbox = await readFile(
      path.join(migrationsDirectory, '009_identity_outbox_event.js'),
      'utf8'
    );

    expect(audit).toContain("createTable('audit_event'");
    expect(audit).toContain('identity_audit_subject_time_idx');
    expect(audit).toContain('BEFORE UPDATE OR DELETE');
    expect(outbox).toContain("createTable('outbox_event'");
    expect(outbox).toContain('identity_outbox_pending_idx');
    expect(outbox).toContain('attempt_count');
    expect(outbox).toContain('next_attempt_at');
    expect(outbox).toContain('delivered_at');
  });
});
