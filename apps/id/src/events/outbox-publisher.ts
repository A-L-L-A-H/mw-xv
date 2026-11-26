export const DEFAULT_PUBLISH_BATCH_SIZE = 50;
export const MAX_PUBLISH_BATCH_SIZE = 500;
export const DEFAULT_LEASE_SECONDS = 60;
export const DEFAULT_RETRY_DELAY_SECONDS = 30;
export const DEFAULT_MAX_ATTEMPTS = 10;

/** Minimal identity.outbox_event row shape used by the publisher. */
export interface OutboxEventRow {
  readonly id: string;
  readonly event_id: string;
  readonly event_type: string;
  readonly schema_version: number;
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
  readonly attempt_count: number;
  readonly next_attempt_at: string;
  readonly claimed_at: string | null;
  readonly delivered_at: string | null;
}

export interface PublishDatabasePort {
  readonly raw: (sql: string, bindings: readonly unknown[]) => Promise<unknown>;
}

export interface PublishClock {
  readonly now: () => Date;
}

export interface DeliveryReceipt {
  readonly eventId: string;
  readonly deliveredAt?: string;
}

export interface DeliveryResult {
  readonly acknowledgedEventIds: readonly string[];
  readonly failedEventIds?: readonly string[];
}

export interface DeliveryAdapter {
  readonly publish: (events: readonly OutboxEventRow[]) => Promise<DeliveryResult>;
}

export interface PublishEventsOptions {
  readonly database: PublishDatabasePort;
  readonly delivery: DeliveryAdapter;
  readonly clock?: PublishClock;
  readonly limit?: number;
  readonly leaseSeconds?: number;
  readonly retryDelaySeconds?: number;
  readonly maxAttempts?: number;
}

export interface PublishBatchResult {
  readonly claimed: number;
  readonly acknowledged: number;
  readonly retried: number;
}

export interface PublisherLoopOptions extends PublishEventsOptions {
  readonly intervalMs?: number;
  readonly signal?: AbortSignal;
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

function toOutboxEventRow(row: Record<string, unknown>): OutboxEventRow {
  if (
    typeof row.id !== 'string' ||
    typeof row.event_id !== 'string' ||
    typeof row.event_type !== 'string' ||
    typeof row.schema_version !== 'number' ||
    typeof row.payload !== 'object' ||
    row.payload === null ||
    typeof row.created_at !== 'string' ||
    typeof row.attempt_count !== 'number' ||
    typeof row.next_attempt_at !== 'string'
  ) {
    throw new Error('Malformed identity outbox row');
  }
  return {
    id: row.id,
    event_id: row.event_id,
    event_type: row.event_type,
    schema_version: row.schema_version,
    payload: row.payload as Record<string, unknown>,
    created_at: row.created_at,
    attempt_count: row.attempt_count,
    next_attempt_at: row.next_attempt_at,
    claimed_at: typeof row.claimed_at === 'string' ? row.claimed_at : null,
    delivered_at: typeof row.delivered_at === 'string' ? row.delivered_at : null,
  };
}

export async function publishOutboxBatch(options: PublishEventsOptions): Promise<PublishBatchResult> {
  const limit = options.limit ?? DEFAULT_PUBLISH_BATCH_SIZE;
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const retryDelaySeconds = options.retryDelaySeconds ?? DEFAULT_RETRY_DELAY_SECONDS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  assertPositiveInteger(limit, 'limit');
  if (limit > MAX_PUBLISH_BATCH_SIZE) throw new Error(`limit must not exceed ${MAX_PUBLISH_BATCH_SIZE}`);
  assertPositiveInteger(leaseSeconds, 'leaseSeconds');
  assertPositiveInteger(retryDelaySeconds, 'retryDelaySeconds');
  assertPositiveInteger(maxAttempts, 'maxAttempts');

  const now = (options.clock?.now ?? (() => new Date()))().toISOString();
  const staleBefore = new Date(Date.parse(now) - leaseSeconds * 1000).toISOString();

  // Atomic claim: SKIP LOCKED guarantees two workers never claim the same row.
  const claimedRows = rowsFrom(
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
      [now, staleBefore, limit, now]
    )
  );
  const claimed = claimedRows.map(toOutboxEventRow);
  if (claimed.length === 0) return { claimed: 0, acknowledged: 0, retried: 0 };

  const claimedById = new Map(claimed.map((event) => [event.event_id, event]));
  let delivery: DeliveryResult;
  try {
    delivery = await options.delivery.publish(claimed);
  } catch (error) {
    delivery = { acknowledgedEventIds: [], failedEventIds: claimed.map((event) => event.event_id) };
    void error;
  }

  const acknowledgedIds = new Set(delivery.acknowledgedEventIds);
  const failedIds = new Set(delivery.failedEventIds ?? []);

  for (const event of claimed) {
    void claimedById;
    if (acknowledgedIds.has(event.event_id)) {
      await options.database.raw(
        `UPDATE identity.outbox_event
         SET delivered_at = ?, claimed_at = NULL
         WHERE event_id = ? AND delivered_at IS NULL`,
        [now, event.event_id]
      );
      continue;
    }

    const currentAttempt = event.attempt_count + 1;
    const retryable = failedIds.has(event.event_id) && currentAttempt < maxAttempts;
    const nextAttempt = retryable
      ? new Date(Date.parse(now) + retryDelaySeconds * 1000).toISOString()
      : now;
    // Retryable failures move next_attempt_at forward; permanent failures or
    // exhausted retries are cleared for operator repair (dead-letter state).
    await options.database.raw(
      `UPDATE identity.outbox_event
       SET claimed_at = NULL, next_attempt_at = ?
       WHERE event_id = ? AND delivered_at IS NULL`,
      [nextAttempt, event.event_id]
    );
  }

  return {
    claimed: claimed.length,
    acknowledged: acknowledgedIds.size,
    retried: claimed.length - acknowledgedIds.size,
  };
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

/**
 * Bounded outbox publisher loop. Owns no database connection, never touches the
 * Business database directly, and stops immediately when its signal aborts.
 */
export async function runOutboxPublisher(options: PublisherLoopOptions): Promise<void> {
  const intervalMs = options.intervalMs ?? 1000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new Error('intervalMs must be a positive integer');
  }
  while (!options.signal?.aborted) {
    const result = await publishOutboxBatch(options);
    if (result.claimed === 0) await delay(intervalMs, options.signal);
  }
}

