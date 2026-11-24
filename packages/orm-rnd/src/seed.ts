import type { Knex } from 'knex';
import type { SeedResult } from '@moonwitness/orm-base';
import {
  Experiment,
  ResearchProgram,
} from './models.js';

export const RND_SEED_VERSION = '1.0.0';
export const RND_DEPENDENCIES = ['orm-base'] as const;

export interface RndSeedOptions {
  /** Seed data is DISABLED by default; pass enabled: true explicitly. */
  readonly enabled?: boolean;
  readonly companyId?: number;
}

export async function countRndRows(db: Knex): Promise<Record<string, number>> {
  const tables = [
    'rnd_hypotheses',
    'rnd_protocol_runs',
    'rnd_experiments',
    'rnd_protocols',
    'rnd_publications',
    'rnd_patents',
    'rnd_ipr_disclosures',
    'rnd_instruments',
    'rnd_reagents',
    'rnd_samples',
    'rnd_programs',
  ];
  const counts: Record<string, number> = {};
  await Promise.all(
    tables.map(async (table) => {
      const row = await db(table).count({ count: '*' }).first();
      counts[table] = Number(row?.count ?? 0);
    })
  );
  return counts;
}

export async function seedRnd(ctx: { db: Knex; options?: RndSeedOptions }): Promise<SeedResult> {
  const options = ctx.options ?? {};

  if (options.enabled !== true) {
    return { inserted: 0, updated: 0, skipped: 0 };
  }

  const db = ctx.db;
  let inserted = 0;
  let updated = 0;
  const skipped = 0;

  // Seed ResearchProgram - upsert by code
  const existingProgram = await db(ResearchProgram.tableName)
    .where({ code: 'RND-CORE-001' })
    .first();

  let programId: number;
  if (existingProgram) {
    await db(ResearchProgram.tableName)
      .where({ id: existingProgram.id })
      .update({
        name: 'Core Technology Development',
        status: 'active',
        funding_source: 'Internal R&D Budget',
        updated_at: new Date(),
      });
    programId = existingProgram.id;
    updated += 1;
  } else {
    const [program] = await db(ResearchProgram.tableName)
      .insert({
        code: 'RND-CORE-001',
        name: 'Core Technology Development',
        status: 'active',
        funding_source: 'Internal R&D Budget',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id');
    programId = program.id;
    inserted += 1;
  }

  // Seed Experiment - upsert by program_id + name
  const existingExperiment = await db(Experiment.tableName)
    .where({ program_id: programId, name: 'Baseline capability evaluation' })
    .first();

  if (existingExperiment) {
    await db(Experiment.tableName)
      .where({ id: existingExperiment.id })
      .update({
        status: 'draft',
        updated_at: new Date(),
      });
    updated += 1;
  } else {
    await db(Experiment.tableName).insert({
      program_id: programId,
      name: 'Baseline capability evaluation',
      status: 'draft',
      created_at: new Date(),
      updated_at: new Date(),
    });
    inserted += 1;
  }

  return { inserted, updated, skipped };
}