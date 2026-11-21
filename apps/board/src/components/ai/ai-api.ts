'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ActivityIcon,
  CompanyIcon,
  DocumentIcon,
  JobsIcon,
  SecurityIcon,
  SettingsIcon,
  SparkleIcon,
} from '@moonwitness/ui/icons';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';

export const AI_MISSION_CONTROL_ROUTES = [
  {
    href: '/board/ai/hq',
    label: 'Company HQ',
    shortLabel: 'HQ',
    icon: CompanyIcon,
  },
  {
    href: '/board/ai/mission-control',
    label: 'Mission Control',
    shortLabel: 'Mission Control',
    icon: SparkleIcon,
  },
  {
    href: '/board/ai/operations',
    label: 'Live Operations',
    shortLabel: 'Operations',
    icon: ActivityIcon,
  },
  {
    href: '/board/ai/continuity',
    label: 'Evidence & Continuity',
    shortLabel: 'Continuity',
    icon: DocumentIcon,
  },
  {
    href: '/board/ai/governance',
    label: 'Governance & Grants',
    shortLabel: 'Governance',
    icon: SecurityIcon,
  },
  {
    href: '/board/ai/providers',
    label: 'Models & Providers',
    shortLabel: 'Providers',
    icon: SettingsIcon,
  },
  {
    href: '/board/ai/eval-lab',
    label: 'Evaluation Lab',
    shortLabel: 'Eval Lab',
    icon: JobsIcon,
  },
] as const;

export interface AiAgentProfileDto {
  readonly id: number;
  readonly company_id: number;
  readonly agent_id: number;
  readonly name: string;
  readonly description?: string | null;
  readonly default_capabilities_json?: string;
}

export interface AiAgentDto {
  readonly id: number;
  readonly company_id: number;
  readonly code: string;
  readonly name?: string;
  readonly display_name?: string;
  readonly status: 'draft' | 'active' | 'paused' | 'disabled' | 'retired';
  readonly role_template: 'planner' | 'manager' | 'researcher' | 'builder' | 'reviewer';
  readonly department_id?: number | null;
  readonly team_id?: number | null;
  readonly position_id?: number | null;
  readonly service_user_id?: number | null;
  readonly reports_to_agent_id?: number | null;
  readonly is_emergency_stopped: boolean;
  readonly retired_at?: string | null;
  readonly profile?: AiAgentProfileDto | null;
  readonly state_source?: string;
}

export interface AiAcceptanceCriterionDto {
  readonly id: number;
  readonly company_id: number;
  readonly work_contract_id: number;
  readonly sequence: number;
  readonly code: string;
  readonly title: string;
  readonly verification_method: string;
  readonly required_evidence_type: string;
  readonly mandatory: boolean;
  readonly version: number;
  readonly status: string;
  readonly checked_at?: string | null;
}

export interface AiWorkContractDto {
  readonly id: number;
  readonly company_id: number;
  readonly code: string;
  readonly title: string;
  readonly objective: string;
  readonly scope_json?: string;
  readonly constraints_json?: string;
  readonly non_goals_json?: string;
  readonly expected_deliverables_json?: string;
  readonly parent_contract_id?: number | null;
  readonly delegation_depth?: number;
  readonly assigned_agent_id?: number | null;
  readonly reviewer_agent_id?: number | null;
  readonly execution_policy_id: number;
  readonly requested_by_id: number;
  readonly risk_tier: 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
  readonly data_classification: 'local_only' | 'cloud_eligible' | 'restricted';
  readonly status:
    'draft' | 'queued' | 'running' | 'in_review' | 'accepted' | 'rejected' | 'cancelled' | 'failed';
  readonly criteria_locked_at?: string | null;
  readonly accepted_at?: string | null;
  readonly criteria?: readonly AiAcceptanceCriterionDto[];
}

export interface AiCapabilityGrantDto {
  readonly id: number;
  readonly company_id: number;
  readonly agent_id: number;
  readonly work_contract_id?: number | null;
  readonly execution_policy_id: number;
  readonly capability: string;
  readonly scope_json?: string;
  readonly policy_version: number;
  readonly max_calls_per_run: number;
  readonly issued_by_id: number;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly status: 'active' | 'expired' | 'revoked';
  readonly revocation_reason?: string | null;
}

