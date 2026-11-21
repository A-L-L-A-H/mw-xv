import { defineModel, fields } from '@moonwitness/orm';
import { Company } from '@moonwitness/orm-base';
import {
  DATA_CLASSIFICATIONS,
  PROVIDER_KINDS,
  RISK_TIERS,
  SECRET_REF_PATTERN,
  SLUG_CODE_PATTERN,
} from './constants.js';
import { modelRef } from './helpers.js';

export const ProviderProfile = defineModel('ai.provider_profile', {
  table: 'ai_provider_profiles',
  order: 'company_id asc, code asc',
  unique: [['company', 'code']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    code: fields.string({ required: true, pattern: SLUG_CODE_PATTERN }),
    name: fields.string({ required: true }),
    kind: fields.enum(PROVIDER_KINDS, { required: true }),
    endpoint_url: fields.string({
      help: 'Loopback URL for ollama or HTTPS URL for external cloud providers; unused for mock.',
    }),
    secret_ref: fields.string({
      required: true,
      pattern: SECRET_REF_PATTERN,
      help: 'Environment variable name only (MW_AI_...); secret values are never stored in ORM.',
    }),
    data_classification: fields.enum(DATA_CLASSIFICATIONS, {
      required: true,
      default: 'local_only',
    }),
    enabled: fields.boolean({ required: true, default: false }),
    timeout_ms: fields.integer({ required: true, default: 30000 }),
    max_concurrency: fields.integer({ required: true, default: 2 }),
    rate_limit_rpm: fields.integer({ required: true, default: 60 }),
    notes: fields.text(),
  },
});

export const ModelProfile = defineModel('ai.model_profile', {
  table: 'ai_model_profiles',
  order: 'company_id asc, code asc',
  unique: [['company', 'code']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    provider_profile: fields.belongsTo(
      modelRef(() => ProviderProfile),
      { required: true }
    ),
    code: fields.string({ required: true, pattern: SLUG_CODE_PATTERN }),
    name: fields.string({ required: true }),
    model_id: fields.string({ required: true }),
    context_window: fields.integer({ required: true, default: 8192 }),
    max_output_tokens: fields.integer({ required: true, default: 2048 }),
    supports_tools: fields.boolean({ required: true, default: false }),
    supports_streaming: fields.boolean({ required: true, default: false }),
    supports_structured_output: fields.boolean({ required: true, default: true }),
    modalities_json: fields.text({ required: true, default: '["text"]' }),
    input_cost_micros_per_1k: fields.integer({ required: true, default: 0 }),
    output_cost_micros_per_1k: fields.integer({ required: true, default: 0 }),
    enabled: fields.boolean({ required: true, default: true }),
  },
});

export const ExecutionPolicy = defineModel('ai.execution_policy', {
  table: 'ai_execution_policies',
  order: 'company_id asc, code asc, policy_version desc',
  unique: [['company', 'code', 'policy_version']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    code: fields.string({ required: true, pattern: SLUG_CODE_PATTERN }),
    policy_version: fields.integer({ required: true, default: 1 }),
    name: fields.string({ required: true }),
    description: fields.text(),
    default_risk_tier: fields.enum(RISK_TIERS, { required: true, default: 'R0' }),
    max_risk_tier: fields.enum(RISK_TIERS, { required: true, default: 'R0' }),
    allowed_classification: fields.enum(DATA_CLASSIFICATIONS, {
      required: true,
      default: 'local_only',
    }),
    allow_cloud_fallback: fields.boolean({ required: true, default: false }),
    require_independent_review: fields.boolean({ required: true, default: true }),
    require_human_signoff: fields.boolean({ required: true, default: false }),
    max_steps: fields.integer({ required: true, default: 8 }),
    max_wall_clock_seconds: fields.integer({ required: true, default: 120 }),
    max_tokens_per_run: fields.integer({ required: true, default: 32000 }),
    max_cost_micros_per_run: fields.integer({ required: true, default: 0 }),
    max_delegation_depth: fields.integer({ required: true, default: 0 }),
    max_concurrent_runs: fields.integer({ required: true, default: 1 }),
    enabled: fields.boolean({ required: true, default: true }),
  },
});
