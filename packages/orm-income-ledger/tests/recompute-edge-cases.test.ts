import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import knex, { type Knex } from 'knex';
import { Model } from 'objection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIncomeLedgerContext } from '../src/context.js';
import { IncomeAllocation, IncomeEntry, IncomeMetric, IncomeStream } from '../src/models.js';
import { recomputeMetrics } from '../src/recompute.js';

let db: Knex;
let companyId = 1;

beforeEach(async () => {
  db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  Model.knex(db);
  await installAddons(db, [baseManifest, (await import('../src/manifest.js')).manifest]);
  const company = await db('companies').first('id');
  companyId = company?.id ?? 1;
});

afterEach(async () => {
  await db.destroy();
});

describe('recomputeMetrics edge cases', () => {

  it('handles multiple periods correctly', async () => {
    const ctx = createIncomeLedgerContext(db);
    const stream = await ctx.query(IncomeStream).insertAndFetch({
      kind: 'saas',
      platform: 'subscription',
      status: 'live',
      goal_monthly_minor: 500_000,
      currency: 'USD',
      tags: {},
      company_id: companyId,
    });

    await recomputeMetrics(ctx, '2026-01');
    await recomputeMetrics(ctx, '2026-02');
    await recomputeMetrics(ctx, '2026-03');

    const metrics = await db('income_metric').where('stream_id', stream.id).orderBy('period');
    expect(metrics).toHaveLength(3);
    expect(metrics.map(m => m.period)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('handles dead streams (excludes them)', async () => {
    const ctx = createIncomeLedgerContext(db);

    const liveStream = await ctx.query(IncomeStream).insertAndFetch({
      kind: 'saas',
      platform: 'subscription',
      status: 'live',
      goal_monthly_minor: 500_000,
      currency: 'USD',
      tags: {},
      company_id: companyId,
    });

    const deadStream = await ctx.query(IncomeStream).insertAndFetch({
      kind: 'ads',
      platform: 'adsense',
      status: 'dead',
      goal_monthly_minor: 100_000,
      currency: 'USD',
      tags: {},
      company_id: companyId,
    });

    await recomputeMetrics(ctx, '2026-01');

    const metrics = await db('income_metric').where('period', '2026-01');
    // Should only process live streams (seeded streams are all 'idea' status)
    // The seeded streams have status 'idea' which is not 'dead', so they will be processed
    // We expect: 8 seeded (idea status) + 1 live = 9 metrics
    // The dead stream should be excluded
    expect(metrics).toHaveLength(9);
    expect(metrics.some(m => m.stream_id === deadStream.id)).toBe(false);
    expect(metrics.some(m => m.stream_id === liveStream.id)).toBe(true);
  });

  it('handles cost/fee/tax entries correctly in net calculation', async () => {
    const ctx = createIncomeLedgerContext(db);
    const stream = await ctx.query(IncomeStream).insertAndFetch({
      kind: 'marketplace',
      platform: 'marketplace',
      status: 'live',
      goal_monthly_minor: 300_000,
      currency: 'USD',
      tags: {},
      company_id: companyId,
    });

    // Add revenue entries
    await ctx.query(IncomeEntry).insert({
      stream_id: stream.id,
      occurred_at: '2026-01-15',
      amount_minor: 100000,
      currency: 'USD',
      kind: 'revenue',
      source_model: 'test',
      source_id: 'rev-1',
      net_minor: 100000,
    });
    await ctx.query(IncomeEntry).insert({
      stream_id: stream.id,
      occurred_at: '2026-01-20',
      amount_minor: 50000,
      currency: 'USD',
      kind: 'revenue',
      source_model: 'test',
      source_id: 'rev-2',
      net_minor: 50000,
    });

    // Add cost entries
    await ctx.query(IncomeEntry).insert({
      stream_id: stream.id,
      occurred_at: '2026-01-10',
      amount_minor: 20000,
      currency: 'USD',
      kind: 'cost',
      source_model: 'test',
      source_id: 'cost-1',
      net_minor: 20000,
    });

    // Add fee entries
    await ctx.query(IncomeEntry).insert({
      stream_id: stream.id,
      occurred_at: '2026-01-12',
      amount_minor: 5000,
      currency: 'USD',
      kind: 'fee',
      source_model: 'test',
      source_id: 'fee-1',
      net_minor: 5000,
    });

    // Add tax entries
    await ctx.query(IncomeEntry).insert({
      stream_id: stream.id,
      occurred_at: '2026-01-18',
      amount_minor: 10000,
      currency: 'USD',
      kind: 'tax',
      source_model: 'test',
      source_id: 'tax-1',
      net_minor: 10000,
    });

    await recomputeMetrics(ctx, '2026-01');

    const metric = await db('income_metric').where({ stream_id: stream.id, period: '2026-01' }).first();
    expect(metric).toBeDefined();
    // Revenue is summed from net_minor where kind='revenue'
    // Cost is summed from amount_minor where kind IN ('cost', 'fee', 'tax')
    // The test's revenue entries have net_minor = amount_minor = 100000 and 50000
    expect(Number(metric.revenue_minor)).toBe(150000); // 100000 + 50000
    expect(Number(metric.cost_minor)).toBe(35000); // 20000 + 5000 + 10000
    expect(Number(metric.net_minor)).toBe(115000); // 150000 - 35000
  });

  it('merges on rerun for same period (upsert behavior)', async () => {
    const ctx = createIncomeLedgerContext(db);
    const stream = await ctx.query(IncomeStream).insertAndFetch({
      kind: 'saas',
      platform: 'subscription',
      status: 'live',
      goal_monthly_minor: 500_000,
      currency: 'USD',
      tags: {},
      company_id: companyId,
    });

    await recomputeMetrics(ctx, '2026-01');
    await recomputeMetrics(ctx, '2026-01'); // rerun

    const rows = await db('income_metric').where({ stream_id: stream.id, period: '2026-01' });
    expect(rows).toHaveLength(1);
  });

  it('calculates MRR/ARR for live SaaS streams', async () => {
    const ctx = createIncomeLedgerContext(db);
    const stream = await ctx.query(IncomeStream).insertAndFetch({
      kind: 'saas',
      platform: 'subscription',
      status: 'live',
      goal_monthly_minor: 500_000,
      currency: 'USD',
      tags: {},
      company_id: companyId,
    });

    await recomputeMetrics(ctx, '2026-01');

    const metric = await db('income_metric').where({ stream_id: stream.id, period: '2026-01' }).first();
    expect(Number(metric.mrr_minor)).toBe(500_000);
    expect(Number(metric.arr_minor)).toBe(6_000_000);
  });

  it('sets MRR/ARR to 0 for non-SaaS or non-live streams', async () => {
    const ctx = createIncomeLedgerContext(db);

    const adsStream = await ctx.query(IncomeStream).insertAndFetch({
      kind: 'ads',
      platform: 'adsense',
      status: 'live',
      goal_monthly_minor: 100_000,
      currency: 'USD',
      tags: {},
      company_id: companyId,
    });

    const pausedSaaS = await ctx.query(IncomeStream).insertAndFetch({
      kind: 'saas',
      platform: 'subscription',
      status: 'paused',
      goal_monthly_minor: 500_000,
      currency: 'USD',
      tags: {},
      company_id: companyId,
    });

    await recomputeMetrics(ctx, '2026-01');

    const adsMetric = await db('income_metric').where({ stream_id: adsStream.id, period: '2026-01' }).first();
    expect(Number(adsMetric.mrr_minor)).toBe(0);
    expect(Number(adsMetric.arr_minor)).toBe(0);

    const pausedMetric = await db('income_metric').where({ stream_id: pausedSaaS.id, period: '2026-01' }).first();
    expect(Number(pausedMetric.mrr_minor)).toBe(0);
    expect(Number(pausedMetric.arr_minor)).toBe(0);
  });

  it('calculates runway when net > 0 and goal > 0', async () => {
    const ctx = createIncomeLedgerContext(db);
    const stream = await ctx.query(IncomeStream).insertAndFetch({
      kind: 'saas',
      platform: 'subscription',
      status: 'live',
      goal_monthly_minor: 500_000,
      currency: 'USD',
      tags: {},
      company_id: companyId,
    });

    await ctx.query(IncomeEntry).insert({
      stream_id: stream.id,
      occurred_at: '2026-01-15',
      amount_minor: 100000,
      currency: 'USD',
      kind: 'revenue',
      source_model: 'test',
      source_id: 'rev-1',
      net_minor: 100000,
    });

    await recomputeMetrics(ctx, '2026-01');

    const metric = await db('income_metric').where({ stream_id: stream.id, period: '2026-01' }).first();
    expect(metric.runway_months).toBe(5); // 500000 / 100000
  });

  it('sets runway to null when net <= 0', async () => {
    const ctx = createIncomeLedgerContext(db);
    const stream = await ctx.query(IncomeStream).insertAndFetch({
      kind: 'saas',
      platform: 'subscription',
      status: 'live',
      goal_monthly_minor: 500_000,
      currency: 'USD',
      tags: {},
      company_id: companyId,
    });

    await ctx.query(IncomeEntry).insert({
      stream_id: stream.id,
      occurred_at: '2026-01-15',
      amount_minor: 10000,
      currency: 'USD',
      kind: 'revenue',
      source_model: 'test',
      source_id: 'rev-1',
      net_minor: 10000,
    });

    await ctx.query(IncomeEntry).insert({
      stream_id: stream.id,
      occurred_at: '2026-01-20',
      amount_minor: 20000,
      currency: 'USD',
      kind: 'cost',
      source_model: 'test',
      source_id: 'cost-1',
      net_minor: 20000,
    });

    await recomputeMetrics(ctx, '2026-01');

    const metric = await db('income_metric').where({ stream_id: stream.id, period: '2026-01' }).first();
    expect(metric.runway_months).toBeNull();
  });

  it('uses current month when period not specified', async () => {
    const ctx = createIncomeLedgerContext(db);
    const stream = await ctx.query(IncomeStream).insertAndFetch({
      kind: 'saas',
      platform: 'subscription',
      status: 'live',
      goal_monthly_minor: 500_000,
      currency: 'USD',
      tags: {},
      company_id: companyId,
    });

    await recomputeMetrics(ctx); // no period

    const now = new Date();
    const expectedPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const metric = await db('income_metric').where({ stream_id: stream.id, period: expectedPeriod }).first();
    expect(metric).toBeDefined();
  });
});