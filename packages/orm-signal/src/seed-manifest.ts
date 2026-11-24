import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import { seedSignalSources } from './seed.js';

export type { AddonSeedManifest, SeedContext, SeedResult };

export const signalSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  async seed(ctx: SeedContext): Promise<SeedResult> {
    const { inserted, total } = await seedSignalSources(ctx.db, { companyId: ctx.companyId });
    return { inserted, updated: 0, skipped: Math.max(0, total - inserted) };
  },
};

export default signalSeedManifest;
