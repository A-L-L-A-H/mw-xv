import { defineAddon } from '@moonwitness/orm';
import { IncomeStream, IncomeEntry, IncomeMetric, IncomeExperiment, IncomeAllocation } from './models.js';
import { incomeHttpPlugin } from './http-plugin.js';
import { seedIncomeStreams } from './seed.js';

export const manifest = defineAddon({
  namespace: 'income',
  depends: ['base'],
  models: [IncomeStream, IncomeEntry, IncomeMetric, IncomeExperiment, IncomeAllocation],
  httpPlugins: [incomeHttpPlugin],
  data: { seed: seedIncomeStreams },
});