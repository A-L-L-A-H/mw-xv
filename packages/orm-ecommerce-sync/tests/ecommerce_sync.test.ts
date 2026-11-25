import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import {
  manifest,
  ecommerceSyncSeedManifest,
  MarketplaceSyncJob,
  MarketplaceConnection,
  SyncMetric,
} from '../src/index.js';

describe('ecommerce_sync addon', () => {
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

  it('manifest has correct structure and required fields', () => {
    expect(manifest.name).toBe('ecommerce_sync');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.displayName).toBe('E-Commerce Sync');
    expect(manifest.category).toBe('Commerce');
    expect(manifest.depends).toEqual(['base']);
    expect(manifest.models).toHaveLength(3);
    expect(manifest.models.map((m) => m.modelName)).toEqual([
      'ecommerce.sync_job',
      'ecommerce.connection',
      'ecommerce.sync_metric',
    ]);
    expect(manifest.httpPlugins).toHaveLength(1);
    expect(manifest.views).toHaveLength(3);
    expect(manifest.menus).toHaveLength(3);
    expect(manifest.data).toBeDefined();
    expect(manifest.data!.length).toBeGreaterThan(0);
  });

  it('seed manifest has correct structure', () => {
    expect(ecommerceSyncSeedManifest.seedVersion).toBe('1.0.0');
    expect(ecommerceSyncSeedManifest.dependencies).toEqual(['base']);
    expect(typeof ecommerceSyncSeedManifest.seed).toBe('function');
  });

  it('installs addon and creates tables', async () => {
    await installAddons(db, [baseManifest, manifest]);

    const syncJobTable = await db.schema.hasTable('marketplace_sync_jobs');
    const connectionTable = await db.schema.hasTable('marketplace_connections');
    const metricTable = await db.schema.hasTable('marketplace_sync_metrics');

    expect(syncJobTable).toBe(true);
    expect(connectionTable).toBe(true);
    expect(metricTable).toBe(true);
  });

  it('seed inserts default marketplace connections', async () => {
    await installAddons(db, [baseManifest, manifest]);
    const result = await ecommerceSyncSeedManifest.seed({ db, companyId: 1 });

    expect(result.inserted).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);

    const connections = await db('marketplace_connections').where({ company_id: 1 }).select('*');
    expect(connections).toHaveLength(2);

    const shopify = connections.find((c) => c.marketplace === 'shopify');
    const woocommerce = connections.find((c) => c.marketplace === 'woocommerce');

    expect(shopify).toBeDefined();
    expect(shopify!.name).toBe('Shopify Store');
    expect(shopify!.status).toBe('pending');
    expect(shopify!.credentials).toBeNull();
    expect(JSON.parse(shopify!.config)).toEqual(
      expect.objectContaining({
        shop_domain: 'example-store.myshopify.com',
        api_version: '2024-01',
      })
    );

    expect(woocommerce).toBeDefined();
    expect(woocommerce!.name).toBe('WooCommerce Store');
    expect(woocommerce!.status).toBe('pending');
    expect(woocommerce!.credentials).toBeNull();
    expect(JSON.parse(woocommerce!.config)).toEqual(
      expect.objectContaining({
        store_url: 'https://example.com',
        version: 'wc/v3',
      })
    );
  });

  it('seed is idempotent: second run updates existing records', async () => {
    await installAddons(db, [baseManifest, manifest]);
    await ecommerceSyncSeedManifest.seed({ db, companyId: 1 });
    const result = await ecommerceSyncSeedManifest.seed({ db, companyId: 1 });

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(2);
    expect(result.skipped).toBe(0);

    const connections = await db('marketplace_connections').where({ company_id: 1 }).select('*');
    expect(connections).toHaveLength(2);
  });

  it('ModelAccess grants created for all three models', async () => {
    await installAddons(db, [baseManifest, manifest]);

    const grants = await db('model_access')
      .join('access_groups', 'model_access.group_id', 'access_groups.id')
      .where('access_groups.code', 'user')
      .whereIn('model_access.model_name', [
        'ecommerce.sync_job',
        'ecommerce.connection',
        'ecommerce.sync_metric',
      ])
      .select('model_access.*', 'access_groups.code as group_code');

    expect(grants).toHaveLength(3);

    const syncJobGrant = grants.find((g) => g.model_name === 'ecommerce.sync_job');
    const connectionGrant = grants.find((g) => g.model_name === 'ecommerce.connection');
    const metricGrant = grants.find((g) => g.model_name === 'ecommerce.sync_metric');

    expect(Boolean(syncJobGrant.read)).toBe(true);
    expect(Boolean(syncJobGrant.create)).toBe(true);
    expect(Boolean(syncJobGrant.write)).toBe(true);
    expect(Boolean(syncJobGrant.unlink)).toBe(false);

    expect(Boolean(connectionGrant.read)).toBe(true);
    expect(Boolean(connectionGrant.create)).toBe(true);
    expect(Boolean(connectionGrant.write)).toBe(true);
    expect(Boolean(connectionGrant.unlink)).toBe(false);

    expect(Boolean(metricGrant.read)).toBe(true);
    expect(Boolean(metricGrant.create)).toBe(false);
    expect(Boolean(metricGrant.write)).toBe(false);
    expect(Boolean(metricGrant.unlink)).toBe(false);
  });

  it('sync job insert compatible with sync_ecommerce action contract', async () => {
    await installAddons(db, [baseManifest, manifest]);

    const inserted = await db('marketplace_sync_jobs')
      .insert({
        company_id: 1,
        marketplace: 'shopify',
        direction: 'pull',
        status: 'queued',
        payload: JSON.stringify({ product_ids: [1, 2, 3] }),
        source_rule_id: 'rule-123',
        dedupe_key: 'shopify-pull-2024-01-15',
        requested_at: new Date().toISOString(),
      })
      .returning('id');

    const jobId = Array.isArray(inserted)
      ? Number((inserted[0] as { id?: number } | undefined)?.id ?? inserted[0])
      : Number(inserted);

    expect(jobId).toBeGreaterThan(0);

    const job = await db('marketplace_sync_jobs').where({ id: jobId }).first();
    expect(job).toBeDefined();
    expect(job!.marketplace).toBe('shopify');
    expect(job!.direction).toBe('pull');
    expect(job!.status).toBe('queued');
    expect(JSON.parse(job!.payload)).toEqual({ product_ids: [1, 2, 3] });
    expect(job!.source_rule_id).toBe('rule-123');
    expect(job!.dedupe_key).toBe('shopify-pull-2024-01-15');
  });

  it('sync metric unique constraint on date+marketplace+direction+company', async () => {
    await installAddons(db, [baseManifest, manifest]);

    await db('marketplace_sync_metrics').insert({
      company_id: 1,
      date: '2024-01-15',
      marketplace: 'shopify',
      direction: 'pull',
      jobs_queued: 10,
      jobs_completed: 8,
      jobs_failed: 2,
      items_processed: 150,
      duration_ms_sum: 5000,
    });

    await expect(
      db('marketplace_sync_metrics').insert({
        company_id: 1,
        date: '2024-01-15',
        marketplace: 'shopify',
        direction: 'pull',
        jobs_queued: 5,
        jobs_completed: 5,
        jobs_failed: 0,
        items_processed: 100,
        duration_ms_sum: 3000,
      })
    ).rejects.toThrow();

    // Different date should work
    await db('marketplace_sync_metrics').insert({
      company_id: 1,
      date: '2024-01-16',
      marketplace: 'shopify',
      direction: 'pull',
      jobs_queued: 5,
      jobs_completed: 5,
      jobs_failed: 0,
      items_processed: 100,
      duration_ms_sum: 3000,
    });

    const metrics = await db('marketplace_sync_metrics').where({ company_id: 1 }).select('*');
    expect(metrics).toHaveLength(2);
  });
});
