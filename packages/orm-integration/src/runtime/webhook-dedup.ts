import type { Knex } from 'knex';

/**
 * Durable, database-backed webhook deduplication for integration webhooks.
 * Uses a unique constraint on (company_id, event_id, endpoint_id) for atomic check-and-insert.
 */

export interface WebhookDeduplicatorOptions {
  readonly db: Knex;
  readonly windowMs?: number;
}

export class DurableWebhookDeduplicator {
  private readonly db: Knex;
  private readonly windowMs: number;

  constructor(options: WebhookDeduplicatorOptions) {
    this.db = options.db;
    this.windowMs = options.windowMs ?? 24 * 60 * 60 * 1_000; // 24 hours
  }

  /**
   * Atomically checks if a webhook has been processed for an endpoint and marks it if not.
   * Returns `true` if this is the first sighting (caller should process),
   * or `false` if it is a duplicate within the idempotency window.
   */
  async tryAcquire(companyId: number, eventId: number, endpointId: number): Promise<boolean> {
    if (!eventId) return true;

    const now = Date.now();
    const expiresAt = new Date(now + this.windowMs).toISOString();

    try {
      const result = await this.db('integration_webhook_dedup')
        .insert({
          company_id: companyId,
          event_id: eventId,
          endpoint_id: endpointId,
          expires_at: expiresAt,
          created_at: new Date().toISOString(),
        })
        .onConflict(['company_id', 'event_id', 'endpoint_id'])
        .ignore()
        .returning(['id']);

      return result.length > 0;
    } catch (error) {
      // If the table doesn't exist yet (migrations not run), fall back to allowing
      const exists = await this.db.schema.hasTable('integration_webhook_dedup');
      if (!exists) return true;
      throw error;
    }
  }

  /** Prunes expired entries from the deduplication table. */
  async prune(now = Date.now()): Promise<number> {
    const expired = new Date(now).toISOString();
    const deleted = await this.db('integration_webhook_dedup')
      .where('expires_at', '<=', expired)
      .delete();
    return deleted;
  }
}

/**
 * Creates the webhook deduplication table migration.
 * Run this during schema sync.
 */
export async function ensureWebhookDedupTable(db: Knex): Promise<void> {
  const exists = await db.schema.hasTable('integration_webhook_dedup');
  if (exists) return;

  await db.schema.createTable('integration_webhook_dedup', (table) => {
    table.increments('id').primary();
    table.integer('company_id').notNullable();
    table.integer('event_id').notNullable();
    table.integer('endpoint_id').notNullable();
    table.string('expires_at').notNullable();
    table.string('created_at').notNullable();
    table.unique(['company_id', 'event_id', 'endpoint_id']);
    table.index(['expires_at']);
  });
}

/** Maximum age of a webhook payload before it is considered stale (5 minutes). */
export const WEBHOOK_FRESHNESS_WINDOW_MS = 5 * 60 * 1_000;

/** Validates webhook freshness by checking the timestamp is within the acceptable window. */
export function validateWebhookFreshness(timestamp: string | null, now = Date.now()): boolean {
  if (!timestamp) return false;
  const payloadTime = Date.parse(timestamp);
  if (!Number.isFinite(payloadTime)) return false;
  return now - payloadTime <= WEBHOOK_FRESHNESS_WINDOW_MS;
}