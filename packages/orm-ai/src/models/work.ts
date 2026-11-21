import { defineModel, fields, type BaseModel } from '@moonwitness/orm';
import { Company, User } from '@moonwitness/orm-base';
import { WorkflowInstance } from '@moonwitness/orm-workflow';
import { Agent } from './agents.js';
import {
  CAPABILITY_PATTERN,
  DATA_CLASSIFICATIONS,
  EVIDENCE_STATUSES,
  GRANT_STATUSES,
  RISK_TIERS,
  SLUG_CODE_PATTERN,
  SOURCE_MODEL_PATTERN,
  VERIFICATION_METHODS,
  WORK_CONTRACT_STATUSES,
} from './constants.js';
import { modelRef } from './helpers.js';
import { ExecutionPolicy } from './providers.js';

function workContractModel(): typeof BaseModel {
  return WorkContract;
}

function acceptanceCriterionModel(): typeof BaseModel {
  return AcceptanceCriterion;
}

export const WorkContract = defineModel('ai.work_contract', {
  table: 'ai_work_contracts',
  order: 'create_date desc, id desc',
  unique: [['company', 'code']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    code: fields.string({ required: true, pattern: SLUG_CODE_PATTERN }),
    title: fields.string({ required: true }),
    objective: fields.text({ required: true }),
    scope_json: fields.text({ required: true, default: '{}' }),
    constraints_json: fields.text({ required: true, default: '{}' }),
    non_goals_json: fields.text({ required: true, default: '[]' }),
    expected_deliverables_json: fields.text({ required: true, default: '[]' }),
    source_model: fields.string({ pattern: SOURCE_MODEL_PATTERN }),
    source_id: fields.integer(),
    workflow_instance: fields.belongsTo(modelRef(() => WorkflowInstance)),
    parent_contract: fields.belongsTo(workContractModel),
    delegation_depth: fields.integer({ required: true, default: 0 }),
    assigned_agent: fields.belongsTo(modelRef(() => Agent)),
    reviewer_agent: fields.belongsTo(modelRef(() => Agent)),
    execution_policy: fields.belongsTo(
      modelRef(() => ExecutionPolicy),
      { required: true }
    ),
    requested_by: fields.belongsTo(
      modelRef(() => User),
      { required: true }
    ),
    risk_tier: fields.enum(RISK_TIERS, { required: true, default: 'R0' }),
    data_classification: fields.enum(DATA_CLASSIFICATIONS, {
      required: true,
      default: 'local_only',
    }),
    status: fields.enum(WORK_CONTRACT_STATUSES, { required: true, default: 'draft' }),
    criteria_locked_at: fields.string(),
    accepted_at: fields.string(),
    criteria: fields.hasMany(acceptanceCriterionModel, { foreignKey: 'work_contract_id' }),
  },
});

export const AcceptanceCriterion = defineModel('ai.acceptance_criterion', {
  table: 'ai_acceptance_criteria',
  order: 'work_contract_id asc, sequence asc, id asc',
  unique: [['work_contract', 'code']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    work_contract: fields.belongsTo(
      modelRef(() => WorkContract),
      { required: true }
    ),
    sequence: fields.integer({ required: true, default: 1 }),
    code: fields.string({ required: true, pattern: SLUG_CODE_PATTERN }),
    title: fields.string({ required: true }),
    verification_method: fields.enum(VERIFICATION_METHODS, { required: true }),
    required_evidence_type: fields.string({ required: true }),
    mandatory: fields.boolean({ required: true, default: true }),
    version: fields.integer({ required: true, default: 1 }),
    status: fields.enum(EVIDENCE_STATUSES, { required: true, default: 'pending' }),
    checked_at: fields.string(),
  },
});

export const CapabilityGrant = defineModel('ai.capability_grant', {
  table: 'ai_capability_grants',
  order: 'create_date desc, id desc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    agent: fields.belongsTo(
      modelRef(() => Agent),
      { required: true }
    ),
    work_contract: fields.belongsTo(modelRef(() => WorkContract)),
    execution_policy: fields.belongsTo(
      modelRef(() => ExecutionPolicy),
      { required: true }
    ),
    capability: fields.string({ required: true, index: true, pattern: CAPABILITY_PATTERN }),
    scope_json: fields.text({ required: true, default: '{}' }),
    policy_version: fields.integer({ required: true }),
    max_calls_per_run: fields.integer({ required: true, default: 25 }),
    issued_by: fields.belongsTo(
      modelRef(() => User),
      { required: true }
    ),
    issued_at: fields.string({ required: true }),
    expires_at: fields.string({ required: true, index: true }),
    status: fields.enum(GRANT_STATUSES, { required: true, default: 'active', index: true }),
    revoked_at: fields.string(),
    revoked_by: fields.belongsTo(modelRef(() => User)),
    revocation_reason: fields.text(),
    audit_ref: fields.string(),
  },
});
