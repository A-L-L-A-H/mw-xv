import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { manifest as crmManifest } from '@moonwitness/orm-crm';
import {
  SaleOrder,
  SaleOrderLine,
  SaleOrderState,
  SaleOrderTagLink,
  manifest,
  buildSalesInitialSeed,
  seedSalesInitialData,
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

describe('@moonwitness/orm-sales initial seed module', () => {
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

  it('builds a deterministic, schema-valid sales seed bundle with consistent foreign keys', () => {
    const firstBundle = buildSalesInitialSeed();
    const secondBundle = buildSalesInitialSeed();

    expect(firstBundle).toEqual(secondBundle);
    expect(firstBundle).not.toBe(secondBundle);
    expect(firstBundle.version).toBe('1.0.0');
    expect(firstBundle.states.length).toBe(5);
    expect(firstBundle.orders.length).toBe(4);
    expect(firstBundle.lines.length).toBe(6);

    const stateIds = new Set(firstBundle.states.map((state) => state.id));
    const stateCodes = new Set(firstBundle.states.map((state) => state.code));
    const stateNames = new Set(firstBundle.states.map((state) => state.name));
    const orderIds = new Set(firstBundle.orders.map((order) => order.id));
    const orderNames = new Set(firstBundle.orders.map((order) => order.name));
    const lineIds = new Set(firstBundle.lines.map((line) => line.id));

    expect(stateIds.size).toBe(5);
    expect(stateCodes.size).toBe(5);
    expect(stateNames.size).toBe(5);
    expect(orderIds.size).toBe(4);
    expect(orderNames.size).toBe(4);
    expect(lineIds.size).toBe(6);

    expect(firstBundle.states.map((state) => state.name)).toContain('Seed Draft');
    expect(firstBundle.states.map((state) => state.name)).toContain('Seed Sent');
    expect(firstBundle.states.map((state) => state.name)).toContain('Seed Confirmed');
    expect(firstBundle.states.map((state) => state.name)).toContain('Seed Done');
    expect(firstBundle.states.map((state) => state.name)).toContain('Seed Cancel');

    for (const state of firstBundle.states) {
      expect(state.name).toMatch(/^[A-Z][A-Za-z ]+$/);
      expect(state.color).toMatch(/^#[0-9A-F]{6}$/);
      expect(state.sequence).toBeGreaterThan(0);
      expect(state.is_done === (state.code === 'done')).toBe(true);
    }

    for (const order of firstBundle.orders) {
      expect(stateCodes.has(order.stateCode)).toBe(true);
      expect(order.partnerEmail).toMatch(/^[^@]+@[^@]+\.[^@]+$/);
      expect(order.opportunityName).toBeTruthy();
      expect(order.assignedToLogin).toBeTruthy();
      expect(order.currency).toMatch(/^[A-Z]{3}$/);
      expect(order.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (order.confirmDate !== null) {
        expect(order.confirmDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      expect(order.totalAmountMinor).toBeGreaterThan(0);
    }

    for (const line of firstBundle.lines) {
      expect(orderIds.has(line.orderId)).toBe(true);
      expect(line.product).toBeTruthy();
      expect(line.quantity).toBeGreaterThan(0);
      expect(line.unitPriceMinor).toBeGreaterThan(0);
      expect(line.discountPercent).toBeGreaterThanOrEqual(0);
      expect(line.discountPercent).toBeLessThanOrEqual(100);
      expect(line.subtotalMinor).toBeGreaterThan(0);
      expect(line.sequence).toBeGreaterThan(0);
    }

    const acmeOrder = firstBundle.orders.find(
      (order) => order.id === 'sales-seed-order-acme-workshop'
    );
    expect(acmeOrder?.partnerEmail).toBe('procurement@acme.local');
    expect(acmeOrder?.opportunityName).toBe('Acme Studio Annual Platform License');

    const mutableBundle = buildSalesInitialSeed();
    mutableBundle.states[0].name = 'Mutated';
    expect(buildSalesInitialSeed()).toEqual(firstBundle);
  });

  it('seeds sales records idempotently into the database with full relational integrity', async () => {
    await installAddons(db, [baseManifest, crmManifest, manifest]);

    const firstRun = await seedSalesInitialData(db);
    expect(firstRun.insertedStates).toBe(5);
    expect(firstRun.insertedOrders).toBe(4);
    expect(firstRun.insertedLines).toBe(6);
    expect(firstRun.insertedTagLinks).toBe(2);
    expect(firstRun.statesTotal).toBe(10);
    expect(firstRun.ordersTotal).toBe(8);
    expect(firstRun.linesTotal).toBe(14);
    expect(firstRun.tagLinksTotal).toBe(4);

    const secondRun = await seedSalesInitialData(db);
    expect(secondRun.insertedStates).toBe(0);
    expect(secondRun.insertedOrders).toBe(0);
    expect(secondRun.insertedLines).toBe(0);
    expect(secondRun.insertedTagLinks).toBe(0);
    expect(secondRun.statesTotal).toBe(firstRun.statesTotal);
    expect(secondRun.ordersTotal).toBe(firstRun.ordersTotal);
    expect(secondRun.linesTotal).toBe(firstRun.linesTotal);
    expect(secondRun.tagLinksTotal).toBe(firstRun.tagLinksTotal);

    const bundle = buildSalesInitialSeed();
    const states = await db(SaleOrderState.tableName).select('id', 'name');
    expect(states).toHaveLength(10);
    const stateIdByName = new Map(states.map((state) => [state.name, Number(state.id)]));
    for (const stateSeed of bundle.states) {
      expect(stateIdByName.has(stateSeed.name)).toBe(true);
    }

    const orderRows = await db(SaleOrder.tableName)
      .whereIn(
        'name',
        bundle.orders.map((order) => order.name)
      )
      .select(
        'id',
        'name',
        'partner_id',
        'state_id',
        'opportunity_id',
        'company_id',
        'currency',
        'total_amount_minor',
        'deadline',
        'confirm_date'
      );
    expect(orderRows).toHaveLength(4);
    const orderIdByName = new Map(orderRows.map((order) => [order.name, Number(order.id)]));
    for (const orderSeed of bundle.orders) {
      const orderRow = orderRows.find((order) => order.name === orderSeed.name);
      expect(orderRow).toBeDefined();
      expect(orderRow?.state_id).toBe(
        stateIdByName.get(bundle.states.find((s) => s.code === orderSeed.stateCode)?.name ?? '')
      );
      expect(orderRow?.currency).toBe(orderSeed.currency);
      expect(orderRow?.total_amount_minor).toBe(orderSeed.totalAmountMinor);
      expect(orderRow?.deadline).toBe(orderSeed.deadline);
      expect(orderRow?.confirm_date).toBe(orderSeed.confirmDate ?? null);
    }

    const lineRows = await db(SaleOrderLine.tableName)
      .whereIn('order_id', [...orderIdByName.values()])
      .select(
        'id',
        'order_id',
        'sequence',
        'name',
        'product',
        'quantity',
        'unit_price_minor',
        'discount_percent',
        'subtotal_minor'
      );
    expect(lineRows).toHaveLength(6);
    for (const lineSeed of bundle.lines) {
      const orderDbId = orderIdByName.get(
        bundle.orders.find((o) => o.id === lineSeed.orderId)?.name ?? ''
      );
      const lineRow = lineRows.find(
        (line) => line.order_id === orderDbId && line.sequence === lineSeed.sequence
      );
      expect(lineRow).toBeDefined();
      expect(lineRow?.name).toBe(lineSeed.name);
      expect(lineRow?.product).toBe(lineSeed.product);
      expect(lineRow?.quantity).toBe(lineSeed.quantity);
      expect(lineRow?.unit_price_minor).toBe(lineSeed.unitPriceMinor);
      expect(lineRow?.discount_percent).toBe(lineSeed.discountPercent);
      expect(lineRow?.subtotal_minor).toBe(lineSeed.subtotalMinor);
    }

    const tagLinkRows = await db(SaleOrderTagLink.tableName)
      .where({ resource_model: SaleOrder.modelName })
      .whereIn('resource_id', [...orderIdByName.values()])
      .select('tag_id', 'resource_id');
    expect(tagLinkRows).toHaveLength(2);
    expect(new Set(tagLinkRows.map((link) => `${link.tag_id}:${link.resource_id}`)).size).toBe(2);
    for (const link of tagLinkRows) {
      expect([...orderIdByName.values()]).toContain(Number(link.resource_id));
      const tagRow = await db('tags').where({ id: link.tag_id }).first<IdRow>('id');
      expect(tagRow).toBeDefined();
    }

    const acmeOrderRow = await db(SaleOrder.tableName)
      .where({ name: 'SEED-SO-2026-0001' })
      .first<{ total_amount_minor: number }>('total_amount_minor');
    expect(acmeOrderRow?.total_amount_minor).toBe(12500000);

    const totalStates = await db(SaleOrderState.tableName).count<CountRow>({ count: '*' }).first();
    const totalOrders = await db(SaleOrder.tableName).count<CountRow>({ count: '*' }).first();
    const totalLines = await db(SaleOrderLine.tableName).count<CountRow>({ count: '*' }).first();
    const totalTagLinks = await db(SaleOrderTagLink.tableName)
      .count<CountRow>({ count: '*' })
      .first();
    expect(countValue(totalStates)).toBe(10);
    expect(countValue(totalOrders)).toBe(8);
    expect(countValue(totalLines)).toBe(14);
    expect(countValue(totalTagLinks)).toBe(4);
  }, 20000);
});
