import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import knex, { type Knex } from 'knex';
import { Model } from 'objection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIncomeLedgerContext } from '../src/context.js';
import { computeAllocationSplit } from '../src/index.js';
import { manifest } from '../src/manifest.js';
import { IncomeStream } from '../src/models.js';
import { recomputeMetrics } from '../src/recompute.js';
import { incomeLedgerSeedManifest } from '../src/seed-manifest.js';

let db: Knex;

beforeEach(async () => {
  db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  Model.knex(db);
  await installAddons(db, [baseManifest, manifest]);
});

afterEach(async () => {
  await db.destroy();
});

describe('income ledger manifest', () => {
  it('declares the addon shape', () => {
    expect(manifest.name).toBe('income');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.depends).toEqual(['base']);
    expect(manifest.models).toHaveLength(5);
    const ownModels = new Set(manifest.models.map((model) => model.modelName));
    expect((manifest.data ?? []).some((record) => ownModels.has(record.model.modelName))).toBe(true);
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
    const seedDb = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    try {
      await seedDb.schema.createTable('income_stream', (table) => {
        table.increments('id').primary();
        table.string('kind').notNullable();
        table.string('platform').nullable();
        table.string('status').notNullable();
        table.integer('goal_monthly_minor').notNullable();
        table.string('currency').notNullable();
        table.json('tags');
        table.integer('company_id').nullable();
        table.datetime('created_at');
        table.datetime('updated_at');
      });

      const first = await incomeLedgerSeedManifest.seed({ db: seedDb });
      expect(first.inserted).toBe(8);
      expect(first.updated).toBe(0);
      expect(first.skipped).toBe(0);

      const count = await seedDb('income_stream').count({ count: '*' });
      expect(Number(count[0].count)).toBe(8);

      const saas = await seedDb('income_stream').where({ kind: 'saas', platform: 'subscription' }).first();
      expect(saas.status).toBe('idea');
      expect(saas.goal_monthly_minor).toBe(500_000);

      const second = await incomeLedgerSeedManifest.seed({ db: seedDb });
      expect(second.inserted).toBe(0);
      expect(second.updated).toBe(8);
    } finally {
      await seedDb.destroy();
    }
  });
});

describe('recomputeMetrics', () => {
  it('computes net metrics for a period and merges on rerun', async () => {
    const ctx = createIncomeLedgerContext(db);
    const company = await db('companies').first('id');
    expect(company).toBeDefined();

    const stream = await ctx.query(IncomeStream).insertAndFetch({
      kind: 'saas',
      platform: 'subscription',
      status: 'live',
      goal_monthly_minor: 500_000,
      currency: 'USD',
      tags: {},
      company_id: Number(company.id),
    });

    await recomputeMetrics(ctx, '2026-01');

    const metrics = await db('income_metric').where({ stream_id: stream.id, period: '2026-01' }).first();
    expect(metrics).toBeDefined();
    expect(Number(metrics.revenue_minor)).toBe(0);
    expect(Number(metrics.mrr_minor)).toBe(500_000);
    expect(Number(metrics.arr_minor)).toBe(6_000_000);

    await recomputeMetrics(ctx, '2026-01');
    const rows = await db('income_metric').where({ stream_id: stream.id, period: '2026-01' });
    expect(rows).toHaveLength(1);
  });
});
