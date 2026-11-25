import type { AddonSeedManifest } from '@moonwitness/orm-base';
import { seed } from './seed.js';

export const ispSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  seed,
};

export default ispSeedManifest;
