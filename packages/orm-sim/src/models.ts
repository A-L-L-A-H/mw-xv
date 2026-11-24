import { defineModel, fields } from '@moonwitness/orm';

export const SimModelKind = {
  ODE: 'ode',
  MONTE_CARLO: 'monte_carlo',
  AGENT_BASED: 'agent_based',
  FEM: 'fem',
} as const;
export type SimModelKind = (typeof SimModelKind)[keyof typeof SimModelKind];

export const SimRunStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;
export type SimRunStatus = (typeof SimRunStatus)[keyof typeof SimRunStatus];

export const SimSweepStrategy = {
  GRID: 'grid',
  LATIN_HYPERCUBE: 'latin_hypercube',
  RANDOM: 'random',
} as const;
export type SimSweepStrategy =
  (typeof SimSweepStrategy)[keyof typeof SimSweepStrategy];

export const SimValidationStatus = {
  DRAFT: 'draft',
  PASSED: 'passed',
  FAILED: 'failed',
} as const;
export type SimValidationStatus =
  (typeof SimValidationStatus)[keyof typeof SimValidationStatus];

export const SimulationModel = defineModel('sim.simulation_model', {
  table: 'sim_models',
  order: 'create_date desc',
  fields: {
    name: fields.string({ required: true }),
    kind: fields.enum(['ode', 'monte_carlo', 'agent_based', 'fem'] as const, {
      required: true,
      default: SimModelKind.ODE,
      label: 'Model Kind',
    }),
    description: fields.text({ label: 'Description' }),
    parameter_schema: fields.json({ label: 'Parameter Schema' }),
    engine_version: fields.string({ label: 'Engine Version' }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-science/orm-rnd records',
    }),
  },
});

export const SolverProfile = defineModel('sim.solver_profile', {
  table: 'sim_solver_profiles',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true }),
    solver: fields.string({ required: true, label: 'Solver' }),
    tolerance: fields.float({ label: 'Tolerance', default: 1e-6 }),
    max_steps: fields.integer({ label: 'Max Steps', default: 10000 }),
    options: fields.json({ label: 'Solver Options' }),
    external_ref: fields.string({ label: 'External Reference' }),
  },
});

export const MeshDefinition = defineModel('sim.mesh_definition', {
  table: 'sim_mesh_definitions',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true }),
    topology: fields.string({ required: true, label: 'Topology' }),
    element_count: fields.integer({ label: 'Element Count', default: 0 }),
    quality_metrics: fields.json({ label: 'Quality Metrics' }),
    external_ref: fields.string({ label: 'External Reference' }),
  },
});

export const SimulationRun = defineModel('sim.simulation_run', {
  table: 'sim_runs',
  order: 'create_date desc',
  fields: {
    model: fields.belongsTo(SimulationModel, { required: true, label: 'Model' }),
    solver_profile: fields.belongsTo(SolverProfile, { label: 'Solver Profile' }),
    mesh: fields.belongsTo(MeshDefinition, { label: 'Mesh' }),
    label: fields.string({ label: 'Label' }),
    status: fields.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled'] as const, {
      required: true,
      default: SimRunStatus.PENDING,
    }),
    engine_version: fields.string({ label: 'Engine Version' }),
    input_snapshot: fields.json({ label: 'Input Snapshot' }),
    started_at: fields.datetime({ label: 'Started At' }),
    finished_at: fields.datetime({ label: 'Finished At' }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-sensor input stream records',
    }),
  },
});

export const ParameterSet = defineModel('sim.parameter_set', {
  table: 'sim_parameter_sets',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true }),
    model: fields.belongsTo(SimulationModel, { required: true, label: 'Model' }),
    values: fields.json({ required: true, label: 'Parameter Vector' }),
    notes: fields.text({ label: 'Notes' }),
    external_ref: fields.string({ label: 'External Reference' }),
  },
});

export const ResultDataset = defineModel('sim.result_dataset', {
  table: 'sim_result_datasets',
  order: 'create_date desc',
  fields: {
    run: fields.belongsTo(SimulationRun, { required: true, label: 'Run' }),
    summary: fields.json({ label: 'Result Summary' }),
    data: fields.json({ label: 'Result Data' }),
    checksum: fields.string({ label: 'Checksum' }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-science measurement records',
    }),
  },
});

export const Scenario = defineModel('sim.scenario', {
  table: 'sim_scenarios',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true }),
    model: fields.belongsTo(SimulationModel, { required: true, label: 'Model' }),
    parameter_set: fields.belongsTo(ParameterSet, { label: 'Parameter Set' }),
    strategy: fields.enum(['grid', 'latin_hypercube', 'random'] as const, {
      required: true,
      default: SimSweepStrategy.GRID,
      label: 'Sweep Strategy',
    }),
    sweep_definition: fields.json({ label: 'Sweep Definition' }),
    external_ref: fields.string({ label: 'External Reference' }),
  },
});

export const ValidationCase = defineModel('sim.validation_case', {
  table: 'sim_validation_cases',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true }),
    model: fields.belongsTo(SimulationModel, { required: true, label: 'Model' }),
    run: fields.belongsTo(SimulationRun, { label: 'Reference Run' }),
    benchmark: fields.json({ label: 'Benchmark Data' }),
    tolerance: fields.float({ label: 'Tolerance', default: 0.01 }),
    status: fields.enum(['draft', 'passed', 'failed'] as const, {
      required: true,
      default: SimValidationStatus.DRAFT,
    }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-science measurement records',
    }),
  },
});