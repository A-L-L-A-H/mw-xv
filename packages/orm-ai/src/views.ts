import { defineView } from '@moonwitness/orm';
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

export const views = [
  defineView(ProviderProfile, {
    title: 'AI Providers',
    list: {
      columns: ['code', 'name', 'kind', 'data_classification', 'enabled', 'company'],
      order: 'company_id asc, code asc',
    },
    form: {
      sections: [
        {
          title: 'Provider',
          fields: ['company', 'code', 'name', 'kind', 'data_classification', 'enabled'],
        },
        {
          title: 'Connection & Limits',
          fields: [
            'endpoint_url',
            'secret_ref',
            'timeout_ms',
            'max_concurrency',
            'rate_limit_rpm',
            'notes',
          ],
        },
      ],
    },
    search: { fields: ['code', 'name', 'secret_ref'] },
  }),
  defineView(ModelProfile, {
    title: 'AI Model Profiles',
    list: {
      columns: [
        'code',
        'name',
        'provider_profile',
        'model_id',
        'supports_tools',
        'enabled',
        'company',
      ],
      order: 'company_id asc, code asc',
    },
    form: {
      sections: [
        {
          title: 'Model',
          fields: ['company', 'provider_profile', 'code', 'name', 'model_id', 'enabled'],
        },
        {
          title: 'Capabilities & Costs',
          fields: [
            'context_window',
            'max_output_tokens',
            'supports_tools',
            'supports_streaming',
            'supports_structured_output',
            'modalities_json',
            'input_cost_micros_per_1k',
            'output_cost_micros_per_1k',
          ],
        },
      ],
    },
    search: { fields: ['code', 'name', 'model_id'] },
  }),
  defineView(ExecutionPolicy, {
    title: 'Execution Policies',
    list: {
      columns: [
        'code',
        'policy_version',
        'name',
        'default_risk_tier',
        'max_risk_tier',
        'allowed_classification',
        'enabled',
        'company',
      ],
      order: 'company_id asc, code asc, policy_version desc',
    },
    form: {
      sections: [
        {
          title: 'Policy Identity',
          fields: ['company', 'code', 'policy_version', 'name', 'enabled', 'description'],
        },
        {
          title: 'Governance & Safety',
          fields: [
            'default_risk_tier',
            'max_risk_tier',
            'allowed_classification',
            'allow_cloud_fallback',
            'require_independent_review',
            'require_human_signoff',
          ],
        },
        {
          title: 'Budgets & Concurrency',
          fields: [
            'max_steps',
            'max_wall_clock_seconds',
            'max_tokens_per_run',
            'max_cost_micros_per_run',
            'max_delegation_depth',
            'max_concurrent_runs',
          ],
        },
      ],
    },
    search: { fields: ['code', 'name', 'description'] },
  }),
  defineView(Agent, {
    title: 'AI Agents',
    list: {
      columns: ['code', 'role_template', 'status', 'department', 'is_emergency_stopped', 'company'],
      order: 'company_id asc, code asc',
    },
    form: {
      sections: [
        {
          title: 'Identity',
          fields: [
            'company',
            'code',
            'role_template',
            'status',
            'service_user',
            'is_emergency_stopped',
            'retired_at',
          ],
        },
        {
          title: 'Organization',
          fields: ['department', 'team', 'position', 'organization_membership', 'reports_to_agent'],
        },
      ],
    },
    search: { fields: ['code'] },
  }),
  defineView(AgentProfile, {
    title: 'Agent Profiles',
    list: {
      columns: ['name', 'agent', 'default_model_profile', 'default_execution_policy', 'company'],
      order: 'company_id asc, name asc',
    },
    form: {
      sections: [
        {
          title: 'Profile',
          fields: ['company', 'agent', 'name', 'description'],
        },
        {
          title: 'Defaults',
          fields: [
            'default_model_profile',
            'default_execution_policy',
            'default_capabilities_json',
            'system_instructions',
          ],
        },
      ],
    },
    search: { fields: ['name', 'description'] },
  }),
  defineView(WorkContract, {
    title: 'Work Contracts',
    list: {
      columns: [
        'code',
        'title',
        'risk_tier',
        'data_classification',
        'status',
        'assigned_agent',
        'company',
      ],
      order: 'create_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Contract',
          fields: [
            'company',
            'code',
            'title',
            'objective',
            'risk_tier',
            'data_classification',
            'status',
          ],
        },
        {
          title: 'Assignment & Governance',
          fields: [
            'requested_by',
            'execution_policy',
            'assigned_agent',
            'reviewer_agent',
            'parent_contract',
            'delegation_depth',
            'workflow_instance',
            'source_model',
            'source_id',
          ],
        },
        {
          title: 'Scope & Acceptance',
          fields: [
            'scope_json',
            'constraints_json',
            'non_goals_json',
            'expected_deliverables_json',
            'criteria_locked_at',
            'accepted_at',
          ],
        },
      ],
    },
    search: { fields: ['code', 'title', 'objective'] },
  }),
  defineView(AcceptanceCriterion, {
    title: 'Acceptance Criteria',
    list: {
      columns: [
        'work_contract',
        'sequence',
        'code',
        'title',
        'verification_method',
        'mandatory',
        'status',
      ],
      order: 'work_contract_id asc, sequence asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Criterion',
          fields: [
            'company',
            'work_contract',
            'sequence',
            'code',
            'title',
            'verification_method',
            'required_evidence_type',
            'mandatory',
            'version',
            'status',
            'checked_at',
          ],
        },
      ],
    },
    search: { fields: ['code', 'title', 'required_evidence_type'] },
  }),
  defineView(CapabilityGrant, {
    title: 'Capability Grants',
    list: {
      columns: [
        'agent',
        'capability',
        'policy_version',
        'status',
        'expires_at',
        'work_contract',
        'company',
      ],
      order: 'create_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Grant',
          fields: [
            'company',
            'agent',
            'work_contract',
            'execution_policy',
            'capability',
            'policy_version',
            'max_calls_per_run',
            'scope_json',
          ],
        },
        {
          title: 'Lifecycle',
          fields: [
            'status',
            'issued_by',
            'issued_at',
            'expires_at',
            'revoked_at',
            'revoked_by',
            'revocation_reason',
            'audit_ref',
          ],
        },
      ],
    },
    search: { fields: ['capability', 'audit_ref', 'revocation_reason'] },
  }),
  defineView(AgentRun, {
    title: 'Agent Runs',
    list: {
      columns: [
        'correlation_id',
        'agent',
        'work_contract',
        'status',
        'step_count',
        'input_tokens',
        'output_tokens',
        'company',
      ],
      order: 'create_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Execution',
          fields: [
            'company',
            'work_contract',
            'agent',
            'capability_grant',
            'provider_profile',
            'model_profile',
            'execution_policy',
            'job',
            'correlation_id',
            'status',
          ],
        },
        {
          title: 'Checkpoints & Usage',
          fields: [
            'fencing_token',
            'checkpoint_cursor',
            'step_count',
            'input_tokens',
            'output_tokens',
            'token_source',
            'estimated_cost_micros',
            'started_at',
            'finished_at',
            'error_code',
            'error_summary',
          ],
        },
      ],
    },
    search: { fields: ['correlation_id', 'error_code'] },
  }),
  defineView(ArtifactManifest, {
    title: 'Artifact Manifests',
    list: {
      columns: [
        'work_contract',
        'artifact_kind',
        'verification_status',
        'data_classification',
        'size_bytes',
        'sha256',
        'company',
      ],
      order: 'create_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Artifact Reference',
          fields: [
            'company',
            'work_contract',
            'acceptance_criterion',
            'agent_run',
            'producer_agent',
            'artifact_kind',
            'storage_key',
            'sha256',
            'size_bytes',
            'mime_type',
          ],
        },
        {
          title: 'Provenance & Verification',
          fields: [
            'source_sha',
            'knowledge_release_ref',
            'data_classification',
            'verification_status',
            'retention_until',
            'stale_at',
            'reviewed_by',
            'reviewed_at',
          ],
        },
      ],
    },
    search: { fields: ['storage_key', 'sha256', 'source_sha', 'knowledge_release_ref'] },
  }),
  defineView(Obligation, {
    title: 'Verification Obligations',
    list: {
      columns: ['code', 'origin_contract', 'trigger_kind', 'status', 'due_at', 'company'],
      order: 'create_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Obligation',
          fields: [
            'company',
            'code',
            'origin_contract',
            'origin_artifact',
            'owner_agent',
            'owner_user',
            'trigger_kind',
            'status',
            'required_evidence',
            'due_at',
            'last_verified_at',
          ],
        },
        {
          title: 'Impact & Rationale',
          fields: ['scope_json', 'impact_links_json', 'decision_rationale'],
        },
      ],
    },
    search: { fields: ['code', 'required_evidence', 'decision_rationale'] },
  }),
  defineView(SkillVersion, {
    title: 'Skill Versions',
    list: {
      columns: ['code', 'version', 'title', 'status', 'eval_score_bps', 'company'],
      order: 'company_id asc, code asc, version desc',
    },
    form: {
      sections: [
        {
          title: 'Skill Definition',
          fields: [
            'company',
            'code',
            'version',
            'title',
            'sop_body',
            'allowed_capabilities_json',
            'source_run',
            'approval_workflow',
          ],
        },
        {
          title: 'Governance',
          fields: [
            'status',
            'eval_score_bps',
            'expires_at',
            'approved_by',
            'approved_at',
            'revoked_by',
            'revoked_at',
            'revocation_reason',
          ],
        },
      ],
    },
    search: { fields: ['code', 'title'] },
  }),
  defineView(MemoryCandidate, {
    title: 'Memory Candidates',
    list: {
      columns: [
        'title',
        'memory_kind',
        'scope_kind',
        'status',
        'confidence_bps',
        'data_classification',
        'company',
      ],
      order: 'create_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Candidate',
          fields: [
            'company',
            'memory_kind',
            'scope_kind',
            'scope_ref',
            'title',
            'content',
            'source_ref',
            'confidence_bps',
            'data_classification',
          ],
        },
        {
          title: 'Provenance & Promotion',
          fields: [
            'work_contract',
            'source_run',
            'source_agent',
            'evidence_artifact',
            'promoted_skill',
            'approval_workflow',
            'status',
            'retention_until',
            'expires_at',
            'reviewed_by',
            'reviewed_at',
            'revoked_by',
            'revoked_at',
            'revocation_reason',
          ],
        },
      ],
    },
    search: { fields: ['title', 'scope_ref', 'source_ref'] },
  }),
  defineView(Taskforce, {
    title: 'AI Taskforces',
    list: {
      columns: ['code', 'name', 'status', 'lead_agent', 'budget_micros', 'expires_at', 'company'],
      order: 'create_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Taskforce',
          fields: [
            'company',
            'code',
            'name',
            'purpose',
            'status',
            'lead_agent',
            'work_contract',
            'execution_policy',
            'created_by',
          ],
        },
        {
          title: 'Scope, Budget & Expiry',
          fields: [
            'scope_json',
            'max_agents',
            'budget_micros',
            'spent_micros',
            'expires_at',
            'disbanded_at',
          ],
        },
      ],
    },
    search: { fields: ['code', 'name', 'purpose'] },
  }),
  defineView(WorkforceAssignment, {
    title: 'Workforce Assignments',
    list: {
      columns: [
        'taskforce',
        'agent',
        'role_template',
        'write_mode',
        'status',
        'expires_at',
        'company',
      ],
      order: 'create_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Assignment',
          fields: [
            'company',
            'taskforce',
            'agent',
            'work_contract',
            'role_template',
            'status',
            'workspace_scope',
            'write_mode',
            'budget_micros',
          ],
        },
        {
          title: 'Lifecycle',
          fields: ['assigned_by', 'assigned_at', 'expires_at', 'released_at', 'notes'],
        },
      ],
    },
    search: { fields: ['workspace_scope', 'notes'] },
  }),
];
