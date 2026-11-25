import type { AddonSeedManifest } from '@moonwitness/orm-base';
import { buildA2aCapabilitySeed } from './seed.js';

export type { AddonSeedManifest };

export const a2aSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  seed: async () => {
    buildA2aCapabilitySeed();
    return { inserted: 0, updated: 0, skipped: 0 };
  },
};
