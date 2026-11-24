import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import type { Knex } from 'knex';
import { seedRnd, countRndRows, RND_SEED_VERSION } from './seed.js';

export const rndSeedManifest: AddonSeedManifest = {
  seedVersion: RND_SEED_VERSION,
  dependencies: ['orm-base'],
  seed: seedRnd,
};

export { countRndRows, RND_SEED_VERSION };