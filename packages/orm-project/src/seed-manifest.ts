import type { AddonSeedManifest } from '@moonwitness/orm-base';
import { PROJECT_SEED_VERSION, seedProjectInitialData } from './seed.js';

export type { AddonSeedManifest };

export const projectSeedManifest: AddonSeedManifest = {
  seedVersion: PROJECT_SEED_VERSION,
  dependencies: ['orm-base'],
  seed: async (ctx) => {
    const result = await seedProjectInitialData(ctx.db);
    return {
      inserted:
        result.insertedStages +
        result.insertedProjects +
        result.insertedMilestones +
        result.insertedTasks +
        result.insertedDependencies,
      updated: 0,
      skipped: 0,
    };
  },
};
