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

export const INCOME_ALLOCATION_TARGETS = ['reinvest', 'savings', 'charity', 'personal', 'tax'] as const;

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
    status: fields.enum(INCOME_STREAM_STATUSES, { required: true, default: 'idea', label: 'Status' }),
    goalMonthlyMinor: fields.integer({ required: true, default: 0, label: 'Monthly Goal (minor units)' }),
    currency: fields.string({ required: true, default: 'USD', minLength: 3, maxLength: 3, label: 'Currency' }),
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
    occurredAt: fields.datetime({ required: true, label: 'Occurred At' }),
    amountMinor: fields.integer({ required: true, label: 'Amount (minor units)' }),
    currency: fields.string({ required: true, minLength: 3, maxLength: 3, label: 'Currency' }),
    kind: fields.enum(INCOME_ENTRY_KINDS, { required: true, label: 'Entry Kind' }),
    sourceModel: fields.string({ required: true, label: 'Source Model' }),
    sourceId: fields.integer({ required: true, label: 'Source ID' }),
    externalRef: fields.string({ label: 'External Reference' }),
    netMinor: fields.integer({ required: true, label: 'Net Amount (minor units)' }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
  indexes: [['stream', 'occurredAt']],
});

export const IncomeMetric = defineModel('income.metric', {
  table: 'income_metric',
  order: 'period desc',
  fields: {
    stream: fields.belongsTo(IncomeStream, { required: true, label: 'Income Stream' }),
    period: fields.string({ required: true, pattern: '^\\d{4}-\\d{2}$', label: 'Period (YYYY-MM)' }),
    revenueMinor: fields.integer({ required: true, default: 0, label: 'Revenue (minor units)' }),
    costMinor: fields.integer({ required: true, default: 0, label: 'Cost (minor units)' }),
    netMinor: fields.integer({ required: true, default: 0, label: 'Net (minor units)' }),
    mrrMinor: fields.integer({ required: true, default: 0, label: 'MRR (minor units)' }),
    arrMinor: fields.integer({ required: true, default: 0, label: 'ARR (minor units)' }),
    runwayMonths: fields.integer({ label: 'Runway (months)' }),
    computedAt: fields.datetime({ required: true, label: 'Computed At' }),
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
    variantConfig: fields.json({ required: true, label: 'Variant Configuration' }),
    status: fields.enum(['running', 'won', 'lost', 'dropped'], { required: true, default: 'running', label: 'Status' }),
    successMetric: fields.string({ required: true, label: 'Success Metric' }),
    resultNote: fields.text({ label: 'Result Note' }),
    concludedAt: fields.datetime({ label: 'Concluded At' }),
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
    isActive: fields.boolean({ required: true, default: true, label: 'Is Active' }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
});