import { defineAddon } from '@moonwitness/orm';
import { views } from './views.js';
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

export const simAddon = defineAddon({
  name: 'sim',
  version: '1.0.0',
  depends: ['base'],
  models: [
    SimulationModel,
    SolverProfile,
    MeshDefinition,
    SimulationRun,
    ParameterSet,
    ResultDataset,
    Scenario,
    ValidationCase,
  ],
  views: Object.values(views),
  menus: [
    { model: SimulationModel.modelName, label: 'Models', group: 'Simulation', sequence: 1 },
    { model: SolverProfile.modelName, label: 'Solver Profiles', group: 'Simulation', sequence: 2 },
    { model: MeshDefinition.modelName, label: 'Mesh Definitions', group: 'Simulation', sequence: 3 },
    { model: SimulationRun.modelName, label: 'Runs', group: 'Simulation', sequence: 4 },
    { model: ParameterSet.modelName, label: 'Parameter Sets', group: 'Simulation', sequence: 5 },
    { model: ResultDataset.modelName, label: 'Result Datasets', group: 'Simulation', sequence: 6 },
    { model: Scenario.modelName, label: 'Scenarios', group: 'Simulation', sequence: 7 },
    { model: ValidationCase.modelName, label: 'Validation Cases', group: 'Simulation', sequence: 8 },
  ],
});

export default simAddon;