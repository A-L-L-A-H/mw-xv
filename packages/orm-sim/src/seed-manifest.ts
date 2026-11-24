import type { Knex } from 'knex';
import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import {
  seedManifest as simSeedManifest,
  SIM_SEED_VERSION,
  countSimRows,
  isSimSeedEnabled,
  type SimSeedOptions,
} from './seed.js';

export type { AddonSeedManifest, SeedContext, SeedResult, SimSeedOptions };

export const seedManifest: AddonSeedManifest = simSeedManifest;
export { SIM_SEED_VERSION, countSimRows, isSimSeedEnabled };

export type SimSeedRowCounts = Record<string, number>;

export async function getSimSeedRowCounts(db: Knex): Promise<SimSeedRowCounts> {
  return countSimRows(db);
}
