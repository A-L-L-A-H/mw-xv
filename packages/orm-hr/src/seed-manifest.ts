import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import { HR_SEED_VERSION, seed } from './seed.js';

export type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';

export const hrSeedManifest: AddonSeedManifest = {
  seedVersion: HR_SEED_VERSION,
  dependencies: ['orm-base'],
  seed: async (ctx: SeedContext): Promise<SeedResult> => seed(ctx),
};