export interface AiModelProfileDto {
  readonly id: number;
  readonly company_id: number;
  readonly provider_profile_id: number;
  readonly code: string;
  readonly name: string;
  readonly model_id: string;
  readonly context_window: number;
  readonly max_output_tokens: number;
  readonly supports_tools: boolean;
  readonly supports_streaming: boolean;
  readonly supports_structured_output: boolean;
  readonly input_cost_micros_per_1k: number;
  readonly output_cost_micros_per_1k: number;
  readonly enabled: boolean;
}

export interface AiProviderProfileDto {
  readonly id: number;
  readonly company_id: number;
  readonly code: string;
  readonly name: string;
  readonly kind: 'mock' | 'ollama' | 'openai' | 'anthropic';
  readonly endpoint_url?: string | null;
  readonly secret_ref: string;
  readonly secret_masked?: string;
  readonly data_classification: 'local_only' | 'cloud_eligible' | 'restricted';
  readonly enabled: boolean;
  readonly timeout_ms: number;
  readonly max_concurrency: number;
  readonly rate_limit_rpm: number;
  readonly notes?: string | null;
  readonly models?: readonly AiModelProfileDto[];
}

export interface AiAgentRunDto {
  readonly id: number;
  readonly company_id: number;
  readonly work_contract_id: number;
  readonly agent_id: number;
  readonly capability_grant_id: number;
  readonly provider_profile_id: number;
  readonly model_profile_id: number;
  readonly execution_policy_id: number;
  readonly job_id?: number | null;
  readonly correlation_id: string;
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  readonly fencing_token: number;
  readonly checkpoint_cursor?: string | null;
  readonly step_count: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly token_source: 'estimated' | 'provider_reported';
  readonly estimated_cost_micros: number;
  readonly started_at?: string | null;
  readonly finished_at?: string | null;
  readonly error_code?: string | null;
  readonly error_summary?: string | null;
}

export interface AiArtifactManifestDto {
  readonly id: number;
  readonly company_id: number;
  readonly work_contract_id: number;
  readonly acceptance_criterion_id?: number | null;
  readonly agent_run_id?: number | null;
  readonly producer_agent_id?: number | null;
  readonly artifact_kind:
    'report' | 'transcript' | 'tool_output' | 'evidence_bundle' | 'eval_result';
  readonly storage_key: string;
  readonly sha256: string;
  readonly size_bytes: number;
  readonly mime_type: string;
  readonly source_sha?: string | null;
  readonly knowledge_release_ref?: string | null;
  readonly data_classification: 'local_only' | 'cloud_eligible' | 'restricted';
  readonly verification_status:
    'proposed' | 'produced' | 'checked' | 'accepted' | 'rejected' | 'superseded';
  readonly retention_until?: string | null;
  readonly stale_at?: string | null;
  readonly reviewed_by_id?: number | null;
  readonly reviewed_at?: string | null;
}

export interface AiObligationDto {
  readonly id: number;
  readonly company_id: number;
  readonly code: string;
  readonly origin_contract_id: number;
  readonly origin_artifact_id?: number | null;
  readonly owner_agent_id?: number | null;
  readonly owner_user_id?: number | null;
  readonly scope_json: string;
  readonly trigger_kind:
    'code_change' | 'source_change' | 'policy_change' | 'time_expiry' | 'manual';
  readonly impact_links_json?: string;
  readonly required_evidence: string;
  readonly status: 'open' | 'reverification_due' | 'satisfied' | 'superseded' | 'retired';
  readonly due_at?: string | null;
  readonly last_verified_at?: string | null;
  readonly decision_rationale?: string | null;
}

export interface AiMemoryCandidateDto {
  readonly id: number;
  readonly company_id: number;
  readonly memory_kind: 'episodic' | 'semantic' | 'procedural';
  readonly scope_kind: 'task' | 'project' | 'company';
  readonly scope_ref: string;
  readonly title: string;
  readonly content: string;
  readonly source_ref: string;
  readonly confidence_bps: number;
  readonly data_classification: 'local_only' | 'cloud_eligible' | 'restricted';
  readonly status: 'candidate' | 'approved' | 'rejected' | 'revoked' | 'expired';
}

export interface AiSkillVersionDto {
  readonly id: number;
  readonly company_id: number;
  readonly code: string;
  readonly version: string;
  readonly title?: string;
  readonly status: 'candidate' | 'approved' | 'rejected' | 'revoked';
}

export interface AiGovernanceApprovalDto {
  readonly id: number;
  readonly company_id: number;
  readonly definition_id?: number;
  readonly resource_model: string;
  readonly resource_id: number;
  readonly current_state: string;
  readonly status: string;
  readonly revision: number;
  readonly requested_by_id?: number;
}

