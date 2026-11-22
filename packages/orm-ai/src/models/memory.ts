import { defineModel, fields } from '@moonwitness/orm';
import { Company, User } from '@moonwitness/orm-base';
import { WorkflowInstance } from '@moonwitness/orm-workflow';
import { Agent } from './agents.js';
import {
  DATA_CLASSIFICATIONS,
  MEMORY_KINDS,
  MEMORY_SCOPE_KINDS,
  MEMORY_STATUSES,
  SKILL_STATUSES,
  SLUG_CODE_PATTERN,
} from './constants.js';
import { modelRef } from './helpers.js';
import { AgentRun, ArtifactManifest } from './runs.js';
import { WorkContract } from './work.js';

export const SkillVersion = defineModel('ai.skill_version', {
  table: 'ai_skill_versions',
  order: 'company_id asc, code asc, version desc',
  unique: [['company', 'code', 'version']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    code: fields.string({ required: true, pattern: SLUG_CODE_PATTERN }),
    version: fields.integer({ required: true, default: 1 }),
    title: fields.string({ required: true }),
    sop_body: fields.text({ required: true }),
    allowed_capabilities_json: fields.text({ required: true, default: '[]' }),
    source_run: fields.belongsTo(modelRef(() => AgentRun)),
    approval_workflow: fields.belongsTo(modelRef(() => WorkflowInstance)),
    status: fields.enum(SKILL_STATUSES, { required: true, default: 'candidate', index: true }),
    eval_score_bps: fields.integer(),
    expires_at: fields.string(),
    approved_by: fields.belongsTo(modelRef(() => User)),
    approved_at: fields.string(),
    revoked_by: fields.belongsTo(modelRef(() => User)),
    revoked_at: fields.string(),
    revocation_reason: fields.text(),
  },
});

export const MemoryCandidate = defineModel('ai.memory_candidate', {
  table: 'ai_memory_candidates',
  order: 'create_date desc, id desc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    memory_kind: fields.enum(MEMORY_KINDS, { required: true }),
    scope_kind: fields.enum(MEMORY_SCOPE_KINDS, { required: true, default: 'project' }),
    scope_ref: fields.string({ required: true }),
    title: fields.string({ required: true }),
    content: fields.text({ required: true }),
    source_ref: fields.string({ required: true }),
    confidence_bps: fields.integer({ required: true, default: 5000 }),
    data_classification: fields.enum(DATA_CLASSIFICATIONS, {
      required: true,
      default: 'local_only',
    }),
    work_contract: fields.belongsTo(modelRef(() => WorkContract)),
    source_run: fields.belongsTo(modelRef(() => AgentRun)),
    source_agent: fields.belongsTo(modelRef(() => Agent)),
    evidence_artifact: fields.belongsTo(modelRef(() => ArtifactManifest)),
    promoted_skill: fields.belongsTo(modelRef(() => SkillVersion)),
    approval_workflow: fields.belongsTo(modelRef(() => WorkflowInstance)),
    status: fields.enum(MEMORY_STATUSES, { required: true, default: 'candidate', index: true }),
    retention_until: fields.string(),
    expires_at: fields.string(),
    reviewed_by: fields.belongsTo(modelRef(() => User)),
    reviewed_at: fields.string(),
    revoked_by: fields.belongsTo(modelRef(() => User)),
    revoked_at: fields.string(),
    revocation_reason: fields.text(),
  },
});
