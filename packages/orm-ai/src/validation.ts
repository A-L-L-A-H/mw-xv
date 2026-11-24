import { isIP } from 'node:net';
import type { Knex } from 'knex';
import type { Transaction } from 'objection';
import { extractRelationId, resolveMutationField } from '@moonwitness/orm';
import { CompanyMembership, User } from '@moonwitness/orm-base';
import {
  OrganizationDepartment,
  OrganizationMembership,
  OrganizationPosition,
  OrganizationTeam,
} from '@moonwitness/orm-organization';
import { Job } from '@moonwitness/jobs';
import { WorkflowInstance } from '@moonwitness/orm-workflow';
import {
  CAPABILITY_PATTERN,
  DATA_CLASSIFICATIONS,
  FREELMAPI_COMPOSE_ORIGIN,
  PROVIDER_KINDS,
  RISK_TIERS,
  SECRET_REF_PATTERN,
  SHA256_PATTERN,
  UUID_PATTERN,
  type DataClassification,
  type ProviderKind,
  type RiskTier,
} from './models/constants.js';
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

type MutationRecord = Readonly<Record<string, unknown>>;
type ModelRow = Readonly<Record<string, unknown>>;
type DbOrTrx = Knex | Transaction;

const CAPABILITY_REGEX = new RegExp(CAPABILITY_PATTERN, 'u');
const SECRET_REF_REGEX = new RegExp(SECRET_REF_PATTERN, 'u');
const SHA256_REGEX = new RegExp(SHA256_PATTERN, 'u');
const UUID_REGEX = new RegExp(UUID_PATTERN, 'iu');

const RISK_ORDER: Readonly<Record<RiskTier, number>> = {
  R0: 0,
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4,
};

function isValidJsonString(value: unknown, expectedKind?: 'array' | 'object'): boolean {
  if (typeof value !== 'string') return false;
  try {
    const parsed: unknown = JSON.parse(value);
    if (expectedKind === 'array') return Array.isArray(parsed);
    if (expectedKind === 'object') {
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
    }
    return true;
  } catch {
    return false;
  }
}

function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

export function isValidSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_REGEX.test(value);
}

export function isValidStorageKey(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export function assertSafeCapabilityIdentifier(capability: string): void {
  if (!CAPABILITY_REGEX.test(capability)) {
    throw new Error(
      `Invalid capability identifier '${capability}'; expected '<domain>.<action>@v<major>'`
    );
  }
}

export function assertValidProviderSecretRef(secretRef: string): void {
  if (!SECRET_REF_REGEX.test(secretRef)) {
    throw new Error(
      `Invalid provider secret_ref '${secretRef}'; only MW_AI_* environment variable names are permitted`
    );
  }
}

/**
 * FreeLLMAPI is a private-network inference gateway. Only its exact approved
 * origin is accepted: no path, query, fragment, credentials, alternate port,
 * or user-supplied redirect target. The default origin is the Compose service
 * address; operators may extend the policy with explicitly approved addresses.
 */
export function isApprovedFreellmOrigin(
  endpointUrl: string | null | undefined,
  approvedOrigins: readonly string[] = [FREELMAPI_COMPOSE_ORIGIN]
): boolean {
  if (typeof endpointUrl !== 'string' || endpointUrl.length > 2048) return false;
  let parsed: URL;
  try {
    parsed = new URL(endpointUrl);
  } catch {
    return false;
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== '' && parsed.pathname !== '/')
  ) {
    return false;
  }
  return approvedOrigins.some((origin) => {
    try {
      const approved = new URL(origin);
      return (
        parsed.protocol === approved.protocol &&
        parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase() ===
          approved.hostname.replace(/^\[|\]$/gu, '').toLowerCase() &&
        parsed.port === approved.port
      );
    } catch {
      return false;
    }
  });
}

export function isValidProviderEndpoint(
  kind: ProviderKind,
  endpointUrl: string | null | undefined,
  approvedFreellmOrigins: readonly string[] = [FREELMAPI_COMPOSE_ORIGIN]
): boolean {
  if (endpointUrl === undefined || endpointUrl === null || endpointUrl === '') {
    return kind === 'mock' || kind === 'openai' || kind === 'anthropic' || kind === 'freellmapi';
  }
  if (typeof endpointUrl !== 'string' || endpointUrl.length > 2048) return false;
  if (kind === 'freellmapi') return isApprovedFreellmOrigin(endpointUrl, approvedFreellmOrigins);
  let parsed: URL;
  try {
    parsed = new URL(endpointUrl);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password || parsed.hash) return false;
  const host = parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (kind === 'ollama') {
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (host === '127.0.0.1' || host === 'localhost' || host === '::1')
    );
  }
  if (kind === 'openai' || kind === 'anthropic') {
    if (parsed.protocol !== 'https:' || !host) return false;
    if (host === 'localhost' || /\.(?:localhost|local|internal)$/iu.test(host)) return false;
    if (isIP(host) !== 0) return false;
    return true;
  }
  return false;
}

