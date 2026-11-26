import type { AddonSeedManifest } from '@moonwitness/orm-base';
import { seedIdentity } from './seed.js';

export const identitySeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  seed: seedIdentity,
};
