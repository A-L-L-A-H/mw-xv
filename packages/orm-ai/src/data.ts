import { ref, seed } from '@moonwitness/orm';
import { AccessGroup, GroupMembership, IrFeatureFlag, ModelAccess } from '@moonwitness/orm-base';
import { WorkflowDefinition } from '@moonwitness/orm-workflow';
import {
  AcceptanceCriterion,
  Agent,
  AgentProfile,
  AgentRun,
  ArtifactManifest,
  CapabilityGrant,
  ExecutionPolicy,
  MemoryCandidate,
  ModelProfile,
  Obligation,
  ProviderProfile,
  SkillVersion,
  Taskforce,
  WorkContract,
  WorkforceAssignment,
} from './models.js';

const ALL_AI_MODELS = [
  ProviderProfile,
  ModelProfile,
  ExecutionPolicy,
  Agent,
  AgentProfile,
  WorkContract,
  AcceptanceCriterion,
  CapabilityGrant,
  AgentRun,
  ArtifactManifest,
  Obligation,
  Taskforce,
  WorkforceAssignment,
  SkillVersion,
  MemoryCandidate,
] as const;

const OPERATOR_WRITABLE_MODELS = [
  ProviderProfile,
  ModelProfile,
  ExecutionPolicy,
  Agent,
  AgentProfile,
  WorkContract,
  AcceptanceCriterion,
  CapabilityGrant,
  Obligation,
  Taskforce,
  WorkforceAssignment,
] as const;

const OPERATOR_READONLY_MODELS = [
  AgentRun,
  ArtifactManifest,
  SkillVersion,
  MemoryCandidate,
] as const;

const workContractReviewWorkflow = {
  startState: 'draft',
  startRoles: ['user', 'superadmin', 'system'],
  timeoutMinutes: 10080,
  resourceModels: [WorkContract.modelName],
  transitions: [
    {
      action: 'submit_for_review',
      from: 'draft',
      to: 'in_review',
      roles: ['user', 'superadmin', 'system'],
    },
    {
      action: 'accept',
      from: 'in_review',
      to: 'accepted',
      roles: ['user', 'superadmin', 'system'],
      requiredApprovals: 1,
      requireDifferentActor: true,
    },
    {
      action: 'reject',
      from: 'in_review',
      to: 'rejected',
      roles: ['user', 'superadmin', 'system'],
    },
  ],
};

const capabilityEscalationWorkflow = {
  startState: 'requested',
  startRoles: ['user', 'superadmin', 'system'],
  timeoutMinutes: 1440,
  resourceModels: [CapabilityGrant.modelName],
  transitions: [
    {
      action: 'approve',
      from: 'requested',
      to: 'approved',
      roles: ['superadmin', 'system'],
      requiredApprovals: 1,
      requireDifferentActor: true,
    },
    {
      action: 'reject',
      from: 'requested',
      to: 'rejected',
      roles: ['user', 'superadmin', 'system'],
    },
  ],
};

const skillPromotionWorkflow = {
  startState: 'candidate',
  startRoles: ['user', 'superadmin', 'system'],
  timeoutMinutes: 10080,
  resourceModels: [SkillVersion.modelName],
  transitions: [
    {
      action: 'approve',
      from: 'candidate',
      to: 'approved',
      roles: ['superadmin', 'system'],
      requiredApprovals: 1,
      requireDifferentActor: true,
    },
    {
      action: 'reject',
      from: 'candidate',
      to: 'rejected',
      roles: ['user', 'superadmin', 'system'],
    },
  ],
};

const memoryPromotionWorkflow = {
  startState: 'candidate',
  startRoles: ['user', 'superadmin', 'system'],
  timeoutMinutes: 10080,
  resourceModels: [MemoryCandidate.modelName],
  transitions: [
    {
      action: 'approve',
      from: 'candidate',
      to: 'approved',
      roles: ['superadmin', 'system'],
      requiredApprovals: 1,
      requireDifferentActor: true,
    },
    {
      action: 'reject',
      from: 'candidate',
      to: 'rejected',
      roles: ['user', 'superadmin', 'system'],
    },
  ],
};

