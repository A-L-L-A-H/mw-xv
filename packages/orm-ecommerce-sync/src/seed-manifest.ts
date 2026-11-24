import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import type { Knex } from 'knex';

const SALT = 'mw-ecommerce-sync-2026';

async function seedEcommerceSync(ctx: SeedContext): Promise<SeedResult> {
  const db = ctx.db as Knex;
  let inserted = 0;
  let updated = 0;
  const skipped = 0;

  const companyId = ctx.companyId ?? 1;

  const marketplaces = [
    {
      marketplace: 'shopify',
      name: 'Shopify Store',
      config: {
        shop_domain: 'example-store.myshopify.com',
        api_version: '2024-01',
        scopes: ['read_products', 'write_products', 'read_orders', 'write_orders'],
        webhook_topics: ['orders/create', 'orders/updated', 'products/create', 'products/update'],
      },
      credentials: {
        access_token: 'ENCRYPTED_PLACEHOLDER',
      },
    },
    {
      marketplace: 'woocommerce',
      name: 'WooCommerce Store',
      config: {
        store_url: 'https://example.com',
        consumer_key: 'ck_...',
        consumer_secret: 'cs_...',
        version: 'wc/v3',
      },
      credentials: {
        consumer_key: 'ENCRYPTED_PLACEHOLDER',
        consumer_secret: 'ENCRYPTED_PLACEHOLDER',
      },
    },
  ];

  for (const mp of marketplaces) {
    const existing = await db('marketplace_connections')
      .where({ company_id: companyId, marketplace: mp.marketplace })
      .first();

    const now = new Date().toISOString();
    const configJson = JSON.stringify(mp.config);
    const credentialsJson = JSON.stringify(mp.credentials);

    if (existing) {
      await db('marketplace_connections')
        .where({ id: existing.id })
        .update({
          name: mp.name,
          config: configJson,
          credentials: credentialsJson,
          status: 'pending',
          write_date: now,
        });
      updated++;
    } else {
      await db('marketplace_connections').insert({
        company_id: companyId,
        marketplace: mp.marketplace,
        name: mp.name,
        status: 'pending',
        config: configJson,
        credentials: credentialsJson,
        create_date: now,
        write_date: now,
      });
      inserted++;
    }
  }

  return { inserted, updated, skipped };
}

export const ecommerceSyncSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['base'],
  seed: seedEcommerceSync,
};