export function isAllowedClassificationRoute(
  requiredClassification: DataClassification,
  providerKind: ProviderKind,
  providerClassification: DataClassification,
  allowCloudFallback = false
): boolean {
  const isLocalProvider = providerKind === 'mock' || providerKind === 'ollama';
  if (requiredClassification === 'restricted') {
    return isLocalProvider && providerClassification === 'restricted';
  }
  if (requiredClassification === 'local_only') {
    return (
      isLocalProvider &&
      (providerClassification === 'local_only' || providerClassification === 'restricted')
    );
  }
  // cloud_eligible. FreeLLMAPI is cloud egress even though its Compose origin is
  // private, so it is subject to the same classification rules as public clouds.
  if (isLocalProvider) return true;
  if (providerKind === 'openai' || providerKind === 'anthropic' || providerKind === 'freellmapi') {
    return providerClassification === 'cloud_eligible';
  }
  return false;
}

export interface AgentOperationalLike {
  readonly active?: boolean | number;
  readonly status: string;
  readonly is_emergency_stopped?: boolean | number;
  readonly retired_at?: string | null;
}

export function isAgentOperational(agent: AgentOperationalLike): boolean {
  if (agent.active === false || agent.active === 0) return false;
  if (agent.status !== 'active') return false;
  if (agent.is_emergency_stopped === true || agent.is_emergency_stopped === 1) return false;
  if (agent.retired_at !== undefined && agent.retired_at !== null && agent.retired_at !== '') {
    return false;
  }
  return true;
}

export interface CapabilityGrantCheckContext {
  readonly companyId: number;
  readonly agentId: number;
  readonly workContractId?: number | null;
  readonly capability: string;
  readonly expectedPolicyVersion: number;
  readonly now?: Date;
}

export interface CapabilityGrantLike {
  readonly active?: boolean | number;
  readonly company_id: number;
  readonly agent_id: number;
  readonly work_contract_id?: number | null;
  readonly capability: string;
  readonly policy_version: number;
  readonly status: string;
  readonly expires_at: string;
  readonly revoked_at?: string | null;
}

export function isActiveCapabilityGrant(
  grant: CapabilityGrantLike,
  context: CapabilityGrantCheckContext
): boolean {
  if (grant.active === false || grant.active === 0) return false;
  if (grant.status !== 'active') return false;
  if (grant.revoked_at !== undefined && grant.revoked_at !== null && grant.revoked_at !== '') {
    return false;
  }
  if (grant.company_id !== context.companyId) return false;
  if (grant.agent_id !== context.agentId) return false;
  if (
    grant.work_contract_id !== undefined &&
    grant.work_contract_id !== null &&
    grant.work_contract_id !== context.workContractId
  ) {
    return false;
  }
  if (!CAPABILITY_REGEX.test(context.capability) || grant.capability !== context.capability) {
    return false;
  }
  if (grant.policy_version !== context.expectedPolicyVersion) return false;
  const expiresMs = Date.parse(grant.expires_at);
  if (!Number.isFinite(expiresMs)) return false;
  const nowMs = (context.now ?? new Date()).getTime();
  return expiresMs > nowMs;
}

export interface MemoryCandidateLike {
  readonly active?: boolean | number;
  readonly company_id: number;
  readonly status: string;
  readonly data_classification: DataClassification;
  readonly revoked_at?: string | null;
  readonly expires_at?: string | null;
}

export interface MemoryConsumptionContext {
  readonly companyId: number;
  readonly allowedClassifications?: readonly DataClassification[];
  readonly now?: Date;
}

export function isUsableApprovedMemory(
  candidate: MemoryCandidateLike,
  context: MemoryConsumptionContext
): boolean {
  if (candidate.active === false || candidate.active === 0) return false;
  if (candidate.company_id !== context.companyId) return false;
  if (candidate.status !== 'approved') return false;
  if (
    candidate.revoked_at !== undefined &&
    candidate.revoked_at !== null &&
    candidate.revoked_at !== ''
  ) {
    return false;
  }
  if (
    candidate.expires_at !== undefined &&
    candidate.expires_at !== null &&
    candidate.expires_at !== ''
  ) {
    const expiresMs = Date.parse(candidate.expires_at);
    if (!Number.isFinite(expiresMs) || expiresMs <= (context.now ?? new Date()).getTime()) {
      return false;
    }
  }
  if (
    context.allowedClassifications &&
    !context.allowedClassifications.includes(candidate.data_classification)
  ) {
    return false;
  }
  return true;
}

export interface SkillVersionLike {
  readonly active?: boolean | number;
  readonly company_id: number;
  readonly status: string;
  readonly revoked_at?: string | null;
  readonly expires_at?: string | null;
}

