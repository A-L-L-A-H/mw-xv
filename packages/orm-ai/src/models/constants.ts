export const SLUG_CODE_PATTERN = '^[a-z][a-z0-9_.-]{1,127}$';
export const CAPABILITY_PATTERN = '^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+@v[1-9][0-9]*$';
export const SECRET_REF_PATTERN = '^MW_AI_(?:C[1-9][0-9]*_)?[A-Z0-9_]{1,100}$';
export const SHA256_PATTERN = '^[a-f0-9]{64}$';
export const UUID_PATTERN =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
export const SOURCE_MODEL_PATTERN = '^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$';

export const PROVIDER_KINDS = ['mock', 'ollama', 'openai', 'anthropic', 'freellmapi'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Origin-only Compose address of the vendored gateway. Never a path or credential. */
export const FREELMAPI_COMPOSE_ORIGIN = 'http://freellmapi:3001';

export const DATA_CLASSIFICATIONS = ['local_only', 'cloud_eligible', 'restricted'] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export const RISK_TIERS = ['R0', 'R1', 'R2', 'R3', 'R4'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export const AGENT_STATUSES = ['draft', 'active', 'paused', 'disabled', 'retired'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_ROLE_TEMPLATES = [
  'planner',
  'manager',
  'researcher',
  'builder',
  'reviewer',
] as const;
export type AgentRoleTemplate = (typeof AGENT_ROLE_TEMPLATES)[number];

export const WORK_CONTRACT_STATUSES = [
  'draft',
  'queued',
  'running',
  'in_review',
  'accepted',
  'rejected',
  'cancelled',
  'failed',
] as const;
export type WorkContractStatus = (typeof WORK_CONTRACT_STATUSES)[number];

export const VERIFICATION_METHODS = [
  'automated_test',
  'schema_check',
  'source_inspection',
  'independent_reviewer',
  'human_decision',
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const EVIDENCE_STATUSES = [
  'pending',
  'produced',
  'checked',
  'accepted',
  'rejected',
  'superseded',
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const GRANT_STATUSES = ['active', 'expired', 'revoked'] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

export const RUN_STATUSES = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TOKEN_SOURCES = ['estimated', 'provider_reported'] as const;
export type TokenSource = (typeof TOKEN_SOURCES)[number];

export const ARTIFACT_KINDS = [
  'report',
  'transcript',
  'tool_output',
  'evidence_bundle',
  'eval_result',
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const ARTIFACT_VERIFICATION_STATUSES = [
  'proposed',
  'produced',
  'checked',
  'accepted',
  'rejected',
  'superseded',
] as const;
export type ArtifactVerificationStatus = (typeof ARTIFACT_VERIFICATION_STATUSES)[number];

export const OBLIGATION_TRIGGERS = [
  'code_change',
  'source_change',
  'policy_change',
  'time_expiry',
  'manual',
] as const;
export type ObligationTrigger = (typeof OBLIGATION_TRIGGERS)[number];

export const OBLIGATION_STATUSES = [
  'open',
  'reverification_due',
  'satisfied',
  'superseded',
  'retired',
] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export const SKILL_STATUSES = ['candidate', 'approved', 'rejected', 'revoked'] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];

export const MEMORY_KINDS = ['episodic', 'semantic', 'procedural'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_SCOPE_KINDS = ['task', 'project', 'company'] as const;
export type MemoryScopeKind = (typeof MEMORY_SCOPE_KINDS)[number];

export const MEMORY_STATUSES = ['candidate', 'approved', 'rejected', 'revoked', 'expired'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const TASKFORCE_STATUSES = [
  'draft',
  'active',
  'paused',
  'completed',
  'expired',
  'disbanded',
] as const;
export type TaskforceStatus = (typeof TASKFORCE_STATUSES)[number];

export const WORKFORCE_ASSIGNMENT_STATUSES = [
  'assigned',
  'active',
  'paused',
  'completed',
  'released',
  'revoked',
] as const;
export type WorkforceAssignmentStatus = (typeof WORKFORCE_ASSIGNMENT_STATUSES)[number];

export const WORKFORCE_WRITE_MODES = ['read_only', 'scoped_write'] as const;
export type WorkforceWriteMode = (typeof WORKFORCE_WRITE_MODES)[number];
