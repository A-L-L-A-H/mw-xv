import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import { INVENTORY_SEED_VERSION, seed } from './seed.js';

export type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';

export const inventorySeedManifest: AddonSeedManifest = {
  seedVersion: INVENTORY_SEED_VERSION,
  dependencies: ['orm-base'],
  seed: async (ctx: SeedContext): Promise<SeedResult> => seed(ctx),
};