export function isUsableApprovedSkill(
  skill: SkillVersionLike,
  context: { readonly companyId: number; readonly now?: Date }
): boolean {
  if (skill.active === false || skill.active === 0) return false;
  if (skill.company_id !== context.companyId) return false;
  if (skill.status !== 'approved') return false;
  if (skill.revoked_at !== undefined && skill.revoked_at !== null && skill.revoked_at !== '') {
    return false;
  }
  if (skill.expires_at !== undefined && skill.expires_at !== null && skill.expires_at !== '') {
    const expiresMs = Date.parse(skill.expires_at);
    if (!Number.isFinite(expiresMs) || expiresMs <= (context.now ?? new Date()).getTime()) {
      return false;
    }
  }
  return true;
}

export interface ServicePrincipalValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

export async function validateServicePrincipalUser(
  userId: number,
  expectedCompanyId: number,
  trx?: DbOrTrx,
  excludeAgentId?: number
): Promise<ServicePrincipalValidationResult> {
  if (!isPositiveInt(userId) || !isPositiveInt(expectedCompanyId)) {
    return { valid: false, reason: 'Invalid user or company identifier' };
  }
  const user = (await User.query(trx).findById(userId).withGraphFetched('partner')) as unknown as
    | {
        id: number;
        active?: boolean | number;
        role?: string;
        password?: string | null;
        partner?: { id: number; active?: boolean | number };
      }
    | undefined;
  if (!user || user.active === false || user.active === 0) {
    return { valid: false, reason: 'Service principal user not found or inactive' };
  }
  if (!user.partner || user.partner.active === false || user.partner.active === 0) {
    return { valid: false, reason: 'Service principal partner must be active' };
  }
  if (user.role !== 'user') {
    return { valid: false, reason: 'Service principal user must hold role "user" only' };
  }
  if (user.password !== null && user.password !== undefined) {
    return { valid: false, reason: 'Service principal user cannot have a password' };
  }

  const memberships = (await CompanyMembership.query(trx).where('user_id', userId)) as unknown as {
    company_id: number;
    active?: boolean | number;
  }[];
  if (memberships.length !== 1) {
    return {
      valid: false,
      reason: 'Service principal user must hold exactly one company membership',
    };
  }
  const [membership] = memberships;
  if (
    membership.active === false ||
    membership.active === 0 ||
    membership.company_id !== expectedCompanyId
  ) {
    return {
      valid: false,
      reason: 'Service principal company membership must match the owning agent company',
    };
  }

  const existingAgents = await Agent.query(trx).where('service_user_id', userId);
  const conflicting = existingAgents.find((candidate) => candidate.id !== excludeAgentId);
  if (conflicting) {
    return { valid: false, reason: 'Service principal user is already linked to another agent' };
  }

  return { valid: true };
}

export async function assertAgentServicePrincipal(
  dbOrTrx: DbOrTrx,
  params: {
    readonly companyId: number;
    readonly userId: number;
    readonly excludeAgentId?: number;
  }
): Promise<void> {
  const result = await validateServicePrincipalUser(
    params.userId,
    params.companyId,
    dbOrTrx,
    params.excludeAgentId
  );
  if (!result.valid) {
    throw new Error(result.reason ?? 'Invalid agent service principal');
  }
}

export async function findAgentByServiceUserId(
  dbOrTrx: DbOrTrx,
  userId: number
): Promise<InstanceType<typeof Agent> | undefined> {
  if (!isPositiveInt(userId)) return undefined;
  return Agent.query(dbOrTrx).where('service_user_id', userId).first();
}

export async function assertAcyclicAgentHierarchy(
  agentId: number | undefined,
  reportsToAgentId: number | null,
  companyId: number,
  trx?: DbOrTrx
): Promise<boolean> {
  const visited = new Set<number>();
  if (agentId !== undefined) visited.add(agentId);
  let nextId = reportsToAgentId;
  while (nextId !== null) {
    if (visited.has(nextId)) return false;
    visited.add(nextId);
    const row = (await Agent.query(trx).findById(nextId)) as unknown as ModelRow | undefined;
    if (!row || row.company_id !== companyId) return false;
    const next = row.reports_to_agent_id;
    nextId = typeof next === 'number' ? next : null;
  }
  return true;
}

export async function assertAcyclicWorkContractHierarchy(
  contractId: number | undefined,
  parentContractId: number | null,
  companyId: number,
  maxDepth: number,
  trx?: DbOrTrx
): Promise<boolean> {
  const visited = new Set<number>();
  if (contractId !== undefined) visited.add(contractId);
  let nextId = parentContractId;
  let depth = 0;
  while (nextId !== null) {
    depth += 1;
    if (depth > maxDepth) return false;
    if (visited.has(nextId)) return false;
    visited.add(nextId);
    const row = (await WorkContract.query(trx).findById(nextId)) as unknown as ModelRow | undefined;
    if (!row || row.company_id !== companyId) return false;
    const next = row.parent_contract_id;
    nextId = typeof next === 'number' ? next : null;
  }
  return true;
}

