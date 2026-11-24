import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import type { Knex } from 'knex';
import { buildProjectInitialSeed } from './seed.js';

export const AI_SEED_VERSION = '1.0.0';
export const AI_SEED_DEPENDENCIES = ['orm-base'] as const;

export const aiSeedManifest: AddonSeedManifest = {
  seedVersion: AI_SEED_VERSION,
  dependencies: [...AI_SEED_DEPENDENCIES],
  async seed(ctx: SeedContext): Promise<SeedResult> {
    const db = ctx.db;
    const seedData = buildProjectInitialSeed();

    let inserted = 0;
    let updated = 0;
    const skipped = 0;

    for (const record of seedData) {
      const table = record.model.tableName;
      const values = record.values;

      const existing = await db(table).where({ id: values.id }).first();
      if (existing) {
        await db(table).where({ id: values.id }).update(values);
        updated += 1;
      } else {
        await db(table).insert(values);
        inserted += 1;
      }
    }

    return { inserted, updated, skipped };
  },
};

export { buildProjectInitialSeed };
