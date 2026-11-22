import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import Fastify from 'fastify';
import { installAddons, resolveViews, validateViews } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { manifest as crmManifest, Opportunity } from '@moonwitness/orm-crm';
import {
  SaleOrder,
  SaleOrderLine,
  SaleOrderState,
  SaleOrderTagLink,
  confirmSaleOrder,
  convertOpportunityToSaleOrder,
  createSalesHttpPlugin,
  manifest,
} from '../src/index.js';

describe('@moonwitness/orm-sales addon', () => {
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

  it('installs sales order states, demo sale orders, lines, tag links, and views idempotently', async () => {
    await installAddons(db, [manifest, crmManifest, baseManifest]);
    await installAddons(db, [baseManifest, crmManifest, manifest]);

    expect(manifest.depends).toEqual(['base', 'crm']);
    expect(await db(SaleOrderState.tableName).count({ count: '*' }).first()).toMatchObject({
      count: 5,
    });
    expect(await db(SaleOrder.tableName).count({ count: '*' }).first()).toMatchObject({ count: 4 });
    expect(await db(SaleOrderLine.tableName).count({ count: '*' }).first()).toMatchObject({
      count: 8,
    });
    expect(await db(SaleOrderTagLink.tableName).count({ count: '*' }).first()).toMatchObject({
      count: 2,
    });

    for (const model of manifest.models) {
      const resolved = resolveViews(model);
      expect(() => validateViews(model, resolved)).not.toThrow();
    }
  });

  it('converts opportunities to sale orders and confirms them via automation and http plugin', async () => {
    await installAddons(db, [baseManifest, crmManifest, manifest]);

    const opp = await Opportunity.query().first();
    expect(opp).toBeDefined();

    const order = await convertOpportunityToSaleOrder(opp!.id, { companyId: 1 });
    expect(order).toBeDefined();
    expect(order.opportunity_id).toBe(opp!.id);
    expect(order.partner_id).toBe(opp!.partner_id);

    const line = await SaleOrderLine.query().where({ order_id: order.id }).first();
    expect(line).toBeDefined();

    // Idempotent on second call
    const order2 = await convertOpportunityToSaleOrder(opp!.id, { companyId: 1 });
    expect(order2.id).toBe(order.id);

    const confirmed = await confirmSaleOrder(order.id, { companyId: 1 });
    expect(confirmed.confirm_date).toBeDefined();
    const confirmedState = await SaleOrderState.query().findById(confirmed.state_id);
    expect(confirmedState?.name).toBe('Confirmed');

    const app = Fastify({ logger: false });
    let currentAuth: {
      userId: number;
      role: string;
      companyId?: number;
      groupPermissions?: Array<{
        model_name: string;
        read: boolean;
        create: boolean;
        write: boolean;
        unlink: boolean;
      }>;
    } | null = {
      userId: 1,
      role: 'superadmin',
      companyId: 1,
    };
    app.addHook('onRequest', async (req) => {
      (req as { auth?: typeof currentAuth }).auth = currentAuth;
    });

    await app.register(createSalesHttpPlugin());
    await app.ready();

    try {
      const opp2 = await Opportunity.query().findById(2);
      expect(opp2).toBeDefined();

      const convertRes = await app.inject({
        method: 'POST',
        url: `/api/sales/opportunities/${opp2!.id}/convert-to-order`,
      });
      expect(convertRes.statusCode).toBe(201);
      const createdOrder = convertRes.json().data;
      expect(createdOrder.opportunity_id).toBe(opp2!.id);

      const confirmRes = await app.inject({
        method: 'POST',
        url: `/api/sales/orders/${createdOrder.id}/confirm`,
      });
      expect(confirmRes.statusCode).toBe(200);
      expect(confirmRes.json().data.confirm_date).toBeDefined();

      currentAuth = { userId: 99, role: 'user', companyId: 1, groupPermissions: [] };
      const deniedRes = await app.inject({
        method: 'POST',
        url: `/api/sales/opportunities/${opp2!.id}/convert-to-order`,
      });
      expect(deniedRes.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
