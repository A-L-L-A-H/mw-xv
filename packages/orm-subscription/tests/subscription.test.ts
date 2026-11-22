import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import Fastify from 'fastify';
import { installAddons, resolveViews, validateViews } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { manifest as crmManifest } from '@moonwitness/orm-crm';
import { manifest as salesManifest, SaleOrder } from '@moonwitness/orm-sales';
import {
  Subscription,
  SubscriptionInvoiceLine,
  SubscriptionPlan,
  SubscriptionTagLink,
  activateSubscription,
  createSubscriptionFromSaleOrder,
  createSubscriptionHttpPlugin,
  manifest,
  suspendSubscription,
} from '../src/index.js';

describe('@moonwitness/orm-subscription addon', () => {
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

  it('installs subscription plans, active contracts, invoice lines, tag links, and views idempotently', async () => {
    await installAddons(db, [manifest, salesManifest, crmManifest, baseManifest]);
    await installAddons(db, [baseManifest, crmManifest, salesManifest, manifest]);

    expect(manifest.depends).toEqual(['base', 'sales']);
    expect(await db(SubscriptionPlan.tableName).count({ count: '*' }).first()).toMatchObject({
      count: 4,
    });
    expect(await db(Subscription.tableName).count({ count: '*' }).first()).toMatchObject({
      count: 4,
    });
    expect(await db(SubscriptionInvoiceLine.tableName).count({ count: '*' }).first()).toMatchObject(
      { count: 6 }
    );
    expect(await db(SubscriptionTagLink.tableName).count({ count: '*' }).first()).toMatchObject({
      count: 2,
    });

    for (const model of manifest.models) {
      const resolved = resolveViews(model);
      expect(() => validateViews(model, resolved)).not.toThrow();
    }
  });

  it('creates subscriptions from sale orders, manages lifecycle, and exposes http routes', async () => {
    await installAddons(db, [baseManifest, crmManifest, salesManifest, manifest]);

    const order = await SaleOrder.query().findById(1);
    expect(order).toBeDefined();

    const sub = await createSubscriptionFromSaleOrder(order!.id, { companyId: 1 });
    expect(sub).toBeDefined();
    expect(sub.sale_order_id).toBe(order!.id);
    expect(sub.partner_id).toBe(order!.partner_id);

    // Idempotent
    const sub2 = await createSubscriptionFromSaleOrder(order!.id, { companyId: 1 });
    expect(sub2.id).toBe(sub.id);

    const invoiceLines = await SubscriptionInvoiceLine.query().where({ subscription_id: sub.id });
    expect(invoiceLines.length).toBeGreaterThan(0);

    const suspended = await suspendSubscription(sub.id, { companyId: 1 });
    expect(suspended.state).toBe('paused');

    const activated = await activateSubscription(sub.id, { companyId: 1 });
    expect(activated.state).toBe('active');

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

    await app.register(createSubscriptionHttpPlugin());
    await app.ready();

    try {
      const order2 = await SaleOrder.query().findById(2);
      expect(order2).toBeDefined();

      const createRes = await app.inject({
        method: 'POST',
        url: `/api/subscriptions/from-order/${order2!.id}`,
      });
      expect(createRes.statusCode).toBe(201);
      const createdSub = createRes.json().data;
      expect(createdSub.sale_order_id).toBe(order2!.id);

      const suspendRes = await app.inject({
        method: 'POST',
        url: `/api/subscriptions/${createdSub.id}/suspend`,
      });
      expect(suspendRes.statusCode).toBe(200);
      expect(suspendRes.json().data.state).toBe('paused');

      const activateRes = await app.inject({
        method: 'POST',
        url: `/api/subscriptions/${createdSub.id}/activate`,
      });
      expect(activateRes.statusCode).toBe(200);
      expect(activateRes.json().data.state).toBe('active');

      currentAuth = { userId: 99, role: 'user', companyId: 1, groupPermissions: [] };
      const deniedRes = await app.inject({
        method: 'POST',
        url: `/api/subscriptions/${createdSub.id}/activate`,
      });
      expect(deniedRes.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
