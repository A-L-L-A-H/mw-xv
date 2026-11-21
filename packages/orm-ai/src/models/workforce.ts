import { defineModel, fields, type BaseModel } from '@moonwitness/orm';
import { Company, User } from '@moonwitness/orm-base';
import { Agent } from './agents.js';
import {
  AGENT_ROLE_TEMPLATES,
  SLUG_CODE_PATTERN,
  TASKFORCE_STATUSES,
  WORKFORCE_ASSIGNMENT_STATUSES,
  WORKFORCE_WRITE_MODES,
} from './constants.js';
import { modelRef } from './helpers.js';
import { ExecutionPolicy } from './providers.js';
import { WorkContract } from './work.js';

function taskforceModel(): typeof BaseModel {
  return Taskforce;
}

function workforceAssignmentModel(): typeof BaseModel {
  return WorkforceAssignment;
}

export const Taskforce = defineModel('ai.taskforce', {
  table: 'ai_taskforces',
  order: 'create_date desc, id desc',
  unique: [['company', 'code']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    code: fields.string({ pattern: SLUG_CODE_PATTERN }),
    name: fields.string({ required: true }),
    purpose: fields.text(),
    scope_json: fields.text({ required: true, default: '{}' }),
    status: fields.enum(TASKFORCE_STATUSES, { required: true, default: 'draft', index: true }),
    lead_agent: fields.belongsTo(modelRef(() => Agent)),
    work_contract: fields.belongsTo(modelRef(() => WorkContract)),
    execution_policy: fields.belongsTo(modelRef(() => ExecutionPolicy)),
    max_agents: fields.integer({ required: true, default: 4 }),
    budget_micros: fields.integer({ required: true, default: 0 }),
    spent_micros: fields.integer({ required: true, default: 0 }),
    expires_at: fields.string({ index: true }),
    created_by: fields.belongsTo(modelRef(() => User)),
    disbanded_at: fields.string(),
    assignments: fields.hasMany(workforceAssignmentModel, { foreignKey: 'taskforce_id' }),
  },
});

export const WorkforceAssignment = defineModel('ai.workforce_assignment', {
  table: 'ai_workforce_assignments',
  order: 'create_date desc, id desc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    taskforce: fields.belongsTo(taskforceModel, { required: true }),
    agent: fields.belongsTo(
      modelRef(() => Agent),
      { required: true }
    ),
    work_contract: fields.belongsTo(modelRef(() => WorkContract)),
    role_template: fields.enum(AGENT_ROLE_TEMPLATES, { required: true, default: 'researcher' }),
    status: fields.enum(WORKFORCE_ASSIGNMENT_STATUSES, {
      required: true,
      default: 'assigned',
      index: true,
    }),
    workspace_scope: fields.string(),
    write_mode: fields.enum(WORKFORCE_WRITE_MODES, { required: true, default: 'read_only' }),
    budget_micros: fields.integer({ required: true, default: 0 }),
    assigned_by: fields.belongsTo(modelRef(() => User)),
    assigned_at: fields.string({ required: true }),
    expires_at: fields.string({ index: true }),
    released_at: fields.string(),
    notes: fields.text(),
  },
});
