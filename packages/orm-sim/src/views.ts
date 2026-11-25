import { defineView } from '@moonwitness/orm';
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

export const views = {
  SimulationModel: defineView(SimulationModel, {
    list: {
      columns: ['name', 'kind', 'engine_version', 'create_date'],
    },
    form: {
      sections: [
        { fields: ['name', 'kind'] },
        { fields: ['description'] },
        { fields: ['parameter_schema', 'engine_version', 'external_ref'] },
      ],
    },
    search: { fields: ['name', 'kind', 'description'] },
  }),

  SolverProfile: defineView(SolverProfile, {
    list: {
      columns: ['name', 'solver', 'tolerance', 'max_steps', 'create_date'],
    },
    form: {
      sections: [
        { fields: ['name', 'solver'] },
        { fields: ['tolerance', 'max_steps', 'options', 'external_ref'] },
      ],
    },
    search: { fields: ['name', 'solver'] },
  }),

  MeshDefinition: defineView(MeshDefinition, {
    list: {
      columns: ['name', 'topology', 'element_count', 'create_date'],
    },
    form: {
      sections: [
        { fields: ['name', 'topology'] },
        { fields: ['element_count', 'quality_metrics', 'external_ref'] },
      ],
    },
    search: { fields: ['name', 'topology'] },
  }),

  SimulationRun: defineView(SimulationRun, {
    list: {
      columns: ['label', 'model', 'status', 'started_at', 'finished_at', 'create_date'],
    },
    form: {
      sections: [
        { fields: ['model', 'solver_profile', 'mesh', 'label'] },
        { fields: ['status', 'engine_version', 'started_at', 'finished_at'] },
        { fields: ['input_snapshot', 'external_ref'] },
      ],
    },
    search: { fields: ['label', 'status'] },
  }),

  ParameterSet: defineView(ParameterSet, {
    list: {
      columns: ['name', 'model', 'create_date'],
    },
    form: {
      sections: [{ fields: ['name', 'model'] }, { fields: ['values', 'notes', 'external_ref'] }],
    },
    search: { fields: ['name'] },
  }),

  ResultDataset: defineView(ResultDataset, {
    list: {
      columns: ['run', 'checksum', 'create_date'],
    },
    form: {
      sections: [{ fields: ['run'] }, { fields: ['summary', 'data', 'checksum', 'external_ref'] }],
    },
    search: { fields: ['checksum'] },
  }),

  Scenario: defineView(Scenario, {
    list: {
      columns: ['name', 'model', 'strategy', 'create_date'],
    },
    form: {
      sections: [
        { fields: ['name', 'model', 'parameter_set'] },
        { fields: ['strategy', 'sweep_definition', 'external_ref'] },
      ],
    },
    search: { fields: ['name'] },
  }),

  ValidationCase: defineView(ValidationCase, {
    list: {
      columns: ['name', 'model', 'run', 'status', 'create_date'],
    },
    form: {
      sections: [
        { fields: ['name', 'model', 'run'] },
        { fields: ['benchmark', 'tolerance', 'status', 'external_ref'] },
      ],
    },
    search: { fields: ['name', 'status'] },
  }),
};
