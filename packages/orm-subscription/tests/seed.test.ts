import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { manifest as crmManifest } from '@moonwitness/orm-crm';
import { manifest as salesManifest } from '@moonwitness/orm-sales';
import {
  SUBSCRIPTION_SEED_VERSION,
  Subscription,
  SubscriptionInvoiceLine,
  SubscriptionPlan,
  SubscriptionTagLink,
  buildSubscriptionInitialSeed,
  manifest,
  seedSubscriptionInitialData,
} from '../src/index.js';

interface CountRow {
  count: number | string;
}

interface IdRow {
  id: number | string;
}

function countValue(row: CountRow | undefined): number {
  return Number(row?.count ?? 0);
}

describe('@moonwitness/orm-subscription initial seed module', () => {
  let db: Knex;

  beforeEach(() => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      pool: {
        afterCreate(
          connection: { pragma(sql: string): unknown },
          done: (error: Error | null, connection: unknown) => void
        ) {
          connection.pragma('foreign_keys = ON');
          done(null, connection);
        },
      },
    });
  });

  afterEach(async () => db.destroy());

  it('builds a deterministic, schema-valid subscription seed bundle with consistent relations', () => {
    const firstBundle = buildSubscriptionInitialSeed();
    const secondBundle = buildSubscriptionInitialSeed();

    expect(firstBundle).toEqual(secondBundle);
    expect(firstBundle).not.toBe(secondBundle);
    expect(firstBundle.version).toBe(SUBSCRIPTION_SEED_VERSION);
    expect(firstBundle.plans).toHaveLength(4);
    expect(firstBundle.subscriptions).toHaveLength(4);
    expect(firstBundle.invoiceLines).toHaveLength(6);
    expect(firstBundle.tagLinks).toHaveLength(2);

    const planCodes = firstBundle.plans.map((plan) => plan.code);
    const planNames = firstBundle.plans.map((plan) => plan.name);
    const subscriptionNames = firstBundle.subscriptions.map((subscription) => subscription.name);
    expect(new Set(planCodes).size).toBe(planCodes.length);
    expect(new Set(planNames).size).toBe(planNames.length);
    expect(new Set(subscriptionNames).size).toBe(subscriptionNames.length);
    expect(planCodes).toEqual([
      'basic-monthly',
      'pro-monthly',
      'business-quarterly',
      'enterprise-yearly',
    ]);
    expect(subscriptionNames).toEqual([
      'SUB-2026-0001',
      'SUB-2026-0002',
      'SUB-2026-0003',
      'SUB-2026-0004',
    ]);

    const planCodeSet = new Set(planCodes);
    for (const plan of firstBundle.plans) {
      expect(plan.name.length).toBeGreaterThan(0);
      expect(plan.amountMinor).toBeGreaterThan(0);
      expect(plan.currency).toMatch(/^[A-Z]{3}$/);
      expect(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).toContain(plan.interval);
      expect(plan.intervalCount).toBeGreaterThan(0);
      expect(plan.trialDays).toBeGreaterThanOrEqual(0);
      expect(plan.isActive).toBe(true);
    }

    for (const subscription of firstBundle.subscriptions) {
      expect(planCodeSet.has(subscription.planCode)).toBe(true);
      expect(subscription.partnerEmail).toMatch(/^[^@]+@[^@]+\.[^@]+$/);
      expect(subscription.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(subscription.nextInvoiceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(subscription.amountMinor).toBeGreaterThan(0);
      expect(subscription.currency).toMatch(/^[A-Z]{3}$/);
      expect(['draft', 'pending', 'active', 'paused', 'cancelled', 'expired']).toContain(
        subscription.state
      );
      expect(['system', 'superadmin']).toContain(subscription.assignedToLogin);
    }

    const lineKeys = firstBundle.invoiceLines.map(
      (line) => `${line.subscriptionName}:${line.sequence}`
    );
    expect(new Set(lineKeys).size).toBe(lineKeys.length);
    for (const line of firstBundle.invoiceLines) {
      expect(subscriptionNames).toContain(line.subscriptionName);
      expect(line.quantity).toBeGreaterThan(0);
      expect(line.unitPriceMinor).toBeGreaterThan(0);
      expect(line.subtotalMinor).toBeGreaterThanOrEqual(0);
      expect(line.discountPercent).toBeGreaterThanOrEqual(0);
      expect(line.discountPercent).toBeLessThanOrEqual(100);
      expect(line.invoiceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    const subscriptionNameSet = new Set(subscriptionNames);
    for (const link of firstBundle.tagLinks) {
      expect(subscriptionNameSet.has(link.subscriptionName)).toBe(true);
      expect(link.resourceModel).toBe(Subscription.modelName);
    }

    const mutableBundle = buildSubscriptionInitialSeed() as {
      plans: Array<{ name: string }>;
    };
    mutableBundle.plans[0]!.name = 'Mutated Plan';
    expect(buildSubscriptionInitialSeed()).toEqual(firstBundle);
  });

  it('seeds subscriptions idempotently with valid schema rows and foreign keys', async () => {
    const schemaOnlySubscriptionManifest = { ...manifest, data: [] } as typeof manifest;
    await installAddons(db, [
      baseManifest,
      crmManifest,
      salesManifest,
      schemaOnlySubscriptionManifest,
    ]);

    const firstRun = await seedSubscriptionInitialData(db);
    expect(firstRun.companyId).toBe(1);
    expect(firstRun.insertedPlans).toBe(4);
    expect(firstRun.insertedSubscriptions).toBe(4);
    expect(firstRun.insertedInvoiceLines).toBe(6);
    expect(firstRun.insertedTagLinks).toBe(2);
    expect(firstRun.plansTotal).toBe(4);
    expect(firstRun.subscriptionsTotal).toBe(4);
    expect(firstRun.invoiceLinesTotal).toBe(6);
    expect(firstRun.tagLinksTotal).toBe(2);

    const secondRun = await seedSubscriptionInitialData(db);
    expect(secondRun.plansTotal).toBe(firstRun.plansTotal);
    expect(secondRun.subscriptionsTotal).toBe(firstRun.subscriptionsTotal);
    expect(secondRun.invoiceLinesTotal).toBe(firstRun.invoiceLinesTotal);
    expect(secondRun.tagLinksTotal).toBe(firstRun.tagLinksTotal);
    expect(secondRun.insertedPlans).toBe(0);
    expect(secondRun.insertedSubscriptions).toBe(0);
    expect(secondRun.insertedInvoiceLines).toBe(0);
    expect(secondRun.insertedTagLinks).toBe(0);

    expect(
      countValue(await db(SubscriptionPlan.tableName).count<CountRow>({ count: '*' }).first())
    ).toBe(4);
    expect(
      countValue(await db(Subscription.tableName).count<CountRow>({ count: '*' }).first())
    ).toBe(4);
    expect(
      countValue(
        await db(SubscriptionInvoiceLine.tableName).count<CountRow>({ count: '*' }).first()
      )
    ).toBe(6);
    expect(
      countValue(await db(SubscriptionTagLink.tableName).count<CountRow>({ count: '*' }).first())
    ).toBe(2);

    const bundle = buildSubscriptionInitialSeed();
    const planRows = await db(SubscriptionPlan.tableName).select<IdRow[]>('id', 'code');
    const planIdByCode = new Map(planRows.map((row) => [String(row.code), Number(row.id)]));
    for (const plan of bundle.plans) {
      expect(planIdByCode.has(plan.code)).toBe(true);
    }

    const partnerRows = await db('partners').select<IdRow[]>('id', 'email');
    const partnerIdByEmail = new Map(partnerRows.map((row) => [String(row.email), Number(row.id)]));
    const userRows = await db('users').select<IdRow[]>('id', 'login');
    const userIdByLogin = new Map(userRows.map((row) => [String(row.login), Number(row.id)]));
    const saleOrderRows = await db('sale_orders').select<IdRow[]>('id', 'name');
    const saleOrderIdByName = new Map(
      saleOrderRows.map((row) => [String(row.name), Number(row.id)])
    );
    const tagRows = await db('tags').select<IdRow[]>('id', 'name');
    const tagIdByName = new Map(tagRows.map((row) => [String(row.name), Number(row.id)]));

    const subscriptionRows = await db(Subscription.tableName).select(
      'id',
      'name',
      'company_id',
      'partner_id',
      'plan_id',
      'sale_order_id',
      'assigned_to_id'
    );
    expect(subscriptionRows).toHaveLength(4);
    for (const subscription of bundle.subscriptions) {
      const row = subscriptionRows.find((candidate) => candidate.name === subscription.name);
      expect(row).toBeDefined();
      expect(Number(row?.company_id)).toBe(firstRun.companyId);
      expect(Number(row?.partner_id)).toBe(partnerIdByEmail.get(subscription.partnerEmail));
      expect(Number(row?.plan_id)).toBe(planIdByCode.get(subscription.planCode));
      expect(Number(row?.assigned_to_id)).toBe(userIdByLogin.get(subscription.assignedToLogin));
      expect(
        subscription.saleOrderName === null ? row?.sale_order_id : Number(row?.sale_order_id)
      ).toBe(
        subscription.saleOrderName === null
          ? null
          : saleOrderIdByName.get(subscription.saleOrderName)
      );
    }

    const invoiceLineRows = await db(SubscriptionInvoiceLine.tableName).select(
      'id',
      'subscription_id',
      'sequence'
    );
    expect(invoiceLineRows).toHaveLength(6);
    for (const line of bundle.invoiceLines) {
      const parentId = subscriptionRows.find((row) => row.name === line.subscriptionName)?.id;
      expect(parentId).toBeDefined();
      expect(
        invoiceLineRows.some(
          (row) =>
            Number(row.subscription_id) === Number(parentId) &&
            Number(row.sequence) === line.sequence
        )
      ).toBe(true);
    }

    const tagLinkRows = await db(SubscriptionTagLink.tableName).select(
      'tag_id',
      'resource_model',
      'resource_id'
    );
    expect(tagLinkRows).toHaveLength(2);
    for (const link of bundle.tagLinks) {
      const targetId = subscriptionRows.find((row) => row.name === link.subscriptionName)?.id;
      expect(targetId).toBeDefined();
      expect(
        tagLinkRows.some(
          (row) =>
            Number(row.tag_id) === tagIdByName.get(link.tagName) &&
            row.resource_model === link.resourceModel &&
            Number(row.resource_id) === Number(targetId)
        )
      ).toBe(true);
    }
  });
});
