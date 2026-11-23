import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createHash } from 'node:crypto';
import { checkRateLimit, hashIp, rollupMetric } from '../src/http-plugin.js';

const SALT = 'mw-public-services-2026';

type SqliteKnex = Knex & { destroy(): Promise<void> };

async function createDb(): Promise<SqliteKnex> {
  const knexFactory = (await import('knex')).default;
  const knex = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }) as SqliteKnex;
  await knex.schema.createTable('public_usages', (table) => {
    table.increments('id').primary();
    table.integer('tool_id').notNullable();
    table.string('user_identifier').notNullable();
    table.string('input_hash').notNullable();
    table.string('output_hash').notNullable();
    table.integer('latency_ms').notNullable().defaultTo(0);
    table.integer('status').notNullable().defaultTo(200);
    table.datetime('created_at').notNullable();
  });
  await knex.schema.createTable('public_metrics', (table) => {
    table.increments('id').primary();
    table.integer('tool_id').notNullable();
    table.string('date').notNullable();
    table.integer('calls').notNullable().defaultTo(0);
    table.integer('unique_users').notNullable().defaultTo(0);
    table.float('avg_latency').notNullable().defaultTo(0);
    table.integer('errors').notNullable().defaultTo(0);
    table.integer('charity_attribution_minor').notNullable().defaultTo(0);
    table.datetime('created_at');
    table.datetime('updated_at');
  });
  return knex;
}

describe('hashIp (user_identifier)', () => {
  it('produces sha256 of ip+salt', () => {
    const expected = createHash('sha256').update('1.2.3.4' + SALT).digest('hex');
    expect(hashIp('1.2.3.4')).toBe(expected);
  });

  it('is deterministic and anonymizing', () => {
    expect(hashIp('10.0.0.1')).toBe(hashIp('10.0.0.1'));
    expect(hashIp('10.0.0.1')).not.toBe('10.0.0.1');
    expect(hashIp('10.0.0.1')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('differs per ip', () => {
    expect(hashIp('10.0.0.1')).not.toBe(hashIp('10.0.0.2'));
  });
});

describe('checkRateLimit (window)', () => {
  let db: SqliteKnex;

  beforeEach(async () => {
    db = await createDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function insertUsage(toolId: number, userIdentifier: string, minutesAgo: number): Promise<void> {
    await db('public_usages').insert({
      tool_id: toolId,
      user_identifier: userIdentifier,
      input_hash: 'in',
      output_hash: 'out',
      latency_ms: 1,
      status: 200,
      created_at: new Date(Date.now() - minutesAgo * 60_000),
    });
  }

  it('allows below limit within window', async () => {
    await insertUsage(1, hashIp('1.1.1.1'), 0);
    await insertUsage(1, hashIp('1.1.1.1'), 0);
    const allowed = await checkRateLimit(db, 1, hashIp('1.1.1.1'), 3);
    expect(allowed).toBe(true);
  });

  it('blocks at limit within window', async () => {
    for (let i = 0; i < 5; i++) {
      await insertUsage(1, hashIp('1.1.1.1'), 0);
    }
    const allowed = await checkRateLimit(db, 1, hashIp('1.1.1.1'), 5);
    expect(allowed).toBe(false);
  });

  it('ignores usage older than the 60s window', async () => {
    await insertUsage(1, hashIp('1.1.1.1'), 2);
    await insertUsage(1, hashIp('1.1.1.1'), 5);
    const allowed = await checkRateLimit(db, 1, hashIp('1.1.1.1'), 1);
    expect(allowed).toBe(true);
  });

  it('isolates by tool and user', async () => {
    await insertUsage(1, hashIp('1.1.1.1'), 0);
    await insertUsage(2, hashIp('1.1.1.1'), 0);
    await insertUsage(1, hashIp('2.2.2.2'), 0);
    expect(await checkRateLimit(db, 1, hashIp('2.2.2.2'), 2)).toBe(true);
    expect(await checkRateLimit(db, 2, hashIp('1.1.1.1'), 1)).toBe(false);
  });
});

describe('rollupMetric (idempotent upsert by tool+date)', () => {
  let db: SqliteKnex;

  beforeEach(async () => {
    db = await createDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('inserts first rollup row', async () => {
    await rollupMetric(db, 1, '2026-11-24', 100, false);
    const row = await db('public_metrics').where({ tool_id: 1, date: '2026-11-24' }).first();
    expect(row.calls).toBe(1);
    expect(row.errors).toBe(0);
    expect(row.avg_latency).toBe(100);
  });

  it('upserts incrementally on repeat calls', async () => {
    await rollupMetric(db, 1, '2026-11-24', 100, false);
    await rollupMetric(db, 1, '2026-11-24', 200, true);
    const rows = await db('public_metrics').where({ tool_id: 1, date: '2026-11-24' });
    expect(rows).toHaveLength(1);
    expect(rows[0].calls).toBe(2);
    expect(rows[0].errors).toBe(1);
    expect(rows[0].avg_latency).toBe(150);
  });

  it('keeps tool+date rows independent', async () => {
    await rollupMetric(db, 1, '2026-11-24', 100, false);
    await rollupMetric(db, 2, '2026-11-24', 50, false);
    await rollupMetric(db, 1, '2026-11-25', 75, false);
    const rows = await db('public_metrics').orderBy('id');
    expect(rows).toHaveLength(3);
    expect(rows[2].tool_id).toBe(1);
    expect(rows[2].date).toBe('2026-11-25');
  });
});
