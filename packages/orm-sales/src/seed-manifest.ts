import type { Knex } from 'knex';
import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import { seedSalesInitialData } from './seed.js';

export type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';

export const salesSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  seed: async (ctx: SeedContext): Promise<SeedResult> => {
    const result = await seedSalesInitialData(ctx.db, {
      companyId: ctx.companyId,
      ownerId: ctx.ownerId,
    });
    const inserted =
      result.insertedStates +
      result.insertedOrders +
      result.insertedLines +
      result.insertedTagLinks;
    return { inserted, updated: 0, skipped: 0 };
  },
};
