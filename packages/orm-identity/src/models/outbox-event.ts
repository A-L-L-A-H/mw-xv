import { Model, type QueryContext } from 'objection';

import { redactAuditMetadata } from './audit-event.js';

export const DEFAULT_OUTBOX_CLAIM_LIMIT = 100;
export const MAX_OUTBOX_CLAIM_LIMIT = 1000;
export const DEFAULT_OUTBOX_LEASE_SECONDS = 60;
export const DEFAULT_OUTBOX_RETRY_DELAY_SECONDS = 30;

export interface OutboxDatabasePort {
  readonly raw: (sql: string, bindings: readonly unknown[]) => Promise<unknown>;
}

export interface OutboxClaimOptions {
  readonly database: OutboxDatabasePort;
  readonly now?: Date;
  readonly limit?: number;
  readonly leaseSeconds?: number;
}

export interface OutboxWriteOptions {
  readonly database: OutboxDatabasePort;
  readonly now?: Date;
}

function rowsFrom(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  }
  return [];
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

export function sanitizeOutboxPayload(payload: unknown): Record<string, unknown> {
  return redactAuditMetadata(payload);
}

export class OutboxEvent extends Model {
  static override readonly tableName = 'identity.outbox_event';
  static override readonly idColumn = 'id';

  id!: string;
  event_id!: string;
  event_type!: string;
  schema_version!: number;
  payload!: Record<string, unknown>;
  created_at!: string;
  attempt_count!: number;
  next_attempt_at!: string;
  claimed_at?: string | null;
  delivered_at?: string | null;

  override $beforeInsert(_context: QueryContext): void {
    const now = new Date().toISOString();
    if (!this.created_at) this.created_at = now;
    if (!this.next_attempt_at) this.next_attempt_at = now;
    if (this.attempt_count === undefined) this.attempt_count = 0;
    this.payload = sanitizeOutboxPayload(this.payload);
  }

  override $formatJson(json: Record<string, unknown>): Record<string, unknown> {
    const formatted = super.$formatJson(json);
    return { ...formatted, payload: sanitizeOutboxPayload(formatted.payload) };
  }
}

/** Single-statement claim; locked candidates are skipped, never double-claimed. */
export async function claimOutboxEvents(
  options: OutboxClaimOptions
): Promise<OutboxEvent[]> {
  const limit = options.limit ?? DEFAULT_OUTBOX_CLAIM_LIMIT;
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_OUTBOX_LEASE_SECONDS;
  assertPositiveInteger(limit, 'limit');
  assertPositiveInteger(leaseSeconds, 'leaseSeconds');
  if (limit > MAX_OUTBOX_CLAIM_LIMIT) {
    throw new Error(`limit must not exceed ${MAX_OUTBOX_CLAIM_LIMIT}`);
  }

  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - leaseSeconds * 1000).toISOString();
  const rows = rowsFrom(
    await options.database.raw(
      `WITH candidates AS (
         SELECT id FROM identity.outbox_event
         WHERE delivered_at IS NULL
           AND next_attempt_at <= ?
           AND (claimed_at IS NULL OR claimed_at <= ?)
         ORDER BY created_at ASC, id ASC
         LIMIT ?
         FOR UPDATE SKIP LOCKED
       )
       UPDATE identity.outbox_event AS event
       SET claimed_at = ?, attempt_count = event.attempt_count + 1
       FROM candidates
       WHERE event.id = candidates.id
       RETURNING event.*`,
      [nowIso, staleBefore, limit, nowIso]
    )
  );

  return rows.map((row) => OutboxEvent.fromJson(row));
}

export async function completeOutboxEvent(
  eventId: string,
  options: OutboxWriteOptions
): Promise<OutboxEvent | undefined> {
  if (!eventId) throw new Error('eventId is required');
  const now = (options.now ?? new Date()).toISOString();
  const rows = rowsFrom(
    await options.database.raw(
      `UPDATE identity.outbox_event
       SET delivered_at = ?, claimed_at = NULL
       WHERE event_id = ? AND delivered_at IS NULL
       RETURNING *`,
      [now, eventId]
    )
  );
  return rows[0] ? OutboxEvent.fromJson(rows[0]) : undefined;
}

export async function retryOutboxEvent(
  eventId: string,
  options: OutboxWriteOptions,
  delaySeconds: number = DEFAULT_OUTBOX_RETRY_DELAY_SECONDS
): Promise<OutboxEvent | undefined> {
  if (!eventId) throw new Error('eventId is required');
  assertPositiveInteger(delaySeconds, 'delaySeconds');
  const now = options.now ?? new Date();
  const nextAttemptAt = new Date(now.getTime() + delaySeconds * 1000).toISOString();
  const rows = rowsFrom(
    await options.database.raw(
      `UPDATE identity.outbox_event
       SET claimed_at = NULL, next_attempt_at = ?
       WHERE event_id = ? AND delivered_at IS NULL
       RETURNING *`,
      [nextAttemptAt, eventId]
    )
  );
  return rows[0] ? OutboxEvent.fromJson(rows[0]) : undefined;
}
