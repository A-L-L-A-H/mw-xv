import type { AddonSeedManifest } from '@moonwitness/orm-base';
import { seedObservability } from './seed.js';

export const observabilitySeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  seed: seedObservability,
};
