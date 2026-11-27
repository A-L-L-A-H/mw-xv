import { D1DatabaseAdapter } from './adapters/d1-adapter.js';
import { SqliteDatabaseAdapter } from './adapters/sqlite-adapter.js';
import { TursoDatabaseAdapter } from './adapters/turso-adapter.js';
import type {
  DatabaseConfig,
  DatabaseConnection,
  DatabaseDriverType,
  OutboxEventInput,
  OutboxRepository,
  TransactionConnection,
} from './binding-types.js';

export * from './binding-types.js';
export { D1DatabaseAdapter } from './adapters/d1-adapter.js';
export { SqliteDatabaseAdapter } from './adapters/sqlite-adapter.js';
export { TursoDatabaseAdapter } from './adapters/turso-adapter.js';

const DRIVER_FACTORIES: Record<DatabaseDriverType, (config: DatabaseConfig) => DatabaseConnection> = {
  sqlite: (config) => new SqliteDatabaseAdapter(config),
  d1: (config) => new D1DatabaseAdapter(config),
  turso: (config) => new TursoDatabaseAdapter(config),
};

/**
 * Factory function to instantiate the unified connection across SQLite, D1, and Turso.
 */
export function createDatabaseConnection(config: DatabaseConfig): DatabaseConnection {
  const factory = DRIVER_FACTORIES[config.driver];
  if (!factory) {
    throw new Error(`Unsupported database driver: ${String(config.driver)}`);
  }
  return factory(config);
}

export const OUTBOX_EVENTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS outbox_events (
    id TEXT PRIMARY KEY,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP
);
`.trim();

function generateOutboxId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * SQL-backed OutboxRepository persisting events within the caller's transaction boundary.
 */
export class SqlOutboxRepository implements OutboxRepository {
  public async ensureSchema(db: DatabaseConnection): Promise<void> {
    await db.query(OUTBOX_EVENTS_TABLE_SQL);
  }

  public async enqueue(trx: TransactionConnection, event: OutboxEventInput): Promise<void> {
    if (!event.aggregateType || !event.aggregateId || !event.eventType) {
      throw new Error('Outbox event requires aggregateType, aggregateId, and eventType.');
    }
    const id = generateOutboxId();
    const serializedPayload = JSON.stringify(event.payload ?? null);
    await trx.query(
      'INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload, status) VALUES (?, ?, ?, ?, ?, ?)',
      [id, event.aggregateType, event.aggregateId, event.eventType, serializedPayload, 'PENDING']
    );
  }
}

/**
 * Executes business logic and enqueues outbox events atomically within a single transaction.
 */
export async function executeTransactionalOutbox<T>(
  db: DatabaseConnection,
  outboxRepo: OutboxRepository,
  work: (trx: TransactionConnection, outboxRepo: OutboxRepository) => Promise<T>
): Promise<T> {
  if (!outboxRepo || typeof outboxRepo.enqueue !== 'function') {
    throw new TypeError('executeTransactionalOutbox requires a valid OutboxRepository.');
  }
  return db.transaction(async (trx) => {
    return work(trx, outboxRepo);
  });
}
