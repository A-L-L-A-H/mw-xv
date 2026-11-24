import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import { seed } from './seed.js';

export type { AddonSeedManifest, SeedContext, SeedResult };
export { seed };

export const automationCoreSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  seed: async (ctx: SeedContext): Promise<SeedResult> => {
    return seed(ctx);
  },
};

export default automationCoreSeedManifest;
