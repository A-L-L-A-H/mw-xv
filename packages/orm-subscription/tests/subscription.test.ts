import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons, resolveViews, validateViews } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { manifest as crmManifest } from '@moonwitness/orm-crm';
import { manifest as salesManifest } from '@moonwitness/orm-sales';
import {
  Subscription,
  SubscriptionInvoiceLine,
  SubscriptionPlan,
  SubscriptionTagLink,
  manifest,
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
});
