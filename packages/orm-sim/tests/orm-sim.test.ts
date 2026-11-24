import { describe, expect, it } from 'vitest';
import {
  SimulationModel,
  SimulationRun,
  SolverProfile,
  views,
  simAddon,
  seedManifest,
  SIM_SEED_VERSION,
  isSimSeedEnabled,
  computeRunChecksum,
  estimateRunSteps,
  isRunFinished,
} from '../src/index.js';

describe('@moonwitness/orm-sim models, addon manifest, and domain helpers', () => {
  it('defines sim_ tables for all 8 core models with external_ref cross-package links', () => {
    expect(SimulationModel.tableName).toBe('sim_models');
    expect(SimulationModel.modelName).toBe('sim.simulation_model');
    expect(SolverProfile.tableName).toBe('sim_solver_profiles');
    expect(SimulationRun.tableName).toBe('sim_runs');
    expect(SimulationModel.fields.external_ref).toBeDefined();
    expect(Object.keys(SimulationModel.fields)).not.toContain('parameter_vector');
    expect(SimulationModel.fields.parameter_schema).toBeDefined();
  });

  it('registers the addon manifest with sim namespace, models, views, and menus', () => {
    expect(simAddon.name).toBe('sim');
    expect(simAddon.models.length).toBe(8);
    expect(simAddon.views?.length).toBe(8);
    expect(simAddon.menus?.every((menu) => menu.model.startsWith('sim.'))).toBe(true);
    expect(views.SimulationModel).toBeDefined();
  });

  it('keeps seeding disabled by default and skips when not enabled', async () => {
    expect(isSimSeedEnabled(undefined)).toBe(false);
    expect(isSimSeedEnabled({ enabled: false })).toBe(false);
    expect(isSimSeedEnabled({ enabled: true })).toBe(true);
    expect(seedManifest.seedVersion).toBe(SIM_SEED_VERSION);
  });

  it('computes deterministic checksums, step estimates, and finished-run detection', () => {
    const snapshot = { viscosity: 1.0, density: 998.2 };
    const checksum = computeRunChecksum(snapshot);
    expect(checksum).toMatch(/^[0-9a-f]{8}$/u);
    expect(computeRunChecksum(snapshot)).toBe(checksum);

    expect(
      estimateRunSteps({ max_steps: 1000, tolerance: 1e-6 })
    ).toBe(1000);
    expect(
      estimateRunSteps({ max_steps: 1000, tolerance: 1e-6 }, { element_count: 4000 })
    ).toBe(2000);

    expect(isRunFinished({ status: 'succeeded' })).toBe(true);
    expect(isRunFinished({ status: 'running' })).toBe(false);
    expect(isRunFinished({ status: 'running', finished_at: new Date() })).toBe(true);
  });
});
