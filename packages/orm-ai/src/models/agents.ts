import { defineModel, fields, type BaseModel } from '@moonwitness/orm';
import { Company, User } from '@moonwitness/orm-base';
import {
  OrganizationDepartment,
  OrganizationMembership,
  OrganizationPosition,
  OrganizationTeam,
} from '@moonwitness/orm-organization';
import { AGENT_ROLE_TEMPLATES, AGENT_STATUSES, SLUG_CODE_PATTERN } from './constants.js';
import { modelRef } from './helpers.js';
import { ExecutionPolicy, ModelProfile } from './providers.js';

function agentModel(): typeof BaseModel {
  return Agent;
}

function agentProfileModel(): typeof BaseModel {
  return AgentProfile;
}

export const Agent = defineModel('ai.agent', {
  table: 'ai_agents',
  order: 'company_id asc, code asc',
  unique: [['company', 'code']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    code: fields.string({ required: true, pattern: SLUG_CODE_PATTERN }),
    status: fields.enum(AGENT_STATUSES, { required: true, default: 'draft' }),
    service_user: fields.belongsTo(
      modelRef(() => User),
      { unique: true }
    ),
    department: fields.belongsTo(modelRef(() => OrganizationDepartment)),
    team: fields.belongsTo(modelRef(() => OrganizationTeam)),
    position: fields.belongsTo(modelRef(() => OrganizationPosition)),
    organization_membership: fields.belongsTo(modelRef(() => OrganizationMembership)),
    reports_to_agent: fields.belongsTo(agentModel),
    role_template: fields.enum(AGENT_ROLE_TEMPLATES, { required: true, default: 'researcher' }),
    is_emergency_stopped: fields.boolean({ required: true, default: false }),
    retired_at: fields.string(),
    profiles: fields.hasMany(agentProfileModel, { foreignKey: 'agent_id' }),
  },
});

export const AgentProfile = defineModel('ai.agent_profile', {
  table: 'ai_agent_profiles',
  order: 'company_id asc, name asc',
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true }
    ),
    agent: fields.belongsTo(
      modelRef(() => Agent),
      { required: true, unique: true }
    ),
    name: fields.string({ required: true, label: 'Display Name' }),
    description: fields.text(),
    system_instructions: fields.text({ sensitive: true }),
    default_model_profile: fields.belongsTo(modelRef(() => ModelProfile)),
    default_execution_policy: fields.belongsTo(modelRef(() => ExecutionPolicy)),
    default_capabilities_json: fields.text({ required: true, default: '[]' }),
  },
});
