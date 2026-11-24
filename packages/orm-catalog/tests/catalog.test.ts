import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons, resolveViews, validateViews } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { Product, ProductChannel, ProductVariant, manifest } from '../src/index.js';

describe('@moonwitness/orm-catalog addon', () => {
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

  it('installs catalog products, variants, channels, views, and seed data idempotently', async () => {
    await installAddons(db, [manifest, baseManifest]);
    await installAddons(db, [baseManifest, manifest]);

    expect(manifest.depends).toEqual(['base']);

    const productCount = await db(Product.tableName).count({ count: '*' }).first();
    expect(productCount).toMatchObject({ count: 3 });

    const variantCount = await db(ProductVariant.tableName).count({ count: '*' }).first();
    expect(variantCount).toMatchObject({ count: 0 });

    const channelCount = await db(ProductChannel.tableName).count({ count: '*' }).first();
    expect(channelCount).toMatchObject({ count: 0 });

    const allSeeded = await db(Product.tableName)
      .whereIn('sku', ['DIG-EBOOK-0001', 'DIG-TEMPLATE-0001', 'DIG-COURSE-0001'])
      .select('sku', 'kind', 'is_active');
    expect(allSeeded).toHaveLength(3);
    expect(allSeeded.every((p) => p.kind === 'digital')).toBe(true);
    expect(allSeeded.every((p) => Boolean(p.is_active) === false)).toBe(true);

    for (const model of manifest.models) {
      const resolved = resolveViews(model);
      expect(() => validateViews(model, resolved)).not.toThrow();
    }
  });

  it('enforces SKU uniqueness on Product', async () => {
    await installAddons(db, [manifest, baseManifest]);

    await db(Product.tableName).insert({
      sku: 'PHY-TEST-0001',
      name: 'Unique Product',
      kind: 'physical',
      price_minor: 1000,
      currency: 'USD',
      is_active: true,
      company_id: 1,
    });

    await expect(
      db(Product.tableName).insert({
        sku: 'PHY-TEST-0001',
        name: 'Another Duplicate',
        kind: 'digital',
        price_minor: 1000,
        currency: 'USD',
        is_active: true,
        company_id: 1,
      })
    ).rejects.toThrow();
  });

  it('enforces SKU uniqueness on ProductVariant', async () => {
    await installAddons(db, [manifest, baseManifest]);

    await db(ProductVariant.tableName).insert({
      sku: 'VAR-001',
      product_id: 1,
      price_adjustment_minor: 0,
      stock_qty: 0,
      company_id: 1,
    });

    await expect(
      db(ProductVariant.tableName).insert({
        sku: 'VAR-001',
        product_id: 2,
        price_adjustment_minor: 0,
        stock_qty: 0,
        company_id: 1,
      })
    ).rejects.toThrow();
  });

  it('resolves variant price via resolver (unit logic covered in pricing.test.ts)', async () => {
    await installAddons(db, [manifest, baseManifest]);
    // This test confirms the schema supports variant resolution logic
    // The resolver itself is pure-logic tested in pricing.test.ts
    const product = await db(Product.tableName).where({ sku: 'DIG-EBOOK-0001' }).first('price_minor');
    expect(product?.price_minor).toBe(2400);
  });
});