async function sameCompanyRecord(
  model: { query(trx?: DbOrTrx): { findById(id: number): PromiseLike<unknown> } },
  id: number | null,
  companyId: number,
  trx?: DbOrTrx
): Promise<ModelRow | null> {
  if (id === null) return null;
  const row = (await model.query(trx).findById(id)) as ModelRow | undefined;
  if (!row || row.company_id !== companyId) return null;
  return row;
}

/** Validate company scope, hierarchy acyclicity, capability/classification bounds, and service principals. */
export async function isValidAiMutation(
  modelName: string,
  values: MutationRecord,
  current?: ModelRow,
  trx?: DbOrTrx
): Promise<boolean> {
  if (!modelName.startsWith('ai.')) return true;
  const companyId = extractRelationId(values, current, 'company');
  if (companyId === null) return false;
  if (current && typeof current.company_id === 'number' && current.company_id !== companyId) {
    return false;
  }
  const currentId = typeof current?.id === 'number' ? current.id : undefined;

  if (modelName === ProviderProfile.modelName) {
    const kind = resolveMutationField<ProviderKind>(values, current, 'kind');
    if (typeof kind !== 'string' || !PROVIDER_KINDS.includes(kind as ProviderKind)) return false;
    const classification =
      resolveMutationField(values, current, 'data_classification') ?? 'local_only';
    if (!DATA_CLASSIFICATIONS.includes(classification as DataClassification)) return false;
    const secretRef = resolveMutationField(values, current, 'secret_ref');
    if (typeof secretRef !== 'string' || !SECRET_REF_REGEX.test(secretRef)) return false;
    const endpointUrl = resolveMutationField(values, current, 'endpoint_url');
    if (endpointUrl !== undefined && endpointUrl !== null && typeof endpointUrl !== 'string') {
      return false;
    }
    if (!isValidProviderEndpoint(kind as ProviderKind, endpointUrl as string | null | undefined)) {
      return false;
    }
    const timeoutMs = resolveMutationField(values, current, 'timeout_ms') ?? 30000;
    const maxConcurrency = resolveMutationField(values, current, 'max_concurrency') ?? 2;
    const rateLimitRpm = resolveMutationField(values, current, 'rate_limit_rpm') ?? 60;
    return isPositiveInt(timeoutMs) && isPositiveInt(maxConcurrency) && isPositiveInt(rateLimitRpm);
  }

  if (modelName === ModelProfile.modelName) {
    const providerId = extractRelationId(values, current, 'provider_profile');
    if (!(await sameCompanyRecord(ProviderProfile, providerId, companyId, trx))) return false;
    const contextWindow = resolveMutationField(values, current, 'context_window') ?? 8192;
    const maxOutputTokens = resolveMutationField(values, current, 'max_output_tokens') ?? 2048;
    const inputCost = resolveMutationField(values, current, 'input_cost_micros_per_1k') ?? 0;
    const outputCost = resolveMutationField(values, current, 'output_cost_micros_per_1k') ?? 0;
    const modalities = resolveMutationField(values, current, 'modalities_json') ?? '["text"]';
    return (
      isPositiveInt(contextWindow) &&
      isPositiveInt(maxOutputTokens) &&
      isNonNegativeInt(inputCost) &&
      isNonNegativeInt(outputCost) &&
      isValidJsonString(modalities, 'array')
    );
  }

  if (modelName === ExecutionPolicy.modelName) {
    const policyVersion = resolveMutationField(values, current, 'policy_version') ?? 1;
    const defaultTier = (resolveMutationField(values, current, 'default_risk_tier') ??
      'R0') as RiskTier;
    const maxTier = (resolveMutationField(values, current, 'max_risk_tier') ?? 'R0') as RiskTier;
    if (!RISK_TIERS.includes(defaultTier) || !RISK_TIERS.includes(maxTier)) return false;
    if (RISK_ORDER[defaultTier] > RISK_ORDER[maxTier]) return false;
    const classification =
      resolveMutationField(values, current, 'allowed_classification') ?? 'local_only';
    if (!DATA_CLASSIFICATIONS.includes(classification as DataClassification)) return false;
    const maxSteps = resolveMutationField(values, current, 'max_steps') ?? 8;
    const maxWall = resolveMutationField(values, current, 'max_wall_clock_seconds') ?? 120;
    const maxTokens = resolveMutationField(values, current, 'max_tokens_per_run') ?? 32000;
    const maxCost = resolveMutationField(values, current, 'max_cost_micros_per_run') ?? 0;
    const maxDepth = resolveMutationField(values, current, 'max_delegation_depth') ?? 0;
    const maxConcurrent = resolveMutationField(values, current, 'max_concurrent_runs') ?? 1;
    return (
      isPositiveInt(policyVersion) &&
      isPositiveInt(maxSteps) &&
      isPositiveInt(maxWall) &&
      isPositiveInt(maxTokens) &&
      isNonNegativeInt(maxCost) &&
      isNonNegativeInt(maxDepth) &&
      isPositiveInt(maxConcurrent)
    );
  }

  if (modelName === Agent.modelName) {
    const departmentId = extractRelationId(values, current, 'department');
    if (
      departmentId !== null &&
      !(await sameCompanyRecord(OrganizationDepartment, departmentId, companyId, trx))
    ) {
      return false;
    }
    const teamId = extractRelationId(values, current, 'team');
    if (teamId !== null) {
      const team = await sameCompanyRecord(OrganizationTeam, teamId, companyId, trx);
      if (!team) return false;
      if (departmentId !== null && team.department_id !== departmentId) return false;
    }
    const positionId = extractRelationId(values, current, 'position');
    if (positionId !== null) {
      const position = await sameCompanyRecord(OrganizationPosition, positionId, companyId, trx);
      if (!position) return false;
      if (
        departmentId !== null &&
        position.department_id !== null &&
        position.department_id !== undefined &&
        position.department_id !== departmentId
      ) {
        return false;
      }
    }
    const orgMembershipId = extractRelationId(values, current, 'organization_membership');
    if (
      orgMembershipId !== null &&
      !(await sameCompanyRecord(OrganizationMembership, orgMembershipId, companyId, trx))
    ) {
      return false;
    }
    const reportsToId = extractRelationId(values, current, 'reports_to_agent');
    if (!(await assertAcyclicAgentHierarchy(currentId, reportsToId, companyId, trx))) {
      return false;
    }
    const retiredAt = resolveMutationField(values, current, 'retired_at');
    if (
      retiredAt !== undefined &&
      retiredAt !== null &&
      retiredAt !== '' &&
      !isValidIsoTimestamp(retiredAt)
    ) {
      return false;
    }
    const serviceUserId = extractRelationId(values, current, 'service_user');
    if (serviceUserId !== null) {
      const check = await validateServicePrincipalUser(serviceUserId, companyId, trx, currentId);
      if (!check.valid) return false;
    }
    return true;
  }

  if (modelName === AgentProfile.modelName) {
    const agentId = extractRelationId(values, current, 'agent');
    if (!(await sameCompanyRecord(Agent, agentId, companyId, trx))) return false;
    const modelProfileId = extractRelationId(values, current, 'default_model_profile');
    if (
      modelProfileId !== null &&
      !(await sameCompanyRecord(ModelProfile, modelProfileId, companyId, trx))
    ) {
      return false;
    }
    const policyId = extractRelationId(values, current, 'default_execution_policy');
    if (
      policyId !== null &&
      !(await sameCompanyRecord(ExecutionPolicy, policyId, companyId, trx))
    ) {
      return false;
    }
    const caps = resolveMutationField(values, current, 'default_capabilities_json') ?? '[]';
    if (!isValidJsonString(caps, 'array')) return false;
    for (const item of JSON.parse(caps as string) as unknown[]) {
      if (typeof item !== 'string' || !CAPABILITY_REGEX.test(item)) return false;
    }
    return true;
  }

  if (modelName === WorkContract.modelName) {
    const policyId = extractRelationId(values, current, 'execution_policy');
    const policy = await sameCompanyRecord(ExecutionPolicy, policyId, companyId, trx);
    if (!policy) return false;
    const riskTier = (resolveMutationField(values, current, 'risk_tier') ?? 'R0') as RiskTier;
    const maxPolicyTier = policy.max_risk_tier as RiskTier;
    if (!RISK_TIERS.includes(riskTier) || RISK_ORDER[riskTier] > RISK_ORDER[maxPolicyTier]) {
      return false;
    }
    const classification =
      resolveMutationField(values, current, 'data_classification') ?? 'local_only';
    if (!DATA_CLASSIFICATIONS.includes(classification as DataClassification)) return false;
    const assignedAgentId = extractRelationId(values, current, 'assigned_agent');
    if (
      assignedAgentId !== null &&
      !(await sameCompanyRecord(Agent, assignedAgentId, companyId, trx))
    ) {
      return false;
    }
    const reviewerAgentId = extractRelationId(values, current, 'reviewer_agent');
    if (
      reviewerAgentId !== null &&
      !(await sameCompanyRecord(Agent, reviewerAgentId, companyId, trx))
    ) {
      return false;
    }
    if (
      assignedAgentId !== null &&
      reviewerAgentId !== null &&
      assignedAgentId === reviewerAgentId
    ) {
      return false;
    }
    const workflowId = extractRelationId(values, current, 'workflow_instance');
    if (
      workflowId !== null &&
      !(await sameCompanyRecord(WorkflowInstance, workflowId, companyId, trx))
    ) {
      return false;
    }
    const delegationDepth = resolveMutationField(values, current, 'delegation_depth') ?? 0;
    const maxDepth =
      typeof policy.max_delegation_depth === 'number' ? policy.max_delegation_depth : 0;
    if (!isNonNegativeInt(delegationDepth) || delegationDepth > maxDepth) return false;
    const parentId = extractRelationId(values, current, 'parent_contract');
    if (parentId !== null) {
      const parent = await sameCompanyRecord(WorkContract, parentId, companyId, trx);
      if (!parent) return false;
      const parentDepth = typeof parent.delegation_depth === 'number' ? parent.delegation_depth : 0;
      if (delegationDepth <= parentDepth) return false;
    }
    if (
      !(await assertAcyclicWorkContractHierarchy(currentId, parentId, companyId, maxDepth, trx))
    ) {
      return false;
    }
    return (
      isValidJsonString(resolveMutationField(values, current, 'scope_json') ?? '{}', 'object') &&
      isValidJsonString(
        resolveMutationField(values, current, 'constraints_json') ?? '{}',
        'object'
      ) &&
      isValidJsonString(resolveMutationField(values, current, 'non_goals_json') ?? '[]', 'array') &&
      isValidJsonString(
        resolveMutationField(values, current, 'expected_deliverables_json') ?? '[]',
        'array'
      )
    );
  }

  if (modelName === AcceptanceCriterion.modelName) {
    const contractId = extractRelationId(values, current, 'work_contract');
    const contract = await sameCompanyRecord(WorkContract, contractId, companyId, trx);
    if (!contract) return false;
    const sequence = resolveMutationField(values, current, 'sequence') ?? 1;
    const version = resolveMutationField(values, current, 'version') ?? 1;
    if (!isPositiveInt(sequence) || !isPositiveInt(version)) return false;

    const lockedAt = contract.criteria_locked_at;
    if (current && typeof lockedAt === 'string' && lockedAt.trim().length > 0) {
      const lockedSpecFields = [
        'code',
        'title',
        'verification_method',
        'required_evidence_type',
        'mandatory',
      ] as const;
      const specChanged = lockedSpecFields.some(
        (field) => Object.hasOwn(values, field) && values[field] !== current[field]
      );
      if (specChanged) {
        const previousVersion = typeof current.version === 'number' ? current.version : 1;
        if (version <= previousVersion) return false;
      }
    }
    return true;
  }

  if (modelName === CapabilityGrant.modelName) {
    const agentId = extractRelationId(values, current, 'agent');
    if (!(await sameCompanyRecord(Agent, agentId, companyId, trx))) return false;
    const policyId = extractRelationId(values, current, 'execution_policy');
    const policy = await sameCompanyRecord(ExecutionPolicy, policyId, companyId, trx);
    if (!policy) return false;
    const contractId = extractRelationId(values, current, 'work_contract');
    if (
      contractId !== null &&
      !(await sameCompanyRecord(WorkContract, contractId, companyId, trx))
    ) {
      return false;
    }
    const capability = resolveMutationField(values, current, 'capability');
    if (typeof capability !== 'string' || !CAPABILITY_REGEX.test(capability)) return false;
    const policyVersion = resolveMutationField(values, current, 'policy_version');
    if (policyVersion !== policy.policy_version) return false;
    const maxCalls = resolveMutationField(values, current, 'max_calls_per_run') ?? 25;
    if (!isPositiveInt(maxCalls)) return false;
    const issuedAt = resolveMutationField(values, current, 'issued_at');
    const expiresAt = resolveMutationField(values, current, 'expires_at');
    if (!isValidIsoTimestamp(issuedAt) || !isValidIsoTimestamp(expiresAt)) return false;
    if (Date.parse(expiresAt) <= Date.parse(issuedAt)) return false;
    return isValidJsonString(resolveMutationField(values, current, 'scope_json') ?? '{}', 'object');
  }

  if (modelName === AgentRun.modelName) {
    const contractId = extractRelationId(values, current, 'work_contract');
    const contract = await sameCompanyRecord(WorkContract, contractId, companyId, trx);
    if (!contract) return false;
    const agentId = extractRelationId(values, current, 'agent');
    if (!(await sameCompanyRecord(Agent, agentId, companyId, trx))) return false;
    const grantId = extractRelationId(values, current, 'capability_grant');
    const grant = await sameCompanyRecord(CapabilityGrant, grantId, companyId, trx);
    if (!grant || grant.agent_id !== agentId) return false;
    if (
      grant.work_contract_id !== null &&
      grant.work_contract_id !== undefined &&
      grant.work_contract_id !== contractId
    ) {
      return false;
    }
    if (!current && (grant.status !== 'active' || Boolean(grant.revoked_at))) {
      return false;
    }
    const providerId = extractRelationId(values, current, 'provider_profile');
    const provider = await sameCompanyRecord(ProviderProfile, providerId, companyId, trx);
    if (!provider) return false;
    const modelProfileId = extractRelationId(values, current, 'model_profile');
    const modelProfile = await sameCompanyRecord(ModelProfile, modelProfileId, companyId, trx);
    if (!modelProfile || modelProfile.provider_profile_id !== providerId) return false;
    const policyId = extractRelationId(values, current, 'execution_policy');
    const policy = await sameCompanyRecord(ExecutionPolicy, policyId, companyId, trx);
    if (!policy || grant.execution_policy_id !== policyId) return false;
    if (
      !isAllowedClassificationRoute(
        contract.data_classification as DataClassification,
        provider.kind as ProviderKind,
        provider.data_classification as DataClassification,
        Boolean(policy.allow_cloud_fallback)
      )
    ) {
      return false;
    }
    const jobId = extractRelationId(values, current, 'job');
    if (jobId !== null) {
      const job = (await Job.query(trx).findById(jobId)) as unknown as ModelRow | undefined;
      if (
        !job ||
        (job.company_id !== null && job.company_id !== undefined && job.company_id !== companyId)
      ) {
        return false;
      }
    }
    return (
      isNonNegativeInt(resolveMutationField(values, current, 'fencing_token') ?? 0) &&
      isNonNegativeInt(resolveMutationField(values, current, 'step_count') ?? 0) &&
      isNonNegativeInt(resolveMutationField(values, current, 'input_tokens') ?? 0) &&
      isNonNegativeInt(resolveMutationField(values, current, 'output_tokens') ?? 0) &&
      isNonNegativeInt(resolveMutationField(values, current, 'estimated_cost_micros') ?? 0)
    );
  }

  if (modelName === ArtifactManifest.modelName) {
    const contractId = extractRelationId(values, current, 'work_contract');
    if (!(await sameCompanyRecord(WorkContract, contractId, companyId, trx))) return false;
    const criterionId = extractRelationId(values, current, 'acceptance_criterion');
    if (criterionId !== null) {
      const criterion = await sameCompanyRecord(AcceptanceCriterion, criterionId, companyId, trx);
      if (!criterion || criterion.work_contract_id !== contractId) return false;
    }
    const runId = extractRelationId(values, current, 'agent_run');
    if (runId !== null) {
      const run = await sameCompanyRecord(AgentRun, runId, companyId, trx);
      if (!run || run.work_contract_id !== contractId) return false;
    }
    const producerAgentId = extractRelationId(values, current, 'producer_agent');
    if (
      producerAgentId !== null &&
      !(await sameCompanyRecord(Agent, producerAgentId, companyId, trx))
    ) {
      return false;
    }
    const classification =
      resolveMutationField(values, current, 'data_classification') ?? 'local_only';
    if (!DATA_CLASSIFICATIONS.includes(classification as DataClassification)) return false;
    const storageKey = resolveMutationField(values, current, 'storage_key');
    const sha256 = resolveMutationField(values, current, 'sha256');
    const sizeBytes = resolveMutationField(values, current, 'size_bytes');
    return isValidStorageKey(storageKey) && isValidSha256(sha256) && isNonNegativeInt(sizeBytes);
  }

  if (modelName === Obligation.modelName) {
    const originContractId = extractRelationId(values, current, 'origin_contract');
    if (!(await sameCompanyRecord(WorkContract, originContractId, companyId, trx))) return false;
    const originArtifactId = extractRelationId(values, current, 'origin_artifact');
    if (originArtifactId !== null) {
      const originArtifact = await sameCompanyRecord(
        ArtifactManifest,
        originArtifactId,
        companyId,
        trx
      );
      if (!originArtifact || originArtifact.work_contract_id !== originContractId) return false;
    }
    const ownerAgentId = extractRelationId(values, current, 'owner_agent');
    if (ownerAgentId !== null && !(await sameCompanyRecord(Agent, ownerAgentId, companyId, trx))) {
      return false;
    }
    const ownerUserId = extractRelationId(values, current, 'owner_user');
    if (ownerUserId !== null) {
      const user = (await User.query(trx).findById(ownerUserId)) as unknown as ModelRow | undefined;
      if (!user || user.active === false || user.active === 0) return false;
    }
    const status = resolveMutationField(values, current, 'status') ?? 'open';
    if (status === 'superseded' || status === 'retired') {
      const rationale = resolveMutationField(values, current, 'decision_rationale');
      if (typeof rationale !== 'string' || rationale.trim().length === 0) return false;
    }
    return (
      isValidJsonString(resolveMutationField(values, current, 'scope_json') ?? '{}', 'object') &&
      isValidJsonString(resolveMutationField(values, current, 'impact_links_json') ?? '[]', 'array')
    );
  }

  if (modelName === Taskforce.modelName) {
    const leadAgentId = extractRelationId(values, current, 'lead_agent');
    if (leadAgentId !== null && !(await sameCompanyRecord(Agent, leadAgentId, companyId, trx))) {
      return false;
    }
    const contractId = extractRelationId(values, current, 'work_contract');
    if (
      contractId !== null &&
      !(await sameCompanyRecord(WorkContract, contractId, companyId, trx))
    ) {
      return false;
    }
    const policyId = extractRelationId(values, current, 'execution_policy');
    if (
      policyId !== null &&
      !(await sameCompanyRecord(ExecutionPolicy, policyId, companyId, trx))
    ) {
      return false;
    }
    const expiresAt = resolveMutationField(values, current, 'expires_at');
    if (
      expiresAt !== undefined &&
      expiresAt !== null &&
      expiresAt !== '' &&
      !isValidIsoTimestamp(expiresAt)
    ) {
      return false;
    }
    const disbandedAt = resolveMutationField(values, current, 'disbanded_at');
    if (
      disbandedAt !== undefined &&
      disbandedAt !== null &&
      disbandedAt !== '' &&
      !isValidIsoTimestamp(disbandedAt)
    ) {
      return false;
    }
    const maxAgents = resolveMutationField(values, current, 'max_agents') ?? 4;
    const budgetMicros = resolveMutationField(values, current, 'budget_micros') ?? 0;
    const spentMicros = resolveMutationField(values, current, 'spent_micros') ?? 0;
    return (
      isPositiveInt(maxAgents) &&
      isNonNegativeInt(budgetMicros) &&
      isNonNegativeInt(spentMicros) &&
      isValidJsonString(resolveMutationField(values, current, 'scope_json') ?? '{}', 'object')
    );
  }

  if (modelName === WorkforceAssignment.modelName) {
    const taskforceId = extractRelationId(values, current, 'taskforce');
    if (!(await sameCompanyRecord(Taskforce, taskforceId, companyId, trx))) return false;
    const agentId = extractRelationId(values, current, 'agent');
    if (!(await sameCompanyRecord(Agent, agentId, companyId, trx))) return false;
    const contractId = extractRelationId(values, current, 'work_contract');
    if (
      contractId !== null &&
      !(await sameCompanyRecord(WorkContract, contractId, companyId, trx))
    ) {
      return false;
    }
    const assignedAt = resolveMutationField(values, current, 'assigned_at');
    if (!isValidIsoTimestamp(assignedAt)) return false;
    const expiresAt = resolveMutationField(values, current, 'expires_at');
    if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
      if (!isValidIsoTimestamp(expiresAt)) return false;
      if (Date.parse(expiresAt) <= Date.parse(assignedAt)) return false;
    }
    const budgetMicros = resolveMutationField(values, current, 'budget_micros') ?? 0;
    return isNonNegativeInt(budgetMicros);
  }

  if (modelName === SkillVersion.modelName) {
    const sourceRunId = extractRelationId(values, current, 'source_run');
    if (sourceRunId !== null && !(await sameCompanyRecord(AgentRun, sourceRunId, companyId, trx))) {
      return false;
    }
    const workflowId = extractRelationId(values, current, 'approval_workflow');
    if (
      workflowId !== null &&
      !(await sameCompanyRecord(WorkflowInstance, workflowId, companyId, trx))
    ) {
      return false;
    }
    const evalScore = resolveMutationField(values, current, 'eval_score_bps');
    if (
      evalScore !== undefined &&
      evalScore !== null &&
      (!isNonNegativeInt(evalScore) || evalScore > 10000)
    ) {
      return false;
    }
    const caps = resolveMutationField(values, current, 'allowed_capabilities_json') ?? '[]';
    if (!isValidJsonString(caps, 'array')) return false;
    for (const item of JSON.parse(caps as string) as unknown[]) {
      if (typeof item !== 'string' || !CAPABILITY_REGEX.test(item)) return false;
    }
    return isPositiveInt(resolveMutationField(values, current, 'version') ?? 1);
  }

  if (modelName === MemoryCandidate.modelName) {
    const classification =
      resolveMutationField(values, current, 'data_classification') ?? 'local_only';
    if (!DATA_CLASSIFICATIONS.includes(classification as DataClassification)) return false;
    const contractId = extractRelationId(values, current, 'work_contract');
    if (
      contractId !== null &&
      !(await sameCompanyRecord(WorkContract, contractId, companyId, trx))
    ) {
      return false;
    }
    const runId = extractRelationId(values, current, 'source_run');
    const run = runId !== null ? await sameCompanyRecord(AgentRun, runId, companyId, trx) : null;
    if (runId !== null && !run) return false;
    if (run && contractId !== null && run.work_contract_id !== contractId) return false;
    const agentId = extractRelationId(values, current, 'source_agent');
    if (agentId !== null && !(await sameCompanyRecord(Agent, agentId, companyId, trx))) {
      return false;
    }
    if (run && agentId !== null && run.agent_id !== agentId) return false;
    const artifactId = extractRelationId(values, current, 'evidence_artifact');
    if (artifactId !== null) {
      const artifact = await sameCompanyRecord(ArtifactManifest, artifactId, companyId, trx);
      if (!artifact) return false;
      if (contractId !== null && artifact.work_contract_id !== contractId) return false;
    }
    const skillId = extractRelationId(values, current, 'promoted_skill');
    if (skillId !== null && !(await sameCompanyRecord(SkillVersion, skillId, companyId, trx))) {
      return false;
    }
    const workflowId = extractRelationId(values, current, 'approval_workflow');
    if (
      workflowId !== null &&
      !(await sameCompanyRecord(WorkflowInstance, workflowId, companyId, trx))
    ) {
      return false;
    }
    const confidence = resolveMutationField(values, current, 'confidence_bps') ?? 5000;
    return isNonNegativeInt(confidence) && confidence <= 10000;
  }

  return true;
}
