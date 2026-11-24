import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import { seedNotificationInitialData } from './seed.js';

export type { AddonSeedManifest, SeedContext, SeedResult };

export const notificationSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  seed: async (ctx: SeedContext): Promise<SeedResult> => {
    const result = await seedNotificationInitialData(ctx.db);
    return {
      inserted: result.insertedTemplates,
      updated: 0,
      skipped: result.templatesTotal - result.insertedTemplates,
    };
  },
};
