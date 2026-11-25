import { defineModel, fields, type BaseModel } from '@moonwitness/orm';
import { Company } from '@moonwitness/orm-base';

function publicToolModel(): typeof BaseModel {
  return PublicTool;
}

export const PublicTool = defineModel('public.tool', {
  table: 'public_tools',
  order: 'name asc',
  fields: {
    slug: fields.string({ required: true, unique: true, pattern: '^[a-z0-9-]+$' }),
    name: fields.string({ required: true }),
    description: fields.text(),
    kind: fields.enum(['api', 'page', 'widget', 'embed'] as const, { required: true }),
    handler: fields.string({ required: true }),
    rate_limit: fields.integer({ required: true, default: 60 }),
    is_active: fields.boolean({ required: true, default: true }),
    charity_mode: fields.boolean({ required: true, default: false }),
    attribution_text: fields.text(),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
  },
});

export const PublicUsage = defineModel('public.usage', {
  table: 'public_usages',
  order: 'created_at desc',
  fields: {
    tool: fields.belongsTo(publicToolModel, { required: true, label: 'Tool' }),
    user_identifier: fields.string({ required: true }),
    input_hash: fields.string({ required: true }),
    output_hash: fields.string({ required: true }),
    latency_ms: fields.integer({ required: true, default: 0 }),
    status: fields.integer({ required: true, default: 200 }),
    created_at: fields.datetime({ required: true }),
  },
});

export const PublicMetric = defineModel('public.metric', {
  table: 'public_metrics',
  unique: [['tool', 'date']],
  order: 'date desc',
  fields: {
    tool: fields.belongsTo(publicToolModel, { required: true, label: 'Tool' }),
    date: fields.date({ required: true }),
    calls: fields.integer({ required: true, default: 0 }),
    unique_users: fields.integer({ required: true, default: 0 }),
    avg_latency: fields.float({ required: true, default: 0 }),
    errors: fields.integer({ required: true, default: 0 }),
    charity_attribution_minor: fields.integer({ required: true, default: 0 }),
  },
});

export const PublicFeedback = defineModel('public.feedback', {
  table: 'public_feedbacks',
  order: 'created_at desc',
  fields: {
    tool: fields.belongsTo(publicToolModel, { required: true, label: 'Tool' }),
    rating: fields.integer({ required: true }),
    comment: fields.text(),
    contact_opt_in: fields.boolean({ required: true, default: false }),
    created_at: fields.datetime({ required: true }),
  },
});
