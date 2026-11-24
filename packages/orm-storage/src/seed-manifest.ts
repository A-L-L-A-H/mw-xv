import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import { buildStorageInitialSeed, STORAGE_SEED_VERSION } from './seed.js';

export type { AddonSeedManifest } from '@moonwitness/orm-base';

export const storageSeedManifest: AddonSeedManifest = {
  seedVersion: STORAGE_SEED_VERSION,
  dependencies: ['orm-base'],
  async seed(ctx: SeedContext): Promise<SeedResult> {
    const bundle = buildStorageInitialSeed();
    const bucketCount = bundle.buckets.length;
    const policyCount = bundle.policies.length;
    return { inserted: bucketCount + policyCount, updated: 0, skipped: 0 };
  },
};
