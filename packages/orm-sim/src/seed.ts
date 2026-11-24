import type { Knex } from 'knex';
import type { AddonSeedManifest, SeedContext, SeedResult } from '@moonwitness/orm-base';
import {
  SimulationModel,
  SolverProfile,
  MeshDefinition,
  SimulationRun,
  ParameterSet,
  ResultDataset,
  Scenario,
  ValidationCase,
} from './models.js';

export const SIM_SEED_VERSION = '1.0.0';

const SIM_TABLES: readonly string[] = [
  SimulationModel.tableName,
  SolverProfile.tableName,
  MeshDefinition.tableName,
  SimulationRun.tableName,
  ParameterSet.tableName,
  ResultDataset.tableName,
  Scenario.tableName,
  ValidationCase.tableName,
];

export interface SimSeedOptions {
  readonly enabled: boolean;
}

export function isSimSeedEnabled(
  options: Partial<SimSeedOptions> | undefined
): boolean {
  return options?.enabled === true;
}

export async function countSimRows(db: Knex): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await Promise.all(
    SIM_TABLES.map(async (table) => {
      const row = await db(table).count({ count: '*' }).first();
      counts[table] = Number(row?.count ?? 0);
    })
  );
  return counts;
}

export const seedManifest: AddonSeedManifest = {
  seedVersion: SIM_SEED_VERSION,
  dependencies: ['orm-base'],
  async seed(ctx: SeedContext): Promise<SeedResult> {
    const options = (ctx as SeedContext & { options?: Partial<SimSeedOptions> })
      .options;
    if (!isSimSeedEnabled(options)) {
      return { inserted: 0, updated: 0, skipped: 0 };
    }

    const existing = await countSimRows(ctx.db);
    const alreadySeeded = Object.values(existing).some((count) => count > 0);
    if (alreadySeeded) {
      const total = Object.values(existing).reduce((sum, count) => sum + count, 0);
      return { inserted: 0, updated: 0, skipped: total };
    }

    const [model] = await ctx
      .db(SimulationModel.tableName)
      .insert({
        name: 'Navier-Stokes 2D',
        kind: 'fem',
        engine_version: '1.0.0',
        parameter_schema: { viscosity: 'number', density: 'number' },
      })
      .returning('id');

    const [solver] = await ctx
      .db(SolverProfile.tableName)
      .insert({
        name: 'Default FEM Solver',
        solver: 'fem-direct',
        tolerance: 1e-6,
        max_steps: 10000,
      })
      .returning('id');

    await ctx.db(SimulationRun.tableName).insert({
      model_id: model.id,
      solver_profile_id: solver.id,
      label: 'Baseline flow',
      status: 'pending',
      engine_version: '1.0.0',
    });

    return { inserted: 3, updated: 0, skipped: 0 };
  },
};

export default seedManifest;