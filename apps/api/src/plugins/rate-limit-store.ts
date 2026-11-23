import type { Knex } from 'knex';

export interface DistributedRateLimitEntry {
  current: number;
  ttl: number;
}

export interface FastifyRateLimitRouteOptions {
  timeWindow?: number | string;
}

const DURATION_UNITS_MS: Readonly<Record<string, number>> = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1_000,
  sec: 1_000,
  secs: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
};

export function parseTimeWindowMs(value: number | string | undefined, fallbackMs: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return fallbackMs;
    if (/^\d+(?:\.\d+)?$/u.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    }
    const match = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/u.exec(trimmed);
    if (match) {
      const amount = Number(match[1]);
      const unitMs = DURATION_UNITS_MS[match[2]!];
      if (Number.isFinite(amount) && amount > 0 && unitMs) {
        return Math.floor(amount * unitMs);
      }
    }
  }
  return fallbackMs;
}

/**
 * Knex/PostgreSQL-backed store compatible with @fastify/rate-limit custom stores.
 * Uses atomic upsert + expiry reset so multi-replica API containers share rate limits.
 */
export class PostgresRateLimitStore {
  private readonly db: Knex;
  private readonly timeWindowMs: number;
  private tableReadyPromise: Promise<void> | null = null;

  constructor(
    db: Knex,
    timeWindowMs: number | string = 60_000,
    sharedTableReady?: Promise<void> | null
  ) {
    this.db = db;
    this.timeWindowMs = parseTimeWindowMs(timeWindowMs, 60_000);
    this.tableReadyPromise = sharedTableReady ?? null;
  }

  getTimeWindowMs(): number {
    return this.timeWindowMs;
  }

  private async ensureTable(): Promise<void> {
    if (!this.tableReadyPromise) {
      this.tableReadyPromise = (async () => {
        const exists = await this.db.schema.hasTable('_api_rate_limits');
        if (!exists) {
          await this.db.schema.createTable('_api_rate_limits', (table) => {
            table.string('key', 512).primary();
            table.integer('hit_count').notNullable();
            table.bigInteger('expires_at_ms').notNullable();
          });
        }
      })();
    }
    return this.tableReadyPromise;
  }

  async pruneExpired(nowMs = Date.now()): Promise<number> {
    await this.ensureTable();
    return this.db('_api_rate_limits').where('expires_at_ms', '<=', nowMs).del();
  }

  async incr(
    key: string,
    cb: (error: Error | null, result?: DistributedRateLimitEntry) => void,
    timeWindow?: number | string
  ): Promise<void> {
    try {
      await this.ensureTable();
      const windowMs = parseTimeWindowMs(timeWindow, this.timeWindowMs);
      const now = Date.now();
      const nextExpiry = now + windowMs;
      const isPostgres = this.db.client?.config?.client === 'pg';
      if (isPostgres) {
        const result = (await this.db.raw(
          `INSERT INTO "_api_rate_limits" ("key", "hit_count", "expires_at_ms")
           VALUES (?, 1, ?)
           ON CONFLICT ("key") DO UPDATE SET
             "hit_count" = CASE
               WHEN "_api_rate_limits"."expires_at_ms" <= ? THEN 1
               ELSE "_api_rate_limits"."hit_count" + 1
             END,
             "expires_at_ms" = CASE
               WHEN "_api_rate_limits"."expires_at_ms" <= ? THEN ?
               ELSE "_api_rate_limits"."expires_at_ms"
             END
           RETURNING "hit_count", "expires_at_ms"`,
          [key, nextExpiry, now, now, nextExpiry]
        )) as { rows?: { hit_count: number; expires_at_ms: string | number }[] };
        const row = result.rows?.[0];
        const current = Number(row?.hit_count ?? 1);
        const ttl = Math.max(0, Number(row?.expires_at_ms ?? nextExpiry) - now);
        cb(null, { current, ttl });
        return;
      }

      const entry = await this.db.transaction(async (trx) => {
        const existing = (await trx('_api_rate_limits').where({ key }).first()) as
          { hit_count: number; expires_at_ms: number | string } | undefined;
        if (!existing || Number(existing.expires_at_ms) <= now) {
          await trx('_api_rate_limits')
            .insert({ key, hit_count: 1, expires_at_ms: nextExpiry })
            .onConflict('key')
            .merge();
          return { current: 1, ttl: windowMs };
        }
        const nextHits = Number(existing.hit_count) + 1;
        await trx('_api_rate_limits').where({ key }).update({ hit_count: nextHits });
        return { current: nextHits, ttl: Math.max(0, Number(existing.expires_at_ms) - now) };
      });
      cb(null, entry);
    } catch (error) {
      cb(error instanceof Error ? error : new Error(String(error)));
    }
  }

  child(routeOptions: FastifyRateLimitRouteOptions): PostgresRateLimitStore {
    return new PostgresRateLimitStore(
      this.db,
      parseTimeWindowMs(routeOptions?.timeWindow, this.timeWindowMs),
      this.tableReadyPromise
    );
  }
}

export function createPostgresRateLimitStoreCtor(
  db: Knex
): new (options?: FastifyRateLimitRouteOptions) => PostgresRateLimitStore {
  return class BoundPostgresRateLimitStore extends PostgresRateLimitStore {
    constructor(options: FastifyRateLimitRouteOptions = {}) {
      super(db, parseTimeWindowMs(options.timeWindow, 60_000));
    }
  };
}
