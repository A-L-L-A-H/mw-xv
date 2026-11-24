import { createContext, defineAddon } from '@moonwitness/orm';
import type { Knex } from 'knex';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest.js';
import { computeAllocationSplit } from '../src/index.js';
import { incomeLedgerSeedManifest } from '../src/seed-manifest.js';
import { IncomeStream } from '../src/models/index.js';
import { recomputeMetrics } from '../src/recompute.js';

type SqliteKnex = Knex & { destroy(): Promise<void> };

let db: SqliteKnex;

beforeEach(async () => {
  const knexFactory = (await import('knex')).default;
  db = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }) as SqliteKnex;
});

afterAll(async () => {
  await db.destroy();
});

describe('income ledger manifest', () => {
  it('declares the addon shape', () => {
    expect(manifest.namespace).toBe('income');
    expect(manifest.depends).toEqual(['base']);
    expect(manifest.models).toHaveLength(5);
  });

  it('declares the seed manifest shape', () => {
    expect(incomeLedgerSeedManifest.seedVersion).toBe('1.0.0');
    expect(incomeLedgerSeedManifest.dependencies).toEqual(['orm-base']);
    expect(typeof incomeLedgerSeedManifest.seed).toBe('function');
  });
});

describe('computeAllocationSplit', () => {
  it('sums percentages of active allocations per target', () => {
    const split = computeAllocationSplit(
      { id: 'stream-1', kind: 'saas', status: 'live', goalMonthlyMinor: 500_000 },
      [
        { target: 'reinvest', percentage: 40, isActive: true },
        { target: 'savings', percentage: 30, isActive: true },
        { target: 'charity', percentage: 10, isActive: false },
        { target: 'tax', percentage: 20, isActive: true },
      ],
    );

    expect(split).toEqual({ reinvest: 40, savings: 30, charity: 0, personal: 0, tax: 20 });
  });

  it('returns zeros when no allocations are active', () => {
    const split = computeAllocationSplit(
      { id: 'stream-1', kind: 'ads', status: 'idea', goalMonthlyMinor: 0 },
      [{ target: 'personal', percentage: 100, isActive: false }],
    );

    expect(split).toEqual({ reinvest: 0, savings: 0, charity: 0, personal: 0, tax: 0 });
  });
});

describe('seed upsert logic', () => {
  it('inserts reference streams once and updates on second run', async () => {
    await db.schema.createTable('income_stream', (table) => {
      table.string('id').primary();
      table.string('kind').notNullable();
      table.string('platform').nullable();
      table.string('status').notNullable();
      table.integer('goalMonthlyMinor').notNullable();
      table.string('currency').notNullable();
      table.json('tags');
      table.string('companyId').nullable();
      table.datetime('createdAt');
      table.datetime('updatedAt');
    });

    const first = await incomeLedgerSeedManifest.seed({ db });
    expect(first.inserted).toBe(8);
    expect(first.updated).toBe(0);
    expect(first.skipped).toBe(0);

    const count = await db('income_stream').count({ count: '*' });
    expect(Number(count[0].count)).toBe(8);

    const saas = await db('income_stream').where({ kind: 'saas', platform: 'subscription' }).first();
    expect(saas.status).toBe('idea');
    expect(saas.goalMonthlyMinor).toBe(500_000);

    const second = await incomeLedgerSeedManifest.seed({ db });
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(8);
  });
});

describe('recomputeMetrics', () => {
  it('computes net metrics for a period and merges on rerun', async () => {
    const addon = defineAddon({
      namespace: 'income',
      depends: [],
      models: [],
    });
    // Install the addon models via manifest so ctx.query works against sqlite.
    const ctx = await createContext({
      manifests: [manifest],
      connection: { client: 'better-sqlite3', connection: ':memory:' },
    });
    void addon;

    const streamId = crypto.randomUUID();
    await ctx.query(IncomeStream).insert({
      id: streamId,
      kind: 'saas',
      platform: 'subscription',
      status: 'live',
      goalMonthlyMinor: 500_000,
      currency: 'USD',
      tags: {},
    });

    await recomputeMetrics(ctx, '2026-01');

    const metrics = await ctx.knex('income_metric').where({ streamId, period: '2026-01' }).first();
    expect(metrics).toBeDefined();
    expect(Number(metrics.revenueMinor)).toBe(0);
    expect(Number(metrics.mrrMinor)).toBe(500_000);
    expect(Number(metrics.arrMinor)).toBe(6_000_000);

    await recomputeMetrics(ctx, '2026-01');
    const rows = await ctx.knex('income_metric').where({ streamId, period: '2026-01' });
    expect(rows).toHaveLength(1);

    await ctx.destroy();
  });
});
