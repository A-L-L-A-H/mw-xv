import type { AddonSeedManifest } from '@moonwitness/orm-base';
import { seedHelpdesk } from './seed.js';

export const helpdeskSeedManifest: AddonSeedManifest = {
  seedVersion: '1.0.0',
  dependencies: ['orm-base'],
  seed: seedHelpdesk,
};
