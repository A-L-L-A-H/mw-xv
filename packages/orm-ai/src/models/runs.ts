import { defineModel, fields } from '@moonwitness/orm';
import { Job } from '@moonwitness/jobs';
import { Company, User } from '@moonwitness/orm-base';
import { Agent } from './agents.js';
import {
  ARTIFACT_KINDS,
  ARTIFACT_VERIFICATION_STATUSES,
  DATA_CLASSIFICATIONS,
  OBLIGATION_STATUSES,
  OBLIGATION_TRIGGERS,
  RUN_STATUSES,
  SHA256_PATTERN,
  SLUG_CODE_PATTERN,
  TOKEN_SOURCES,
  UUID_PATTERN,
} from './constants.js';
import { modelRef } from './helpers.js';
import { ExecutionPolicy, ModelProfile, ProviderProfile } from './providers.js';
import { AcceptanceCriterion, CapabilityGrant, WorkContract } from './work.js';

export const AgentRun = defineModel('ai.agent_run', {
  table: 'ai_agent_runs',
  order: 'create_date desc, id desc',
  unique: [['company', 'idempotency_key']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    work_contract: fields.belongsTo(
      modelRef(() => WorkContract),
      { required: true }
    ),
    agent: fields.belongsTo(
      modelRef(() => Agent),
      { required: true }
    ),
    capability_grant: fields.belongsTo(
      modelRef(() => CapabilityGrant),
      { required: true }
    ),
    provider_profile: fields.belongsTo(
      modelRef(() => ProviderProfile),
      { required: true }
    ),
    model_profile: fields.belongsTo(
      modelRef(() => ModelProfile),
      { required: true }
    ),
    execution_policy: fields.belongsTo(
      modelRef(() => ExecutionPolicy),
      { required: true }
    ),
    job: fields.belongsTo(
      modelRef(() => Job),
      { unique: true }
    ),
    /** Immutable secret-free execution snapshot hash, set before dispatch. */
    execution_fingerprint: fields.string({ pattern: SHA256_PATTERN, index: true }),
    approval_workflow_id: fields.integer({ index: true }),
    idempotency_key: fields.string({ required: true, hidden: true }),
    correlation_id: fields.string({ required: true, index: true }),
    status: fields.enum(RUN_STATUSES, { required: true, default: 'pending', index: true }),
    fencing_token: fields.integer({ required: true, default: 0 }),
    checkpoint_cursor: fields.string(),
    checkpoint_json: fields.text({ hidden: true }),
    step_count: fields.integer({ required: true, default: 0 }),
    input_tokens: fields.integer({ required: true, default: 0 }),
    output_tokens: fields.integer({ required: true, default: 0 }),
    token_source: fields.enum(TOKEN_SOURCES, { required: true, default: 'estimated' }),
    estimated_cost_micros: fields.integer({ required: true, default: 0 }),
    started_at: fields.string(),
    finished_at: fields.string(),
    error_code: fields.string(),
    error_summary: fields.text(),
  },
});

/** Small durable acknowledgement record for idempotent tool side effects. */
export const AgentRunEffect = defineModel('ai.agent_run_effect', {
  table: 'ai_agent_run_effects',
  order: 'id desc',
  unique: [['company', 'agent_run', 'effect_key']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    agent_run: fields.belongsTo(
      modelRef(() => AgentRun),
      { required: true }
    ),
    effect_key: fields.string({ required: true }),
    args_sha256: fields.string({ required: true, pattern: SHA256_PATTERN }),
    output_json: fields.text({ required: true, default: 'null' }),
    fencing_token: fields.integer({ required: true, default: 0 }),
  },
});

export const ArtifactManifest = defineModel('ai.artifact_manifest', {
  table: 'ai_artifact_manifests',
  order: 'create_date desc, id desc',
  unique: [['company', 'storage_key', 'acceptance_criterion']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    work_contract: fields.belongsTo(
      modelRef(() => WorkContract),
      { required: true }
    ),
    acceptance_criterion: fields.belongsTo(modelRef(() => AcceptanceCriterion)),
    agent_run: fields.belongsTo(modelRef(() => AgentRun)),
    producer_agent: fields.belongsTo(modelRef(() => Agent)),
    artifact_kind: fields.enum(ARTIFACT_KINDS, { required: true }),
    storage_key: fields.string({ required: true, pattern: UUID_PATTERN }),
    sha256: fields.string({ required: true, index: true, pattern: SHA256_PATTERN }),
    size_bytes: fields.integer({ required: true }),
    mime_type: fields.string({ required: true, default: 'application/json' }),
    source_sha: fields.string(),
    knowledge_release_ref: fields.string(),
    data_classification: fields.enum(DATA_CLASSIFICATIONS, {
      required: true,
      default: 'local_only',
    }),
    verification_status: fields.enum(ARTIFACT_VERIFICATION_STATUSES, {
      required: true,
      default: 'proposed',
    }),
    retention_until: fields.string({ index: true }),
    stale_at: fields.string(),
    reviewed_by: fields.belongsTo(modelRef(() => User)),
    reviewed_at: fields.string(),
  },
});

export const Obligation = defineModel('ai.obligation', {
  table: 'ai_obligations',
  order: 'create_date desc, id desc',
  unique: [['company', 'code']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    code: fields.string({ required: true, pattern: SLUG_CODE_PATTERN }),
    origin_contract: fields.belongsTo(
      modelRef(() => WorkContract),
      { required: true }
    ),
    origin_artifact: fields.belongsTo(modelRef(() => ArtifactManifest)),
    owner_agent: fields.belongsTo(modelRef(() => Agent)),
    owner_user: fields.belongsTo(modelRef(() => User)),
    scope_json: fields.text({ required: true, default: '{}' }),
    trigger_kind: fields.enum(OBLIGATION_TRIGGERS, { required: true }),
    impact_links_json: fields.text({ required: true, default: '[]' }),
    required_evidence: fields.string({ required: true }),
    status: fields.enum(OBLIGATION_STATUSES, { required: true, default: 'open', index: true }),
    due_at: fields.string({ index: true }),
    last_verified_at: fields.string(),
    decision_rationale: fields.text(),
  },
});
