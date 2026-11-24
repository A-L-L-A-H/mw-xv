import { defineModel, fields } from '@moonwitness/orm';
import { Company } from '@moonwitness/orm-base';

export const INCOME_STREAM_KINDS = [
  'saas',
  'marketplace',
  'ads',
  'affiliate',
  'content_royalty',
  'digital_product',
  'service',
  'donation',
  'other',
] as const;

export const INCOME_STREAM_STATUSES = ['idea', 'building', 'live', 'paused', 'dead'] as const;

export const INCOME_ENTRY_KINDS = ['revenue', 'cost', 'payout', 'refund', 'fee', 'tax'] as const;

export const INCOME_ALLOCATION_TARGETS = [
  'reinvest',
  'savings',
  'charity',
  'personal',
  'tax',
] as const;

export type IncomeStreamKind = (typeof INCOME_STREAM_KINDS)[number];
export type IncomeStreamStatus = (typeof INCOME_STREAM_STATUSES)[number];
export type IncomeEntryKind = (typeof INCOME_ENTRY_KINDS)[number];
export type IncomeAllocationTarget = (typeof INCOME_ALLOCATION_TARGETS)[number];

export const IncomeStream = defineModel('income.stream', {
  table: 'income_stream',
  order: 'created_at desc',
  fields: {
    kind: fields.enum(INCOME_STREAM_KINDS, { required: true, label: 'Stream Kind' }),
    platform: fields.string({ label: 'Platform' }),
    status: fields.enum(INCOME_STREAM_STATUSES, {
      required: true,
      default: 'idea',
      label: 'Status',
    }),
    goal_monthly_minor: fields.integer({
      required: true,
      default: 0,
      label: 'Monthly Goal (minor units)',
    }),
    currency: fields.string({
      required: true,
      default: 'USD',
      minLength: 3,
      maxLength: 3,
      label: 'Currency',
    }),
    tags: fields.json({ default: {} }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
});

export const IncomeEntry = defineModel('income.entry', {
  table: 'income_entry',
  order: 'occurred_at desc',
  fields: {
    stream: fields.belongsTo(IncomeStream, { required: true, label: 'Income Stream' }),
    occurred_at: fields.datetime({ required: true, index: true, label: 'Occurred At' }),
    amount_minor: fields.integer({ required: true, label: 'Amount (minor units)' }),
    currency: fields.string({ required: true, minLength: 3, maxLength: 3, label: 'Currency' }),
    kind: fields.enum(INCOME_ENTRY_KINDS, { required: true, label: 'Entry Kind' }),
    source_model: fields.string({ required: true, label: 'Source Model' }),
    source_id: fields.string({ required: true, label: 'Source ID' }),
    external_ref: fields.string({ label: 'External Reference' }),
    net_minor: fields.integer({ required: true, label: 'Net Amount (minor units)' }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
});

export const IncomeMetric = defineModel('income.metric', {
  table: 'income_metric',
  order: 'period desc',
  fields: {
    stream: fields.belongsTo(IncomeStream, { required: true, label: 'Income Stream' }),
    period: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}$',
      label: 'Period (YYYY-MM)',
    }),
    revenue_minor: fields.integer({ required: true, default: 0, label: 'Revenue (minor units)' }),
    cost_minor: fields.integer({ required: true, default: 0, label: 'Cost (minor units)' }),
    net_minor: fields.integer({ required: true, default: 0, label: 'Net (minor units)' }),
    mrr_minor: fields.integer({ required: true, default: 0, label: 'MRR (minor units)' }),
    arr_minor: fields.integer({ required: true, default: 0, label: 'ARR (minor units)' }),
    runway_months: fields.integer({ label: 'Runway (months)' }),
    computed_at: fields.datetime({ required: true, label: 'Computed At' }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
  unique: [['stream', 'period']],
});

export const IncomeExperiment = defineModel('income.experiment', {
  table: 'income_experiment',
  order: 'created_at desc',
  fields: {
    stream: fields.belongsTo(IncomeStream, { required: true, label: 'Income Stream' }),
    hypothesis: fields.text({ required: true, label: 'Hypothesis' }),
    variant_config: fields.json({ required: true, label: 'Variant Configuration' }),
    status: fields.enum(['running', 'won', 'lost', 'dropped'], {
      required: true,
      default: 'running',
      label: 'Status',
    }),
    success_metric: fields.string({ required: true, label: 'Success Metric' }),
    result_note: fields.text({ label: 'Result Note' }),
    concluded_at: fields.datetime({ label: 'Concluded At' }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
});

export const IncomeAllocation = defineModel('income.allocation', {
  table: 'income_allocation',
  order: 'created_at desc',
  fields: {
    stream: fields.belongsTo(IncomeStream, { required: true, label: 'Income Stream' }),
    target: fields.enum(INCOME_ALLOCATION_TARGETS, { required: true, label: 'Allocation Target' }),
    percentage: fields.decimal({ required: true, min: 0, max: 100, label: 'Percentage' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Is Active' }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
});
