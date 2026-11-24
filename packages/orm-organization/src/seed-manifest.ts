import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import { seedOrganizationInitialData } from './seed.js';

export const organizationSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  async seed(ctx: SeedContext): Promise<SeedResult> {
    const result = await seedOrganizationInitialData(ctx.db);
    return {
      inserted:
        result.inserted.units +
        result.inserted.teams +
        result.inserted.positions +
        result.inserted.members +
        result.inserted.accessGroups +
        result.inserted.modelAccessGrants +
        result.inserted.roleBindings,
      updated: 0,
      skipped:
        result.skipped.units +
        result.skipped.teams +
        result.skipped.positions +
        result.skipped.members +
        result.skipped.accessGroups +
        result.skipped.modelAccessGrants +
        result.skipped.roleBindings,
    };
  },
};
