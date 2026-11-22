import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons, resolveViews, validateViews } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { manifest as crmManifest } from '@moonwitness/orm-crm';
import {
  SaleOrder,
  SaleOrderLine,
  SaleOrderState,
  SaleOrderTagLink,
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
});
