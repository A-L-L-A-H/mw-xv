import type {
  AddonSeedManifest,
  SeedContext,
  SeedResult,
} from '@moonwitness/orm-base';
import { Product } from './models/index.js';

export const CATALOG_SEED_VERSION = '1.0.0';

export const SEED_PRODUCTS = [
  {
    key: 'catalog.product_ebook_launch_authority',
    sku: 'DIG-EBOOK-0001',
    name: 'Launch Authority: Indie Software Playbook (eBook)',
    description:
      'Digitally delivered ebook covering go-to-market strategy for independent software products.',
    kind: 'digital',
    price_minor: 2400,
    currency: 'USD',
    cost_minor: 0,
  },
  {
    key: 'catalog.product_dashboard_ui_kit',
    sku: 'DIG-TEMPLATE-0001',
    name: 'Observability Dashboard Figma Template',
    description:
      'Editable template pack of monitoring dashboard layouts, charts, and empty-state components.',
    kind: 'digital',
    price_minor: 4900,
    currency: 'USD',
    cost_minor: 0,
  },
  {
    key: 'catalog.product_orm_video_course',
    sku: 'DIG-COURSE-0001',
    name: 'Query Planning Masterclass Video Course',
    description:
      'Recorded course with hands-on query planner walkthroughs and indexing labs.',
    kind: 'digital',
    price_minor: 12900,
    currency: 'USD',
    cost_minor: 0,
  },
] as const;

export const seedProducts: AddonSeedManifest = {
  seedVersion: CATALOG_SEED_VERSION,
  dependencies: ['orm-base'],
  async seed(ctx: SeedContext): Promise<SeedResult> {
    let inserted = 0;
    let skipped = 0;

    for (const product of SEED_PRODUCTS) {
      const { key: _key, ...values } = product;
      const existing = await ctx.db(Product.tableName).where({ sku: values.sku }).first('id');
      if (existing) {
        skipped += 1;
        continue;
      }
      await ctx.db(Product.tableName).insert({
        ...values,
        is_active: false,
      });
      inserted += 1;
    }

    return {
      inserted,
      updated: 0,
      skipped,
    };
  },
};

export default seedProducts;