export const data = [
  seed(AccessGroup, 'ai.group_operator', {
    code: 'ai_operator',
    name: 'AI Corporation Operator',
    description: 'Authorized operators for AI Corporation domain administration.',
  }),
  seed(AccessGroup, 'ai.group_reviewer', {
    code: 'ai_reviewer',
    name: 'AI Corporation Reviewer',
    description: 'Independent reviewers for Proof-Carrying Work and learning promotions.',
  }),
  seed(GroupMembership, 'ai.membership_operator_superadmin', {
    user: ref('base.user_superadmin'),
    group: ref('ai.group_operator'),
  }),
  seed(GroupMembership, 'ai.membership_reviewer_superadmin', {
    user: ref('base.user_superadmin'),
    group: ref('ai.group_reviewer'),
  }),
  ...ALL_AI_MODELS.map((model) =>
    seed(ModelAccess, `ai.access_user_${model.modelName.replaceAll('.', '_')}_deny`, {
      group: ref('base.group_user'),
      model_name: model.modelName,
      read: false,
      create: false,
      write: false,
      unlink: false,
    })
  ),
  ...OPERATOR_WRITABLE_MODELS.map((model) =>
    seed(ModelAccess, `ai.access_operator_${model.modelName.replaceAll('.', '_')}`, {
      group: ref('ai.group_operator'),
      model_name: model.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    })
  ),
  ...OPERATOR_READONLY_MODELS.map((model) =>
    seed(ModelAccess, `ai.access_operator_${model.modelName.replaceAll('.', '_')}`, {
      group: ref('ai.group_operator'),
      model_name: model.modelName,
      read: true,
      create: false,
      write: false,
      unlink: false,
    })
  ),
  ...ALL_AI_MODELS.map((model) =>
    seed(ModelAccess, `ai.access_reviewer_${model.modelName.replaceAll('.', '_')}_read`, {
      group: ref('ai.group_reviewer'),
      model_name: model.modelName,
      read: true,
      create: false,
      write: false,
      unlink: false,
    })
  ),
  seed(IrFeatureFlag, 'ai.feature_flag_corporation_enabled', {
    key: 'ai.corporation_enabled',
    name: 'AI Corporation Workforce',
    enabled: false,
    rollout_pct: 0,
    proposal_id: 'AI-000',
    description: 'Default-off feature gate for AI Corporation execution.',
  }),
  seed(WorkflowDefinition, 'ai.workflow_work_contract_review_v1', {
    code: 'ai.work_contract_review',
    version: 1,
    name: 'AI Work Contract Review',
    config: JSON.stringify(workContractReviewWorkflow),
  }),
  seed(WorkflowDefinition, 'ai.workflow_capability_escalation_v1', {
    code: 'ai.capability_escalation',
    version: 1,
    name: 'AI Capability Escalation',
    config: JSON.stringify(capabilityEscalationWorkflow),
  }),
  seed(WorkflowDefinition, 'ai.workflow_skill_promotion_v1', {
    code: 'ai.skill_promotion',
    version: 1,
    name: 'AI Skill Promotion',
    config: JSON.stringify(skillPromotionWorkflow),
  }),
  seed(WorkflowDefinition, 'ai.workflow_memory_promotion_v1', {
    code: 'ai.memory_promotion',
    version: 1,
    name: 'AI Memory Promotion',
    config: JSON.stringify(memoryPromotionWorkflow),
  }),
  seed(ProviderProfile, 'ai.provider_mock_default', {
    company: ref('base.company_default'),
    code: 'mock_deterministic',
    name: 'Deterministic Mock Provider',
    kind: 'mock',
    secret_ref: 'MW_AI_MOCK_UNUSED',
    data_classification: 'local_only',
    enabled: false,
    timeout_ms: 10000,
    max_concurrency: 2,
    rate_limit_rpm: 120,
    notes: 'Default disabled deterministic mock provider profile; no secret key stored.',
  }),
  seed(ModelProfile, 'ai.model_mock_default', {
    company: ref('base.company_default'),
    provider_profile: ref('ai.provider_mock_default'),
    code: 'mock_v1',
    name: 'Deterministic Mock Model v1',
    model_id: 'mock-deterministic-v1',
    context_window: 8192,
    max_output_tokens: 2048,
    supports_tools: true,
    supports_streaming: false,
    supports_structured_output: true,
    modalities_json: '["text"]',
    input_cost_micros_per_1k: 0,
    output_cost_micros_per_1k: 0,
    enabled: true,
  }),
  seed(ExecutionPolicy, 'ai.policy_r0_readonly', {
    company: ref('base.company_default'),
    code: 'r0_readonly_default',
    policy_version: 1,
    name: 'R0 Read-Only Default Policy',
    description: 'Fail-closed read-only policy for local bounded research.',
    default_risk_tier: 'R0',
    max_risk_tier: 'R0',
    allowed_classification: 'local_only',
    allow_cloud_fallback: false,
    require_independent_review: true,
    require_human_signoff: false,
    max_steps: 8,
    max_wall_clock_seconds: 120,
    max_tokens_per_run: 32000,
    max_cost_micros_per_run: 0,
    max_delegation_depth: 0,
    max_concurrent_runs: 1,
    enabled: true,
  }),
  seed(Agent, 'ai.agent_example_researcher', {
    company: ref('base.company_default'),
    code: 'example_researcher',
    status: 'draft',
    department: ref('organization.department_product'),
    role_template: 'researcher',
    is_emergency_stopped: false,
  }),
  seed(AgentProfile, 'ai.agent_profile_example_researcher', {
    company: ref('base.company_default'),
    agent: ref('ai.agent_example_researcher'),
    name: 'Example Bounded Researcher',
    description: 'Safe draft example profile; inactive until explicitly activated and granted.',
    default_model_profile: ref('ai.model_mock_default'),
    default_execution_policy: ref('ai.policy_r0_readonly'),
    default_capabilities_json: '["repo.read@v1"]',
  }),
];