export interface AiCapabilityGateDto {
  readonly gate: string;
  readonly label: string;
  readonly passed: boolean;
  readonly safetyRegressions: number;
}

export interface AiAblationConditionDto {
  readonly passRate: number;
  readonly harmRate: number;
}

export interface AiEvalSummaryDto {
  readonly companyId: number;
  readonly agiClaimed: boolean;
  readonly counts: {
    readonly agents: number;
    readonly workContracts: number;
    readonly agentRuns: number;
    readonly artifacts: number;
    readonly obligations: number;
    readonly taskforces: number;
    readonly workforceAssignments: number;
    readonly jobs: number;
  };
  readonly capabilityGates: readonly AiCapabilityGateDto[];
  readonly ablationConditions: Readonly<Record<string, AiAblationConditionDto>>;
}

function unwrapArrayResponse<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.records)) return obj.records as T[];
  }
  return [];
}

/**
 * Sanitizes a secret reference name so it never renders raw credentials or `MW_AI_*=...` patterns.
 */
export function sanitizeSecretReferenceName(rawRef: string | undefined | null): string {
  if (!rawRef || typeof rawRef !== 'string') return 'MW_AI_UNCONFIGURED_REF';
  const beforeEquals = rawRef.split('=')[0]?.trim() ?? '';
  if (/^MW_AI_[A-Z0-9_]+$/u.test(beforeEquals)) {
    return beforeEquals;
  }
  return 'MW_AI_REDACTED_REF';
}

export function formatMicrosAsUsd(micros: number | undefined | null): string {
  const safe = typeof micros === 'number' && Number.isFinite(micros) ? micros : 0;
  return `$${(safe / 1_000_000).toFixed(4)}`;
}

export function useAiAgents() {
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'agents']),
    queryFn: async () => {
      const response = await client.request<{ success: boolean; data: AiAgentDto[] }>(
        '/api/ai/agents'
      );
      return unwrapArrayResponse<AiAgentDto>(response);
    },
  });
}

export function useAiWorkContracts() {
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'work-contracts']),
    queryFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: AiWorkContractDto[];
      }>('/api/ai/work-contracts');
      return unwrapArrayResponse<AiWorkContractDto>(response);
    },
  });
}

export function useAiRuns() {
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'runs']),
    queryFn: async () => {
      const response = await client.request<{ success: boolean; data: AiAgentRunDto[] }>(
        '/api/ai/runs'
      );
      return unwrapArrayResponse<AiAgentRunDto>(response);
    },
  });
}

export function useAiArtifacts() {
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'artifacts']),
    queryFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: AiArtifactManifestDto[];
      }>('/api/ai/artifacts');
      return unwrapArrayResponse<AiArtifactManifestDto>(response);
    },
  });
}

export function useAiObligations() {
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'obligations']),
    queryFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: AiObligationDto[];
      }>('/api/ai/obligations');
      return unwrapArrayResponse<AiObligationDto>(response);
    },
  });
}

export function useAiGrants() {
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'grants']),
    queryFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: AiCapabilityGrantDto[];
      }>('/api/ai/grants');
      return unwrapArrayResponse<AiCapabilityGrantDto>(response);
    },
  });
}

export function useAiProviders() {
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'providers']),
    queryFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: AiProviderProfileDto[];
      }>('/api/ai/providers');
      return unwrapArrayResponse<AiProviderProfileDto>(response);
    },
  });
}

export function useAiMemory() {
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'memory']),
    queryFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: {
          candidates?: AiMemoryCandidateDto[];
          skills?: AiSkillVersionDto[];
        };
      }>('/api/ai/memory');
      return {
        candidates: Array.isArray(response?.data?.candidates) ? response.data.candidates : [],
        skills: Array.isArray(response?.data?.skills) ? response.data.skills : [],
      };
    },
  });
}

export function useAiGovernanceApprovals() {
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'governance', 'approvals']),
    queryFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: AiGovernanceApprovalDto[];
      }>('/api/ai/governance/approvals');
      return unwrapArrayResponse<AiGovernanceApprovalDto>(response);
    },
  });
}

export function useAiEvalSummary() {
  return useQuery({
    queryKey: scopedQueryKey(['ai', 'eval-summary']),
    queryFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: AiEvalSummaryDto;
      }>('/api/ai/eval-summary');
      return response?.data ?? null;
    },
  });
}
