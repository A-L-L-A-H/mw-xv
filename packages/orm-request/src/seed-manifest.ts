import { seedRequestInitialData } from './seed.js';
import type { SeedContext, SeedResult, AddonSeedManifest } from '@moonwitness/orm-base';

export const requestSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  seed: async (ctx: SeedContext): Promise<SeedResult> => {
    const result = await seedRequestInitialData(ctx.db);
    return {
      inserted:
        (result.insertedCurrencies ?? 0) +
        (result.insertedDefinitions ?? 0) +
        (result.insertedRequests ?? 0),
      updated: 0,
      skipped: 0,
    };
  },
};

export type { AddonSeedManifest };
